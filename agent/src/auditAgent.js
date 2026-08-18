import { statusName, yuan } from "./digest.js";

/**
 * Third-party audit agent: scans every invoice on the ledger and produces a
 * compliance report. All checks are deterministic and need no trust in seller
 * or buyer — authenticity is verified against on-chain digests, and the
 * remaining checks recompute what the contract guarantees, so any finding of
 * type digest/arithmetic/linkage would indicate a broken deployment rather
 * than expected behavior. The duplicate-content heuristic is advisory: the
 * contract permits two invoices with identical faces (they may be legitimate
 * repeat purchases), so the agent flags them for human review.
 */
export class AuditAgent {
  constructor({ tools }) {
    this.tools = tools;
  }

  async run() {
    const invoices = await this.tools.listAllInvoices();
    const findings = [];
    const stats = {};
    const contentIndex = new Map();

    for (const inv of invoices) {
      const id = Number(inv.invoiceId);
      const s = statusName(inv);
      stats[s] = (stats[s] ?? 0) + 1;
      if (s === "Blank") continue;

      // Integrity: the stored face must hash to a registered digest.
      if (!(await this.tools.verifyAuthentic(inv))) {
        findings.push({
          invoiceId: id,
          type: "digest-mismatch",
          severity: "critical",
          detail: "recomputed face digest not found on chain",
        });
      }

      // Arithmetic: tax and total must be internally consistent.
      const expectedTax = (BigInt(inv.preTaxAmount) * BigInt(inv.taxRateBps)) / 10000n;
      if (BigInt(inv.taxAmount) !== expectedTax || BigInt(inv.totalAmount) !== BigInt(inv.preTaxAmount) + expectedTax) {
        findings.push({
          invoiceId: id,
          type: "arithmetic-inconsistent",
          severity: "critical",
          detail: `tax/total do not follow from pre-tax ${yuan(inv.preTaxAmount)} at ${Number(inv.taxRateBps) / 100}%`,
        });
      }

      // Red-flush linkage: a reversed invoice must have a matching credit note.
      if (s === "Reversed") {
        const credit = invoices.find((o) => Number(o.invoiceId) === Number(inv.linkedInvoiceId));
        if (!credit || !credit.isCredit || BigInt(credit.totalAmount) !== BigInt(inv.totalAmount)) {
          findings.push({
            invoiceId: id,
            type: "red-flush-linkage",
            severity: "critical",
            detail: "reversed invoice lacks a value-matching linked credit note",
          });
        }
      }

      // Advisory heuristic: identical seller/buyer/amount/description pairs.
      if (!inv.isCredit) {
        const key = [inv.seller.taxpayerId, inv.buyer.taxpayerId, String(inv.preTaxAmount), inv.itemDescription].join("|");
        if (contentIndex.has(key)) {
          findings.push({
            invoiceId: id,
            type: "possible-duplicate-invoicing",
            severity: "warning",
            detail: `identical content to invoice ${contentIndex.get(key)} — review for double-billing`,
          });
        } else {
          contentIndex.set(key, id);
        }
      }
    }

    return { scanned: invoices.length, stats, findings };
  }
}
