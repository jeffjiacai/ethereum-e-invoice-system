import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

// Node wiring that mirrors web/src/eth.js: connect to the local Hardhat chain
// and expose the well-known dev accounts as named roles. Used by demo.js; the
// tests inject their own provider/contract instead (dependency injection).

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadDeployment() {
  const path = join(HERE, "..", "..", "web", "src", "contract", "einvoice.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

// Public Hardhat dev keys (local chain only — never real funds).
export const KEYS = {
  taxBureau: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  seller: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  buyer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  auditor: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
};

export function connect(rpcUrl = "http://127.0.0.1:8545") {
  const deployment = loadDeployment();
  // cacheTimeout -1 disables ethers' short-lived result cache, which otherwise
  // returns stale nonces on an auto-mining Hardhat node; NonceManager tracks
  // nonces locally so sequential agent transactions never collide.
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const wallets = Object.fromEntries(
    Object.entries(KEYS).map(([role, key]) => [role, new ethers.Wallet(key, provider)])
  );
  const contractFor = (role) =>
    new ethers.Contract(deployment.address, deployment.abi, new ethers.NonceManager(wallets[role]));
  return { provider, deployment, wallets, contractFor };
}

export function revertReason(e) {
  return (
    e?.reason ??
    e?.revert?.args?.[0] ??
    e?.message?.match(/reverted with reason string '([^']*)'/)?.[1] ??
    e?.shortMessage ??
    "transaction reverted"
  );
}
