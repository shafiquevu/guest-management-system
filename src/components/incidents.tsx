"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, MessageSquare, X } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Card, Chip, cx, EmptyState, field, PageHeader, Tabs } from "@/components/ui";
import { CATEGORY_LABEL, timeAgo } from "@/lib/format";

type Status = "open" | "investigating" | "resolved" | "closed";
type Incident = {
  id: string; conversation_id: string | null; title: string; description: string; category: string;
  priority: string; status: Status; assigned_to: string | null; resolved_at: string | null; resolution_notes: string | null;
  created_at: string; updated_at: string; guest: { full_name: string } | null; property: { name: string } | null;
};
type Person = { id: string; full_name: string };

const STATUS_LABEL: Record<Status, string> = { open: "Open", investigating: "Investigating", resolved: "Resolved", closed: "Closed" };
const STATUS_TINT: Record<Status, string> = {
  open: "bg-rose-50 text-rose-700 ring-rose-200",
  investigating: "bg-amber-50 text-amber-800 ring-amber-200",
  resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-slate-50 text-slate-600 ring-slate-200",
};
const PRIORITY_TINT: Record<string, string> = {
  urgent: "bg-rose-600 text-white ring-rose-600",
  high: "bg-rose-50 text-rose-700 ring-rose-200",
  normal: "bg-slate-50 text-slate-700 ring-slate-200",
  low: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function Incidents() {
  const { api, isManager } = useApp();
  const [rows, setRows] = useState<Incident[]>([]);
  const [staff, setStaff] = useState<Person[]>([]);
  const [tab, setTab] = useState<"active" | "done" | "all">("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api("/api/incidents");
    setLoading(false);
    if (!res.ok) return setError(res.data.error ?? "Could not load incidents.");
    setError(null);
    setRows(res.data.incidents);
    setStaff(res.data.staff);
  }, [api]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const active = rows.filter((r) => r.status === "open" || r.status === "investigating");
  const done = rows.filter((r) => r.status === "resolved" || r.status === "closed");
  const shown = tab === "active" ? active : tab === "done" ? done : rows;
  const name = (id: string | null) => staff.find((p) => p.id === id)?.full_name ?? null;
  const selected = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <PageHeader
          title="Incidents"
          subtitle={`${active.length} active · issues the AI escalated (refunds, complaints, damage, access) and their outcome`}
        />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
        <div className="w-full max-w-sm">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: "active", label: "Active", count: active.length },
              { key: "done", label: "Resolved" },
              { key: "all", label: "All" },
            ]}
          />
        </div>
        <Card>
          {loading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
          ) : !shown.length ? (
            <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title={tab === "active" ? "No active incidents" : "Nothing here"} />
          ) : (
            <ul className="-m-4 divide-y divide-slate-100">
              {shown.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setOpenId(r.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Chip className={PRIORITY_TINT[r.priority] ?? PRIORITY_TINT.normal}>{r.priority}</Chip>
                        <Chip className="bg-white text-slate-600 ring-slate-200">{CATEGORY_LABEL[r.category] ?? r.category}</Chip>
                        <span className="truncate text-sm font-medium text-slate-900">{r.title}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {[r.guest?.full_name, r.property?.name, name(r.assigned_to) ? `Owner: ${name(r.assigned_to)}` : "No owner", timeAgo(r.created_at)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <Chip className={STATUS_TINT[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {selected && (
        <IncidentPanel
          key={selected.id}
          incident={selected}
          staff={staff}
          canEdit={isManager}
          onClose={() => setOpenId(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function IncidentPanel({
  incident, staff, canEdit, onClose, onSaved,
}: { incident: Incident; staff: Person[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { api } = useApp();
  const [status, setStatus] = useState<Status>(incident.status);
  const [owner, setOwner] = useState(incident.assigned_to ?? "");
  const [notes, setNotes] = useState(incident.resolution_notes ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    const res = await api("/api/incidents", { json: { id: incident.id, status, assignedTo: owner || null, resolutionNotes: notes } });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.data.error ?? "Could not save." });
    setMsg({ ok: true, text: "Saved." });
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="scroll-thin h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{CATEGORY_LABEL[incident.category] ?? incident.category} · {incident.priority}</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{incident.title}</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {[incident.guest?.full_name, incident.property?.name].filter(Boolean).join(" · ")} · opened {timeAgo(incident.created_at)}
            </p>
          </div>
          <button onClick={onClose} className={btn.ghost} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm whitespace-pre-line text-slate-700 ring-1 ring-slate-100">{incident.description}</p>
        {incident.conversation_id && (
          <Link href={`/inbox?c=${incident.conversation_id}`} className={cx(btn.secondary, "mt-3")}>
            <MessageSquare className="h-4 w-4" /> Open the conversation
          </Link>
        )}

        <fieldset disabled={!canEdit} className="mt-5 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={field}>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Owner</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={field}>
              <option value="">No owner</option>
              {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">What was done (needed to resolve)</span>
            <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} placeholder="e.g. Refunded one night, guest happy." />
          </label>
          {msg && (
            <p className={cx("rounded-lg px-3 py-2 text-sm ring-1", msg.ok ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>{msg.text}</p>
          )}
          {canEdit && (
            <div className="flex justify-end">
              <button onClick={save} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save"}</button>
            </div>
          )}
        </fieldset>
        {incident.resolved_at && <p className="mt-4 text-xs text-slate-500">Resolved {timeAgo(incident.resolved_at)}</p>}
      </aside>
    </div>
  );
}
