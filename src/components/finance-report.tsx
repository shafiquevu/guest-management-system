"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Download, Printer, Receipt, RefreshCw, Trash2, Wallet } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Card, cx, EmptyState, field, PageHeader } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type Row = { property: string; bookings: number; nights: number; gross: number; commission: number; revenue: number; eotSales: number; expenses: number; profit: number };
type PlatformRow = { platform: string; bookings: number; nights: number; gross: number; commission: number; revenue: number };
type TrendRow = { month: string; bookings: number; revenue: number; eotBookings: number; eotSales: number };
type Expense = { id: string; property: string | null; label: string; category: string | null; amount: number; date: string; supplier: string | null };
type Totals = {
  bookings: number; nights: number; gross: number; commission: number; revenue: number;
  eotBookings: number; eotSales: number; otherIncome: number; outstandingFines: number; totalSales: number;
  pendingClaims: number; expenses: number; profit: number; avgBooking: number | null; flagged: number;
};
type Report = {
  month: string; currency: string; source: { name: string; fetchedAt: string };
  totals: Totals; rows: Row[]; platforms: PlatformRow[]; trend: TrendRow[]; expenses: Expense[]; properties: string[];
};

const CATEGORIES = ["Cleaning", "Laundry", "Utilities", "Repairs & maintenance", "Supplies", "Rent", "Council tax", "Insurance", "Other"];

function lastMonth(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: short ? "short" : "long", year: "numeric", timeZone: "UTC" });
}

const gbp = (n: number | null | undefined, pence = false) =>
  n === null || n === undefined
    ? "–"
    : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: pence ? 2 : 0, maximumFractionDigits: pence ? 2 : 0 }).format(n);

export function FinanceReport() {
  const { api, isManager } = useApp();
  const [month, setMonth] = useState(lastMonth);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ property: "", label: "", category: "Cleaning", amount: "", date: "", supplier: "" });
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

  function downloadCsv() {
    if (!report) return;
    const t = report.totals;
    const lines: (string | number)[][] = [
      [`Finance report — ${monthLabel(report.month)}`],
      [`Source: ${report.source.name}`],
      [],
      ["Booking revenue (check-in month)", t.revenue],
      ["Sales by end of tenancy (check-out month)", t.eotSales],
      ["Bookings", t.bookings],
      ["Nights", t.nights],
      ["Gross", t.gross],
      ["Commission", t.commission],
      ["Other income", t.otherIncome],
      ["Outstanding fines", t.outstandingFines],
      ["Total sales", t.totalSales],
      ["Pending claims", t.pendingClaims],
      ["Expenses", t.expenses],
      ["Profit", t.profit],
      [],
      ["Property", "Bookings", "Nights", "Gross", "Commission", "Revenue", "End-of-tenancy sales", "Expenses", "Profit"],
      ...report.rows.map((r) => [r.property, r.bookings, r.nights, r.gross, r.commission, r.revenue, r.eotSales, r.expenses, r.profit]),
      ["TOTAL", t.bookings, t.nights, t.gross, t.commission, t.revenue, t.eotSales, t.expenses, t.revenue - t.expenses],
      [],
      ["Platform", "Bookings", "Nights", "Gross", "Commission", "Revenue"],
      ...report.platforms.map((p) => [p.platform, p.bookings, p.nights, p.gross, p.commission, p.revenue]),
      [],
      ["Month", "Bookings (check-in)", "Revenue (check-in)", "Bookings ending", "End-of-tenancy sales"],
      ...report.trend.map((m) => [monthLabel(m.month), m.bookings, m.revenue, m.eotBookings, m.eotSales]),
    ];
    if (report.expenses.length) {
      lines.push([], ["Expense date", "Property", "What", "Category", "Supplier", "Amount"]);
      for (const e of report.expenses) lines.push([e.date, e.property ?? "General", e.label, e.category ?? "", e.supplier ?? "", e.amount]);
    }
    const csv = lines
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
      json: { ...form, amount: Number(form.amount), date: form.date || `${month}-01` },
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
        { label: "Booking revenue", value: gbp(t.revenue), hint: `${t.bookings} bookings by check-in month`, tone: "text-orange-700" },
        { label: "Sales by end of tenancy", value: gbp(t.eotSales), hint: `${t.eotBookings} bookings by check-out month` },
        { label: "Total sales", value: gbp(t.totalSales), hint: "Revenue + other income − unpaid fines", tone: "text-indigo-700" },
        { label: "Profit", value: gbp(t.profit), hint: "Total sales − expenses", tone: t.profit < 0 ? "text-rose-600" : "text-emerald-700" },
        { label: "Commission", value: gbp(t.commission), hint: t.gross ? `${Math.round((t.commission / t.gross) * 100)}% of ${gbp(t.gross)} gross` : "" },
        { label: "Other income", value: gbp(t.otherIncome), hint: "Extras + paid damage claims" },
        { label: "Expenses", value: gbp(t.expenses), hint: `${report?.expenses.length ?? 0} entries` },
        { label: "Average booking", value: gbp(t.avgBooking), hint: `${t.nights} nights` },
      ]
    : [];

  return (
    <div className="scroll-thin h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PageHeader
          title="Finance"
          subtitle={`${monthLabel(month)} · from GH Ledger, the same figures as your ledger dashboard`}
          actions={
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} className={cx(field, "w-44")} aria-label="Month" />
              <button onClick={() => load()} disabled={loading} className={btn.secondary} title="Refresh from GH Ledger" aria-label="Refresh">
                <RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} />
              </button>
              <button onClick={downloadCsv} disabled={!report} className={btn.secondary}><Download className="h-4 w-4" /> Excel</button>
              <button onClick={() => window.print()} disabled={!report} className={btn.secondary}><Printer className="h-4 w-4" /> PDF</button>
            </div>
          }
        />

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}

        {loading && !report && (
          <div className="flex flex-col items-center gap-2 py-16 text-sm text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-label="Loading" />
            Reading GH Ledger…
          </div>
        )}

        {report && t && (
          <>
            {(t.pendingClaims > 0 || t.outstandingFines > 0 || t.flagged > 0) && (
              <div className="flex flex-wrap gap-2">
                {t.pendingClaims > 0 && <Notice>{gbp(t.pendingClaims)} in damage claims submitted, not yet resolved</Notice>}
                {t.outstandingFines > 0 && <Notice>{gbp(t.outstandingFines)} in parking fines not yet paid</Notice>}
                {t.flagged > 0 && <Notice>{t.flagged} bookings flagged for review in GH Ledger</Notice>}
              </div>
            )}

            <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", loading && "opacity-60")}>
              {tiles.map((x) => (
                <div key={x.label} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                  <p className="text-xs font-medium text-slate-500">{x.label}</p>
                  <p className={cx("mt-1 text-2xl font-semibold tabular-nums tracking-tight", x.tone ?? "text-slate-900")}>{x.value}</p>
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
                        <th className="px-3 py-2.5 text-right">Gross</th>
                        <th className="px-3 py-2.5 text-right">Commission</th>
                        <th className="px-3 py-2.5 text-right">Revenue</th>
                        <th className="px-3 py-2.5 text-right" title="Bookings counted whole in the month they end">End of tenancy</th>
                        <th className="px-3 py-2.5 text-right">Expenses</th>
                        <th className="px-4 py-2.5 text-right">Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums">
                      {report.rows.map((r) => (
                        <tr key={r.property}>
                          <td className="px-4 py-2.5 font-medium text-slate-900">{r.property}</td>
                          <td className="px-3 py-2.5 text-right">{r.bookings}</td>
                          <td className="px-3 py-2.5 text-right">{r.nights}</td>
                          <td className="px-3 py-2.5 text-right">{gbp(r.gross)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-500">{gbp(r.commission)}</td>
                          <td className="px-3 py-2.5 text-right font-medium">{gbp(r.revenue)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-600">{gbp(r.eotSales)}</td>
                          <td className="px-3 py-2.5 text-right text-slate-500">{gbp(r.expenses)}</td>
                          <td className={cx("px-4 py-2.5 text-right font-semibold", r.profit < 0 ? "text-rose-600" : "text-slate-900")}>{gbp(r.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold tabular-nums text-slate-900">
                      <tr>
                        <td className="px-4 py-2.5">Total</td>
                        <td className="px-3 py-2.5 text-right">{t.bookings}</td>
                        <td className="px-3 py-2.5 text-right">{t.nights}</td>
                        <td className="px-3 py-2.5 text-right">{gbp(t.gross)}</td>
                        <td className="px-3 py-2.5 text-right">{gbp(t.commission)}</td>
                        <td className="px-3 py-2.5 text-right">{gbp(t.revenue)}</td>
                        <td className="px-3 py-2.5 text-right">{gbp(t.eotSales)}</td>
                        <td className="px-3 py-2.5 text-right">{gbp(t.expenses)}</td>
                        <td className="px-4 py-2.5 text-right">{gbp(t.revenue - t.expenses)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="By platform">
                {report.platforms.length === 0 ? (
                  <p className="text-sm text-slate-500">No bookings this month.</p>
                ) : (
                  <table className="w-full text-sm tabular-nums">
                    <thead className="text-left text-xs font-medium text-slate-500">
                      <tr>
                        <th className="pb-2">Platform</th>
                        <th className="pb-2 text-right">Bookings</th>
                        <th className="pb-2 text-right">Gross</th>
                        <th className="pb-2 text-right">Commission</th>
                        <th className="pb-2 text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.platforms.map((p) => (
                        <tr key={p.platform}>
                          <td className="py-2 font-medium text-slate-900">{p.platform}</td>
                          <td className="py-2 text-right">{p.bookings}</td>
                          <td className="py-2 text-right">{gbp(p.gross)}</td>
                          <td className="py-2 text-right text-slate-500">{gbp(p.commission)}</td>
                          <td className="py-2 text-right font-medium">{gbp(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>

              <Card title="Last 12 months">
                <table className="w-full text-sm tabular-nums">
                  <thead className="text-left text-xs font-medium text-slate-500">
                    <tr>
                      <th className="pb-2">Month</th>
                      <th className="pb-2 text-right">Revenue (check-in)</th>
                      <th className="pb-2 text-right">End of tenancy</th>
                      <th className="pb-2 text-right">Difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.trend.map((m) => {
                      const diff = m.eotSales - m.revenue;
                      return (
                        <tr key={m.month} className={cx(m.month === report.month && "bg-indigo-50/50")}>
                          <td className="py-2 font-medium text-slate-900">{monthLabel(m.month, true)}</td>
                          <td className="py-2 text-right">{gbp(m.revenue)}</td>
                          <td className="py-2 text-right">{gbp(m.eotSales)}</td>
                          <td className={cx("py-2 text-right", diff < 0 ? "text-rose-600" : "text-emerald-700")}>{diff > 0 ? "+" : ""}{gbp(diff)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            </div>

            <Card title={`Expenses (${report.expenses.length})`}>
              {isManager && (
                <form onSubmit={addExpense} className="grid gap-2 sm:grid-cols-3 print:hidden">
                  <select value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })} className={field} aria-label="Property">
                    <option value="">General (no property)</option>
                    {report.properties.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field} aria-label="Category">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <input required type="number" min="0.01" step="0.01" placeholder="Amount (£)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={field} aria-label="Amount" />
                  <input required placeholder="What was it? e.g. Deep clean after checkout" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={cx(field, "sm:col-span-2")} />
                  <input type="date" min={`${month}-01`} max={`${month}-31`} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={field} aria-label="Date" />
                  <input placeholder="Supplier (optional)" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={cx(field, "sm:col-span-2")} />
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
                          {e.date} · {e.property ?? "General"}{e.category ? ` · ${e.category}` : ""}{e.supplier ? ` · ${e.supplier}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="font-medium tabular-nums text-slate-900">{gbp(e.amount, true)}</span>
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

            <p className="text-xs text-slate-400">Read from GH Ledger {timeAgo(report.source.fetchedAt)} ago. Changes made in GH Ledger show here within 5 minutes.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
      <AlertTriangle className="h-4 w-4 shrink-0" /> {children}
    </p>
  );
}
