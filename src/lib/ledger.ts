import "server-only";

/**
 * GH Ledger: the team's own finance app (ghledger.netlify.app), backed by a
 * Google Sheet through an Apps Script web app. It is their record of every
 * booking (Airbnb, Booking.com, direct, council), damage claim and parking
 * ticket, so the Finance page reads it rather than keeping a second copy that
 * could drift. Read-only from here: the team keeps editing in GH Ledger.
 *
 *   LEDGER_URL       the Apps Script /exec URL
 *   LEDGER_USERNAME  a GH Ledger login
 *   LEDGER_PASSWORD
 */

export type LedgerBooking = {
  id: string;
  name: string;
  property: string;
  flat: string;
  checkIn: string;
  checkOut: string;
  platform: string;
  amount: number;          // what the business keeps (Booking.com: gross minus commission)
  grossAmount: number;
  councilWing: string;
  invoiceNo: string;
  remittanceAdviceNo: string;
  paymentDate: string;
  bankReflectionDate: string;
  bankReflectionAmount: number | null;
  flagged: boolean;
};

// Claims, extras and tickets carry GH Ledger's own month key (YYYY-MM), which
// is how its dashboard groups them; reusing it keeps both pages in step.
export type LedgerClaim = { id: string; property: string; status: string; requestedAmount: number; approvedAmount: number; monthKey: string };
export type LedgerExtra = { id: string; amount: number; monthKey: string; label: string; property: string };
export type LedgerTicket = { id: string; feeAmount: number; paid: boolean; monthKey: string; property: string };

export type Ledger = {
  bookings: LedgerBooking[];
  extras: LedgerExtra[];
  damageClaims: LedgerClaim[];
  parkingTickets: LedgerTicket[];
  properties: string[];
  fetchedAt: string;
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; data: Ledger } | null = null;
let token: string | null = null;

export function ledgerConfigured(): boolean {
  return Boolean(process.env.LEDGER_URL && process.env.LEDGER_USERNAME && process.env.LEDGER_PASSWORD);
}

async function call(init: { method: "GET"; query: string } | { method: "POST"; body: unknown }): Promise<Record<string, unknown>> {
  const url = process.env.LEDGER_URL!;
  const res = init.method === "GET"
    ? await fetch(`${url}?${init.query}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) })
    : await fetch(url, {
        method: "POST",
        // Apps Script only accepts a "simple" request body.
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(init.body),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GH Ledger returned an unexpected response (usually a brief Google hiccup). Try again.");
  }
}

async function login(): Promise<string> {
  const r = await call({ method: "POST", body: { action: "login", username: process.env.LEDGER_USERNAME, password: process.env.LEDGER_PASSWORD } });
  if (!r.ok || typeof r.token !== "string") throw new Error(`GH Ledger login failed: ${String(r.error ?? "unknown error")}`);
  return r.token;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();
const day = (v: unknown) => str(v).slice(0, 10);

export async function fetchLedger(force = false): Promise<Ledger> {
  if (!ledgerConfigured()) throw new Error("GH Ledger is not connected (LEDGER_URL / LEDGER_USERNAME / LEDGER_PASSWORD missing).");
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let body: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    token ??= await login();
    body = await call({ method: "GET", query: `action=all&token=${encodeURIComponent(token)}` });
    if (body.ok) break;
    if (body.error === "AUTH_REQUIRED" && attempt === 0) {
      token = null; // session expired: sign in again once
      continue;
    }
    throw new Error(`GH Ledger: ${String(body.error ?? "request failed")}`);
  }
  const data = (body?.data ?? {}) as Record<string, unknown[]>;
  const list = (k: string) => (Array.isArray(data[k]) ? (data[k] as Record<string, unknown>[]) : []);

  const ledger: Ledger = {
    bookings: list("bookings").map((b) => ({
      id: str(b.id),
      name: str(b.name),
      property: str(b.property) || "Unknown",
      flat: str(b.flat),
      checkIn: day(b.checkIn),
      checkOut: day(b.checkOut),
      platform: str(b.platform) || "Other",
      amount: num(b.amount),
      grossAmount: b.grossAmount === "" || b.grossAmount === null || b.grossAmount === undefined ? num(b.amount) : num(b.grossAmount),
      councilWing: str(b.councilWing),
      invoiceNo: str(b.invoiceNo),
      remittanceAdviceNo: str(b.remittanceAdviceNo),
      paymentDate: day(b.paymentDate),
      bankReflectionDate: day(b.bankReflectionDate),
      bankReflectionAmount: b.bankReflectionAmount === "" || b.bankReflectionAmount == null ? null : num(b.bankReflectionAmount),
      flagged: Boolean(b.flagged),
    })),
    extras: list("extras").map((e) => ({
      id: str(e.id), amount: num(e.amount), monthKey: str(e.monthKey), label: str(e.label ?? e.name ?? e.type), property: str(e.property),
    })),
    damageClaims: list("damageClaims").map((c) => ({
      id: str(c.id), property: str(c.property), status: str(c.status),
      requestedAmount: num(c.requestedAmount), approvedAmount: num(c.approvedAmount), monthKey: str(c.monthKey),
    })),
    parkingTickets: list("parkingTickets").map((t) => ({
      id: str(t.id), feeAmount: num(t.feeAmount), paid: Boolean(t.paid), monthKey: str(t.monthKey), property: str(t.property),
    })),
    properties: (Array.isArray(data.properties) ? (data.properties as unknown[]) : []).map(str).filter(Boolean),
    fetchedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data: ledger };
  return ledger;
}
