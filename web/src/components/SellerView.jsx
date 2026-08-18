import React, { useEffect, useState } from "react";
import { readContract, roles } from "../eth.js";
import { useTx } from "../hooks.js";
import Msg from "./Msg.jsx";
import { statusName, STATUS_COLORS, invNo, money } from "../format.js";
import InvoiceFace from "./InvoiceFace.jsx";

export default function SellerView({ role, version, refresh }) {
  const [held, setHeld] = useState([]); // invoices currently held (blanks)
  const [sold, setSold] = useState([]); // invoices this account issued
  const apply = useTx(refresh);
  const issue = useTx(refresh);
  const manage = useTx(refresh);

  const [applyCount, setApplyCount] = useState(10);
  const [blankId, setBlankId] = useState("");
  const [buyerAddr, setBuyerAddr] = useState(roles[2].address);
  const [amount, setAmount] = useState("1000.00");
  const [rate, setRate] = useState("13");
  const [category, setCategory] = useState("1090511030000000000");
  const [descr, setDescr] = useState("Office laptop x1");
  const [redOriginal, setRedOriginal] = useState("");
  const [redBlank, setRedBlank] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = await readContract.invoicesOf(role.address);
      const mine = await Promise.all(ids.map((id) => readContract.getInvoice(id)));

      const total = Number(await readContract.totalSupply());
      const allIds = await Promise.all(
        Array.from({ length: total }, (_, i) => readContract.invoiceByIndex(i))
      );
      const all = await Promise.all(allIds.map((id) => readContract.getInvoice(id)));
      const issued = all.filter(
        (inv) => inv.seller.account.toLowerCase() === role.address.toLowerCase()
      );

      if (!cancelled) {
        setHeld([...mine].sort((a, b) => Number(a.invoiceId) - Number(b.invoiceId)));
        setSold([...issued].sort((a, b) => Number(a.invoiceId) - Number(b.invoiceId)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version, role]);

  const blanks = held.filter((inv) => statusName(inv) === "Blank");
  const undeclared = sold.filter((inv) => !inv.declared && !inv.isCredit && Number(inv.status) >= 2);
  const flushable = sold.filter((inv) => statusName(inv) === "Issued" && !inv.isCredit);

  useEffect(() => {
    if (blanks.length && !blankId) setBlankId(String(blanks[0].invoiceId));
  }, [blanks, blankId]);

  return (
    <>
      <div className="stat-row" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="n">{blanks.length}</div>
          <div className="l">Blank invoices held</div>
        </div>
        <div className="stat">
          <div className="n">{sold.filter((i) => !i.isCredit).length}</div>
          <div className="l">Invoices issued</div>
        </div>
        <div className="stat">
          <div className="n">{undeclared.length}</div>
          <div className="l">Awaiting tax declaration</div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>1 · Apply for blank invoices</h2>
          <p className="hint">The tax bureau reviews and grants a numbered range.</p>
          <label>Number of blank invoices</label>
          <input type="number" min="1" value={applyCount} onChange={(e) => setApplyCount(e.target.value)} />
          <button
            className="action"
            disabled={apply.busy}
            onClick={() =>
              apply.run(
                () => role.contract.applyForInvoices(Number(applyCount)),
                `Application submitted for ${applyCount} blank invoice(s) — awaiting bureau approval`
              )
            }
          >
            Submit application
          </button>
          <Msg msg={apply.msg} />
        </div>

        <div className="card">
          <h2>3 · Declare output tax</h2>
          <p className="hint">Declare each issued invoice exactly once.</p>
          {undeclared.length === 0 && <div className="empty">Nothing awaiting declaration.</div>}
          {undeclared.map((inv) => (
            <div key={String(inv.invoiceId)} style={{ borderTop: "1px solid #eaeef2", padding: "8px 0" }}>
              {invNo(inv.invoiceId)} — tax {money(inv.taxAmount)}
              <button
                className="mini primary"
                disabled={manage.busy}
                onClick={() =>
                  manage.run(
                    () => role.contract.declareTax(inv.invoiceId),
                    `Declared ${money(inv.taxAmount)} for ${invNo(inv.invoiceId)}`
                  )
                }
              >
                Declare
              </button>
            </div>
          ))}
          <h2 style={{ marginTop: 18 }}>4 · Red-flush an erroneous invoice</h2>
          <p className="hint">Issues a linked negative invoice from one of your blanks.</p>
          <label>Erroneous invoice</label>
          <select value={redOriginal} onChange={(e) => setRedOriginal(e.target.value)}>
            <option value="">— select —</option>
            {flushable.map((inv) => (
              <option key={String(inv.invoiceId)} value={String(inv.invoiceId)}>
                {invNo(inv.invoiceId)} · {money(inv.totalAmount)} · {inv.itemDescription}
              </option>
            ))}
          </select>
          <label>Blank invoice for the credit note</label>
          <select value={redBlank} onChange={(e) => setRedBlank(e.target.value)}>
            <option value="">— select —</option>
            {blanks.map((inv) => (
              <option key={String(inv.invoiceId)} value={String(inv.invoiceId)}>
                {invNo(inv.invoiceId)}
              </option>
            ))}
          </select>
          <button
            className="action danger"
            disabled={manage.busy || !redOriginal || !redBlank}
            onClick={() =>
              manage.run(
                () => role.contract.redFlush(redOriginal, redBlank),
                `Red-flushed ${invNo(redOriginal)} with credit ${invNo(redBlank)}`
              )
            }
          >
            Red-flush
          </button>
          <Msg msg={manage.msg} />
        </div>
      </div>

      <div className="card">
        <h2>2 · Issue an invoice</h2>
        <p className="hint">
          Fills the face of a blank invoice and transfers ownership to the buyer. The face digest is
          stored on-chain for verification.
        </p>
        <div className="grid">
          <div>
            <label>Blank invoice</label>
            <select value={blankId} onChange={(e) => setBlankId(e.target.value)}>
              {blanks.length === 0 && <option value="">— no blanks held —</option>}
              {blanks.map((inv) => (
                <option key={String(inv.invoiceId)} value={String(inv.invoiceId)}>
                  {invNo(inv.invoiceId)}
                </option>
              ))}
            </select>
            <label>Buyer address</label>
            <input value={buyerAddr} onChange={(e) => setBuyerAddr(e.target.value)} />
            <label>Item description</label>
            <input value={descr} onChange={(e) => setDescr(e.target.value)} />
          </div>
          <div>
            <label>Pre-tax amount (¥)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} />
            <label>Tax rate (%)</label>
            <input value={rate} onChange={(e) => setRate(e.target.value)} />
            <label>Tax category code</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
        </div>
        <button
          className="action"
          disabled={issue.busy || !blankId}
          onClick={() =>
            issue.run(
              () =>
                role.contract.issueInvoice(
                  blankId,
                  buyerAddr,
                  BigInt(Math.round(parseFloat(amount) * 100)),
                  BigInt(Math.round(parseFloat(rate) * 100)),
                  BigInt(category),
                  descr
                ),
              `Issued ${invNo(blankId)} to buyer`
            )
          }
        >
          Issue invoice
        </button>
        <Msg msg={issue.msg} />
      </div>

      <div className="card">
        <h2>Invoices I issued</h2>
        {sold.length === 0 && <div className="empty">None yet.</div>}
        {sold.map((inv) => (
          <InvoiceFace key={String(inv.invoiceId)} inv={inv} />
        ))}
      </div>
    </>
  );
}
