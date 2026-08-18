import { ethers } from "ethers";
import deployment from "./contract/einvoice.json";

// Well-known Hardhat development accounts (public dev keys, local chain only).
// Account 0 deploys the contract and is therefore the tax bureau.
const ACCOUNTS = [
  {
    role: "Tax Bureau",
    key: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    icon: "🏛️",
    blurb: "Registers enterprises, reviews applications, distributes blank invoices.",
  },
  {
    role: "Seller",
    key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    icon: "🏢",
    blurb: "Huaxin Trading Co., Ltd. — applies for blanks, issues invoices, declares tax.",
  },
  {
    role: "Buyer",
    key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    icon: "🏬",
    blurb: "Nanshan Software Co., Ltd. — receives, verifies and reimburses invoices.",
  },
  {
    role: "Verifier",
    key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    icon: "🔍",
    blurb: "Third party (auditor, court, bank) — queries and verifies invoices.",
  },
];

export const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545", undefined, {
  polling: true,
  pollingInterval: 800,
});

export const roles = ACCOUNTS.map((a) => {
  const wallet = new ethers.Wallet(a.key, provider);
  return {
    ...a,
    address: wallet.address,
    contract: new ethers.Contract(deployment.address, deployment.abi, wallet),
  };
});

export const readContract = new ethers.Contract(deployment.address, deployment.abi, provider);
export const contractAddress = deployment.address;

export function revertReason(e) {
  return (
    e?.reason ??
    e?.revert?.args?.[0] ??
    e?.message?.match(/reverted with reason string '([^']*)'/)?.[1] ??
    e?.shortMessage ??
    "transaction failed"
  );
}

/** Recompute the invoice face digest exactly as the contract does. */
export function computeContentHash(inv) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string", "string", "uint256", "uint256", "uint256", "string", "bool", "uint64"],
      [
        inv.invoiceId,
        inv.seller.taxpayerId,
        inv.buyer.taxpayerId,
        inv.preTaxAmount,
        inv.taxRateBps,
        inv.taxCategoryCode,
        inv.itemDescription,
        inv.isCredit,
        inv.issuedAt,
      ]
    )
  );
}
