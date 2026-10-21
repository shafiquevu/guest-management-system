"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox as InboxIcon, MessageSquareText, Search, Timer } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Chip, cx, EmptyState, field, GuestAvatar, Tabs } from "@/components/ui";
import { awaitingReply, CHANNEL_LABEL, STAY_STYLE, stayStatus, timeAgo } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { DetailsPanel } from "./details-panel";
import { Thread } from "./thread";

export type ConversationRow = {
  id: string;
  channel: string;
  status: string;
  subject: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  assigned_to: string | null;
  property_id: string | null;
  reservation_id: string | null;
  guest: { id: string; full_name: string; email: string | null; phone: string | null } | null;
  property: { id: string; name: string } | null;
  reservation: { confirmation_code: string | null; check_in: string | null; check_out: string | null; status: string | null } | null;
};

export type StaffOption = { id: string; full_name: string };

type TabKey = "active" | "waiting" | "resolved" | "all";

const SELECT = `id, channel, status, subject, unread_count, last_message_at, last_inbound_at,
  last_outbound_at, assigned_to, property_id, reservation_id,
  guest:guests(id, full_name, email, phone),
  property:properties(id, name),
  reservation:reservations(confirmation_code, check_in, check_out, status)`;

const ACTIVE = ["open", "pending", "escalated"];

export function Inbox() {
  const { supabase, profile } = useApp();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, { body: string; outbound: boolean }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);

  const [tab, setTab] = useState<TabKey>("active");
  const [channel, setChannel] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [assignee, setAssignee] = useState<"all" | "me" | "unassigned">("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    let query = supabase
      .from("conversations")
      .select(SELECT)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (channel) query = query.eq("channel", channel);
    if (propertyId) query = query.eq("property_id", propertyId);
    if (assignee === "me") query = query.eq("assigned_to", profile.id);
    if (assignee === "unassigned") query = query.is("assigned_to", null);
    const { data, error } = await query.limit(500);
    setLoading(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    const rows = (data ?? []) as unknown as ConversationRow[];
    setConversations(rows);

    // Last line of each thread, for the preview.
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, body, direction, content_type, created_at")
        .in("conversation_id", ids.slice(0, 200))
        .neq("content_type", "system")
        .order("created_at", { ascending: false })
        .limit(1000);
      const map: Record<string, { body: string; outbound: boolean }> = {};
      for (const m of msgs ?? []) {
        if (!map[m.conversation_id]) map[m.conversation_id] = { body: m.body ?? "", outbound: m.direction === "outbound" };
      }
      setPreviews(map);
    }
  }, [supabase, channel, propertyId, assignee, profile.id]);

  useLoader(load);

  const loadOptions = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setStaff((s.data ?? []) as StaffOption[]);
    setProperties((p.data ?? []) as { id: string; name: string }[]);
  }, [supabase]);
  useLoader(loadOptions);

  // Live: any change to a conversation reloads the list (debounced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const sub = supabase
      .channel("inbox-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 400);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [supabase, load]);

  const inTab = useCallback((c: ConversationRow, key: TabKey) => {
    if (key === "all") return true;
    if (key === "resolved") return c.status === "resolved" || c.status === "archived";
    if (key === "waiting") return ACTIVE.includes(c.status) && awaitingReply(c);
    return ACTIVE.includes(c.status);
  }, []);

  const counts = useMemo(
    () => ({
      active: conversations.filter((c) => inTab(c, "active")).length,
      waiting: conversations.filter((c) => inTab(c, "waiting")).length,
    }),
    [conversations, inTab],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!inTab(c, tab)) return false;
      if (!q) return true;
      return [c.guest?.full_name, c.guest?.email, c.guest?.phone, c.property?.name, c.reservation?.confirmation_code, c.subject]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [conversations, search, tab, inTab]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.full_name;

  return (
    <div className="grid h-full grid-cols-[360px_minmax(0,1fr)_340px] max-xl:grid-cols-[340px_minmax(0,1fr)]">
      {/* ── list ── */}
      <section className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Inbox</h1>
            <span className="text-xs text-slate-500">{visible.length} conversations</span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search guest, property or booking code"
              className={cx(field, "pl-9")}
              aria-label="Search conversations"
            />
          </div>
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: "active", label: "Open", count: counts.active },
              { key: "waiting", label: "Waiting", count: counts.waiting },
              { key: "resolved", label: "Done" },
              { key: "all", label: "All" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={cx(field, "py-1.5 text-xs")} aria-label="Channel">
              <option value="">All channels</option>
              {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)} className={cx(field, "py-1.5 text-xs")} aria-label="Assigned to">
              <option value="all">Everyone</option>
              <option value="me">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={cx(field, "col-span-2 py-1.5 text-xs")} aria-label="Property">
              <option value="">All properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <li className="space-y-3 p-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex animate-pulse gap-3">
                  <div className="h-9 w-9 rounded-full bg-slate-100" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 rounded bg-slate-100" />
                    <div className="h-3 w-3/4 rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </li>
          )}
          {loadError && <li className="p-4 text-sm text-red-600">{loadError}</li>}
          {!loading && !loadError && visible.length === 0 && (
            <li>
              <EmptyState
                icon={<InboxIcon className="h-5 w-5" />}
                title={tab === "waiting" ? "Nobody is waiting" : "No conversations"}
                text={tab === "waiting" ? "Every guest has an answer." : "New guest messages appear here automatically."}
              />
            </li>
          )}
          {visible.map((c) => {
            const waiting = awaitingReply(c) && ACTIVE.includes(c.status);
            const stay = stayStatus(c.reservation);
            const preview = previews[c.id];
            const unread = c.unread_count > 0;
            const isSelected = selectedId === c.id;
            return (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={cx(
                    "relative flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition",
                    isSelected ? "bg-indigo-50/70" : "hover:bg-slate-50",
                  )}
                >
                  {isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-indigo-600" aria-hidden />}
                  <GuestAvatar name={c.guest?.full_name ?? c.subject} channel={c.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={cx("truncate text-sm text-slate-900", unread ? "font-semibold" : "font-medium")}>
                        {c.guest?.full_name ?? c.subject ?? "Guest"}
                      </span>
                      <span className={cx("ml-auto shrink-0 text-xs", unread ? "font-semibold text-indigo-600" : "text-slate-400")}>
                        {timeAgo(c.last_message_at)}
                      </span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{c.property?.name ?? "No property linked"}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={cx("min-w-0 flex-1 truncate text-sm", unread ? "text-slate-900" : "text-slate-500")}>
                        {preview ? `${preview.outbound ? "You: " : ""}${preview.body}` : "No messages yet"}
                      </p>
                      {unread && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[11px] font-semibold text-white">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {stay && <Chip className={STAY_STYLE[stay.tone]}>{stay.label}</Chip>}
                      {waiting && (
                        <Chip className="bg-amber-50 text-amber-800 ring-amber-200">
                          <Timer className="mr-1 h-3 w-3" />
                          Waiting {timeAgo(c.last_inbound_at)}
                        </Chip>
                      )}
                      {c.status === "escalated" && <Chip className="bg-red-50 text-red-700 ring-red-200">Escalated</Chip>}
                      {c.status === "pending" && <Chip className="bg-slate-100 text-slate-600 ring-slate-200">Pending</Chip>}
                      <span className="ml-auto truncate text-[11px] text-slate-400">{staffName(c.assigned_to) ?? "Unassigned"}</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── thread ── */}
      <section className="flex min-h-0 flex-col bg-slate-50">
        {selected ? (
          <Thread key={selected.id} conversation={selected} staff={staff} onChanged={load} />
        ) : (
          <EmptyState
            icon={<MessageSquareText className="h-5 w-5" />}
            title="Select a conversation"
            text="Pick a guest on the left to read the thread and reply."
          />
        )}
      </section>

      {/* ── details ── */}
      <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-slate-200 bg-white max-xl:hidden">
        {selected && <DetailsPanel key={selected.id} conversation={selected} onChanged={load} />}
      </aside>
    </div>
  );
}
