// End-to-end lifecycle demo against a running local node:
//   npx hardhat run scripts/demo.js --network localhost
// Walks one invoice through: apply -> approve -> issue -> verify -> declare
// -> lock -> duplicate-lock rejection -> reimburse, then red-flushes a second
// invoice. Prints each step.
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

const fmt = (cents) => `¥${(Number(cents) / 100).toFixed(2)}`;
const STATUS = ["None", "Blank", "Issued", "Locked", "Reimbursed", "Reversed"];

async function main() {
  const [taxBureau, seller, buyer, thirdParty] = await ethers.getSigners();

  const deployment = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "web", "src", "contract", "einvoice.json"), "utf8")
  );
  const einvoice = await ethers.getContractAt("EInvoice", deployment.address);
  console.log(`Using EInvoice at ${deployment.address}\n`);

  // ---- Subsystem 1: application & distribution ----
  const applyTx = await (await einvoice.connect(seller).applyForInvoices(10)).wait();
  const appId = applyTx.logs.map((l) => einvoice.interface.parseLog(l)).find((e) => e?.name === "InvoicesApplied")
    .args.applicationId;
  console.log(`1. Seller applied for 10 blank invoices (application #${appId})`);

  const startId = Number(await einvoice.totalSupply()) + 1;
  await (await einvoice.connect(taxBureau).approveApplication(appId, startId, 10)).wait();
  console.log(`   Tax bureau approved: granted invoice numbers ${startId}..${startId + 9}`);
  console.log(`   Seller now holds ${await einvoice.ownedInvoicesCount(seller.address)} blank invoice(s)\n`);

  // ---- Subsystem 2: issuing & circulation ----
  const invId = startId;
  await (
    await einvoice
      .connect(seller)
      .issueInvoice(invId, buyer.address, 1000_00n, 1300n, 1090511030000000000n, "Office laptop x1")
  ).wait();
  let inv = await einvoice.getInvoice(invId);
  console.log(`2. Seller issued invoice #${invId} to buyer:`);
  console.log(`   ${inv.seller.legalName} -> ${inv.buyer.legalName}`);
  console.log(`   pre-tax ${fmt(inv.preTaxAmount)} + 13% tax ${fmt(inv.taxAmount)} = ${fmt(inv.totalAmount)}`);
  console.log(`   owner is now the buyer: ${(await einvoice.ownerOf(invId)) === buyer.address}\n`);

  // ---- Subsystem 4: query & verification (third party) ----
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
  const [valid, foundId] = await einvoice.connect(thirdParty).verifyByHash(recomputed);
  console.log(`3. Third party recomputed the face digest and verified on-chain: valid=${valid}, invoice #${foundId}\n`);

  // ---- Subsystem 5: declaration & reimbursement ----
  await (await einvoice.connect(seller).declareTax(invId)).wait();
  console.log(`4. Seller declared output tax ${fmt(inv.taxAmount)} for invoice #${invId}`);

  await (await einvoice.connect(buyer).lockForReimbursement(invId, "CLAIM-2026-042")).wait();
  console.log(`5. Buyer locked invoice #${invId} against claim CLAIM-2026-042`);

  try {
    await einvoice.connect(buyer).lockForReimbursement(invId, "CLAIM-2026-043");
    console.log("   !! duplicate lock unexpectedly succeeded");
  } catch (e) {
    const reason = e.message.match(/'([^']*)'/)?.[1] ?? e.reason ?? e.shortMessage ?? "reverted";
    console.log(`   Duplicate reimbursement attempt rejected: "${reason}"`);
  }

  await (await einvoice.connect(buyer).reimburse(invId)).wait();
  inv = await einvoice.getInvoice(invId);
  console.log(`   Buyer reimbursed ${fmt(inv.totalAmount)}; status = ${STATUS[Number(inv.status)]}\n`);

  // ---- Subsystem 3: void & red-flush ----
  const wrongId = startId + 1;
  const creditId = startId + 2;
  await (
    await einvoice
      .connect(seller)
      .issueInvoice(wrongId, buyer.address, 500_00n, 1300n, 1090511030000000000n, "Erroneous line item")
  ).wait();
  console.log(`6. Seller issued erroneous invoice #${wrongId} (${fmt((await einvoice.getInvoice(wrongId)).totalAmount)})`);
  await (await einvoice.connect(seller).redFlush(wrongId, creditId)).wait();
  const original = await einvoice.getInvoice(wrongId);
  const credit = await einvoice.getInvoice(creditId);
  console.log(`   Red-flushed with credit invoice #${creditId}:`);
  console.log(`   original status = ${STATUS[Number(original.status)]}, linked to #${original.linkedInvoiceId}`);
  console.log(`   credit isCredit=${credit.isCredit}, offsets ${fmt(credit.totalAmount)}\n`);

  console.log(`Total invoices on chain: ${await einvoice.totalSupply()}`);
  console.log("Demo complete: all five subsystems exercised.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
