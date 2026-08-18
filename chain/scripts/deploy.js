// Deploys EInvoice and seeds the demo roles:
//   account 0 = tax bureau (deployer), 1 = seller, 2 = buyer, 3 = third party
// Writes the deployed address + ABI where the web frontend can import them.
const fs = require("fs");
const path = require("path");
const { ethers, artifacts, network } = require("hardhat");

async function main() {
  const [taxBureau, seller, buyer] = await ethers.getSigners();

  const EInvoice = await ethers.getContractFactory("EInvoice");
  const einvoice = await EInvoice.deploy();
  await einvoice.waitForDeployment();
  const address = await einvoice.getAddress();
  console.log(`EInvoice deployed to ${address} on ${network.name} by ${taxBureau.address}`);

  await (
    await einvoice.registerEnterprise(
      seller.address,
      "91110108MA01C8H37E",
      "Huaxin Trading Co., Ltd.",
      "ICBC Beijing Zhongguancun Branch 0200 1234 5678",
      "12 Haidian Road, Beijing"
    )
  ).wait();
  await (
    await einvoice.registerEnterprise(
      buyer.address,
      "91440300MA5EYP8Q2F",
      "Nanshan Software Co., Ltd.",
      "CMB Shenzhen Nanshan Branch 7559 8765 4321",
      "1001 Keyuan Road, Shenzhen"
    )
  ).wait();
  console.log("Registered demo enterprises: seller (Huaxin Trading), buyer (Nanshan Software)");

  // Export address + ABI for the frontend.
  const artifact = await artifacts.readArtifact("EInvoice");
  const outDir = path.join(__dirname, "..", "..", "web", "src", "contract");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "einvoice.json"),
    JSON.stringify({ address, chainId: network.config.chainId ?? 31337, abi: artifact.abi }, null, 2)
  );
  console.log("Wrote address + ABI to web/src/contract/einvoice.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
