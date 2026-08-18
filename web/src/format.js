export const STATUS_NAMES = ["None", "Blank", "Issued", "Locked", "Reimbursed", "Reversed"];

export const STATUS_COLORS = {
  Blank: "#8a8f98",
  Issued: "#1a7f37",
  Locked: "#b58a00",
  Reimbursed: "#0969da",
  Reversed: "#cf222e",
};

export function statusName(inv) {
  const base = STATUS_NAMES[Number(inv.status)];
  return inv.isCredit && base === "Issued" ? "Credit" : base;
}

export function money(cents, credit = false) {
  const v = (Number(cents) / 100).toFixed(2);
  return credit ? `−¥${v}` : `¥${v}`;
}

export function pct(bps) {
  return `${Number(bps) / 100}%`;
}

export function ts(seconds) {
  if (!seconds || Number(seconds) === 0) return "—";
  return new Date(Number(seconds) * 1000).toLocaleString();
}

export function short(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

export function invNo(id) {
  return `No. ${String(id).padStart(8, "0")}`;
}
