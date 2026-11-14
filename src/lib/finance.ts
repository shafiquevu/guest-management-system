import "server-only";
import { fetchLedger, type LedgerBooking } from "@/lib/ledger";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Monthly finance, from GH Ledger (the team's own booking ledger).
 *
 * The numbers follow GH Ledger's dashboard exactly, so the two never disagree:
 *   Booking revenue     bookings counted in their CHECK-IN month, by `amount`
 *                       (what the business keeps; Booking.com is gross minus
 *                       its 20% commission)
 *   End-of-tenancy      the same bookings counted whole in their CHECK-OUT month
 *   Other income        extras + damage claims marked Paid (approved amount)
 *   Total sales         booking revenue + other income - unpaid parking fines
 *   Pending claims      damage claims still "Claim Submitted"
 *
 * Expenses are recorded here (property_expenses) and give profit per property.
 * GH Ledger names properties ("Clyde", "Milburn"), not Beds24 ids, so an
 * expense keeps the ledger property name in its notes as "Property: <name>".
 */

export const EXPENSE_PROPERTY_PREFIX = "Property: ";

export type FinanceRow = {
  property: string;
  bookings: number;
  nights: number;
  gross: number;
  commission: number;
  revenue: number;
  eotSales: number;
  expenses: number;
  profit: number;
};

export type PlatformRow = { platform: string; bookings: number; nights: number; gross: number; commission: number; revenue: number };
export type TrendRow = { month: string; bookings: number; revenue: number; eotBookings: number; eotSales: number };

export type Expense = {
  id: string;
  property: string | null;
  label: string;
  category: string | null;
  amount: number;
  date: string;
  supplier: string | null;
};

export type FinanceReport = {
  month: string;
  currency: "GBP";
  source: { name: "GH Ledger"; fetchedAt: string };
  totals: {
    bookings: number;
    nights: number;
    gross: number;
    commission: number;
    revenue: number;
    eotBookings: number;
    eotSales: number;
    otherIncome: number;
    outstandingFines: number;
    totalSales: number;
    pendingClaims: number;
    expenses: number;
    profit: number;
    avgBooking: number | null;
    flagged: number;
  };
  rows: FinanceRow[];
  platforms: PlatformRow[];
  trend: TrendRow[];
  expenses: Expense[];
  properties: string[];
};

export function monthBounds(month: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must look like 2026-10.");
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, "0")}` };
}

const monthOf = (iso: string) => (/^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : "");
/** GH Ledger's end-of-tenancy month: check-out month, else check-in month. */
export const eotMonth = (b: Pick<LedgerBooking, "checkIn" | "checkOut">) => monthOf(b.checkOut) || monthOf(b.checkIn);

export function nights(b: Pick<LedgerBooking, "checkIn" | "checkOut">): number {
  const a = Date.parse(`${b.checkIn}T00:00:00Z`);
  const d = Date.parse(`${b.checkOut}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(d) && d > a ? Math.round((d - a) / 86_400_000) : 0;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function buildFinanceReport(orgId: string, month: string): Promise<FinanceReport> {
  const { start, end } = monthBounds(month);
  const ledger = await fetchLedger();

  const checkIn = ledger.bookings.filter((b) => monthOf(b.checkIn) === month);
  const eot = ledger.bookings.filter((b) => eotMonth(b) === month);

  // ── per property (check-in basis, plus end-of-tenancy sales) ──
  const rows = new Map<string, FinanceRow>();
  const row = (property: string) => {
    let r = rows.get(property);
    if (!r) {
      r = { property, bookings: 0, nights: 0, gross: 0, commission: 0, revenue: 0, eotSales: 0, expenses: 0, profit: 0 };
      rows.set(property, r);
    }
    return r;
  };
  const platforms = new Map<string, PlatformRow>();
  for (const b of checkIn) {
    const r = row(b.property);
    r.bookings += 1;
    r.nights += nights(b);
    r.gross += b.grossAmount;
    r.commission += b.grossAmount - b.amount;
    r.revenue += b.amount;
    const p = platforms.get(b.platform) ?? { platform: b.platform, bookings: 0, nights: 0, gross: 0, commission: 0, revenue: 0 };
    p.bookings += 1;
    p.nights += nights(b);
    p.gross += b.grossAmount;
    p.commission += b.grossAmount - b.amount;
    p.revenue += b.amount;
    platforms.set(b.platform, p);
  }
  for (const b of eot) row(b.property).eotSales += b.amount;

  // ── other income, fines, claims (GH Ledger's own month keys) ──
  const extras = ledger.extras.filter((e) => e.monthKey === month).reduce((s, e) => s + e.amount, 0);
  const paidClaims = ledger.damageClaims.filter((c) => c.monthKey === month && c.status === "Paid").reduce((s, c) => s + c.approvedAmount, 0);
  const pendingClaims = ledger.damageClaims.filter((c) => c.monthKey === month && c.status === "Claim Submitted").reduce((s, c) => s + c.requestedAmount, 0);
  const outstandingFines = ledger.parkingTickets.filter((t) => t.monthKey === month && !t.paid).reduce((s, t) => s + t.feeAmount, 0);

  // ── expenses recorded in this app ──
  const { data: expRows } = await supabaseAdmin()
    .from("property_expenses")
    .select("id, label, category, amount, expense_date, supplier, notes")
    .eq("organization_id", orgId)
    .gte("expense_date", start)
    .lte("expense_date", end)
    .order("expense_date", { ascending: false });
  const expenses: Expense[] = (expRows ?? []).map((e) => {
    const note = String(e.notes ?? "");
    const property = note.startsWith(EXPENSE_PROPERTY_PREFIX) ? note.slice(EXPENSE_PROPERTY_PREFIX.length).trim() || null : null;
    return {
      id: e.id as string,
      property,
      label: e.label as string,
      category: (e.category as string | null) ?? null,
      amount: Number(e.amount) || 0,
      date: e.expense_date as string,
      supplier: (e.supplier as string | null) ?? null,
    };
  });
  for (const e of expenses) if (e.property) row(e.property).expenses += e.amount;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  const list = [...rows.values()]
    .map((r) => ({
      ...r,
      gross: round(r.gross),
      commission: round(r.commission),
      revenue: round(r.revenue),
      eotSales: round(r.eotSales),
      expenses: round(r.expenses),
      profit: round(r.revenue - r.expenses),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.property.localeCompare(b.property));

  // ── 12-month trend, both bases, like GH Ledger's end-of-tenancy table ──
  const trendMap = new Map<string, TrendRow>();
  const tr = (m: string) => {
    let t = trendMap.get(m);
    if (!t) { t = { month: m, bookings: 0, revenue: 0, eotBookings: 0, eotSales: 0 }; trendMap.set(m, t); }
    return t;
  };
  for (const b of ledger.bookings) {
    const ci = monthOf(b.checkIn);
    if (ci && ci <= month) { const t = tr(ci); t.bookings += 1; t.revenue += b.amount; }
    const eo = eotMonth(b);
    if (eo && eo <= month) { const t = tr(eo); t.eotBookings += 1; t.eotSales += b.amount; }
  }
  const trend = [...trendMap.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12)
    .map((t) => ({ ...t, revenue: round(t.revenue), eotSales: round(t.eotSales) }));

  const revenue = checkIn.reduce((s, b) => s + b.amount, 0);
  const otherIncome = extras + paidClaims;
  const totalSales = revenue + otherIncome - outstandingFines;

  return {
    month,
    currency: "GBP",
    source: { name: "GH Ledger", fetchedAt: ledger.fetchedAt },
    totals: {
      bookings: checkIn.length,
      nights: checkIn.reduce((s, b) => s + nights(b), 0),
      gross: round(checkIn.reduce((s, b) => s + b.grossAmount, 0)),
      commission: round(checkIn.reduce((s, b) => s + (b.grossAmount - b.amount), 0)),
      revenue: round(revenue),
      eotBookings: eot.length,
      eotSales: round(eot.reduce((s, b) => s + b.amount, 0)),
      otherIncome: round(otherIncome),
      outstandingFines: round(outstandingFines),
      totalSales: round(totalSales),
      pendingClaims: round(pendingClaims),
      expenses: round(totalExpenses),
      profit: round(totalSales - totalExpenses),
      avgBooking: checkIn.length ? round(revenue / checkIn.length) : null,
      flagged: checkIn.filter((b) => b.flagged).length,
    },
    rows: list,
    platforms: [...platforms.values()]
      .map((p) => ({ ...p, gross: round(p.gross), commission: round(p.commission), revenue: round(p.revenue) }))
      .sort((a, b) => b.revenue - a.revenue),
    trend,
    expenses,
    properties: [...new Set([...ledger.properties, ...list.map((r) => r.property)])].sort(),
  };
}
