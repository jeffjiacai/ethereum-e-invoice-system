import { statusName, yuan } from "./digest.js";

// The reasoner PROPOSES which invoice a natural-language expense claim refers
// to. It never touches the chain. Two backends:
//   - deterministic rules (default): amount match + description-token overlap.
//   - Claude (optional): used only when ANTHROPIC_API_KEY is set; falls back to
//     rules on any error. This is the only "AI" component; safety does not
//     depend on it (the contract's proved invariants bound every action).

const MODEL = process.env.AGENT_MODEL || "claude-opus-4-8";

function tokenize(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );
}

/** Deterministic matcher: exact-amount candidates win, ties broken by token overlap. */
export function ruleMatch(claim, candidates) {
  if (candidates.length === 0) return { invoiceId: null, via: "rules", rationale: "no candidate invoices" };
  const claimTokens = tokenize(claim.description);
  const scored = candidates.map((inv) => {
    const amountMatch = Number(inv.totalAmount) === claim.amountCents ? 1 : 0;
    const invTokens = tokenize(inv.itemDescription);
    let overlap = 0;
    for (const t of claimTokens) if (invTokens.has(t)) overlap += 1;
    return { inv, amountMatch, overlap };
  });
  scored.sort((a, b) => b.amountMatch - a.amountMatch || b.overlap - a.overlap);
  const best = scored[0];
  if (best.amountMatch === 0 && best.overlap === 0) {
    return { invoiceId: null, via: "rules", rationale: "no invoice matched by amount or description" };
  }
  return {
    invoiceId: Number(best.inv.invoiceId),
    via: "rules",
    rationale: `amount ${best.amountMatch ? "matches" : "differs"}, ${best.overlap} description token(s) overlap`,
  };
}

/** Claude-backed matcher via the Anthropic SDK with structured JSON output. */
async function llmMatch(claim, candidates) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const catalogue = candidates
    .map(
      (inv) =>
        `- invoiceId ${Number(inv.invoiceId)}: "${inv.itemDescription}", total ${yuan(inv.totalAmount)}, seller ${inv.seller.legalName}, status ${statusName(inv)}`
    )
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      "You match a natural-language expense claim to exactly one candidate invoice, or none. " +
      "Prefer an exact tax-inclusive amount match; use the item description to disambiguate. " +
      "Never invent an invoiceId that is not in the candidate list.",
    messages: [
      {
        role: "user",
        content:
          `Expense claim ${claim.claimId}: "${claim.description}", amount ${yuan(claim.amountCents)}.\n\n` +
          `Candidate invoices:\n${catalogue}\n\n` +
          `Return the best-matching invoiceId (or null if none matches).`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            invoiceId: { type: ["integer", "null"] },
            confidence: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["invoiceId", "confidence", "rationale"],
          additionalProperties: false,
        },
      },
    },
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
  const parsed = JSON.parse(text);
  // Guard against hallucinated ids: the id must be an actual candidate.
  const valid = candidates.some((c) => Number(c.invoiceId) === parsed.invoiceId);
  return {
    invoiceId: valid ? parsed.invoiceId : null,
    via: `claude:${MODEL}`,
    rationale: valid ? parsed.rationale : `LLM proposed a non-candidate id; ignored (${parsed.rationale ?? ""})`,
  };
}

export function makeReasoner() {
  const useLLM = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    async matchClaim(claim, candidates) {
      if (useLLM) {
        try {
          return await llmMatch(claim, candidates);
        } catch (e) {
          const fallback = ruleMatch(claim, candidates);
          fallback.rationale = `LLM unavailable (${e.shortMessage ?? e.message}); ${fallback.rationale}`;
          return fallback;
        }
      }
      return ruleMatch(claim, candidates);
    },
  };
}
