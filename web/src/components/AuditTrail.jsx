import React, { useEffect, useState } from "react";
import { readContract, provider } from "../eth.js";
import { money, short, invNo } from "../format.js";

const ZERO = "0x0000000000000000000000000000000000000000";

function describe(ev) {
  const a = ev.args;
  switch (ev.fragment.name) {
    case "Transfer":
      return a.from === ZERO
        ? { label: "Blank invoice minted", detail: `granted to ${short(a.to)}` }
        : { label: "Ownership transferred", detail: `${short(a.from)} → ${short(a.to)}` };
    case "InvoiceIssued":
      return {
        label: "Invoice issued",
        detail: `seller ${short(a.seller)} → buyer ${short(a.buyer)}, total ${money(a.totalAmount)}`,
      };
    case "InvoiceRedFlushed":
      return {
        label: "Red-flushed",
        detail: `original ${invNo(a.originalId)} offset by credit ${invNo(a.creditId)}`,
      };
    case "TaxDeclared":
      return { label: "Output tax declared", detail: `tax ${money(a.taxAmount)} by ${short(a.seller)}` };
    case "InvoiceLocked":
      return { label: "Locked for reimbursement", detail: `claim ${a.claimDocId} by ${short(a.locker)}` };
    case "InvoiceUnlocked":
      return { label: "Reimbursement lock released", detail: `by ${short(a.locker)}` };
    case "InvoiceReimbursed":
      return { label: "Reimbursed", detail: `${money(a.totalAmount)} to claim of ${short(a.locker)}` };
    default:
      return { label: ev.fragment.name, detail: "" };
  }
}

/** Full on-chain event history for one invoice number. */
export default function AuditTrail({ invoiceId, version }) {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    (async () => {
      const id = BigInt(invoiceId);
      const filters = [
        readContract.filters.Transfer(null, null, id),
        readContract.filters.InvoiceIssued(id),
        readContract.filters.InvoiceRedFlushed(id),
        readContract.filters.InvoiceRedFlushed(null, id),
        readContract.filters.TaxDeclared(id),
        readContract.filters.InvoiceLocked(id),
        readContract.filters.InvoiceUnlocked(id),
        readContract.filters.InvoiceReimbursed(id),
      ];
      const results = (
        await Promise.all(filters.map((f) => readContract.queryFilter(f, 0, "latest")))
      ).flat();
      results.sort((x, y) => x.blockNumber - y.blockNumber || x.index - y.index);
      const withTime = await Promise.all(
        results.map(async (ev) => {
          const block = await provider.getBlock(ev.blockNumber);
          return { ev, time: new Date(block.timestamp * 1000).toLocaleString(), block: ev.blockNumber };
        })
      );
      if (!cancelled) setEntries(withTime);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, version]);

  if (!invoiceId) return null;
  if (!entries) return <div className="empty">Loading audit trail…</div>;
  if (entries.length === 0) return <div className="empty">No on-chain events for this invoice.</div>;

  return (
    <ul className="trail">
      {entries.map(({ ev, time, block }, i) => {
        const { label, detail } = describe(ev);
        return (
          <li key={i}>
            <div className="ev">{label}</div>
            <div className="detail">
              {detail} · block #{block} · {time}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
