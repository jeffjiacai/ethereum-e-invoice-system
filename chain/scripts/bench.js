// Measures per-operation gas, end-to-end confirmation latency, and sustained
// throughput on the local chain. Run on the in-process hardhat network:
//   npx hardhat run scripts/bench.js
// Results feed the evaluation section of the paper.
const { ethers, network } = require("hardhat");

const N = 200; // invoices per measurement batch

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    mean: sum / samples.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function timed(promiseFactory) {
  const t0 = process.hrtime.bigint();
  const receipt = await (await promiseFactory()).wait();
  const t1 = process.hrtime.bigint();
  return { ms: Number(t1 - t0) / 1e6, gas: Number(receipt.gasUsed) };
}

async function main() {
  const [taxBureau, seller, buyer] = await ethers.getSigners();
  const EInvoice = await ethers.getContractFactory("EInvoice");

  // Deployment cost
  const deployTx = await EInvoice.deploy();
  await deployTx.waitForDeployment();
  const deployReceipt = await deployTx.deploymentTransaction().wait();
  const einvoice = deployTx;
  console.log(`network: ${network.name}`);
  console.log(`deploy gas: ${deployReceipt.gasUsed}`);

  await (
    await einvoice.registerEnterprise(seller.address, "91110108MA01C8H37E", "Huaxin Trading Co., Ltd.",
      "ICBC Beijing Zhongguancun Branch 0200 1234 5678", "12 Haidian Road, Beijing")
  ).wait();
  await (
    await einvoice.registerEnterprise(buyer.address, "91440300MA5EYP8Q2F", "Nanshan Software Co., Ltd.",
      "CMB Shenzhen Nanshan Branch 7559 8765 4321", "1001 Keyuan Road, Shenzhen")
  ).wait();

  const ops = {
    grantInvoices_x10: [],
    issueInvoice: [],
    declareTax: [],
    lockForReimbursement: [],
    reimburse: [],
    redFlush: [],
  };

  // Grant blanks in batches of 10 (2*N blanks total: N to issue, N spare for red-flush)
  let nextId = 1;
  for (let i = 0; i < (2 * N) / 10; i++) {
    ops.grantInvoices_x10.push(await timed(() => einvoice.grantInvoices(seller.address, nextId, 10)));
    nextId += 10;
  }

  // Issue N invoices, then declare / lock / reimburse each
  for (let i = 1; i <= N; i++) {
    ops.issueInvoice.push(
      await timed(() =>
        einvoice.connect(seller).issueInvoice(i, buyer.address, 1000_00n, 1300n, 1090511030000000000n, "Office laptop x1")
      )
    );
  }
  for (let i = 1; i <= N; i++) ops.declareTax.push(await timed(() => einvoice.connect(seller).declareTax(i)));
  for (let i = 1; i <= N; i++)
    ops.lockForReimbursement.push(await timed(() => einvoice.connect(buyer).lockForReimbursement(i, `CLAIM-${i}`)));
  for (let i = 1; i <= N; i++) ops.reimburse.push(await timed(() => einvoice.connect(buyer).reimburse(i)));

  // Red-flush: issue 50 more, then red-flush them with spare blanks
  const rf = 50;
  for (let i = N + 1; i <= N + rf; i++) {
    await (
      await einvoice.connect(seller).issueInvoice(i, buyer.address, 500_00n, 1300n, 1090511030000000000n, "Erroneous item")
    ).wait();
  }
  for (let i = 0; i < rf; i++) {
    ops.redFlush.push(await timed(() => einvoice.connect(seller).redFlush(N + 1 + i, N + rf + 1 + i)));
  }

  console.log("\nper-operation results (gas constant across runs; latency over local JSON-RPC):");
  console.log("operation, n, gas, latency_mean_ms, latency_p50_ms, latency_p95_ms");
  for (const [op, samples] of Object.entries(ops)) {
    const gas = stats(samples.map((s) => s.gas));
    const lat = stats(samples.map((s) => s.ms));
    const gasStr = gas.min === gas.max ? `${gas.min}` : `${Math.round(gas.mean)} (min ${gas.min}, max ${gas.max})`;
    console.log(
      `${op}, ${samples.length}, ${gasStr}, ${lat.mean.toFixed(1)}, ${lat.p50.toFixed(1)}, ${lat.p95.toFixed(1)}`
    );
  }

  // Sustained throughput: submit a batch of issueInvoice txs concurrently
  const batch = 100;
  const ids = [];
  for (let i = 0; i < batch; i++) ids.push(nextId + i);
  await (await einvoice.grantInvoices(seller.address, nextId, batch)).wait();
  const t0 = process.hrtime.bigint();
  const txs = [];
  for (const id of ids) {
    txs.push(
      einvoice.connect(seller).issueInvoice(id, buyer.address, 1000_00n, 1300n, 1090511030000000000n, "Office laptop x1")
    );
  }
  const sent = await Promise.all(txs);
  await Promise.all(sent.map((t) => t.wait()));
  const t1 = process.hrtime.bigint();
  const seconds = Number(t1 - t0) / 1e9;
  console.log(`\nthroughput: ${batch} issueInvoice txs in ${seconds.toFixed(2)}s = ${(batch / seconds).toFixed(1)} tx/s`);
  console.log("(local Hardhat auto-mining node; consortium-chain numbers depend on consensus configuration)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
