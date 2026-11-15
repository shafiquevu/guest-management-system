/**
 * Invoice maths and shapes, shared by the API (which stores the totals) and the
 * page (which shows them while you type). Money is worked in pence so totals
 * never drift by a penny from adding floats.
 *
 * A line can be priced two ways:
 *   rate  x qty                -> the line total   (cleaning fee: 1 x £40)
 *   a fixed line total         -> the rate shown is total / qty
 * The second exists because stays are agreed as a total. The old tool made
 * "£4,000 for 30 nights" into 30 x £133.34 = £4,000.20, overcharging 20p; a
 * fixed total keeps the £4,000 the client agreed to.
 */

export type InvoiceItem = {
  description: string;
  qty: number;
  unit: string;
  rate: number;
  vatRate: number;          // percent, e.g. 0 or 20
  fixedTotal?: number | null; // when set, the line's net total; rate is derived
};

export type InvoiceStatus = "draft" | "sent" | "paid" | "cancelled";
export const STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "cancelled"];
export const STATUS_LABEL: Record<InvoiceStatus, string> = { draft: "Draft", sent: "Sent", paid: "Paid", cancelled: "Cancelled" };

export const UNITS = ["Nights", "Service", "Item", "Hours", "Weeks"];

const pence = (n: number) => Math.round(n * 100);

export function lineNet(item: InvoiceItem): number {
  if (item.fixedTotal !== null && item.fixedTotal !== undefined && Number.isFinite(item.fixedTotal)) {
    return pence(item.fixedTotal) / 100;
  }
  return pence((Number(item.qty) || 0) * (Number(item.rate) || 0)) / 100;
}

/** The rate to print: the entered rate, or total / qty for a fixed-total line. */
export function lineRate(item: InvoiceItem): number {
  if (item.fixedTotal !== null && item.fixedTotal !== undefined && Number.isFinite(item.fixedTotal)) {
    const q = Number(item.qty) || 0;
    return q ? pence(item.fixedTotal / q) / 100 : 0;
  }
  return Number(item.rate) || 0;
}

export function lineVat(item: InvoiceItem): number {
  return Math.round(pence(lineNet(item)) * (Number(item.vatRate) || 0) / 100) / 100;
}

export function totals(items: InvoiceItem[]): { subtotal: number; vat: number; total: number } {
  const sub = items.reduce((s, i) => s + pence(lineNet(i)), 0);
  const vat = items.reduce((s, i) => s + pence(lineVat(i)), 0);
  return { subtotal: sub / 100, vat: vat / 100, total: (sub + vat) / 100 };
}

/** Clean what the browser sent into items we are willing to store. */
export function cleanItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => {
        const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
        return Number.isFinite(n) ? n : 0;
      };
      const fixed = o.fixedTotal === null || o.fixedTotal === undefined || o.fixedTotal === "" ? null : num(o.fixedTotal);
      return {
        description: String(o.description ?? "").trim().slice(0, 300),
        qty: num(o.qty),
        unit: String(o.unit ?? "").trim().slice(0, 30),
        rate: num(o.rate),
        vatRate: num(o.vatRate),
        fixedTotal: fixed,
      };
    })
    .filter((i) => i.description || i.qty || i.rate || i.fixedTotal);
}

/** Whole nights between two YYYY-MM-DD dates (0 if either is missing). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 2026-11-06 -> 6/11/2026, the way the team writes stay dates on invoices. */
export function ukDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : iso;
}

/** The nightly-rate line for a stay, priced at the stay's agreed total. */
export function stayLine(checkIn: string, checkOut: string, stayTotal: number | null): InvoiceItem {
  const nights = nightsBetween(checkIn, checkOut);
  const hasTotal = stayTotal !== null && Number.isFinite(stayTotal) && stayTotal > 0;
  return {
    description: `Nightly Rate (${ukDate(checkIn)} - ${ukDate(checkOut)})`,
    qty: nights,
    unit: "Nights",
    rate: 0,
    vatRate: 0,
    fixedTotal: hasTotal ? stayTotal : null,
  };
}

export function money(n: number, currency = "GBP"): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
