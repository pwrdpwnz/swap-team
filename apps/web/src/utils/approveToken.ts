import { ethers } from "ethers";

/**
 * Функция для предоставления неограниченного доступа к токенам указанному адресату.
 * @param {ethers.Signer} signer - Подписывающий транзакцию.
 * @param {string} tokenAddress - Адрес контракта токена.
 * @param {string} spender - Адрес, который получит доступ.
 * @returns {Promise<void>}
 */
export async function approveToken(
  signer: ethers.Signer,
  tokenAddress: string,
  spender: string
): Promise<void> {
  const tokenContract = new ethers.Contract(
    tokenAddress,
    ["function approve(address spender, uint256 amount) public returns (bool)"],
    signer
  );
  const maxUint256 = ethers.constants.MaxUint256;

  const transaction = await tokenContract.approve(spender, maxUint256);
  await transaction.wait();

  console.log(
    `Approved unlimited amount of token ${tokenAddress} for spender ${spender}`
  );
}
