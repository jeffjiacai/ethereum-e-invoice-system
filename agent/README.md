# AI agent layer

Autonomous agents that operate the blockchain e-invoice system, with the
**machine-verified contract as their safety envelope**. To the ledger an agent
is just a registered account — exactly the adversary of the paper's threat
model — so the proved theorems (reimbursement uniqueness, authorization, face
integrity) bound anything the agent does. A hallucinating, buggy, or
prompt-injected agent can waste a transaction; it cannot double-reimburse,
forge an invoice, or act without authorization.

## Architecture

```
expense claims (natural language)
        │
   ┌────▼─────────────────────────────┐
   │ ReimbursementAgent               │
   │  perceive  – read owned invoices │   AuditAgent
   │  reason    – rules OR Claude     │    scan ledger, verify digests,
   │  guard     – deterministic policy│    arithmetic, red-flush linkage,
   │  act       – lock -> reimburse   │    duplicate-content heuristic
   └────┬─────────────────────────────┘
        │ signed transactions (tool layer)
   ┌────▼─────────────────────────────┐
   │ EInvoice.sol — verified contract │  <- SMTChecker-proved invariants
   └──────────────────────────────────┘
```

- `src/reasoner.js` — **hybrid reasoning**: deterministic matcher by default;
  with `ANTHROPIC_API_KEY` set, claim matching goes through Claude
  (`claude-opus-4-8`, override with `AGENT_MODEL`) with structured JSON
  output, falling back to rules on any error. Safety never depends on which
  backend ran.
- `src/policy.js` — deterministic guard (document authenticity by digest,
  lifecycle state, ownership, amount consistency, spending limit).
- `src/tools.js` — the agent's only interface to the ledger.
- `src/agent.js` — perceive → reason → guard → act loop with a full trace.
- `src/auditAgent.js` — third-party compliance scan over the whole ledger.

## Run the demo

```bash
cd ../chain && npx hardhat node                                  # terminal 1
cd ../chain && npx hardhat run scripts/deploy.js --network localhost
cd ../agent && npm install && node demo.js                       # terminal 2
```

The demo seeds five invoices and processes six claims — three legitimate, one
duplicate, one over the spending limit, one with a forged receipt. Expected:
the three legitimate claims reimburse; the three unsafe ones are rejected by
the policy guard; and when the guard is deliberately bypassed, the duplicate
is rejected **by the contract itself** (`EInvoice: invoice not available for
reimbursement`). The audit agent then scans the ledger. The demo asserts all
of this and exits non-zero on any deviation.

Optional LLM mode: `ANTHROPIC_API_KEY=… node demo.js` — matching runs through
Claude; the safety outcomes must be identical.

## Tests

Agent unit + integration tests live with the contract tests:

```bash
cd ../chain && npx hardhat test test/agent.test.js
```

They run fully offline (no API key required) against an in-process chain.
