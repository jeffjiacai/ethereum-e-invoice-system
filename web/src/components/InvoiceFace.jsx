import React from "react";
import { money, pct, ts, invNo, statusName, STATUS_COLORS } from "../format.js";

/** Renders an on-chain invoice as a VAT-style invoice face. */
export default function InvoiceFace({ inv }) {
  const credit = inv.isCredit;
  const status = statusName(inv);
  return (
    <div className="invoice-face">
      <div className="face-head">
        {credit && <span className="credit-stamp">CREDIT / RED-FLUSH</span>}
        <div className="title">BLOCKCHAIN ELECTRONIC INVOICE</div>
        <div className="no">{invNo(inv.invoiceId)}</div>
      </div>
      <table>
        <tbody>
          <tr>
            <td className="k">Seller</td>
            <td>
              {inv.seller.legalName}
              <br />
              Taxpayer ID: {inv.seller.taxpayerId}
              <br />
              Bank: {inv.seller.bankInfo}
              <br />
              Address: {inv.seller.registeredAddress}
            </td>
            <td className="k">Buyer</td>
            <td>
              {inv.buyer.legalName}
              <br />
              Taxpayer ID: {inv.buyer.taxpayerId}
              <br />
              Bank: {inv.buyer.bankInfo}
              <br />
              Address: {inv.buyer.registeredAddress}
            </td>
          </tr>
          <tr>
            <td className="k">Items</td>
            <td>{inv.itemDescription}</td>
            <td className="k">Category</td>
            <td>{String(inv.taxCategoryCode)}</td>
          </tr>
          <tr>
            <td className="k">Amount</td>
            <td>
              Pre-tax: {money(inv.preTaxAmount, credit)} &nbsp;|&nbsp; Tax ({pct(inv.taxRateBps)}):{" "}
              {money(inv.taxAmount, credit)}
              <br />
              <b>Total: {money(inv.totalAmount, credit)}</b>
            </td>
            <td className="k">Status</td>
            <td>
              <span className="pill" style={{ background: STATUS_COLORS[status] ?? "#8a8f98" }}>
                {status}
              </span>
              {inv.declared && (
                <span className="pill" style={{ background: "#57606a", marginLeft: 6 }}>
                  Tax declared
                </span>
              )}
              {Number(inv.linkedInvoiceId) !== 0 && (
                <div style={{ marginTop: 6 }}>Linked invoice: {invNo(inv.linkedInvoiceId)}</div>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="face-foot">
        <span>Issued: {ts(inv.issuedAt)}</span>
        <span>Digest: {inv.contentHash.slice(0, 18)}…</span>
      </div>
    </div>
  );
}
