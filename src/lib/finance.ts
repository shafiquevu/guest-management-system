import "server-only";
import { beds24All, type Beds24Booking } from "@/lib/beds24/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Monthly finance, read straight from Beds24.
 *
 * The inbox only stores bookings that have guest messages, so the report can't
 * use the reservations table: it asks Beds24 for every booking that overlaps
 * the month. A stay that crosses the month boundary counts only its nights in
 * the month, and its money is split the same way.
 *
 * Bookings that came in through an iCal link carry dates but no price. They
 * still count towards nights and occupancy, and are reported as "no price" so
 * nobody mistakes a gap in the feed for a quiet month.
 */

export type FinanceRow = {
  propertyId: number;
  name: string;
  rooms: number;
  bookings: number;
  nights: number;
  occupancy: number | null;
  gross: number;
  commission: number;
  net: number;
  unpriced: number;
  pricedNights: number;
  expenses: number;
  profit: number;
  adr: number | null;
};

export type ChannelRow = { channel: string; bookings: number; nights: number; gross: number; commission: number; net: number };

export type Expense = {
  id: string;
  propertyId: number | null;
  propertyName: string;
  label: string;
  category: string | null;
  amount: number;
  date: string;
  supplier: string | null;
};

export type FinanceReport = {
  month: string;
  currency: string;
  rows: FinanceRow[];
  channels: ChannelRow[];
  totals: Omit<FinanceRow, "propertyId" | "name" | "rooms"> & { rooms: number };
  expenses: Expense[];
};

// Bookings only: "request" and "inquiry" are not stays, "black" blocks a date.
const BOOKED = ["confirmed", "new"];

type Beds24PropertyRooms = {
  id: number;
  name?: string;
  currency?: string;
  roomTypes?: { qty?: number }[];
};

export function monthBounds(month: string): { start: string; end: string; days: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must look like 2026-10.");
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(days).padStart(2, "0")}`, days };
}

function dayNumber(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/** Nights of a stay that fall inside [start, end] (end inclusive), and its total nights. */
export function nightsInMonth(arrival: string, departure: string, start: string, end: string): { inMonth: number; total: number } {
  const a = dayNumber(arrival);
  const d = dayNumber(departure);
  const total = Math.max(0, d - a);
  const inMonth = Math.max(0, Math.min(d, dayNumber(end) + 1) - Math.max(a, dayNumber(start)));
  return { inMonth, total };
}

export function channelOf(b: { apiSource?: unknown; referer?: unknown; channel?: unknown }): string {
  const source = String(b.apiSource || b.referer || b.channel || "").toLowerCase();
  if (source.includes("airbnb")) return "Airbnb";
  if (source.includes("booking")) return "Booking.com";
  if (source.includes("expedia")) return "Expedia";
  if (source.includes("vrbo") || source.includes("homeaway")) return "Vrbo";
  return "Direct / other";
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function buildFinanceReport(orgId: string, month: string): Promise<FinanceReport> {
  const { start, end, days } = monthBounds(month);

  const [bookings, properties] = await Promise.all([
    beds24All<Beds24Booking>("/bookings", { departureFrom: start, arrivalTo: end, status: BOOKED }, 50),
    beds24All<Beds24PropertyRooms>("/properties", { includeAllRooms: "true" }, 10),
  ]);

  const rows = new Map<number, FinanceRow>();
  for (const p of properties) {
    const rooms = Math.max(1, (p.roomTypes ?? []).reduce((n, r) => n + (Number(r.qty) || 0), 0));
    rows.set(p.id, {
      propertyId: p.id, name: p.name || `Property ${p.id}`, rooms,
      bookings: 0, nights: 0, occupancy: null, gross: 0, commission: 0, net: 0,
      unpriced: 0, pricedNights: 0, expenses: 0, profit: 0, adr: null,
    });
  }
  const currency = properties.find((p) => p.currency)?.currency || "GBP";

  const channels = new Map<string, ChannelRow>();
  for (const b of bookings) {
    if (!b.arrival || !b.departure || !b.propertyId) continue;
    const { inMonth, total } = nightsInMonth(b.arrival, b.departure, start, end);
    if (inMonth <= 0 || total <= 0) continue;
    const share = inMonth / total;
    const price = Number(b.price) || 0;
    const commission = Number(b.commission) || 0;

    let row = rows.get(b.propertyId);
    if (!row) {
      row = {
        propertyId: b.propertyId, name: `Property ${b.propertyId}`, rooms: 1,
        bookings: 0, nights: 0, occupancy: null, gross: 0, commission: 0, net: 0,
        unpriced: 0, pricedNights: 0, expenses: 0, profit: 0, adr: null,
      };
      rows.set(b.propertyId, row);
    }
    row.bookings += 1;
    row.nights += inMonth;
    if (price > 0) {
      row.gross += price * share;
      row.commission += commission * share;
      row.pricedNights += inMonth;
    } else {
      row.unpriced += 1;
    }

    const ch = channelOf(b);
    const c = channels.get(ch) ?? { channel: ch, bookings: 0, nights: 0, gross: 0, commission: 0, net: 0 };
    c.bookings += 1;
    c.nights += inMonth;
    c.gross += price * share;
    c.commission += commission * share;
    channels.set(ch, c);
  }

  // Expenses are kept against our own property rows, keyed by the Beds24 id.
  const db = supabaseAdmin();
  const { data: expRows } = await db
    .from("property_expenses")
    .select("id, label, category, amount, expense_date, supplier, property:properties(external_id, name)")
    .eq("organization_id", orgId)
    .gte("expense_date", start)
    .lte("expense_date", end)
    .order("expense_date", { ascending: false });
  const expenses: Expense[] = (expRows ?? []).map((e) => {
    const prop = (Array.isArray(e.property) ? e.property[0] : e.property) as { external_id: string | null; name: string } | null;
    return {
      id: e.id as string,
      propertyId: prop?.external_id ? Number(prop.external_id) : null,
      propertyName: prop?.name ?? "General",
      label: e.label as string,
      category: (e.category as string | null) ?? null,
      amount: Number(e.amount) || 0,
      date: e.expense_date as string,
      supplier: (e.supplier as string | null) ?? null,
    };
  });
  for (const e of expenses) {
    const row = e.propertyId !== null ? rows.get(e.propertyId) : undefined;
    if (row) row.expenses += e.amount;
  }

  const list = [...rows.values()]
    .map((r) => {
      const net = r.gross - r.commission;
      return {
        ...r,
        gross: round(r.gross),
        commission: round(r.commission),
        net: round(net),
        expenses: round(r.expenses),
        profit: round(net - r.expenses),
        occupancy: Math.min(1, r.nights / (r.rooms * days)),
        adr: r.pricedNights > 0 ? round(r.gross / r.pricedNights) : null,
      };
    })
    .filter((r) => r.bookings > 0 || r.expenses > 0)
    .sort((a, b) => b.gross - a.gross || b.nights - a.nights);

  // Occupancy is measured against every room the account has, not only the ones that sold.
  const totalRooms = [...rows.values()].reduce((n, r) => n + r.rooms, 0);
  const sum = (k: "bookings" | "nights" | "gross" | "commission" | "net" | "unpriced" | "pricedNights" | "expenses" | "profit") =>
    round(list.reduce((n, r) => n + r[k], 0));
  const unallocated = round(expenses.filter((e) => e.propertyId === null).reduce((n, e) => n + e.amount, 0));
  const gross = sum("gross");
  const nights = sum("nights");

  return {
    month,
    currency,
    rows: list,
    channels: [...channels.values()]
      .map((c) => ({ ...c, gross: round(c.gross), commission: round(c.commission), net: round(c.gross - c.commission) }))
      .sort((a, b) => b.gross - a.gross || b.bookings - a.bookings),
    totals: {
      rooms: totalRooms,
      bookings: sum("bookings"),
      nights,
      occupancy: totalRooms ? Math.min(1, nights / (totalRooms * days)) : null,
      gross,
      commission: sum("commission"),
      net: sum("net"),
      unpriced: sum("unpriced"),
      pricedNights: sum("pricedNights"),
      expenses: round(sum("expenses") + unallocated),
      profit: round(sum("profit") - unallocated),
      adr: sum("pricedNights") > 0 ? round(gross / sum("pricedNights")) : null,
    },
    expenses,
  };
}
