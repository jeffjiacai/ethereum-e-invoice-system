import { ethers } from "ethers";

/**
 * Recompute an invoice face digest exactly as EInvoice.sol does. Ported from
 * web/src/eth.js so an agent (or any third party) can check authenticity
 * without trusting the seller, the buyer, or any central platform.
 */
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

export const STATUS = ["None", "Blank", "Issued", "Locked", "Reimbursed", "Reversed"];

export function statusName(inv) {
  const base = STATUS[Number(inv.status)];
  return inv.isCredit && base === "Issued" ? "Credit" : base;
}

export function yuan(cents) {
  return `¥${(Number(cents) / 100).toFixed(2)}`;
}
