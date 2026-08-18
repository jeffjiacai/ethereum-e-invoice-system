import { revertReason } from "./chain.js";

/**
 * Base agent: a perceive -> decide -> guard -> act loop that records a
 * structured trace of every step. The important architectural point is the
 * ordering: the reasoner (possibly an LLM) only *proposes*; the deterministic
 * policy guard filters; and the contract's proved invariants are the final,
 * un-bypassable authority. A hallucinating or adversarial reasoner can waste a
 * step but cannot violate a contract invariant (Theorems 1-4 of the paper).
 */
export class Agent {
  constructor({ name, tools, reasoner, policy }) {
    this.name = name;
    this.tools = tools;
    this.reasoner = reasoner;
    this.policy = policy;
    this.trace = [];
  }

  log(step, detail) {
    const entry = { t: new Date().toISOString(), step, ...detail };
    this.trace.push(entry);
    return entry;
  }

  /**
   * Run one claim: reason a candidate, run the policy guard, and — only if the
   * guard passes — submit the guarded on-chain actions. Returns an outcome
   * record. On-chain reverts are caught and reported (never crash the agent).
   */
  async handleClaim(claim, candidates) {
    this.log("perceive", { claim: claim.claimId, candidates: candidates.map((c) => Number(c.invoiceId)) });

    // 1. Reason (deterministic or LLM) — proposes a candidate invoice.
    const decision = await this.reasoner.matchClaim(claim, candidates);
    this.log("reason", {
      claim: claim.claimId,
      picked: decision.invoiceId,
      via: decision.via,
      rationale: decision.rationale,
    });
    if (decision.invoiceId == null) {
      return this.done(claim, "no_match", decision.rationale);
    }

    const inv = candidates.find((c) => Number(c.invoiceId) === Number(decision.invoiceId));
    if (!inv) return this.done(claim, "no_match", "reasoner returned an invoice not in the candidate set");

    // 2. Guard (deterministic policy, always enforced).
    const verdict = await this.policy.check(claim, inv, this.tools);
    this.log("guard", { claim: claim.claimId, invoice: Number(inv.invoiceId), ok: verdict.ok, reason: verdict.reason });
    if (!verdict.ok) {
      return this.done(claim, "blocked_by_policy", verdict.reason, Number(inv.invoiceId));
    }

    // 3. Act (guarded contract calls). The contract is the final authority.
    try {
      await this.tools.lock(inv.invoiceId, claim.claimId);
      await this.tools.reimburse(inv.invoiceId);
      this.log("act", { claim: claim.claimId, invoice: Number(inv.invoiceId), action: "lock+reimburse", ok: true });
      return this.done(claim, "reimbursed", "lock+reimburse succeeded", Number(inv.invoiceId));
    } catch (e) {
      const reason = revertReason(e);
      this.log("act", { claim: claim.claimId, invoice: Number(inv.invoiceId), action: "lock+reimburse", ok: false, reason });
      // Best-effort release if we locked but reimburse failed.
      try {
        await this.tools.unlock(inv.invoiceId);
      } catch {
        /* ignore */
      }
      return this.done(claim, "rejected_on_chain", reason, Number(inv.invoiceId));
    }
  }

  done(claim, outcome, detail, invoice = null) {
    const rec = { claim: claim.claimId, invoice, outcome, detail };
    this.log("done", rec);
    return rec;
  }
}
