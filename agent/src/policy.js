import { statusName, yuan } from "./digest.js";

/**
 * Deterministic policy guard — defense-in-depth between the (possibly LLM)
 * reasoner and the chain. Every check here is ALSO enforced by the contract
 * or derivable from on-chain state; the guard exists to reject bad actions
 * cheaply and with a human-readable reason before any gas is spent. The
 * ultimate safety guarantee remains the contract's proved invariants.
 *
 * Checks run in document-first order: authenticate the submitted invoice face
 * before comparing amounts, mirroring how a finance department validates a
 * receipt before approving the numbers on it.
 */
export function makePolicy({ agentAddress, maxClaimCents = Infinity }) {
  return {
    async check(claim, inv, tools) {
      // 1. Document authenticity: the face attached to the claim must hash to
      //    an on-chain digest for this same invoice (forgery check).
      if (claim.attachedFace) {
        if (Number(claim.attachedFace.invoiceId) !== Number(inv.invoiceId)) {
          return { ok: false, reason: "attached invoice face references a different invoice" };
        }
        const authentic = await tools.verifyAuthentic(claim.attachedFace);
        if (!authentic) {
          return { ok: false, reason: "attached invoice face fails digest verification — possible forgery" };
        }
      }

      // 2. Lifecycle state: only an Issued, non-credit invoice is reimbursable.
      const s = statusName(inv);
      if (inv.isCredit) {
        return { ok: false, reason: "credit (red-flush) invoices cannot be reimbursed" };
      }
      if (s !== "Issued") {
        return { ok: false, reason: `invoice is ${s}, not Issued${s === "Reimbursed" ? " — duplicate reimbursement attempt" : ""}` };
      }

      // 3. Ownership: the agent's account must hold the invoice.
      const owner = await tools.ownerOf(inv.invoiceId);
      if (owner.toLowerCase() !== agentAddress.toLowerCase()) {
        return { ok: false, reason: "agent's account does not hold this invoice" };
      }

      // 4. Amount consistency: the claim must equal the invoice total exactly.
      if (Number(claim.amountCents) !== Number(inv.totalAmount)) {
        return {
          ok: false,
          reason: `claim amount ${yuan(claim.amountCents)} != invoice total ${yuan(inv.totalAmount)}`,
        };
      }

      // 5. Spending policy: per-claim ceiling set by the finance department.
      if (Number(claim.amountCents) > maxClaimCents) {
        return {
          ok: false,
          reason: `claim ${yuan(claim.amountCents)} exceeds per-claim limit ${yuan(maxClaimCents)} — needs human approval`,
        };
      }

      return { ok: true, reason: "all policy checks passed" };
    },
  };
}

/** A guard that approves everything — used only to demonstrate that the
 *  contract still blocks unsafe actions when the policy layer is bypassed. */
export const allowAllPolicy = {
  async check() {
    return { ok: true, reason: "policy bypassed (demonstration)" };
  },
};
