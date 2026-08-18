// End-to-end agent demo against a running local chain:
//
//   cd chain && npx hardhat node                                   (terminal 1)
//   cd chain && npx hardhat run scripts/deploy.js --network localhost
//   cd agent && npm install && node demo.js                        (terminal 2)
//
// Seeds five invoices, then lets the reimbursement agent work through six
// expense claims: three legitimate, one duplicate, one over the spending
// limit, and one with a forged (tampered) invoice face. The unsafe ones are
// rejected — by the deterministic policy guard, and (when the guard is
// deliberately bypassed) by the verified contract itself. Finally the audit
// agent scans the whole ledger.
//
// Reasoning is deterministic by default; set ANTHROPIC_API_KEY to route
// claim-matching through Claude (the safety outcomes must not change).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect } from "./src/chain.js";
import { makeTools } from "./src/tools.js";
import { makeReasoner } from "./src/reasoner.js";
import { makePolicy, allowAllPolicy } from "./src/policy.js";
import { ReimbursementAgent } from "./src/reimbursementAgent.js";
import { AuditAgent } from "./src/auditAgent.js";
import { yuan } from "./src/digest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATEGORY = 1090511030000000000n;
const MAX_CLAIM_CENTS = 500000; // ¥5,000.00 per-claim policy ceiling

const cents = (yuanFloat) => Math.round(yuanFloat * 100);

/** Convert an on-chain invoice into the plain "receipt document" an employee
 *  would attach to a claim (exactly the fields the digest covers). */
function faceOf(inv) {
  return {
    invoiceId: Number(inv.invoiceId),
    seller: { taxpayerId: inv.seller.taxpayerId },
    buyer: { taxpayerId: inv.buyer.taxpayerId },
    preTaxAmount: BigInt(inv.preTaxAmount),
    taxRateBps: BigInt(inv.taxRateBps),
    taxCategoryCode: BigInt(inv.taxCategoryCode),
    itemDescription: inv.itemDescription,
    isCredit: inv.isCredit,
    issuedAt: BigInt(inv.issuedAt),
  };
}

async function main() {
  const { contractFor, wallets } = connect();
  const bureau = contractFor("taxBureau");
  const seller = contractFor("seller");
  const buyer = contractFor("buyer");
  const auditor = contractFor("auditor");

  // ---- Seed: grant blanks, issue five invoices to the buyer ----------------
  // A per-run batch tag keeps this run's invoices distinguishable from any
  // earlier demo runs on the same chain, so the demo is safely rerunnable.
  const TAG = `batch${Date.now().toString().slice(-6)}`;
  const startId = Number(await bureau.totalSupply()) + 1;
  await (await bureau.grantInvoices(wallets.seller.address, startId, 6)).wait();
  const seeds = [
    { descr: `Office laptop x1 (engineering) ${TAG}`, preTax: 1000_00n, rate: 1300n }, // ¥1130.00
    { descr: `Taxi fare to client site ${TAG}`, preTax: 205_00n, rate: 600n },         // ¥217.30
    { descr: `Hotel, Shenzhen business trip ${TAG}`, preTax: 800_00n, rate: 600n },    // ¥848.00
    { descr: `Conference registration fee ${TAG}`, preTax: 6000_00n, rate: 1300n },    // ¥6780.00
    { descr: `Team dinner, product launch ${TAG}`, preTax: 1000_00n, rate: 1300n },    // ¥1130.00
  ];
  for (let i = 0; i < seeds.length; i++) {
    await (
      await seller.issueInvoice(startId + i, wallets.buyer.address, seeds[i].preTax, seeds[i].rate, CATEGORY, seeds[i].descr)
    ).wait();
  }
  console.log(`Seeded invoices ${startId}..${startId + seeds.length - 1} to the buyer\n`);

  // ---- Build the claim queue (sample texts + attached receipt faces) -------
  const raw = JSON.parse(readFileSync(join(HERE, "claims.sample.json"), "utf8")).map((c) => ({
    ...c,
    description: `${c.description} ${TAG}`,
  }));
  const invoiceAt = async (offset) => faceOf(await buyer.getInvoice(startId + offset));
  const claims = [
    { ...raw[0], amountCents: cents(raw[0].amountYuan), attachedFace: await invoiceAt(0) }, // legit: laptop
    { ...raw[1], amountCents: cents(raw[1].amountYuan), attachedFace: await invoiceAt(1) }, // legit: taxi
    { ...raw[2], amountCents: cents(raw[2].amountYuan), attachedFace: await invoiceAt(2) }, // legit: hotel
    { ...raw[3], amountCents: cents(raw[3].amountYuan), attachedFace: await invoiceAt(0) }, // duplicate: laptop again
    { ...raw[4], amountCents: cents(raw[4].amountYuan), attachedFace: await invoiceAt(3) }, // over limit: conference
    { ...raw[5], amountCents: cents(raw[5].amountYuan), attachedFace: await invoiceAt(4) }, // forged: dinner
  ];
  // Forge the last claim's receipt: inflate every amount 2x on the face.
  const forged = claims[5].attachedFace;
  forged.preTaxAmount *= 2n;

  // ---- Run the reimbursement agent -----------------------------------------
  const agent = new ReimbursementAgent({
    account: wallets.buyer.address,
    tools: makeTools(buyer),
    reasoner: makeReasoner(),
    policy: makePolicy({ agentAddress: wallets.buyer.address, maxClaimCents: MAX_CLAIM_CENTS }),
  });

  console.log(`Reimbursement agent processing ${claims.length} claims (reasoner: ${process.env.ANTHROPIC_API_KEY ? "Claude" : "rules"})…\n`);
  const outcomes = await agent.processClaims(claims);
  for (const o of outcomes) {
    const mark = o.outcome === "reimbursed" ? "✓" : "✗";
    console.log(`  ${mark} ${o.claim} → invoice ${o.invoice ?? "-"} · ${o.outcome} · ${o.detail}`);
  }

  // ---- Bypass the policy on purpose: the contract must still refuse --------
  console.log("\nBypassing the policy guard and retrying the duplicate claim (contract is the last line of defense)…");
  const rogue = new ReimbursementAgent({
    account: wallets.buyer.address,
    tools: makeTools(buyer),
    reasoner: makeReasoner(),
    policy: allowAllPolicy,
  });
  const [bypass] = await rogue.processClaims([claims[3]]);
  console.log(`  ✗ ${bypass.claim} → ${bypass.outcome} · ${bypass.detail}`);

  // ---- Audit agent ----------------------------------------------------------
  console.log("\nAudit agent scanning the ledger…");
  const audit = new AuditAgent({ tools: makeTools(auditor) });
  const report = await audit.run();
  console.log(`  scanned ${report.scanned} invoices · status counts: ${JSON.stringify(report.stats)}`);
  if (report.findings.length === 0) console.log("  no findings");
  for (const f of report.findings) {
    console.log(`  [${f.severity}] invoice ${f.invoiceId}: ${f.type} — ${f.detail}`);
  }

  // ---- Assertions (demo doubles as an end-to-end check) --------------------
  const byId = Object.fromEntries(outcomes.map((o) => [o.claim, o]));
  const expect = (cond, msg) => {
    if (!cond) throw new Error(`demo expectation failed: ${msg}`);
  };
  expect(byId["CLM-2026-101"].outcome === "reimbursed", "laptop claim reimburses");
  expect(byId["CLM-2026-102"].outcome === "reimbursed", "taxi claim reimburses");
  expect(byId["CLM-2026-103"].outcome === "reimbursed", "hotel claim reimburses");
  expect(byId["CLM-2026-104"].outcome === "blocked_by_policy", "duplicate blocked by policy");
  expect(byId["CLM-2026-105"].outcome === "blocked_by_policy", "over-limit blocked by policy");
  expect(byId["CLM-2026-106"].outcome === "blocked_by_policy", "forged face blocked by policy");
  expect(bypass.outcome === "rejected_on_chain", "policy bypass rejected by the contract");
  expect(report.findings.every((f) => f.severity !== "critical"), "no critical audit findings");

  const reimbursed = outcomes.filter((o) => o.outcome === "reimbursed").length;
  console.log(`\nSummary: ${claims.length} claims — ${reimbursed} reimbursed, ${claims.length - reimbursed} unsafe claims rejected (100%).`);
  console.log("Even with the policy bypassed, the verified contract rejected the duplicate reimbursement.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
