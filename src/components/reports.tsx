"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BarChart3, Printer, RefreshCw } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Card, cx, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { CHANNEL_LABEL, minutesLabel } from "@/lib/format";
import { OUTSIDE_APP, type Bucket } from "@/lib/reply-stats";

type Wait = { conversationId: string; guest: string | null; property: string | null; channel: string; minutes: number };
type Report = {
  days: number; from: string; to: string; conversations: number;
  guestMessages: number; replies: number; answeredWaits: number;
  avgMinutes: number | null; medianMinutes: number | null; withinHour: number | null;
  byStaff: Bucket[]; byChannel: Bucket[]; byProperty: Bucket[];
  slowest: Wait[]; stillWaiting: Wait[];
  incidents: { opened: number; resolved: number; open: number };
};

const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

export function Reports() {
  const { api } = useApp();
  const [days, setDays] = useState<"7" | "30">("7");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api(`/api/reports?days=${days}`);
    setLoading(false);
    if (!res.ok) return setError(res.data.error ?? "Could not load the report.");
    setError(null);
    setReport(res.data);
  }, [api, days]);

  useEffect(() => {
    Promise.resolve().then(load);
  }, [load]);

  const outside = report?.byStaff.find((b) => b.key === OUTSIDE_APP);
  const outsideShare = report && outside && report.answeredWaits ? outside.replies / report.answeredWaits : 0;

  return (
    <div className="scroll-thin h-full overflow-y-auto print:h-auto print:overflow-visible">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">
        <PageHeader
          title="Reports"
          subtitle={report ? `Response times · ${day(report.from)} – ${day(report.to)}` : "Response times and volumes"}
          actions={
            <div className="flex items-center gap-2 print:hidden">
              <div className="w-48">
                <Tabs value={days} onChange={setDays} items={[{ key: "7", label: "Last 7 days" }, { key: "30", label: "Last 30 days" }]} />
              </div>
              <button onClick={load} className={btn.secondary} disabled={loading} aria-label="Refresh"><RefreshCw className={cx("h-4 w-4", loading && "animate-spin")} /></button>
              <button onClick={() => window.print()} className={btn.secondary} disabled={!report}><Printer className="h-4 w-4" /> PDF</button>
            </div>
          }
        />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{error}</p>}
        {!report ? (
          <Card><p className="py-8 text-center text-sm text-slate-500">{loading ? "Loading…" : "No data."}</p></Card>
        ) : !report.guestMessages && !report.replies ? (
          <Card><EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No messages in this period" /></Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Average first reply" value={minutesLabel(report.avgMinutes)} note={`median ${minutesLabel(report.medianMinutes)}`} />
              <Tile label="Answered within 1 hour" value={pct(report.withinHour)} note={`${report.answeredWaits} answered`} />
              <Tile label="Guest messages" value={String(report.guestMessages)} note={`${report.conversations} conversations · ${report.replies} replies`} />
              <Tile label="Incidents" value={String(report.incidents.opened)} note={`${report.incidents.resolved} resolved · ${report.incidents.open} still open`} />
            </div>

            {outsideShare > 0.5 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                {pct(outsideShare)} of replies were sent outside the app (on Airbnb, WhatsApp or by phone) and synced in, so they can&apos;t be credited to a staff member.
                Replying from the inbox makes the staff figures complete.
              </p>
            )}

            <div className="grid gap-5 lg:grid-cols-2">
              <BucketTable title="By staff member" rows={report.byStaff} label={(k) => k} />
              <BucketTable title="By channel" rows={report.byChannel} label={(k) => CHANNEL_LABEL[k] ?? k} />
            </div>
            <BucketTable title="By property" rows={report.byProperty} label={(k) => k} />

            <div className="grid gap-5 lg:grid-cols-2">
              <WaitList title="Slowest replies" rows={report.slowest} empty="No replies in this period." />
              <WaitList title="Still waiting for a reply" rows={report.stillWaiting} empty="Nobody is waiting." tone="amber" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function BucketTable({ title, rows, label }: { title: string; rows: Bucket[]; label: (k: string) => string }) {
  return (
    <Card title={title}>
      {!rows.length ? (
        <p className="text-sm text-slate-500">No replies.</p>
      ) : (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 text-right font-medium">Replies</th>
                <th className="px-4 py-2 text-right font-medium">Average</th>
                <th className="px-4 py-2 text-right font-medium">Median</th>
                <th className="px-4 py-2 text-right font-medium">Within 1 h</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 25).map((r) => (
                <tr key={r.key} className="border-b border-slate-50">
                  <td className={cx("max-w-56 truncate px-4 py-2", r.key === OUTSIDE_APP ? "text-slate-500 italic" : "text-slate-900")}>{label(r.key)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.replies}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{minutesLabel(r.avgMinutes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{minutesLabel(r.medianMinutes)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.withinHour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function WaitList({ title, rows, empty, tone }: { title: string; rows: Wait[]; empty: string; tone?: "amber" }) {
  return (
    <Card title={title}>
      {!rows.length ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="-m-4 divide-y divide-slate-50">
          {rows.map((w) => (
            <li key={w.conversationId}>
              <Link href={`/inbox?c=${w.conversationId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{w.guest ?? "Guest"}</span>
                  <span className="block truncate text-xs text-slate-500">{[w.property, CHANNEL_LABEL[w.channel] ?? w.channel].filter(Boolean).join(" · ")}</span>
                </span>
                <span className={cx("shrink-0 text-sm tabular-nums", tone === "amber" ? "text-amber-700" : "text-slate-700")}>{minutesLabel(w.minutes)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
