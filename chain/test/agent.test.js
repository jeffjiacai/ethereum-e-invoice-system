const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// The agent package is ESM; load it via dynamic import (CJS-safe).
let makeTools, ruleMatch, makeReasoner, makePolicy, allowAllPolicy, ReimbursementAgent, AuditAgent;
before(async function () {
  ({ makeTools } = await import("../../agent/src/tools.js"));
  ({ ruleMatch, makeReasoner } = await import("../../agent/src/reasoner.js"));
  ({ makePolicy, allowAllPolicy } = await import("../../agent/src/policy.js"));
  ({ ReimbursementAgent } = await import("../../agent/src/reimbursementAgent.js"));
  ({ AuditAgent } = await import("../../agent/src/auditAgent.js"));
});

const CATEGORY = 1090511030000000000n;
const Status = { Issued: 2n, Reimbursed: 4n };

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

describe("AI agent layer", function () {
  async function agentFixture() {
    const [taxBureau, seller, buyer] = await ethers.getSigners();
    const EInvoice = await ethers.getContractFactory("EInvoice");
    const einvoice = await EInvoice.deploy();
    await einvoice.registerEnterprise(seller.address, "91110108MA01C8H37E", "Huaxin Trading Co., Ltd.", "ICBC 0200", "Beijing");
    await einvoice.registerEnterprise(buyer.address, "91440300MA5EYP8Q2F", "Nanshan Software Co., Ltd.", "CMB 7559", "Shenzhen");
    await einvoice.grantInvoices(seller.address, 1, 4);
    // laptop ¥1130.00, taxi ¥217.30, dinner ¥1130.00
    await einvoice.connect(seller).issueInvoice(1, buyer.address, 1000_00n, 1300n, CATEGORY, "Office laptop x1 (engineering)");
    await einvoice.connect(seller).issueInvoice(2, buyer.address, 205_00n, 600n, CATEGORY, "Taxi fare to client site");
    await einvoice.connect(seller).issueInvoice(3, buyer.address, 1000_00n, 1300n, CATEGORY, "Team dinner, product launch");

    const buyerContract = einvoice.connect(buyer);
    const tools = makeTools(buyerContract);
    const policy = makePolicy({ agentAddress: buyer.address, maxClaimCents: 500000 });
    const agent = new ReimbursementAgent({ account: buyer.address, tools, reasoner: makeReasoner(), policy });
    return { einvoice, taxBureau, seller, buyer, tools, policy, agent };
  }

  describe("reasoner (deterministic rules)", function () {
    it("matches a claim by amount and description tokens", async function () {
      const { tools, buyer } = await loadFixture(agentFixture);
      const candidates = await tools.listOwnedInvoices(buyer.address);
      const claim = { claimId: "C1", description: "office laptop for engineering", amountCents: 113000 };
      const match = ruleMatch(claim, candidates);
      expect(match.invoiceId).to.equal(1); // laptop, not the equal-amount dinner
    });

    it("returns null when nothing plausibly matches", async function () {
      const { tools, buyer } = await loadFixture(agentFixture);
      const candidates = await tools.listOwnedInvoices(buyer.address);
      const claim = { claimId: "C2", description: "zzzz qqqq", amountCents: 99 };
      expect(ruleMatch(claim, candidates).invoiceId).to.equal(null);
    });
  });

  describe("policy guard", function () {
    it("passes a consistent, authentic, in-limit claim", async function () {
      const { tools, policy } = await loadFixture(agentFixture);
      const inv = await tools.getInvoice(1);
      const claim = { claimId: "C3", amountCents: 113000, attachedFace: faceOf(inv) };
      const verdict = await policy.check(claim, inv, tools);
      expect(verdict.ok).to.equal(true);
    });

    it("rejects an amount that disagrees with the invoice total", async function () {
      const { tools, policy } = await loadFixture(agentFixture);
      const inv = await tools.getInvoice(1);
      const verdict = await policy.check({ claimId: "C4", amountCents: 999999 }, inv, tools);
      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.include("!= invoice total");
    });

    it("rejects a claim above the spending limit", async function () {
      const { tools, buyer } = await loadFixture(agentFixture);
      const strict = makePolicy({ agentAddress: buyer.address, maxClaimCents: 100 });
      const inv = await tools.getInvoice(1);
      const verdict = await strict.check({ claimId: "C5", amountCents: 113000 }, inv, tools);
      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.include("exceeds per-claim limit");
    });

    it("rejects a forged (tampered) invoice face by digest", async function () {
      const { tools, policy } = await loadFixture(agentFixture);
      const inv = await tools.getInvoice(1);
      const forged = faceOf(inv);
      forged.preTaxAmount *= 2n;
      const verdict = await policy.check({ claimId: "C6", amountCents: 113000, attachedFace: forged }, inv, tools);
      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.include("forgery");
    });

    it("rejects when the agent's account does not hold the invoice", async function () {
      const { tools, seller } = await loadFixture(agentFixture);
      const wrong = makePolicy({ agentAddress: seller.address, maxClaimCents: 500000 });
      const inv = await tools.getInvoice(1);
      const verdict = await wrong.check({ claimId: "C7", amountCents: 113000 }, inv, tools);
      expect(verdict.ok).to.equal(false);
      expect(verdict.reason).to.include("does not hold");
    });
  });

  describe("reimbursement agent end-to-end", function () {
    it("reimburses a legitimate claim on-chain", async function () {
      const { einvoice, agent } = await loadFixture(agentFixture);
      const [outcome] = await agent.processClaims([
        { claimId: "CLM-A", description: "office laptop engineering", amountCents: 113000 },
      ]);
      expect(outcome.outcome).to.equal("reimbursed");
      expect((await einvoice.getInvoice(1)).status).to.equal(Status.Reimbursed);
    });

    it("blocks a duplicate claim at the policy layer with a clear reason", async function () {
      const { agent } = await loadFixture(agentFixture);
      const claim = { claimId: "CLM-B", description: "office laptop engineering", amountCents: 113000 };
      const [first, second] = await agent.processClaims([claim, { ...claim, claimId: "CLM-B2" }]);
      expect(first.outcome).to.equal("reimbursed");
      expect(second.outcome).to.equal("blocked_by_policy");
      expect(second.detail).to.include("duplicate");
    });

    it("even with the policy bypassed, the contract rejects the duplicate", async function () {
      const { einvoice, buyer, agent } = await loadFixture(agentFixture);
      const claim = { claimId: "CLM-C", description: "office laptop engineering", amountCents: 113000 };
      await agent.processClaims([claim]);

      const rogue = new ReimbursementAgent({
        account: buyer.address,
        tools: makeTools(einvoice.connect(buyer)),
        reasoner: makeReasoner(),
        policy: allowAllPolicy,
      });
      const [outcome] = await rogue.processClaims([{ ...claim, claimId: "CLM-C2" }]);
      expect(outcome.outcome).to.equal("rejected_on_chain");
      expect(outcome.detail).to.include("not available for reimbursement");
      // exactly one reimbursement happened
      expect((await einvoice.getInvoice(1)).status).to.equal(Status.Reimbursed);
    });

    it("records a full perceive/reason/guard trace", async function () {
      const { agent } = await loadFixture(agentFixture);
      await agent.processClaims([{ claimId: "CLM-D", description: "taxi client site", amountCents: 21730 }]);
      const steps = agent.trace.map((e) => e.step);
      expect(steps).to.include.members(["perceive", "reason", "guard", "act", "done"]);
    });
  });

  describe("audit agent", function () {
    it("finds no integrity issues on a healthy ledger and flags duplicate content", async function () {
      const { einvoice, seller, buyer } = await loadFixture(agentFixture);
      // Issue an invoice with content identical to the laptop invoice.
      await einvoice.connect(seller).issueInvoice(4, buyer.address, 1000_00n, 1300n, CATEGORY, "Office laptop x1 (engineering)");

      const audit = new AuditAgent({ tools: makeTools(einvoice) });
      const report = await audit.run();

      expect(report.scanned).to.equal(4);
      expect(report.findings.filter((f) => f.severity === "critical")).to.have.length(0);
      const dup = report.findings.find((f) => f.type === "possible-duplicate-invoicing");
      expect(dup).to.not.equal(undefined);
      expect(dup.invoiceId).to.equal(4);
    });
  });
});
