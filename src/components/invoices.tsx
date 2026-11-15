"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Building2, FileText, Plus, Printer, Search, Trash2, X } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Card, Chip, cx, EmptyState, field, PageHeader, Tabs } from "@/components/ui";
import {
  lineNet,
  lineRate,
  money,
  STATUS_LABEL,
  stayLine,
  totals,
  UNITS,
  type InvoiceItem,
  type InvoiceStatus,
} from "@/lib/invoices";

type Company = {
  id: string; name: string; trading_as: string | null; address: string | null; company_no: string | null; vat_no: string | null;
  email: string | null; phone: string | null; website: string | null; logo_url: string | null;
  account_name: string | null; account_no: string | null; sort_code: string | null;
  footer_note: string | null; default_notes: string | null; active: boolean;
};
type ListRow = {
  id: string; company_id: string; invoice_no: string; status: InvoiceStatus; invoice_date: string; due_date: string | null;
  bill_to: string; customer_ref: string | null; property_ref: string | null; total: number; currency: string;
};
type Settings = { prefix: string; next_number: number };
type Booking = {
  id: string; name: string; property: string; flat: string; checkIn: string; checkOut: string; platform: string; amount: number;
  ledgerInvoiceNo: string; invoice: { id: string; invoice_no: string; status: string } | null;
};

type Draft = {
  id: string | null;
  invoiceNo: string | null;
  companyId: string;
  status: InvoiceStatus;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  currency: string;
  billTo: string;
  customerRef: string;
  propertyRef: string;
  ledgerBookingId: string;
  notes: string;
  items: InvoiceItem[];
};

const today = () => new Date().toISOString().slice(0, 10);
const blankItem = (): InvoiceItem => ({ description: "", qty: 1, unit: "Service", rate: 0, vatRate: 0, fixedTotal: null });
const STATUS_TINT: Record<InvoiceStatus, string> = {
  draft: "bg-slate-50 text-slate-700 ring-slate-200",
  sent: "bg-amber-50 text-amber-800 ring-amber-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-rose-50 text-rose-700 ring-rose-200",
};

function newDraft(company?: Company): Draft {
  return {
    id: null, invoiceNo: null, companyId: company?.id ?? "", status: "draft",
    invoiceDate: today(), dueDate: today(), terms: "Due upon receipt", currency: "GBP",
    billTo: "", customerRef: "", propertyRef: "", ledgerBookingId: "",
    notes: company?.default_notes ?? "", items: [blankItem()],
  };
}

export function Invoices() {
  const { api, isManager } = useApp();
  const [invoices, setInvoices] = useState<ListRow[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [settings, setSettings] = useState<Settings>({ prefix: "GPS", next_number: 1 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"list" | "edit" | "companies">("list");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const res = await api("/api/invoices");
    setLoading(false);
    if (!res.ok) return setError(res.data.error ?? "Could not load invoices.");
    setError(null);
    setInvoices(res.data.invoices);
    setCompanies(res.data.companies);
    setSettings(res.data.settings);
  }, [api]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  async function open(id: string) {
    const res = await api(`/api/invoices/${id}`);
    if (!res.ok) return setError(res.data.error ?? "Could not open the invoice.");
    const i = res.data.invoice;
    setDraft({
      id: i.id, invoiceNo: i.invoice_no, companyId: i.company_id, status: i.status,
      invoiceDate: i.invoice_date, dueDate: i.due_date ?? "", terms: i.terms ?? "", currency: i.currency,
      billTo: i.bill_to, customerRef: i.customer_ref ?? "", propertyRef: i.property_ref ?? "",
      ledgerBookingId: i.ledger_booking_id ?? "", notes: i.notes ?? "", items: i.items?.length ? i.items : [blankItem()],
    });
    setView("edit");
  }

  if (view === "companies") {
    return (
      <Page>
        <CompaniesPanel companies={companies} settings={settings} onBack={() => { setView("list"); load(); }} onChanged={load} />
      </Page>
    );
  }
  if (view === "edit" && draft) {
    return (
      <InvoiceEditor
        initial={draft}
        companies={companies}
        readOnly={!isManager}
        onClose={() => { setView("list"); setDraft(null); load(); }}
      />
    );
  }

  return (
    <Page>
      <InvoiceList
        invoices={invoices}
        companies={companies}
        loading={loading}
        error={error}
        canEdit={isManager}
        onNew={() => {
          const first = companies.find((c) => c.active);
          if (!first) return setView("companies");
          setDraft(newDraft(first));
          setView("edit");
        }}
        onOpen={open}
        onCompanies={() => setView("companies")}
      />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-thin h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- list

function InvoiceList({
  invoices, companies, loading, error, canEdit, onNew, onOpen, onCompanies,
}: {
  invoices: ListRow[]; companies: Company[]; loading: boolean; error: string | null; canEdit: boolean;
  onNew: () => void; onOpen: (id: string) => void; onCompanies: () => void;
}) {
  const [tab, setTab] = useState<"all" | InvoiceStatus>("all");
  const [q, setQ] = useState("");
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);
  const shown = invoices.filter(
    (i) =>
      (tab === "all" || i.status === tab) &&
      (!q || [i.invoice_no, i.bill_to, i.customer_ref, i.property_ref, companyName.get(i.company_id)].join(" ").toLowerCase().includes(q.toLowerCase())),
  );
  const count = (s: InvoiceStatus) => invoices.filter((i) => i.status === s).length;
  const outstanding = invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.total), 0);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={invoices.length ? `${count("sent")} unpaid · ${money(outstanding)} outstanding` : "Create, number and print invoices"}
        actions={
          canEdit && (
            <>
              <button onClick={onCompanies} className={btn.secondary}><Building2 className="h-4 w-4" /> Companies</button>
              <button onClick={onNew} className={btn.primary}><Plus className="h-4 w-4" /> New invoice</button>
            </>
          )
        }
      />
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: "all", label: "All" },
              { key: "draft", label: "Draft", count: count("draft") },
              { key: "sent", label: "Sent", count: count("sent") },
              { key: "paid", label: "Paid" },
              { key: "cancelled", label: "Cancelled" },
            ]}
          />
        </div>
        <label className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, customer, property…" className={cx(field, "pl-9")} />
        </label>
      </div>
      <Card>
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : !shown.length ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title={invoices.length ? "No invoices match" : "No invoices yet"}
            text={companies.length ? "Start one from a booking with New invoice." : "First add the company you invoice from under Companies."}
          />
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Bill to</th>
                  <th className="px-4 py-2 font-medium max-md:hidden">Company</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} onClick={() => onOpen(i.id)} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap text-slate-900">{i.invoice_no}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{i.invoice_date}</td>
                    <td className="max-w-64 truncate px-4 py-2.5 text-slate-900">{i.bill_to.split("\n")[0]}</td>
                    <td className="max-w-48 truncate px-4 py-2.5 text-slate-600 max-md:hidden">{companyName.get(i.company_id) ?? "–"}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums text-slate-900">{money(Number(i.total), i.currency)}</td>
                    <td className="px-4 py-2.5"><Chip className={STATUS_TINT[i.status]}>{STATUS_LABEL[i.status]}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- editor

function InvoiceEditor({
  initial, companies, readOnly, onClose,
}: { initial: Draft; companies: Company[]; readOnly: boolean; onClose: () => void }) {
  const { api } = useApp();
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const company = companies.find((c) => c.id === d.companyId) ?? null;
  const sums = totals(d.items);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => ({ ...cur, [k]: v }));
  const setItem = (n: number, patch: Partial<InvoiceItem>) =>
    setD((cur) => ({ ...cur, items: cur.items.map((it, i) => (i === n ? { ...it, ...patch } : it)) }));

  async function save(nextStatus?: InvoiceStatus) {
    setSaving(true);
    setMessage(null);
    const body = { ...d, status: nextStatus ?? d.status };
    const res = await api("/api/invoices", { json: body });
    setSaving(false);
    if (!res.ok) return setMessage({ ok: false, text: res.data.error ?? "Could not save." });
    setD((cur) => ({ ...cur, id: res.data.id, invoiceNo: res.data.invoiceNo, status: body.status }));
    setMessage({ ok: true, text: d.id ? "Saved." : `Saved as ${res.data.invoiceNo}.` });
  }

  async function remove() {
    if (!d.id || !confirm(`Delete draft ${d.invoiceNo}?`)) return;
    const res = await api(`/api/invoices/${d.id}`, { method: "DELETE" });
    if (!res.ok) return setMessage({ ok: false, text: res.data.error ?? "Could not delete." });
    onClose();
  }

  function pickBooking(b: Booking) {
    const ref = [b.flat, b.property].filter(Boolean).join(", ");
    setD((cur) => ({
      ...cur,
      billTo: cur.billTo || b.name,
      customerRef: cur.customerRef || b.platform,
      propertyRef: ref || cur.propertyRef,
      ledgerBookingId: b.id,
      items: [stayLine(b.checkIn, b.checkOut, b.amount || null), ...cur.items.filter((i) => i.description || i.rate || i.fixedTotal)],
    }));
    setPicking(false);
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto print:h-auto print:overflow-visible">
      <style>{`@media print { @page { size: A4; margin: 10mm; } }`}</style>
      <div className="mx-auto grid max-w-7xl gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] print:block print:max-w-none print:p-0">
        <div className="space-y-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={onClose} className={btn.ghost}><ArrowLeft className="h-4 w-4" /> Invoices</button>
            <div className="flex flex-wrap items-center gap-2">
              {!readOnly && d.id && d.status === "draft" && (
                <button onClick={remove} className={btn.ghost} aria-label="Delete draft"><Trash2 className="h-4 w-4" /></button>
              )}
              <button onClick={() => window.print()} className={btn.secondary}><Printer className="h-4 w-4" /> Export PDF</button>
              {!readOnly && (
                <>
                  {d.status === "draft" && (
                    <button onClick={() => save("sent")} disabled={saving} className={btn.secondary}>Save as sent</button>
                  )}
                  <button onClick={() => save()} disabled={saving} className={btn.primary}>{saving ? "Saving…" : "Save"}</button>
                </>
              )}
            </div>
          </div>
          {message && (
            <p className={cx("rounded-lg px-3 py-2 text-sm ring-1", message.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
              {message.text}
            </p>
          )}

          <Card
            title={d.invoiceNo ?? "New invoice"}
            action={!readOnly && <button onClick={() => setPicking(true)} className={btn.ghost}><Search className="h-4 w-4" /> From a booking</button>}
          >
            <fieldset disabled={readOnly} className="grid gap-3 sm:grid-cols-3">
              <L label="Company">
                <select value={d.companyId} onChange={(e) => {
                  const next = companies.find((c) => c.id === e.target.value);
                  setD((cur) => ({ ...cur, companyId: e.target.value, notes: cur.notes || next?.default_notes || "" }));
                }} className={field}>
                  {companies.filter((c) => c.active || c.id === d.companyId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </L>
              <L label="Invoice no.">
                <input value={d.invoiceNo ?? "Given on first save"} disabled className={field} />
              </L>
              <L label="Status">
                <select value={d.status} onChange={(e) => set("status", e.target.value as InvoiceStatus)} className={field}>
                  {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </L>
              <L label="Invoice date"><input type="date" value={d.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} className={field} /></L>
              <L label="Due date"><input type="date" value={d.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={field} /></L>
              <L label="Payment terms"><input value={d.terms} onChange={(e) => set("terms", e.target.value)} className={field} /></L>
              <L label="Bill to" className="sm:col-span-1">
                <textarea rows={5} value={d.billTo} onChange={(e) => set("billTo", e.target.value)} className={field} placeholder={"Name\nCompany\nAddress"} />
              </L>
              <L label="Property">
                <textarea rows={5} value={d.propertyRef} onChange={(e) => set("propertyRef", e.target.value)} className={field} placeholder={"Flat 1, Omega House\n2 Milburn Avenue"} />
              </L>
              <div className="space-y-3">
                <L label="Customer / booking ref"><input value={d.customerRef} onChange={(e) => set("customerRef", e.target.value)} className={field} placeholder="Airbnb - HMKFXA8BPF" /></L>
                <L label="Currency">
                  <select value={d.currency} onChange={(e) => set("currency", e.target.value)} className={field}>
                    {["GBP", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </L>
              </div>
            </fieldset>
            {d.ledgerBookingId && <p className="mt-3 text-xs text-slate-500">Linked to a GH Ledger booking.</p>}
          </Card>

          <Card title="Lines" action={!readOnly && (
            <button onClick={() => set("items", [...d.items, blankItem()])} className={btn.ghost}><Plus className="h-4 w-4" /> Add line</button>
          )}>
            <fieldset disabled={readOnly} className="space-y-3">
              {d.items.map((it, n) => {
                const fixed = it.fixedTotal !== null && it.fixedTotal !== undefined;
                return (
                  <div key={n} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="flex gap-2">
                      <input value={it.description} onChange={(e) => setItem(n, { description: e.target.value })} placeholder="Description" className={field} />
                      {!readOnly && (
                        <button onClick={() => set("items", d.items.filter((_, i) => i !== n))} className={btn.ghost} aria-label="Remove line"><X className="h-4 w-4" /></button>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      <L label="Qty"><input type="number" step="any" value={it.qty} onChange={(e) => setItem(n, { qty: Number(e.target.value) })} className={field} /></L>
                      <L label="Unit">
                        <input list="invoice-units" value={it.unit} onChange={(e) => setItem(n, { unit: e.target.value })} className={field} />
                      </L>
                      <L label="Price by">
                        <select value={fixed ? "total" : "rate"} onChange={(e) =>
                          setItem(n, e.target.value === "total" ? { fixedTotal: lineNet(it) } : { rate: lineRate(it), fixedTotal: null })
                        } className={field}>
                          <option value="rate">Rate</option>
                          <option value="total">Line total</option>
                        </select>
                      </L>
                      {fixed ? (
                        <L label={`Total (rate ${money(lineRate(it), d.currency)})`}>
                          <input type="number" step="0.01" value={it.fixedTotal ?? 0} onChange={(e) => setItem(n, { fixedTotal: Number(e.target.value) })} className={field} />
                        </L>
                      ) : (
                        <L label="Rate"><input type="number" step="0.01" value={it.rate} onChange={(e) => setItem(n, { rate: Number(e.target.value) })} className={field} /></L>
                      )}
                      <L label="VAT %">
                        <select value={it.vatRate} onChange={(e) => setItem(n, { vatRate: Number(e.target.value) })} className={field}>
                          {[0, 5, 20].map((v) => <option key={v} value={v}>{v}%</option>)}
                        </select>
                      </L>
                    </div>
                    <p className="mt-2 text-right text-sm tabular-nums text-slate-700">{money(lineNet(it), d.currency)}</p>
                  </div>
                );
              })}
              <datalist id="invoice-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <Row label="Subtotal" value={money(sums.subtotal, d.currency)} />
                <Row label="VAT" value={money(sums.vat, d.currency)} />
                <Row label="Total due" value={money(sums.total, d.currency)} bold />
              </div>
            </fieldset>
          </Card>

          <Card title="Notes">
            <textarea disabled={readOnly} rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} className={field} />
          </Card>
        </div>

        <div className="xl:sticky xl:top-6 xl:self-start print:static">
          <p className="mb-2 text-xs font-medium text-slate-500 print:hidden">Preview</p>
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 print:overflow-visible print:rounded-none print:shadow-none print:ring-0">
            {company ? <InvoiceDocument d={d} company={company} /> : <p className="p-6 text-sm text-slate-500">Pick a company.</p>}
          </div>
        </div>
      </div>
      {picking && <BookingPicker onPick={pickBooking} onClose={() => setPicking(false)} />}
    </div>
  );
}

function L({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cx("flex justify-between", bold && "border-t border-slate-200 pt-1 font-semibold text-slate-900")}>
      <span className="text-slate-600">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- booking picker

function BookingPicker({ onPick, onClose }: { onPick: (b: Booking) => void; onClose: () => void }) {
  const { api } = useApp();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await api(`/api/invoices/bookings?q=${encodeURIComponent(q)}`);
      if (!res.ok) return setNote(res.data.error ?? "Could not load bookings.");
      setNote(res.data.note ?? null);
      setRows(res.data.bookings);
    }, 300);
    return () => clearTimeout(t);
  }, [api, q]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[10vh] print:hidden" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-slate-100 p-3">
          <Search className="h-4 w-4 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Guest name, property or flat…" className="flex-1 text-sm outline-none" />
          <button onClick={onClose} className={btn.ghost} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="scroll-thin max-h-[60vh] overflow-y-auto">
          {note && <p className="p-4 text-sm text-slate-500">{note}</p>}
          {rows === null ? (
            <p className="p-4 text-sm text-slate-500">Loading GH Ledger…</p>
          ) : !rows.length ? (
            <p className="p-4 text-sm text-slate-500">No bookings match.</p>
          ) : (
            rows.map((b) => (
              <button key={b.id} onClick={() => onPick(b)} className="flex w-full items-start justify-between gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{b.name || "No name"}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {[b.flat, b.property].filter(Boolean).join(", ")} · {b.checkIn} → {b.checkOut} · {b.platform}
                  </span>
                  {b.invoice && (
                    <span className="mt-1 block text-xs font-medium text-amber-700">Already invoiced: {b.invoice.invoice_no} ({b.invoice.status})</span>
                  )}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-slate-700">{b.amount ? money(b.amount) : "–"}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the printed invoice

const NAVY = "#0f2238";
const GOLD = "#c8a24a";

function InvoiceDocument({ d, company }: { d: Draft; company: Company }) {
  const sums = totals(d.items);
  const lines = (s: string | null) => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const contact = [
    company.company_no && `Company No: ${company.company_no}`,
    company.vat_no && `VAT No: ${company.vat_no}`,
    company.email && `Email: ${company.email}`,
    company.phone && `Phone: ${company.phone}`,
    company.website && `Website: ${company.website}`,
  ].filter(Boolean) as string[];
  const legal = company.trading_as ? `${company.name} (Trading as ${company.trading_as})` : company.name;

  return (
    <div className="mx-auto flex min-h-[1000px] w-[794px] max-w-none flex-col bg-white p-12 text-[12px] leading-snug text-slate-800 print:min-h-0 print:w-auto print:p-0">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          {company.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- printed letterhead logo
            <img src={company.logo_url} alt="" className="h-20 w-20 object-contain" />
          )}
          <div>
            <p className="font-bold text-slate-900">{company.name}</p>
            {company.trading_as && <p className="font-bold text-slate-900">({company.trading_as})</p>}
            {lines(company.address).map((l) => <p key={l}>{l}</p>)}
            {contact.map((l) => <p key={l}>{l}</p>)}
          </div>
        </div>
        <div className="text-right">
          <p className="text-4xl font-bold tracking-tight" style={{ color: NAVY }}>INVOICE</p>
          <div className="mt-10 space-y-0.5">
            <p><b>Invoice No:</b> {d.invoiceNo ?? "—"}</p>
            <p><b>Date:</b> {d.invoiceDate}</p>
            {d.dueDate && <p><b>Due Date:</b> {d.dueDate}</p>}
            {d.terms && <p><b>Terms:</b> {d.terms}</p>}
          </div>
        </div>
      </div>
      <div className="mt-4 h-1 rounded" style={{ background: NAVY }} />

      <div className="mt-8 grid grid-cols-2">
        <p className="px-2 pb-1 text-[12px] font-bold italic" style={{ color: GOLD }}>BILL TO</p>
        <p className="px-2 pb-1 text-[12px] font-bold italic" style={{ color: GOLD }}>REFERENCE</p>
        <div className="border border-slate-200 bg-slate-50 p-2">
          {lines(d.billTo).map((l, i) => <p key={i}>{l}</p>)}
        </div>
        <div className="border border-l-0 border-slate-200 bg-slate-50 p-2">
          {d.customerRef && <p><b>Customer Ref:</b> {d.customerRef}</p>}
          {d.customerRef && lines(d.propertyRef).length > 0 && <p>&nbsp;</p>}
          {lines(d.propertyRef).map((l, i) => <p key={i}>{l}</p>)}
        </div>
      </div>

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="text-left text-white" style={{ background: NAVY }}>
            <th className="px-2 py-1.5 font-semibold">#</th>
            <th className="px-2 py-1.5 font-semibold">Description</th>
            <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
            <th className="px-2 py-1.5 font-semibold">Unit</th>
            <th className="px-2 py-1.5 text-right font-semibold">Rate</th>
            <th className="px-2 py-1.5 text-right font-semibold">VAT</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {d.items.filter((i) => i.description || lineNet(i)).map((it, n) => (
            <tr key={n} className="border-b border-slate-200">
              <td className="px-2 py-1.5">{n + 1}</td>
              <td className="px-2 py-1.5">{it.description}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{it.qty}</td>
              <td className="px-2 py-1.5">{it.unit}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(lineRate(it), d.currency)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{it.vatRate}%</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(lineNet(it), d.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 ml-auto w-64 border border-slate-200 text-[13px]">
        <div className="flex justify-between border-b border-slate-200 px-2 py-1.5"><span>Subtotal</span><span className="tabular-nums">{money(sums.subtotal, d.currency)}</span></div>
        <div className="flex justify-between border-b border-slate-200 px-2 py-1.5"><span>VAT</span><span className="tabular-nums">{money(sums.vat, d.currency)}</span></div>
        <div className="flex justify-between px-2 py-1.5 font-bold text-white" style={{ background: NAVY }}><span>Total Due</span><span className="tabular-nums">{money(sums.total, d.currency)}</span></div>
      </div>

      <div className="mt-10 grid grid-cols-2 text-center text-slate-500">
        <div><div className="h-8 border border-slate-200" /><p className="mt-1">Authorised Signature</p></div>
        <div><div className="h-8 border border-l-0 border-slate-200" /><p className="mt-1">Company Stamp</p></div>
      </div>

      {d.notes && (
        <div className="mt-10">
          <p className="mb-1 font-bold italic" style={{ color: GOLD }}>Notes</p>
          <p className="whitespace-pre-line">{d.notes}</p>
        </div>
      )}

      {(company.account_name || company.account_no || company.sort_code) && (
        <div className="mt-6">
          <p className="mb-1 font-bold italic" style={{ color: GOLD }}>Payment Details</p>
          {company.account_name && <p>A/C Name: {company.account_name}</p>}
          {company.account_no && <p>A/C No.: {company.account_no}</p>}
          {company.sort_code && <p>S/C No.: {company.sort_code}</p>}
        </div>
      )}

      {company.footer_note && <p className="mt-6 text-center text-[11px] text-slate-500">{company.footer_note}</p>}

      <div className="mt-auto border-t border-slate-200 pt-3 text-center text-[10px] text-slate-500">
        <p>{legal}</p>
        {lines(company.address).length > 0 && <p>{lines(company.address).join(", ")}</p>}
        <p>{[company.phone && `Tel: ${company.phone}`, company.email && `Email: ${company.email}`, company.website].filter(Boolean).join(" | ")}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- companies

const EMPTY_COMPANY = {
  id: "", name: "", tradingAs: "", address: "", companyNo: "", vatNo: "", email: "", phone: "", website: "", logoUrl: "",
  accountName: "", accountNo: "", sortCode: "", footerNote: "", defaultNotes: "", active: true,
};
type CompanyForm = typeof EMPTY_COMPANY;

function toForm(c: Company): CompanyForm {
  return {
    id: c.id, name: c.name, tradingAs: c.trading_as ?? "", address: c.address ?? "", companyNo: c.company_no ?? "", vatNo: c.vat_no ?? "",
    email: c.email ?? "", phone: c.phone ?? "", website: c.website ?? "", logoUrl: c.logo_url ?? "",
    accountName: c.account_name ?? "", accountNo: c.account_no ?? "", sortCode: c.sort_code ?? "",
    footerNote: c.footer_note ?? "", defaultNotes: c.default_notes ?? "", active: c.active,
  };
}

function CompaniesPanel({
  companies, settings, onBack, onChanged,
}: { companies: Company[]; settings: Settings; onBack: () => void; onChanged: () => void }) {
  const { api, profile } = useApp();
  const [form, setForm] = useState<CompanyForm | null>(companies.length ? null : { ...EMPTY_COMPANY });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [series, setSeries] = useState({ prefix: settings.prefix, nextNumber: String(settings.next_number) });

  async function saveCompany() {
    if (!form) return;
    setBusy(true);
    const res = await api("/api/invoices/companies", { json: form });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.data.error ?? "Could not save." });
    setMsg({ ok: true, text: `Saved ${form.name}.` });
    setForm(null);
    onChanged();
  }

  async function uploadLogo(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    const res = await api("/api/invoices/companies/logo", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.data.error ?? "Could not upload the logo." });
    setForm((f) => (f ? { ...f, logoUrl: res.data.url } : f));
  }

  async function saveSeries() {
    setBusy(true);
    const res = await api("/api/invoices/companies", { method: "PUT", json: { prefix: series.prefix, nextNumber: Number(series.nextNumber) } });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: "Numbering saved." } : { ok: false, text: res.data.error ?? "Could not save." });
    if (res.ok) onChanged();
  }

  const year = new Date().getFullYear();
  const f = (k: keyof CompanyForm, label: string, opts: { area?: boolean; placeholder?: string } = {}) =>
    form && (
      <L label={label}>
        {opts.area ? (
          <textarea rows={3} value={String(form[k])} placeholder={opts.placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={field} />
        ) : (
          <input value={String(form[k])} placeholder={opts.placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={field} />
        )}
      </L>
    );

  return (
    <>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={btn.ghost}><ArrowLeft className="h-4 w-4" /> Invoices</button>
        {!form && <button onClick={() => setForm({ ...EMPTY_COMPANY })} className={btn.primary}><Plus className="h-4 w-4" /> Add company</button>}
      </div>
      <PageHeader title="Companies" subtitle="The companies you invoice from: letterhead, logo and bank details." />
      {msg && (
        <p className={cx("rounded-lg px-3 py-2 text-sm ring-1", msg.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>{msg.text}</p>
      )}

      {form ? (
        <Card title={form.id ? `Edit ${form.name}` : "New company"}>
          <div className="grid gap-3 sm:grid-cols-2">
            {f("name", "Company name", { placeholder: "JAK's Homes Limited" })}
            {f("tradingAs", "Trading as", { placeholder: "Guests House Limited" })}
            {f("address", "Address", { area: true, placeholder: "58A East Reach\nTaunton, TA1 3EZ\nUnited Kingdom" })}
            <div className="space-y-3">
              <L label="Logo">
                <div className="flex items-center gap-3">
                  {form.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- logo preview
                    <img src={form.logoUrl} alt="" className="h-12 w-12 rounded object-contain ring-1 ring-slate-200" />
                  )}
                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy}
                    onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} className="text-sm" />
                </div>
              </L>
              {f("companyNo", "Company number")}
            </div>
            {f("vatNo", "VAT number (if registered)")}
            {f("email", "Email")}
            {f("phone", "Phone")}
            {f("website", "Website")}
            {f("accountName", "Bank account name")}
            {f("accountNo", "Account number")}
            {f("sortCode", "Sort code")}
            {f("footerNote", "Footer line", { placeholder: "Exemption Code: Temporary Accommodation - Housing Support - EX30" })}
            {f("defaultNotes", "Default notes", { area: true, placeholder: "This invoice has been issued for services and/or materials supplied." })}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> In use
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setForm(null)} className={btn.secondary}>Cancel</button>
            <button onClick={saveCompany} disabled={busy} className={btn.primary}>Save company</button>
          </div>
        </Card>
      ) : (
        <Card>
          {!companies.length ? (
            <EmptyState icon={<Building2 className="h-5 w-5" />} title="No companies yet" text="Add the first company you invoice from." />
          ) : (
            <ul className="-m-4 divide-y divide-slate-100">
              {companies.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setForm(toForm(c))} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    {c.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- logo thumbnail
                      <img src={c.logo_url} alt="" className="h-9 w-9 rounded object-contain ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded bg-slate-100 text-slate-500"><Building2 className="h-4 w-4" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{c.name}</span>
                      <span className="block truncate text-xs text-slate-500">{c.trading_as ? `Trading as ${c.trading_as}` : c.address?.split("\n")[0]}</span>
                    </span>
                    {!c.active && <Chip className="bg-slate-50 text-slate-600 ring-slate-200">Not in use</Chip>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {profile.role === "admin" && (
        <Card title="Numbering">
          <p className="mb-3 text-sm text-slate-600">
            One series for every company. Set the next number to carry on from the old tool, e.g. 2777 if the last was GPS-{year}-002776.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <L label="Prefix"><input value={series.prefix} onChange={(e) => setSeries({ ...series, prefix: e.target.value })} className={cx(field, "w-28")} /></L>
            <L label="Next number"><input type="number" value={series.nextNumber} onChange={(e) => setSeries({ ...series, nextNumber: e.target.value })} className={cx(field, "w-36")} /></L>
            <p className="pb-2 text-sm text-slate-500">
              Next: {series.prefix.toUpperCase()}-{year}-{String(Number(series.nextNumber) || 0).padStart(6, "0")}
            </p>
            <button onClick={saveSeries} disabled={busy} className={btn.secondary}>Save numbering</button>
          </div>
        </Card>
      )}
    </>
  );
}
