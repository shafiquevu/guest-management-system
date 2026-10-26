"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { AlarmClock, ArrowRight, BedDouble, Clock3, Inbox as InboxIcon, ListTodo, LogIn, LogOut, MessageCircleWarning } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Avatar, Card, ChannelBadge, cx, EmptyState, PageHeader } from "@/components/ui";
import { averageReplyMinutes, awaitingReply, CHANNEL_LABEL, dateTime, minutesLabel, timeAgo, type ReplyMsg } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type Conv = {
  id: string;
  channel: string;
  status: string;
  unread_count: number;
  assigned_to: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  guest: { full_name: string } | null;
  property: { name: string } | null;
};
type Task = { id: string; title: string; status: string; priority: string; due_at: string | null; assigned_to: string | null };
type Res = { id: string; check_in: string | null; check_out: string | null; status: string | null; guest: { full_name: string } | null; property: { name: string } | null };

const ACTIVE = ["open", "pending", "escalated"];

export function Dashboard() {
  const { supabase, profile } = useApp();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stays, setStays] = useState<Res[]>([]);
  const [replyMinutes, setReplyMinutes] = useState<number | null>(null);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [c, t, r, m, s] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, channel, status, unread_count, assigned_to, last_inbound_at, last_outbound_at, guest:guests(full_name), property:properties(name)")
        .limit(2000),
      supabase.from("tasks").select("id, title, status, priority, due_at, assigned_to").not("status", "in", "(completed,cancelled)").limit(1000),
      supabase
        .from("reservations")
        .select("id, check_in, check_out, status, guest:guests(full_name), property:properties(name)")
        .gte("check_out", `${today}T00:00:00Z`)
        .lte("check_in", `${today}T23:59:59Z`)
        .neq("status", "cancelled")
        .limit(500),
      supabase
        .from("messages")
        .select("conversation_id, direction, received_at, sent_at, created_at")
        .neq("content_type", "system")
        .gte("created_at", since)
        .limit(5000),
      supabase.from("profiles").select("id, full_name").eq("active", true),
    ]);
    setConvs((c.data ?? []) as unknown as Conv[]);
    setTasks((t.data ?? []) as Task[]);
    setStays((r.data ?? []) as unknown as Res[]);
    setStaff((s.data ?? []) as { id: string; full_name: string }[]);
    setReplyMinutes(averageReplyMinutes((m.data ?? []) as ReplyMsg[]));
    setLoading(false);
  }, [supabase]);
  useLoader(load);

  const today = new Date().toISOString().slice(0, 10);
  const active = convs.filter((c) => ACTIVE.includes(c.status));
  const waiting = active
    .filter(awaitingReply)
    .sort((a, b) => (a.last_inbound_at ?? "").localeCompare(b.last_inbound_at ?? ""));
  const unread = active.reduce((n, c) => n + (c.unread_count > 0 ? 1 : 0), 0);
  const escalated = active.filter((c) => c.status === "escalated").length;
  const overdue = tasks
    .filter((t) => t.due_at && t.due_at < new Date().toISOString())
    .sort((a, b) => (a.due_at ?? "").localeCompare(b.due_at ?? ""));
  const arrivals = stays.filter((s) => s.check_in?.slice(0, 10) === today);
  const departures = stays.filter((s) => s.check_out?.slice(0, 10) === today);
  const inHouse = stays.filter((s) => (s.check_in?.slice(0, 10) ?? "") <= today && (s.check_out?.slice(0, 10) ?? "") > today);

  const byChannel = tally(active, (c) => CHANNEL_LABEL[c.channel] ?? c.channel);
  const byProperty = tally(active, (c) => c.property?.name ?? "No property");
  const workload = (() => {
    const name = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "Unassigned";
    const counts = new Map<string, number>();
    for (const c of active) counts.set(name(c.assigned_to), (counts.get(name(c.assigned_to)) ?? 0) + 1);
    for (const t of tasks) counts.set(name(t.assigned_to), (counts.get(name(t.assigned_to)) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <PageHeader
          title={`${greeting}, ${profile.full_name.split(" ")[0]}`}
          subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          actions={
            <Link href="/inbox" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500">
              Open inbox <ArrowRight className="h-4 w-4" />
            </Link>
          }
        />

        {/* headline numbers */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={<MessageCircleWarning className="h-5 w-5" />} tone="amber" label="Guests waiting for a reply" value={waiting.length} hint={waiting[0] ? `Longest: ${timeAgo(waiting[0].last_inbound_at)}` : "All answered"} loading={loading} />
          <Stat icon={<InboxIcon className="h-5 w-5" />} tone="indigo" label="Open conversations" value={active.length} hint={escalated ? `${escalated} need a manager · ${unread} unread` : `${unread} unread`} loading={loading} />
          <Stat icon={<Clock3 className="h-5 w-5" />} tone="sky" label="Average reply time" value={minutesLabel(replyMinutes)} hint="Last 30 days" loading={loading} />
          <Stat icon={<AlarmClock className="h-5 w-5" />} tone="red" label="Overdue tasks" value={overdue.length} hint={`${tasks.length} open tasks`} loading={loading} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* waiting longest */}
          <Card title="Waiting longest" action={<Link href="/inbox" className="text-xs font-medium text-indigo-600 hover:underline">View all</Link>} className="lg:col-span-2">
            {waiting.length === 0 ? (
              <EmptyState icon={<InboxIcon className="h-5 w-5" />} title="Nobody is waiting" text="Every guest has had a reply." />
            ) : (
              <ul className="-my-2 divide-y divide-slate-100">
                {waiting.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={c.guest?.full_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{c.guest?.full_name ?? "Guest"}</p>
                      <p className="truncate text-xs text-slate-500">{c.property?.name ?? "No property"}</p>
                    </div>
                    <ChannelBadge channel={c.channel} />
                    <span className="w-16 text-right text-xs font-medium text-amber-700">{timeAgo(c.last_inbound_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* today */}
          <Card title="Today">
            <div className="grid grid-cols-3 gap-2 text-center">
              <MiniStat icon={<LogIn className="h-4 w-4" />} label="Arrivals" value={arrivals.length} />
              <MiniStat icon={<BedDouble className="h-4 w-4" />} label="In house" value={inHouse.length} />
              <MiniStat icon={<LogOut className="h-4 w-4" />} label="Departures" value={departures.length} />
            </div>
            <ul className="mt-4 space-y-2">
              {[...arrivals.map((s) => ({ s, kind: "Arrives" })), ...departures.map((s) => ({ s, kind: "Leaves" }))]
                .slice(0, 6)
                .map(({ s, kind }) => (
                  <li key={`${kind}-${s.id}`} className="flex items-center gap-2 text-sm">
                    <span className={cx("w-14 shrink-0 text-xs font-medium", kind === "Arrives" ? "text-emerald-700" : "text-slate-500")}>{kind}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-900">{s.guest?.full_name ?? "Guest"}</span>
                    <span className="max-w-28 truncate text-xs text-slate-500">{s.property?.name}</span>
                  </li>
                ))}
              {arrivals.length + departures.length === 0 && <li className="text-sm text-slate-500">No arrivals or departures today.</li>}
            </ul>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Open conversations by channel">
            <BarList rows={byChannel} unit="conversation" />
          </Card>
          <Card title="Open conversations by property">
            <BarList rows={byProperty.slice(0, 6)} unit="conversation" />
          </Card>
          <Card title="Workload by person">
            <BarList rows={workload.slice(0, 6)} unit="open item" />
          </Card>
        </div>

        <Card title="Overdue tasks" action={<Link href="/tasks" className="text-xs font-medium text-indigo-600 hover:underline">All tasks</Link>}>
          {overdue.length === 0 ? (
            <EmptyState icon={<ListTodo className="h-5 w-5" />} title="Nothing overdue" />
          ) : (
            <ul className="-my-2 divide-y divide-slate-100">
              {overdue.slice(0, 8).map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{t.title}</span>
                  <span className="text-xs capitalize text-slate-500">{t.priority}</span>
                  <span className="w-32 text-right text-xs font-medium text-red-600">Due {dateTime(t.due_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Average minutes between a guest message and the next host reply, over the period. */
function tally<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const TONES = {
  amber: "bg-amber-50 text-amber-700",
  indigo: "bg-indigo-50 text-indigo-700",
  sky: "bg-sky-50 text-sky-700",
  red: "bg-red-50 text-red-700",
};

function Stat({ icon, label, value, hint, tone, loading }: { icon: ReactNode; label: string; value: ReactNode; hint: string; tone: keyof typeof TONES; loading: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center gap-3">
        <span className={cx("flex h-9 w-9 items-center justify-center rounded-lg", TONES[tone])}>{icon}</span>
        <p className="text-sm text-slate-500">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {loading ? <span className="inline-block h-8 w-12 animate-pulse rounded bg-slate-100" /> : value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-3">
      <span className="mx-auto flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm">{icon}</span>
      <p className="mt-1.5 text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

/** One series, one hue: a labelled horizontal bar per row, values written out. */
function BarList({ rows, unit }: { rows: [string, number][]; unit: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing open.</p>;
  const max = Math.max(...rows.map((r) => r[1]));
  return (
    <ul className="space-y-2.5">
      {rows.map(([label, value]) => (
        <li key={label} title={`${label}: ${value} ${unit}${value === 1 ? "" : "s"}`}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-slate-700">{label}</span>
            <span className="font-medium text-slate-900 tabular-nums">{value}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max((value / max) * 100, 4)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
