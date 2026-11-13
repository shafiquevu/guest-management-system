"use client";

import { useCallback, useState, type FormEvent } from "react";
import { AlertTriangle, Download, Printer, Receipt, Trash2, Wallet } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Card, cx, EmptyState, field, PageHeader } from "@/components/ui";
import { useLoader } from "@/lib/use-loader";

type Row = {
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
  expenses: number;
  profit: number;
  adr: number | null;
};
type ChannelRow = { channel: string; bookings: number; nights: number; gross: number; commission: number; net: number };
type Expense = { id: string; propertyId: number | null; propertyName: string; label: string; category: string | null; amount: number; date: string; supplier: string | null };
type Report = { month: string; currency: string; rows: Row[]; channels: ChannelRow[]; totals: Omit<Row, "propertyId" | "name">; expenses: Expense[] };

const CATEGORIES = ["Cleaning", "Laundry", "Utilities", "Repairs & maintenance", "Supplies", "Rent", "Insurance", "Other"];

function lastMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export function FinanceReport() {
  const { api, isManager } = useApp();
  const [month, setMonth] = useState(lastMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ propertyId: "", label: "", category: "Cleaning", amount: "", date: "", supplier: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api(`/api/finance?month=${month}`);
    setLoading(false);
    if (!res.ok) {
      setReport(null);
      return setError(res.data.error ?? "Could not load the report.");
    }
    setError(null);
    setReport(res.data as Report);
  }, [api, month]);
  useLoader(load);

  const money = (n: number | null | undefined) =>
    n === null || n === undefined
      ? "–"
      : new Intl.NumberFormat(undefined, { style: "currency", currency: report?.currency || "GBP", maximumFractionDigits: 0 }).format(n);
  const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);

  function downloadCsv() {
    if (!report) return;
    const head = ["Property", "Bookings", "Nights", "Occupancy %", "Gross", "Commission", "Net payout", "Expenses", "Profit", "Avg nightly rate", "Bookings without price"];
    const lines = report.rows.map((r) => [
      r.name, r.bookings, r.nights, r.occupancy === null ? "" : Math.round(r.occupancy * 100),
      r.gross, r.commission, r.net, r.expenses, r.profit, r.adr ?? "", r.unpriced,
    ]);
    const t = report.totals;
    lines.push(["TOTAL", t.bookings, t.nights, t.occupancy === null ? "" : Math.round(t.occupancy * 100), t.gross, t.commission, t.net, t.expenses, t.profit, t.adr ?? "", t.unpriced]);
    lines.push([]);
    lines.push(["Channel", "Bookings", "Nights", "", "Gross", "Commission", "Net payout"]);
    for (const c of report.channels) lines.push([c.channel, c.bookings, c.nights, "", c.gross, c.commission, c.net]);
    if (report.expenses.length) {
      lines.push([]);
      lines.push(["Expense date", "Property", "What", "Category", "Supplier", "Amount"]);
      for (const e of report.expenses) lines.push([e.date, e.propertyName, e.label, e.category ?? "", e.supplier ?? "", e.amount]);
    }
    const csv = [head, ...lines]
      .map((row) => row.map((v) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-${report.month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function addExpense(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await api("/api/finance/expenses", {
      json: { ...form, propertyId: form.propertyId || null, amount: Number(form.amount), date: form.date || `${month}-01` },
    });
    setSaving(false);
    if (!res.ok) return setError(res.data.error ?? "Could not save the expense.");
    setForm({ ...form, label: "", amount: "", supplier: "" });
    load();
  }

  async function deleteExpense(id: string) {
    if (!window.confirm("Delete this expense?")) return;
    const res = await api("/api/finance/expenses", { method: "DELETE", json: { id } });
    if (!res.ok) return setError(res.data.error ?? "Could not delete.");
    load();
  }

  const t = report?.totals;
  const tiles = t
    ? [
        { label: "Gross revenue", value: money(t.gross), hint: `${t.bookings} bookings` },
        { label: "Channel commission", value: money(t.commission), hint: t.gross ? `${Math.round((t.commission / t.gross) * 100)}% of gross` : "" },
        { label: "Net payout", value: money(t.net), hint: "Gross minus commission" },
        { label: "Expenses", value: money(t.expenses), hint: `${report?.expenses.length ?? 0} entries` },
        { label: "Profit", value: money(t.profit), hint: "Net payout minus expenses", strong: true },
        { label: "Nights sold", value: String(t.nights), hint: `Across ${t.rooms} rooms` },
        { label: "Occupancy", value: pct(t.occupancy), hint: "Nights sold ÷ nights available" },
        { label: "Avg nightly rate", value: money(t.adr), hint: "Priced bookings only" },
      ]
    : [];

  return (
    <div className="scroll-thin h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PageHeader
          title="Finance"
          subtitle={`Monthly report for ${monthLabel(month)}, from your Beds24 bookings`}
          actions={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={cx(field, "w-44")} aria-label="Month" />
              <button onClick={downloadCsv} disabled={!report} className={btn.secondary}><Download className="h-4 w-4" /> Excel</button>
              <button onClick={() => window.print()} disabled={!report} className={btn.secondary}><Printer className="h-4 w-4" /> PDF</button>
            </div>
          }
        />

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>
        )}

        {loading && !report && (
          <div className="flex justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-label="Loading" />
          </div>
        )}

        {report && t && (
          <>
            {t.unpriced > 0 && (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {t.unpriced} of {t.bookings} bookings came in through an iCal calendar link, which carries dates but no price.
                They count towards nights and occupancy, but not revenue. Connecting the channels through the Beds24 API fixes this.
              </p>
            )}

            <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", loading && "opacity-60")}>
              {tiles.map((x) => (
                <div key={x.label} className={cx("rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200", x.strong && "ring-indigo-200")}>
                  <p className="text-xs font-medium text-slate-500">{x.label}</p>
                  <p className={cx("mt-1 text-2xl font-semibold tabular-nums tracking-tight", x.strong ? "text-indigo-700" : "text-slate-900")}>{x.value}</p>
                  {x.hint && <p className="mt-0.5 text-xs text-slate-500">{x.hint}</p>}
                </div>
              ))}
            </div>

            <Card title={`By property (${report.rows.length})`}>
              {report.rows.length === 0 ? (
                <EmptyState icon={<Wallet className="h-5 w-5" />} title="No bookings this month" text="Pick another month above." />
              ) : (
                <div className="-mx-4 -my-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5">Property</th>
                        <th className="px-3 py-2.5 text-right">Bookings</th>
                        <th className="px-3 py-2.5 text-right">Nights</th>
                        <th className="px-3 py-2.5 text-right">Occupancy</th>
                        <th className="px-3 py-2.5 text-right">Gross</th>
                        <th className="px-3 py-2.5 text-right">Commission</th>
                        <th className="px-3 py-2.5 text-right">Net payout</th>
                        <th className="px-3 py-2.5 text-right">Expenses</th>
                        <th className="px-4 py-2.5 text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {report.rows.map((r) => (
                        <tr key={r.propertyId}>
                          <td className="max-w-xs px-4 py-2.5">
                            <p className="truncate font-medium text-slate-900" title={r.name}>{r.name}</p>
                            {r.unpriced > 0 && <p className="text-xs text-amber-700">{r.unpriced} without price</p>}
                          </td>
                          <td className="px-3 py-2.5 text-right">{r.bookings}</td>
                          <td className="px-3 py-2.5 text-right">{r.nights}</td>
                          <td className="px-3 py-2.5 text-right">{pct(r.occupancy)}</td>
                          <td className="px-3 py-2.5 text-right">{money(r.gross)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-500">{money(r.commission)}</td>
                          <td className="px-3 py-2.5 text-right">{money(r.net)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-500">{money(r.expenses)}</td>
                          <td className={cx("px-4 py-2.5 text-right font-semibold", r.profit < 0 ? "text-rose-600" : "text-slate-900")}>{money(r.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold tabular-nums text-slate-900">
                      <tr>
                        <td className="px-4 py-2.5">Total</td>
                        <td className="px-3 py-2.5 text-right">{t.bookings}</td>
                        <td className="px-3 py-2.5 text-right">{t.nights}</td>
                        <td className="px-3 py-2.5 text-right">{pct(t.occupancy)}</td>
                        <td className="px-3 py-2.5 text-right">{money(t.gross)}</td>
                        <td className="px-3 py-2.5 text-right">{money(t.commission)}</td>
                        <td className="px-3 py-2.5 text-right">{money(t.net)}</td>
                        <td className="px-3 py-2.5 text-right">{money(t.expenses)}</td>
                        <td className={cx("px-4 py-2.5 text-right", t.profit < 0 && "text-rose-600")}>{money(t.profit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="By channel">
                {report.channels.length === 0 ? (
                  <p className="text-sm text-slate-500">No bookings this month.</p>
                ) : (
                  <table className="w-full text-sm tabular-nums">
                    <thead className="text-left text-xs font-medium text-slate-500">
                      <tr>
                        <th className="pb-2">Channel</th>
                        <th className="pb-2 text-right">Bookings</th>
                        <th className="pb-2 text-right">Nights</th>
                        <th className="pb-2 text-right">Gross</th>
                        <th className="pb-2 text-right">Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.channels.map((c) => (
                        <tr key={c.channel}>
                          <td className="py-2 font-medium text-slate-900">{c.channel}</td>
                          <td className="py-2 text-right">{c.bookings}</td>
                          <td className="py-2 text-right">{c.nights}</td>
                          <td className="py-2 text-right">{money(c.gross)}</td>
                          <td className="py-2 text-right">{money(c.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {report.channels.some((c) => c.channel === "Booking.com" && c.commission === 0 && c.gross > 0) && (
                  <p className="mt-3 text-xs text-slate-500">
                    Booking.com bills its commission once a month by invoice, so it isn&apos;t in the booking data.
                    Its net here is before that commission; add the invoice under Expenses to include it.
                  </p>
                )}
              </Card>

              <Card title={`Expenses (${report.expenses.length})`}>
                {isManager && (
                  <form onSubmit={addExpense} className="grid gap-2 sm:grid-cols-2 print:hidden">
                    <select value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })} className={field} aria-label="Property">
                      <option value="">General (no property)</option>
                      {report.rows.map((r) => <option key={r.propertyId} value={r.propertyId}>{r.name}</option>)}
                    </select>
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field} aria-label="Category">
                      {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <input required placeholder="What was it? e.g. Deep clean after checkout" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={cx(field, "sm:col-span-2")} />
                    <input required type="number" min="0.01" step="0.01" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={field} aria-label="Amount" />
                    <input type="date" min={`${month}-01`} max={`${month}-31`} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={field} aria-label="Date" />
                    <input placeholder="Supplier (optional)" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={field} />
                    <button disabled={saving} className={btn.primary}><Receipt className="h-4 w-4" /> Add expense</button>
                  </form>
                )}
                {report.expenses.length === 0 ? (
                  <p className={cx("text-sm text-slate-500", isManager && "mt-4")}>No expenses recorded for {monthLabel(month)}.</p>
                ) : (
                  <ul className={cx("divide-y divide-slate-100", isManager && "mt-4 border-t border-slate-100")}>
                    {report.expenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">{e.label}</p>
                          <p className="truncate text-xs text-slate-500">
                            {e.date} · {e.propertyName}{e.category ? ` · ${e.category}` : ""}{e.supplier ? ` · ${e.supplier}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="tabular-nums font-medium text-slate-900">{money(e.amount)}</span>
                          {isManager && (
                            <button onClick={() => deleteExpense(e.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 print:hidden" aria-label={`Delete ${e.label}`}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
