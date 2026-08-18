import { Agent } from "./agent.js";

/**
 * Buyer-side finance agent: works through a queue of natural-language expense
 * claims. For each claim it re-perceives the account's current invoice
 * holdings (so earlier reimbursements are reflected), asks the reasoner to
 * match the claim to an invoice, runs the policy guard, and — only then —
 * executes the on-chain lock -> reimburse protocol.
 */
export class ReimbursementAgent extends Agent {
  constructor({ account, ...rest }) {
    super({ name: "reimbursement-agent", ...rest });
    this.account = account;
  }

  async processClaims(claims) {
    const outcomes = [];
    for (const claim of claims) {
      const candidates = await this.tools.listOwnedInvoices(this.account);
      outcomes.push(await this.handleClaim(claim, candidates));
    }
    return outcomes;
  }
}
