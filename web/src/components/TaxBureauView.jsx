import React, { useEffect, useState } from "react";
import { readContract } from "../eth.js";
import { useAllInvoices, useTx } from "../hooks.js";
import Msg from "./Msg.jsx";
import { money, statusName, STATUS_COLORS, invNo, short, ts } from "../format.js";

export default function TaxBureauView({ role, version, refresh }) {
  const { invoices } = useAllInvoices(version);
  const [applications, setApplications] = useState([]);
  const { busy, msg, run } = useTx(refresh);

  // registration form
  const [regAddr, setRegAddr] = useState("");
  const [regTaxId, setRegTaxId] = useState("");
  const [regName, setRegName] = useState("");
  const [regBank, setRegBank] = useState("");
  const [regLoc, setRegLoc] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = Number(await readContract.applicationCount());
      const apps = await Promise.all(
        Array.from({ length: n }, (_, i) => readContract.applications(i))
      );
      if (!cancelled) setApplications(apps.map((a, i) => ({ id: i, ...a.toObject() })));
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  const nextFreeId = invoices.length ? Math.max(...invoices.map((i) => Number(i.invoiceId))) + 1 : 1;
  const counts = invoices.reduce((acc, inv) => {
    const s = statusName(inv);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="card">
        <h2>Ledger overview</h2>
        <p className="hint">Every invoice on the chain, across all enterprises.</p>
        <div className="stat-row">
          <div className="stat">
            <div className="n">{invoices.length}</div>
            <div className="l">Total invoices</div>
          </div>
          {["Blank", "Issued", "Locked", "Reimbursed", "Reversed", "Credit"].map((s) => (
            <div className="stat" key={s}>
              <div className="n" style={{ color: STATUS_COLORS[s] ?? "#57606a" }}>
                {counts[s] ?? 0}
              </div>
              <div className="l">{s}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Pending applications</h2>
          <p className="hint">Approve mints the numbered blank range to the applicant.</p>
          {applications.filter((a) => !a.processed).length === 0 && (
            <div className="empty">No pending applications.</div>
          )}
          {applications
            .filter((a) => !a.processed)
            .map((a) => (
              <div key={a.id} style={{ borderTop: "1px solid #eaeef2", padding: "10px 0" }}>
                <b>Application #{a.id}</b> — {short(a.applicant)} requests {String(a.count)} blank
                invoice(s) · {ts(a.appliedAt)}
                <div>
                  <button
                    className="mini primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          role.contract.approveApplication(a.id, nextFreeId, Number(a.count)),
                        `Approved: granted ${a.count} blanks starting at ${invNo(nextFreeId)}`
                      )
                    }
                  >
                    Approve (grant {String(a.count)} from {invNo(nextFreeId)})
                  </button>
                  <button
                    className="mini"
                    disabled={busy}
                    onClick={() => run(() => role.contract.rejectApplication(a.id), "Application rejected")}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          <Msg msg={msg} />
        </div>

        <div className="card">
          <h2>Register enterprise</h2>
          <p className="hint">Binds an on-chain account to a taxpayer identity (KYC).</p>
          <label>Account address</label>
          <input value={regAddr} onChange={(e) => setRegAddr(e.target.value)} placeholder="0x…" />
          <label>Taxpayer ID</label>
          <input value={regTaxId} onChange={(e) => setRegTaxId(e.target.value)} placeholder="91110108…" />
          <label>Legal name</label>
          <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Company Ltd." />
          <label>Bank info</label>
          <input value={regBank} onChange={(e) => setRegBank(e.target.value)} placeholder="Bank + account" />
          <label>Registered address</label>
          <input value={regLoc} onChange={(e) => setRegLoc(e.target.value)} placeholder="Street, city" />
          <button
            className="action"
            disabled={busy || !regAddr}
            onClick={() =>
              run(
                () => role.contract.registerEnterprise(regAddr, regTaxId, regName, regBank, regLoc),
                `Registered ${regName || regAddr}`
              )
            }
          >
            Register
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Invoice ledger</h2>
        <table className="plain">
          <thead>
            <tr>
              <th>Number</th>
              <th>Status</th>
              <th>Seller</th>
              <th>Buyer</th>
              <th>Total</th>
              <th>Issued</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const s = statusName(inv);
              return (
                <tr key={String(inv.invoiceId)}>
                  <td>{invNo(inv.invoiceId)}</td>
                  <td>
                    <span className="pill" style={{ background: STATUS_COLORS[s] ?? "#8a8f98" }}>
                      {s}
                    </span>
                  </td>
                  <td>{inv.seller.legalName || "—"}</td>
                  <td>{inv.buyer.legalName || "—"}</td>
                  <td>{Number(inv.status) > 1 ? money(inv.totalAmount, inv.isCredit) : "—"}</td>
                  <td>{ts(inv.issuedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {invoices.length === 0 && <div className="empty">No invoices minted yet.</div>}
      </div>
    </>
  );
}
