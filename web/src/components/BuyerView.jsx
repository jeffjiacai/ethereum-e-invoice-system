import React, { useEffect, useState } from "react";
import { readContract, computeContentHash } from "../eth.js";
import { useTx } from "../hooks.js";
import Msg from "./Msg.jsx";
import { statusName, invNo, money } from "../format.js";
import InvoiceFace from "./InvoiceFace.jsx";

export default function BuyerView({ role, version, refresh }) {
  const [received, setReceived] = useState([]);
  const [claimIds, setClaimIds] = useState({});
  const [verified, setVerified] = useState({});
  const { busy, msg, run } = useTx(refresh);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = await readContract.invoicesOf(role.address);
      const invs = await Promise.all(ids.map((id) => readContract.getInvoice(id)));
      const locks = await Promise.all(ids.map((id) => readContract.getLock(id)));
      if (!cancelled) {
        const withLocks = invs.map((inv, i) => ({ inv, lock: locks[i] }));
        withLocks.sort((a, b) => Number(a.inv.invoiceId) - Number(b.inv.invoiceId));
        setReceived(withLocks);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, role]);

  async function verify(inv) {
    const digest = computeContentHash(inv);
    const [valid, id] = await readContract.verifyByHash(digest);
    setVerified((v) => ({
      ...v,
      [String(inv.invoiceId)]:
        valid && id === inv.invoiceId
          ? { kind: "ok", text: `Authentic: recomputed digest matches on-chain record for ${invNo(id)}` }
          : { kind: "err", text: "Digest not found on chain — invoice may be forged" },
    }));
  }

  return (
    <>
      <div className="stat-row" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="n">{received.filter(({ inv }) => !inv.isCredit).length}</div>
          <div className="l">Invoices received</div>
        </div>
        <div className="stat">
          <div className="n">
            {received.filter(({ inv }) => statusName(inv) === "Reimbursed").length}
          </div>
          <div className="l">Reimbursed</div>
        </div>
        <div className="stat">
          <div className="n">
            {money(
              received
                .filter(({ inv }) => statusName(inv) === "Reimbursed")
                .reduce((s, { inv }) => s + Number(inv.totalAmount), 0)
            )}
          </div>
          <div className="l">Total reimbursed</div>
        </div>
      </div>
      <Msg msg={msg} />

      {received.length === 0 && (
        <div className="card">
          <div className="empty">No invoices received yet. Ask the seller to issue one.</div>
        </div>
      )}

      {received.map(({ inv, lock }) => {
        const key = String(inv.invoiceId);
        const s = statusName(inv);
        return (
          <div className="card" key={key}>
            <InvoiceFace inv={inv} />
            {lock.locker !== "0x0000000000000000000000000000000000000000" && s === "Locked" && (
              <p className="hint" style={{ marginTop: 10 }}>
                Locked against claim <b>{lock.claimDocId}</b>
              </p>
            )}
            <div style={{ marginTop: 12 }}>
              <button className="mini" onClick={() => verify(inv)}>
                Verify authenticity
              </button>
              {s === "Issued" && !inv.isCredit && (
                <>
                  <input
                    style={{ width: 220, display: "inline-block", margin: "0 6px" }}
                    placeholder="Expense claim ID (e.g. CLAIM-001)"
                    value={claimIds[key] ?? ""}
                    onChange={(e) => setClaimIds((c) => ({ ...c, [key]: e.target.value }))}
                  />
                  <button
                    className="mini primary"
                    disabled={busy || !(claimIds[key] ?? "").trim()}
                    onClick={() =>
                      run(
                        () => role.contract.lockForReimbursement(inv.invoiceId, claimIds[key].trim()),
                        `${invNo(inv.invoiceId)} locked against ${claimIds[key].trim()}`
                      )
                    }
                  >
                    Lock for reimbursement
                  </button>
                </>
              )}
              {s === "Locked" && (
                <>
                  <button
                    className="mini primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => role.contract.reimburse(inv.invoiceId),
                        `${invNo(inv.invoiceId)} reimbursed (${money(inv.totalAmount)})`
                      )
                    }
                  >
                    Complete reimbursement
                  </button>
                  <button
                    className="mini"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => role.contract.unlockReimbursement(inv.invoiceId),
                        `${invNo(inv.invoiceId)} unlocked — claim withdrawn`
                      )
                    }
                  >
                    Unlock (claim failed)
                  </button>
                </>
              )}
              {s === "Reimbursed" && (
                <button
                  className="mini"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => role.contract.lockForReimbursement(inv.invoiceId, "CLAIM-DUPLICATE"),
                      "this should never appear"
                    )
                  }
                >
                  Try duplicate reimbursement (demo)
                </button>
              )}
            </div>
            {verified[key] && <div className={`msg ${verified[key].kind}`}>{verified[key].text}</div>}
          </div>
        );
      })}
    </>
  );
}
