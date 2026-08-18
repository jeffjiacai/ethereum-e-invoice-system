# Blockchain Electronic Invoice System on Ethereum

Research artifact for the paper *Making Duplicate Reimbursement Unrepresentable: A
Verified Ethereum E-Invoice System for Humans and AI Agents*. This repository contains
the implementation, the machine-checked verification of the contract's lifecycle
invariants, the autonomous AI-agent layer, and everything needed to reproduce the
paper's numbers. The paper itself is under review and is not included here.

Each invoice is a non-fungible, **non-tradable** token whose ownership and state change
only through five lifecycle subsystems:

1. **Application & distribution** — enterprises apply; the tax bureau mints numbered blank invoices
2. **Issuance & circulation** — filling the invoice face and delivering it to the buyer is one atomic transaction
3. **Void & red-flush** — errors are corrected with a linked negative credit invoice, never by editing
4. **Query & verification** — any third party verifies an invoice face by its keccak256 digest
5. **Declaration & reimbursement** — a lock-based two-phase protocol makes duplicate reimbursement impossible

## Repository layout

```
chain/            Solidity 0.8.24 contract, Hardhat tests, deploy/demo/bench scripts
  contracts/EInvoice.sol
  test/                        35 tests: contract (23) + AI agent layer (12)
  scripts/deploy.js            deploy + register demo enterprises, export ABI to web/
  scripts/demo.js              scripted end-to-end lifecycle walkthrough
  scripts/bench.js             gas / latency / throughput measurements
  verification/                SMTChecker model + CHC proof of the invariants
web/              React + ethers v6 dApp with four role dashboards
agent/            AI agents (reimbursement + audit) with the contract as safety envelope
```

## Quick start

Requires Node.js ≥ 20.

```bash
# 1. install
cd chain && npm install
cd ../web && npm install

# 2. start a local Ethereum node (terminal 1)
cd chain && npx hardhat node

# 3. deploy the contract and register demo enterprises (terminal 2)
cd chain && npx hardhat run scripts/deploy.js --network localhost

# 4. start the web app (terminal 3)
cd web && npm run dev        # open http://localhost:5173
```

The web app maps the local node's first four accounts to roles — **Tax Bureau**,
**Seller** (Huaxin Trading), **Buyer** (Nanshan Software), and **Verifier** — switchable
in the header. Walk the lifecycle: Seller applies for blanks → Tax Bureau approves →
Seller issues an invoice → Buyer verifies and reimburses (try reimbursing twice — the
contract rejects it) → Verifier inspects the full on-chain audit trail.

Or run everything scripted:

```bash
cd chain
npx hardhat test                                     # 35 tests (contract + agents)
npx hardhat run scripts/demo.js --network localhost  # lifecycle walkthrough
npx hardhat run scripts/bench.js                     # gas/latency/throughput
REPORT_GAS=1 npx hardhat test                        # per-method gas report
```

## Measured results (Hardhat EVM, i9-14900HX)

| Operation | Gas |
|---|---|
| deploy | 3,861,367 |
| issueInvoice | 646,773 |
| redFlush | 696,130 |
| lockForReimbursement | 101,902 |
| reimburse | 32,743 |
| declareTax | 32,716 |

Single dev node sustains ~137 invoice issuances/s; local confirmation latency 1.6–3.2 ms mean.

## Formal verification

The paper proves reimbursement uniqueness, authorization, face integrity, and red-flush
value conservation by hand, and the core state-machine invariants are additionally
**machine-checked** with the Solidity SMTChecker (CHC engine), which proves them
inductively over all transaction sequences:

```bash
cd chain
npx hardhat compile                  # one-time: fetches solc 0.8.24
pip install z3-solver==4.12.6.0      # one-time: provides libz3
bash verification/verify.sh          # -> CHC: 5 verification condition(s) proved safe!
```

See [chain/verification/README.md](chain/verification/README.md) for what is proved.

## AI agents

Autonomous agents operate the system with the verified contract as their safety
envelope: to the ledger an agent is just a registered account — exactly the
adversary of the paper's threat model — so a hallucinating or prompt-injected
agent cannot double-reimburse, forge an invoice, or act without authorization.
Reasoning is hybrid: deterministic rules by default, Claude (`claude-opus-4-8`)
when `ANTHROPIC_API_KEY` is set, with rule fallback on any error.

```bash
# with the local node running and the contract deployed (see Quick start):
cd agent && npm install && node demo.js
```

The demo processes six expense claims: three legitimate ones reimburse; a
duplicate, an over-limit, and a forged-receipt claim are rejected by the policy
guard; and with the guard deliberately bypassed, the contract itself rejects the
duplicate. An audit agent then scans the whole ledger. See
[agent/README.md](agent/README.md).

## The paper

The manuscript is under review and is not distributed in this repository. Every claim it
makes is reproducible here:

| Paper claim | Reproduce with |
|---|---|
| 35 tests pass (23 contract + 12 agent) | `cd chain && npx hardhat test` |
| Gas / latency / throughput table | `cd chain && npx hardhat run scripts/bench.js` |
| "CHC: 5 verification condition(s) proved safe" | `cd chain && bash verification/verify.sh` |
| Agent case study: 0 of 4 unsafe actions executed | `cd agent && node demo.js` |
| Full invoice lifecycle end to end | `cd chain && npx hardhat run scripts/demo.js --network localhost` |
