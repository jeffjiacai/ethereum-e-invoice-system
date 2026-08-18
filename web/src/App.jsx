import React, { useEffect, useState } from "react";
import { roles, provider, contractAddress } from "./eth.js";
import { short } from "./format.js";
import TaxBureauView from "./components/TaxBureauView.jsx";
import SellerView from "./components/SellerView.jsx";
import BuyerView from "./components/BuyerView.jsx";
import VerifierView from "./components/VerifierView.jsx";

export default function App() {
  const [roleIdx, setRoleIdx] = useState(0);
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(null);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const code = await provider.getCode(contractAddress);
        if (!stop) setConnected(code !== "0x");
      } catch {
        if (!stop) setConnected(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [version]);

  const role = roles[roleIdx];
  const views = [TaxBureauView, SellerView, BuyerView, VerifierView];
  const View = views[roleIdx];

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Blockchain Electronic Invoice System</h1>
          <div className="sub">
            Ethereum smart contract at {short(contractAddress)} · local chain 31337
          </div>
        </div>
        <nav className="rolebar">
          {roles.map((r, i) => (
            <button key={r.role} className={i === roleIdx ? "active" : ""} onClick={() => setRoleIdx(i)}>
              {r.icon} {r.role}
            </button>
          ))}
        </nav>
      </header>

      <main className="container">
        {connected === false ? (
          <div className="conn-error">
            <b>Cannot reach the local chain.</b> Start it and deploy the contract first:
            <pre>
              cd chain{"\n"}npx hardhat node{"\n"}npx hardhat run scripts/deploy.js --network localhost
            </pre>
          </div>
        ) : (
          <>
            <p className="role-blurb">
              {role.icon} <b>{role.role}</b> · <code>{role.address}</code> — {role.blurb}
            </p>
            <View role={role} version={version} refresh={refresh} />
          </>
        )}
      </main>
    </>
  );
}
