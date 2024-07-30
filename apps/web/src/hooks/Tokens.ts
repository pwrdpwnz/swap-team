import { ChainId, Currency, Token } from '@uniswap/sdk-core'
import { chainIdToBackendChain, getChainInfo, isSupportedChainId, useSupportedChainId } from 'constants/chains'
import { COMMON_BASES } from 'constants/routing'
import { NATIVE_CHAIN_ID, UNKNOWN_TOKEN_SYMBOL } from 'constants/tokens'
import { arrayify, parseBytes32String } from 'ethers/lib/utils'
import { gqlTokenToCurrencyInfo } from 'graphql/data/types'
import { useBytes32TokenContract, useTokenContract } from 'hooks/useContract'
import { NEVER_RELOAD, useSingleCallResult } from 'lib/hooks/multicall'
import { TokenAddressMap } from 'lib/hooks/useTokenList/utils'
import { useMemo } from 'react'
import { TokenFromList } from 'state/lists/tokenFromList'
import {
  Token as GqlToken,
  SafetyLevel,
  useSimpleTokenQuery,
} from 'uniswap/src/data/graphql/uniswap-data-api/__generated__/types-and-hooks'
import { CurrencyInfo } from 'uniswap/src/features/dataApi/types'
import { isAddress, isSameAddress } from 'utilities/src/addresses'
import { DEFAULT_ERC20_DECIMALS } from 'utilities/src/tokens/constants'
import { currencyId } from 'utils/currencyId'
import { getNativeTokenDBAddress } from 'utils/nativeTokens'
import { useChainId } from 'wagmi'
import { useCombinedInactiveLists } from '../state/lists/hooks'
import { useUserAddedTokens } from '../state/user/userAddedTokens'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import {Contract} from 'ethers' // Важно: убедитесь, что импортируется именно из 'ethers'

type Maybe<T> = T | undefined

function useTokensFromMap(tokenMap: TokenAddressMap, chainId: Maybe<ChainId>): { [address: string]: TokenFromList } {
  return useMemo(() => {
    if (!chainId) return {}

    return Object.keys(tokenMap[chainId] ?? {}).reduce<{ [address: string]: TokenFromList }>((newMap, address) => {
      newMap[address] = tokenMap[chainId][address].token
      return newMap
    }, {})
  }, [chainId, tokenMap])
}

export function useFallbackListTokens(chainId: Maybe<ChainId>): { [address: string]: Token } {
  const fallbackListTokens = useCombinedInactiveLists()
  const tokensFromMap = useTokensFromMap(fallbackListTokens, chainId)
  const userAddedTokens = useUserAddedTokens()
  return useMemo(() => {
    return userAddedTokens.reduce<{ [address: string]: Token }>(
      (tokenMap, token) => {
        tokenMap[token.address] = token;
        return tokenMap;
      },
      { ...tokensFromMap }
    );
  }, [tokensFromMap, userAddedTokens])
}

export function useIsUserAddedToken(currency: Currency | undefined | null): boolean {
  const userAddedTokens = useUserAddedTokens()

  if (!currency) {
    return false
  }

  return !!userAddedTokens.find((token) => currency.equals(token))
}

export function useCurrency(address?: string, chainId?: ChainId, skip?: boolean): Maybe<Currency> {
  const currencyInfo = useCurrencyInfo(address, chainId, skip)
  return currencyInfo?.currency
}

export function useCurrencyInfo(currency?: Currency): Maybe<CurrencyInfo>
export function useCurrencyInfo(address?: string, chainId?: ChainId, skip?: boolean): Maybe<CurrencyInfo>
export function useCurrencyInfo(
  addressOrCurrency?: string | Currency,
  chainId?: ChainId,
  skip?: boolean
): Maybe<CurrencyInfo> {
  const connectedChainId = useChainId()
  const fallbackListTokens = useFallbackListTokens(chainId ?? connectedChainId)

  const address =
    typeof addressOrCurrency === "string"
      ? addressOrCurrency
      : addressOrCurrency?.isNative
      ? NATIVE_CHAIN_ID
      : addressOrCurrency?.address;
  const chainIdWithFallback =
    (typeof addressOrCurrency === "string"
      ? chainId
      : addressOrCurrency?.chainId) ?? connectedChainId;

  const supportedChainId = useSupportedChainId(chainIdWithFallback)

  const backendChainName = chainIdToBackendChain({
    chainId: supportedChainId,
    withFallback: true,
  })
  const isNative =
    address === NATIVE_CHAIN_ID || address?.toLowerCase() === 'native' || address?.toLowerCase() === 'eth'

  const commonBase = chainIdWithFallback
    ? COMMON_BASES[chainIdWithFallback]?.find(
        (base) =>
          (base.currency.isNative && isNative) ||
          (base.currency.isToken &&
            isSameAddress(base.currency.address, address))
      )
    : undefined;

  const { data } = useSimpleTokenQuery({
    variables: {
      chain: backendChainName,
      address: isNative ? getNativeTokenDBAddress(backendChainName) : address ?? '',
    },
    skip:
      (!address && !isNative) ||
      skip ||
      !!commonBase ||
      !getChainInfo({ chainId: supportedChainId })?.backendChain.backendSupported,
    fetchPolicy: 'cache-first',
  })

  return useMemo(() => {
    if (commonBase) {
      return commonBase
    }

    const fallbackListToken = fallbackListTokens[address ?? '']
    if (fallbackListToken instanceof TokenFromList && !skip) {
      return {
        currency: fallbackListToken,
        currencyId: currencyId(fallbackListToken),
        logoUrl: fallbackListToken.tokenInfo.logoURI,
        safetyLevel: SafetyLevel.Verified,
        isSpam: false,
      }
    }

    if (!data?.token || !address || skip) {
      return
    }

    return gqlTokenToCurrencyInfo(data.token as GqlToken)
  }, [commonBase, fallbackListTokens, address, skip, data?.token])
}

export function useToken(tokenAddress?: string, chainId?: ChainId): Maybe<Token> {
  const connectedChainId = useChainId()
  const currency = useCurrency(tokenAddress, chainId ?? connectedChainId)
  const networkToken = useTokenFromActiveNetwork(
    tokenAddress,
    getChainInfo({ chainId: chainId ?? connectedChainId })?.backendChain.backendSupported
  )
  return useMemo(() => {
    if (currency && currency instanceof Token) {
      return currency
    }
    return networkToken
  }, [currency, networkToken])
}

const BYTES32_REGEX = /^0x[a-fA-F0-9]{64}$/

function parseStringOrBytes32(str: string | undefined, bytes32: string | undefined, defaultValue: string): string {
  return str && str.length > 0
    ? str
    : bytes32 && BYTES32_REGEX.test(bytes32) && arrayify(bytes32)[31] === 0
    ? parseBytes32String(bytes32)
    : defaultValue;
}

const UNKNOWN_TOKEN_NAME = 'Unknown Token'

function useTokenFromActiveNetwork(tokenAddress: string | undefined, skip?: boolean): Token | undefined {
  const chainId = useChainId()

  const formattedAddress = isAddress(tokenAddress);
  const tokenContract: Contract | null = useTokenContract(
    formattedAddress ? formattedAddress : undefined,
    false
  );
  const tokenContractBytes32: Contract | null = useBytes32TokenContract(
    formattedAddress ? formattedAddress : undefined,
    false
  );

  // @ts-ignore
  const tokenName = useSingleCallResult(
    skip ? undefined : tokenContract,
    "name",
    undefined,
    NEVER_RELOAD
  );
  // @ts-ignore
  const tokenNameBytes32 = useSingleCallResult(
    skip ? undefined : tokenContractBytes32,
    "name",
    undefined,
    NEVER_RELOAD
  );
  // @ts-ignore
  const symbol = useSingleCallResult(
    skip ? undefined : tokenContract,
    "symbol",
    undefined,
    NEVER_RELOAD
  );
  // @ts-ignore
  const symbolBytes32 = useSingleCallResult(
    skip ? undefined : tokenContractBytes32,
    "symbol",
    undefined,
    NEVER_RELOAD
  );
  // @ts-ignore
  const decimals = useSingleCallResult(skip ? undefined : tokenContract, 'decimals', undefined, NEVER_RELOAD)

  const isLoading = useMemo(
    () => decimals.loading || symbol.loading || tokenName.loading,
    [decimals.loading, symbol.loading, tokenName.loading]
  )
  const parsedDecimals = useMemo(() => decimals?.result?.[0] ?? DEFAULT_ERC20_DECIMALS, [decimals.result])

  const parsedSymbol = useMemo(
    () =>
      parseStringOrBytes32(
        symbol.result?.[0],
        symbolBytes32.result?.[0],
        UNKNOWN_TOKEN_SYMBOL
      ),
    [symbol.result, symbolBytes32.result]
  );
  const parsedName = useMemo(
    () =>
      parseStringOrBytes32(
        tokenName.result?.[0],
        tokenNameBytes32.result?.[0],
        UNKNOWN_TOKEN_NAME
      ),
    [tokenName.result, tokenNameBytes32.result]
  );

  return useMemo(() => {
    if (!tokenAddress || !isSupportedChainId(chainId) || !formattedAddress) return undefined
    if (isLoading || !chainId) return undefined
    if (!decimals?.result?.[0] && parsedSymbol === UNKNOWN_TOKEN_SYMBOL && parsedName === UNKNOWN_TOKEN_NAME) {
      return undefined
    }

    return new Token(chainId, formattedAddress, parsedDecimals, parsedSymbol, parsedName)
  }, [tokenAddress, chainId, formattedAddress, isLoading, decimals?.result, parsedDecimals, parsedSymbol, parsedName])
}
