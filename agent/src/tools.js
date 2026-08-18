import { computeContentHash } from "./digest.js";

/**
 * The agent's tool surface: the ONLY ways it can touch the ledger. Read tools
 * gather perception; act tools submit signed transactions. Every act tool is a
 * thin wrapper over a guarded contract function, so the contract's proved
 * invariants bound whatever the agent (or its LLM) decides to do.
 *
 * `contract` must be connected to the agent's signer for act tools to work.
 */
export function makeTools(contract) {
  return {
    // ---- perception (read-only) ----
    async listOwnedInvoices(address) {
      const ids = await contract.invoicesOf(address);
      return Promise.all(ids.map((id) => contract.getInvoice(id)));
    },
    async listAllInvoices() {
      const n = Number(await contract.totalSupply());
      const ids = await Promise.all(Array.from({ length: n }, (_, i) => contract.invoiceByIndex(i)));
      return Promise.all(ids.map((id) => contract.getInvoice(id)));
    },
    async getInvoice(id) {
      return contract.getInvoice(id);
    },
    async getLock(id) {
      return contract.getLock(id);
    },
    async ownerOf(id) {
      return contract.ownerOf(id);
    },
    /** Authenticity check: does the recomputed face digest exist on-chain and
     *  map back to the same invoice number the face claims to be? */
    async verifyAuthentic(inv) {
      const digest = computeContentHash(inv);
      const [valid, id] = await contract.verifyByHash(digest);
      return valid && Number(id) === Number(inv.invoiceId);
    },

    // ---- action (state-changing) ----
    async lock(id, claimDocId) {
      return (await contract.lockForReimbursement(id, claimDocId)).wait();
    },
    async reimburse(id) {
      return (await contract.reimburse(id)).wait();
    },
    async unlock(id) {
      return (await contract.unlockReimbursement(id)).wait();
    },
  };
}
