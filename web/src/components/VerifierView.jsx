import React, { useState } from "react";
import { readContract, computeContentHash } from "../eth.js";
import { invNo } from "../format.js";
import InvoiceFace from "./InvoiceFace.jsx";
import AuditTrail from "./AuditTrail.jsx";

export default function VerifierView({ version }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null); // {inv, verdict:{kind,text}}
  const [notFound, setNotFound] = useState(null);

  async function lookup() {
    setResult(null);
    setNotFound(null);
    const q = query.trim();
    try {
      let inv;
      if (q.startsWith("0x") && q.length === 66) {
        // digest lookup
        const [valid, id] = await readContract.verifyByHash(q);
        if (!valid) {
          setNotFound(`No invoice on chain matches digest ${q.slice(0, 18)}… — treat as forged.`);
          return;
        }
        inv = await readContract.getInvoice(id);
      } else {
        const id = BigInt(q);
        if (!(await readContract.exists(id))) {
          setNotFound(`Invoice ${invNo(id)} does not exist on this chain.`);
          return;
        }
        inv = await readContract.getInvoice(id);
      }
      const recomputed = computeContentHash(inv);
      const [valid, id2] = await readContract.verifyByHash(recomputed);
      setResult({
        inv,
        verdict:
          valid && id2 === inv.invoiceId
            ? {
                kind: "ok",
                text: "Authentic: the digest recomputed from the invoice face matches the on-chain record.",
              }
            : { kind: "err", text: "Digest mismatch — invoice data inconsistent." },
      });
    } catch (e) {
      setNotFound(`Query failed: ${e.shortMessage ?? e.message}`);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Query &amp; verify an invoice</h2>
        <p className="hint">
          Enter an invoice number (e.g. <code>1</code>) or a 32-byte content digest (<code>0x…</code>).
          Third parties — auditors, courts, banks — can verify authenticity without trusting either
          transaction party.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
          placeholder="Invoice number or 0x digest"
        />
        <button className="action" onClick={lookup} disabled={!query.trim()}>
          Look up
        </button>
        {notFound && <div className="msg err">{notFound}</div>}
      </div>

      {result && (
        <>
          <div className="card">
            <div className={`msg ${result.verdict.kind}`} style={{ marginTop: 0 }}>
              {result.verdict.text}
            </div>
            <InvoiceFace inv={result.inv} />
            <div className="hashbox">on-chain digest: {result.inv.contentHash}</div>
          </div>
          <div className="card">
            <h2>Audit trail — {invNo(result.inv.invoiceId)}</h2>
            <p className="hint">Complete, immutable event history reconstructed from chain logs.</p>
            <AuditTrail invoiceId={String(result.inv.invoiceId)} version={version} />
          </div>
        </>
      )}
    </>
  );
}
