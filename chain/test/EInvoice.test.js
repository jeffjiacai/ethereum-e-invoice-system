const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const RATE_13 = 1300n; // 13% in basis points
const CATEGORY = 1090511030000000000n; // sample goods & services classification code

const Status = {
  None: 0n,
  Blank: 1n,
  Issued: 2n,
  Locked: 3n,
  Reimbursed: 4n,
  Reversed: 5n,
};

describe("EInvoice", function () {
  async function deployFixture() {
    const [taxBureau, seller, buyer, thirdParty, outsider] = await ethers.getSigners();
    const EInvoice = await ethers.getContractFactory("EInvoice");
    const einvoice = await EInvoice.deploy();

    await einvoice.registerEnterprise(
      seller.address,
      "91110108MA01C8H37E",
      "Huaxin Trading Co., Ltd.",
      "ICBC Beijing Zhongguancun Branch 0200 1234 5678",
      "12 Haidian Road, Beijing"
    );
    await einvoice.registerEnterprise(
      buyer.address,
      "91440300MA5EYP8Q2F",
      "Nanshan Software Co., Ltd.",
      "CMB Shenzhen Nanshan Branch 7559 8765 4321",
      "1001 Keyuan Road, Shenzhen"
    );

    return { einvoice, taxBureau, seller, buyer, thirdParty, outsider };
  }

  async function issuedFixture() {
    const ctx = await deployFixture();
    const { einvoice, seller, buyer } = ctx;
    await einvoice.grantInvoices(seller.address, 1, 5);
    await einvoice
      .connect(seller)
      .issueInvoice(1, buyer.address, 1000_00n, RATE_13, CATEGORY, "Office laptop x1");
    return ctx;
  }

  describe("enterprise registry", function () {
    it("registers enterprises with metadata", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      const ent = await einvoice.enterprises(seller.address);
      expect(ent.registered).to.equal(true);
      expect(ent.taxpayerId).to.equal("91110108MA01C8H37E");
    });

    it("only the tax bureau may register", async function () {
      const { einvoice, seller, outsider } = await loadFixture(deployFixture);
      await expect(
        einvoice.connect(seller).registerEnterprise(outsider.address, "X", "X", "X", "X")
      ).to.be.revertedWith("EInvoice: caller is not tax bureau");
    });

    it("rejects duplicate registration", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      await expect(
        einvoice.registerEnterprise(seller.address, "X", "X", "X", "X")
      ).to.be.revertedWith("EInvoice: already registered");
    });
  });

  describe("subsystem 1: application & distribution", function () {
    it("grants a numbered range of blank invoices", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      await expect(einvoice.grantInvoices(seller.address, 1, 3))
        .to.emit(einvoice, "InvoicesGranted")
        .withArgs(seller.address, 1, 3);
      expect(await einvoice.ownedInvoicesCount(seller.address)).to.equal(3n);
      expect(await einvoice.totalSupply()).to.equal(3n);
      expect(await einvoice.ownerOf(2)).to.equal(seller.address);
      expect((await einvoice.getInvoice(2)).status).to.equal(Status.Blank);
    });

    it("processes an application: apply -> approve mints to applicant", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      await expect(einvoice.connect(seller).applyForInvoices(100))
        .to.emit(einvoice, "InvoicesApplied")
        .withArgs(0, seller.address, 100);
      // bureau grants fewer than applied for (80 of 100), per the design
      await expect(einvoice.approveApplication(0, 120, 80))
        .to.emit(einvoice, "ApplicationProcessed")
        .withArgs(0, true);
      expect(await einvoice.ownedInvoicesCount(seller.address)).to.equal(80n);
      expect(await einvoice.ownerOf(120)).to.equal(seller.address);
      expect(await einvoice.ownerOf(199)).to.equal(seller.address);
    });

    it("rejects an application without minting", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      await einvoice.connect(seller).applyForInvoices(10);
      await einvoice.rejectApplication(0);
      expect(await einvoice.ownedInvoicesCount(seller.address)).to.equal(0n);
      await expect(einvoice.approveApplication(0, 1, 10)).to.be.revertedWith(
        "EInvoice: application already processed"
      );
    });

    it("unregistered enterprises cannot apply; only bureau mints", async function () {
      const { einvoice, seller, outsider } = await loadFixture(deployFixture);
      await expect(einvoice.connect(outsider).applyForInvoices(1)).to.be.revertedWith(
        "EInvoice: caller not a registered enterprise"
      );
      await expect(einvoice.connect(seller).grantInvoices(seller.address, 1, 1)).to.be.revertedWith(
        "EInvoice: caller is not tax bureau"
      );
      await expect(einvoice.grantInvoices(outsider.address, 1, 1)).to.be.revertedWith(
        "EInvoice: grantee not registered"
      );
    });

    it("invoice numbers are unique", async function () {
      const { einvoice, seller } = await loadFixture(deployFixture);
      await einvoice.grantInvoices(seller.address, 1, 1);
      await expect(einvoice.grantInvoices(seller.address, 1, 1)).to.be.revertedWith(
        "EInvoice: invoice number already exists"
      );
    });
  });

  describe("subsystem 2: issuing & circulation", function () {
    it("issues an invoice: fills face, computes tax, transfers to buyer", async function () {
      const { einvoice, seller, buyer } = await loadFixture(deployFixture);
      await einvoice.grantInvoices(seller.address, 1, 1);
      await expect(
        einvoice.connect(seller).issueInvoice(1, buyer.address, 1000_00n, RATE_13, CATEGORY, "Office laptop x1")
      )
        .to.emit(einvoice, "InvoiceIssued")
        .and.to.emit(einvoice, "Transfer")
        .withArgs(seller.address, buyer.address, 1);

      const inv = await einvoice.getInvoice(1);
      expect(inv.status).to.equal(Status.Issued);
      expect(inv.seller.taxpayerId).to.equal("91110108MA01C8H37E");
      expect(inv.buyer.taxpayerId).to.equal("91440300MA5EYP8Q2F");
      expect(inv.taxAmount).to.equal(130_00n); // 13% of 1000.00
      expect(inv.totalAmount).to.equal(1130_00n);
      expect(await einvoice.ownerOf(1)).to.equal(buyer.address);
      expect(await einvoice.ownedInvoicesCount(seller.address)).to.equal(0n);
      expect(await einvoice.ownedInvoicesCount(buyer.address)).to.equal(1n);
    });

    it("cannot issue an invoice you do not hold, twice, or to unregistered buyers", async function () {
      const { einvoice, seller, buyer, outsider } = await loadFixture(deployFixture);
      await einvoice.grantInvoices(seller.address, 1, 2);
      await expect(
        einvoice.connect(buyer).issueInvoice(1, seller.address, 1n, RATE_13, CATEGORY, "x")
      ).to.be.revertedWith("EInvoice: caller does not hold this blank invoice");
      await expect(
        einvoice.connect(seller).issueInvoice(1, outsider.address, 1n, RATE_13, CATEGORY, "x")
      ).to.be.revertedWith("EInvoice: buyer not a registered enterprise");
      await einvoice.connect(seller).issueInvoice(1, buyer.address, 1n, RATE_13, CATEGORY, "x");
      // buyer now holds it, but it is no longer blank
      await expect(
        einvoice.connect(buyer).issueInvoice(1, seller.address, 1n, RATE_13, CATEGORY, "x")
      ).to.be.revertedWith("EInvoice: invoice already issued");
    });
  });

  describe("subsystem 3: void & red-flush", function () {
    it("red-flushes an erroneous invoice with a linked credit invoice", async function () {
      const { einvoice, seller, buyer } = await loadFixture(issuedFixture);
      await expect(einvoice.connect(seller).redFlush(1, 2))
        .to.emit(einvoice, "InvoiceRedFlushed")
        .withArgs(1, 2, seller.address);

      const original = await einvoice.getInvoice(1);
      const credit = await einvoice.getInvoice(2);
      expect(original.status).to.equal(Status.Reversed);
      expect(original.linkedInvoiceId).to.equal(2n);
      expect(credit.isCredit).to.equal(true);
      expect(credit.linkedInvoiceId).to.equal(1n);
      expect(credit.preTaxAmount).to.equal(original.preTaxAmount);
      expect(credit.totalAmount).to.equal(original.totalAmount);
      expect(await einvoice.ownerOf(2)).to.equal(buyer.address);
    });

    it("only the original seller may red-flush, using their own blank", async function () {
      const { einvoice, seller, buyer } = await loadFixture(issuedFixture);
      await einvoice.grantInvoices(buyer.address, 100, 1);
      await expect(einvoice.connect(buyer).redFlush(1, 100)).to.be.revertedWith(
        "EInvoice: caller is not the original seller"
      );
      await expect(einvoice.connect(seller).redFlush(1, 100)).to.be.revertedWith(
        "EInvoice: caller does not hold this blank invoice"
      );
    });

    it("reversed and credit invoices are frozen", async function () {
      const { einvoice, seller, buyer } = await loadFixture(issuedFixture);
      await einvoice.connect(seller).redFlush(1, 2);
      // reversed original cannot be reimbursed or red-flushed again
      await expect(einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-1")).to.be.revertedWith(
        "EInvoice: invoice not available for reimbursement"
      );
      await expect(einvoice.connect(seller).redFlush(1, 3)).to.be.revertedWith(
        "EInvoice: original not in issued state"
      );
      // credit invoice cannot be reimbursed or red-flushed
      await expect(einvoice.connect(buyer).lockForReimbursement(2, "CLAIM-1")).to.be.revertedWith(
        "EInvoice: credit invoices cannot be reimbursed"
      );
      await expect(einvoice.connect(seller).redFlush(2, 3)).to.be.revertedWith(
        "EInvoice: cannot red-flush a credit invoice"
      );
    });
  });

  describe("subsystem 4: query & verification", function () {
    it("exists/ownerOf/getInvoice behave for present and absent invoices", async function () {
      const { einvoice } = await loadFixture(issuedFixture);
      expect(await einvoice.exists(1)).to.equal(true);
      expect(await einvoice.exists(999)).to.equal(false);
      await expect(einvoice.ownerOf(999)).to.be.revertedWith("EInvoice: invoice does not exist");
      await expect(einvoice.getInvoice(999)).to.be.revertedWith("EInvoice: invoice does not exist");
    });

    it("verifies authenticity by recomputed content digest", async function () {
      const { einvoice, thirdParty } = await loadFixture(issuedFixture);
      const inv = await einvoice.getInvoice(1);
      // a third party recomputes the digest from the invoice face
      const recomputed = ethers.keccak256(
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
      expect(recomputed).to.equal(inv.contentHash);
      const [valid, id] = await einvoice.connect(thirdParty).verifyByHash(recomputed);
      expect(valid).to.equal(true);
      expect(id).to.equal(1n);
      // a forged face fails verification
      const [forgedValid] = await einvoice.verifyByHash(ethers.keccak256("0x1234"));
      expect(forgedValid).to.equal(false);
    });
  });

  describe("subsystem 5: declaration & reimbursement", function () {
    it("seller declares output tax exactly once", async function () {
      const { einvoice, seller } = await loadFixture(issuedFixture);
      await expect(einvoice.connect(seller).declareTax(1))
        .to.emit(einvoice, "TaxDeclared")
        .withArgs(1, seller.address, 130_00n);
      expect((await einvoice.getInvoice(1)).declared).to.equal(true);
      await expect(einvoice.connect(seller).declareTax(1)).to.be.revertedWith(
        "EInvoice: already declared"
      );
    });

    it("only the seller declares", async function () {
      const { einvoice, buyer } = await loadFixture(issuedFixture);
      await expect(einvoice.connect(buyer).declareTax(1)).to.be.revertedWith(
        "EInvoice: caller is not the seller"
      );
    });

    it("lock -> reimburse completes and is terminal", async function () {
      const { einvoice, buyer } = await loadFixture(issuedFixture);
      await expect(einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-2026-001"))
        .to.emit(einvoice, "InvoiceLocked")
        .withArgs(1, buyer.address, "CLAIM-2026-001");
      await expect(einvoice.connect(buyer).reimburse(1))
        .to.emit(einvoice, "InvoiceReimbursed")
        .withArgs(1, buyer.address, 1130_00n);
      expect((await einvoice.getInvoice(1)).status).to.equal(Status.Reimbursed);
    });

    it("blocks duplicate reimbursement — the core guarantee", async function () {
      const { einvoice, buyer } = await loadFixture(issuedFixture);
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-A");
      // a second lock attempt fails while locked
      await expect(einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-B")).to.be.revertedWith(
        "EInvoice: invoice not available for reimbursement"
      );
      await einvoice.connect(buyer).reimburse(1);
      // and any further attempt after reimbursement fails
      await expect(einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-C")).to.be.revertedWith(
        "EInvoice: invoice not available for reimbursement"
      );
      await expect(einvoice.connect(buyer).reimburse(1)).to.be.revertedWith(
        "EInvoice: invoice not locked"
      );
    });

    it("only the invoice holder locks; only the locker reimburses or unlocks", async function () {
      const { einvoice, seller, buyer, thirdParty } = await loadFixture(issuedFixture);
      await expect(einvoice.connect(seller).lockForReimbursement(1, "X")).to.be.revertedWith(
        "EInvoice: caller does not hold this invoice"
      );
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-A");
      await expect(einvoice.connect(thirdParty).reimburse(1)).to.be.revertedWith(
        "EInvoice: caller did not lock this invoice"
      );
      await expect(einvoice.connect(thirdParty).unlockReimbursement(1)).to.be.revertedWith(
        "EInvoice: caller did not lock this invoice"
      );
    });

    it("unlock releases a failed claim so the invoice can be re-reimbursed once", async function () {
      const { einvoice, buyer } = await loadFixture(issuedFixture);
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-A");
      await expect(einvoice.connect(buyer).unlockReimbursement(1))
        .to.emit(einvoice, "InvoiceUnlocked")
        .withArgs(1, buyer.address);
      expect((await einvoice.getInvoice(1)).status).to.equal(Status.Issued);
      // can lock again after unlock
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-B");
      await einvoice.connect(buyer).reimburse(1);
      expect((await einvoice.getInvoice(1)).status).to.equal(Status.Reimbursed);
    });

    it("enforces declared-before-reimburse policy when enabled", async function () {
      const { einvoice, seller, buyer } = await loadFixture(issuedFixture);
      await einvoice.setRequireDeclaredBeforeReimburse(true);
      await expect(einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-A")).to.be.revertedWith(
        "EInvoice: invoice not yet tax-declared"
      );
      await einvoice.connect(seller).declareTax(1);
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-A");
    });
  });

  describe("full lifecycle", function () {
    it("apply -> grant -> issue -> verify -> declare -> lock -> reimburse", async function () {
      const { einvoice, seller, buyer, thirdParty } = await loadFixture(deployFixture);

      await einvoice.connect(seller).applyForInvoices(2);
      await einvoice.approveApplication(0, 1, 2);

      await einvoice
        .connect(seller)
        .issueInvoice(1, buyer.address, 8500_00n, 600n, CATEGORY, "Consulting services");

      const inv = await einvoice.connect(thirdParty).getInvoice(1);
      const [valid] = await einvoice.connect(thirdParty).verifyByHash(inv.contentHash);
      expect(valid).to.equal(true);

      await einvoice.connect(seller).declareTax(1);
      await einvoice.connect(buyer).lockForReimbursement(1, "CLAIM-2026-042");
      await einvoice.connect(buyer).reimburse(1);

      const finalInv = await einvoice.getInvoice(1);
      expect(finalInv.status).to.equal(Status.Reimbursed);
      expect(finalInv.declared).to.equal(true);
      expect(finalInv.taxAmount).to.equal(510_00n); // 6% of 8500.00
    });
  });
});
