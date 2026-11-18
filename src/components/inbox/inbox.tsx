"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Inbox as InboxIcon, MessageSquareText, Plus, RefreshCw, Search, SlidersHorizontal, Timer, X } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { brandOf } from "@/components/channel-logo";
import { Avatar, Chip, cx, EmptyState, field, GuestAvatar, Tabs } from "@/components/ui";
import { awaitingReply, CATEGORY_LABEL, CHANNEL_LABEL, messagePreview, PRIORITY_CHIP, STAY_STYLE, stayStatus, timeAgo } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { DetailsPanel } from "./details-panel";
import { NewChat } from "./new-chat";
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
  ai_category: string | null;
  ai_priority: string | null;
  ai_summary: string | null;
  ai_flag: string | null;
};

export type StaffOption = { id: string; full_name: string; avatar_url: string | null };

type TabKey = "active" | "waiting" | "resolved" | "all";

const SELECT = `id, channel, status, subject, unread_count, last_message_at, last_inbound_at,
  last_outbound_at, assigned_to, property_id, reservation_id,
  ai_category, ai_priority, ai_summary, ai_flag,
  guest:guests(id, full_name, email, phone),
  property:properties(id, name),
  reservation:reservations(confirmation_code, check_in, check_out, status)`;

const ACTIVE = ["open", "pending", "escalated"];

export function Inbox() {
  const { supabase, api, profile } = useApp();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, { body: string; outbound: boolean; sentBy: string | null }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);

  const [tab, setTab] = useState<TabKey>("active");
  const [channel, setChannel] = useState("");
  const [propertyId, setPropertyId] = useState("");
  // "all", "me", "unassigned" or a staff member's id.
  const [assignee, setAssignee] = useState("all");
  // "" or the id of a staff member who has replied in the thread.
  const [repliedBy, setRepliedBy] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "urgent">("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    let query = supabase
      .from("conversations")
      .select(SELECT)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (channel) query = query.eq("channel", channel);
    if (propertyId) query = query.eq("property_id", propertyId);
    if (assignee === "me") query = query.eq("assigned_to", profile.id);
    else if (assignee === "unassigned") query = query.is("assigned_to", null);
    else if (assignee !== "all") query = query.eq("assigned_to", assignee);
    if (repliedBy) {
      const { data: replied } = await supabase
        .from("messages")
        .select("conversation_id")
        .eq("sent_by", repliedBy)
        .eq("direction", "outbound")
        .limit(5000);
      const ids = [...new Set((replied ?? []).map((m) => m.conversation_id as string))];
      query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
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
        .select("conversation_id, body, direction, content_type, sent_by, created_at")
        .in("conversation_id", ids.slice(0, 200))
        .neq("content_type", "system")
        .order("created_at", { ascending: false })
        .limit(1000);
      const map: Record<string, { body: string; outbound: boolean; sentBy: string | null }> = {};
      for (const m of msgs ?? []) {
        if (!map[m.conversation_id]) {
          map[m.conversation_id] = { body: m.body ?? "", outbound: m.direction === "outbound", sentBy: m.sent_by };
        }
      }
      setPreviews(map);
    }
  }, [supabase, channel, propertyId, assignee, repliedBy, profile.id]);

  useLoader(load);

  const loadOptions = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("profiles").select("id, full_name, avatar_url").eq("active", true).order("full_name"),
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

  // Guest emails: Gmail doesn't push, so check every 10 seconds while the inbox
  // is open and visible (the server skips it if anyone checked in the last 8s).
  // New emails arrive through the realtime subscription above.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === "visible") void api("/api/sync/gmail", { json: {} });
    };
    check();
    const every = setInterval(check, 10_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", check);
    };
  }, [api]);

  // "Sync now": email + Beds24 straight away, instead of waiting for the schedule.
  // WhatsApp needs no sync -- it arrives the moment it is sent.
  // Filters that are switched on, shown as removable chips under the search box.
  const activeFilters = useMemo(() => {
    const name = (id: string) => (id === profile.id ? "me" : (staff.find((s) => s.id === id)?.full_name ?? "someone"));
    const list: { key: string; label: string; clear: () => void }[] = [];
    if (channel) list.push({ key: "channel", label: CHANNEL_LABEL[channel] ?? channel, clear: () => setChannel("") });
    if (assignee !== "all") {
      list.push({
        key: "assignee",
        label: assignee === "unassigned" ? "Unassigned" : `Assigned to ${name(assignee === "me" ? profile.id : assignee)}`,
        clear: () => setAssignee("all"),
      });
    }
    if (repliedBy) list.push({ key: "replied", label: `Replied by ${name(repliedBy)}`, clear: () => setRepliedBy("") });
    if (propertyId) {
      list.push({ key: "property", label: properties.find((p) => p.id === propertyId)?.name ?? "Property", clear: () => setPropertyId("") });
    }
    if (sort !== "newest") list.push({ key: "sort", label: "Urgent first", clear: () => setSort("newest") });
    return list;
  }, [channel, assignee, repliedBy, propertyId, sort, staff, properties, profile.id]);
  const clearFilters = () => {
    setChannel("");
    setAssignee("all");
    setRepliedBy("");
    setPropertyId("");
    setSort("newest");
  };
  // The rows of the filter panel: label, value, setter, options.
  const filterRows: [string, string, (v: string) => void, string[][]][] = [
    ["Channel", channel, setChannel, [["", "All channels"], ...Object.entries(CHANNEL_LABEL)]],
    [
      "Assigned to",
      assignee,
      setAssignee,
      [["all", "Anyone"], ["me", "Me"], ["unassigned", "Nobody (unassigned)"], ...staff.filter((s) => s.id !== profile.id).map((s) => [s.id, s.full_name])],
    ],
    ["Replied by", repliedBy, setRepliedBy, [["", "Anyone"], ...staff.map((s) => [s.id, s.id === profile.id ? "Me" : s.full_name])]],
    ["Property", propertyId, setPropertyId, [["", "All properties"], ...properties.map((p) => [p.id, p.name])]],
    ["Sort", sort, (v) => setSort(v as "newest" | "urgent"), [["newest", "Newest message first"], ["urgent", "Escalated & urgent first"]]],
  ];

  // The filter panel closes on a click outside it or on Esc.
  useEffect(() => {
    if (!filtersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!filtersRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function syncNow() {
    setSyncing(true);
    setSyncNote(null);
    const res = await api("/api/sync/beds24", { json: { maxAgeDays: 3 } });
    setSyncing(false);
    const added = res.data?.messagesAdded ?? 0;
    setSyncNote(
      res.ok
        ? { ok: true, text: added ? `Synced: ${added} new message${added === 1 ? "" : "s"}.` : "Synced: everything is up to date." }
        : { ok: false, text: `Sync problem: ${res.data?.error ?? res.data?.errors?.[0] ?? res.status}` },
    );
    load();
    setTimeout(() => setSyncNote(null), 6000);
  }

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
    // Newest first by default: urgent-first buried new messages under old flagged
    // chats, which looked like "messages not syncing". Urgent first is a choice.
    const rank = (c: ConversationRow) =>
      sort !== "urgent" || !ACTIVE.includes(c.status) ? 2 : c.status === "escalated" ? 0 : c.ai_priority === "urgent" ? 1 : 2;
    return conversations
      .filter((c) => {
        if (!inTab(c, tab)) return false;
        if (!q) return true;
        return [c.guest?.full_name, c.guest?.email, c.guest?.phone, c.property?.name, c.reservation?.confirmation_code, c.subject, c.ai_summary]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => rank(a) - rank(b));
  }, [conversations, search, tab, inTab, sort]);

  // A link to one conversation: /inbox?c=<id> (alert emails, Incidents, Reports).
  // Read through the router so it works on every click, not only on a fresh page
  // load (Incidents -> "Open the conversation" was landing on an empty inbox).
  const linked = useSearchParams().get("c");
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!linked || loading || opened.current === linked) return;
    opened.current = linked;
    const here = conversations.find((c) => c.id === linked);
    // State is set after the effect (same pattern as useLoader), not inside it.
    void Promise.resolve().then(async () => {
      setSelectedId(linked);
      if (here) {
        // Resolved threads are not on the Active tab: show the tab it is on.
        if (!inTab(here, tab)) setTab("all");
        return;
      }
      // Not in the loaded list (or hidden by a filter): fetch that one thread.
      const { data } = await supabase.from("conversations").select(SELECT).eq("id", linked).maybeSingle();
      if (!data) return;
      setConversations((cs) => (cs.some((c) => c.id === linked) ? cs : [data as unknown as ConversationRow, ...cs]));
      setTab("all");
    });
  }, [linked, loading, conversations, supabase, inTab, tab]);
  useEffect(() => {
    if (linked && selectedId === linked) {
      document.getElementById(`conv-${linked}`)?.scrollIntoView({ block: "center" });
    }
  }, [linked, selectedId, tab]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const assignedTo = (id: string | null) => staff.find((s) => s.id === id);
  const staffName = (id: string | null) => assignedTo(id)?.full_name;
  // Who wrote the last reply: you, a named colleague, or someone outside the inbox (Airbnb app, Beds24).
  const replier = (sentBy: string | null) =>
    sentBy === profile.id ? "You" : (staffName(sentBy)?.split(" ")[0] ?? "Host");

  return (
    <div className="grid h-full grid-cols-[360px_minmax(0,1fr)_340px] max-xl:grid-cols-[340px_minmax(0,1fr)]">
      {/* ── list ── */}
      <section className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg leading-tight font-semibold tracking-tight text-slate-900">Inbox</h1>
              <p className="truncate text-xs text-slate-500">{visible.length} conversations</p>
            </div>
            {profile.role !== "read_only" && (
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={syncNow}
                  disabled={syncing}
                  title="Sync now: check email and Beds24 for new messages"
                  aria-label="Sync now"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={cx("h-4 w-4", syncing && "animate-spin")} />
                </button>
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  title="Write to a guest first (WhatsApp or email)"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-medium whitespace-nowrap text-white shadow-sm hover:bg-indigo-500"
                >
                  <Plus className="h-4 w-4" /> New chat
                </button>
              </div>
            )}
          </div>
          {composing && (
            <NewChat
              onClose={() => setComposing(false)}
              onOpened={(id) => {
                setComposing(false);
                setTab("all");
                setSelectedId(id);
                void load();
              }}
            />
          )}
          {syncNote && (
            <p className={cx("rounded-lg px-3 py-1.5 text-xs", syncNote.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
              {syncNote.text}
            </p>
          )}
          <div ref={filtersRef} className="relative flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search guest, property, booking"
                className={cx(field, "pl-9")}
                aria-label="Search conversations"
              />
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              title="Filter and sort"
              className={cx(
                "relative inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ring-1 transition",
                filtersOpen || activeFilters.length
                  ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                  : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Filters</span>
              {activeFilters.length > 0 && (
                <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] leading-4 font-semibold text-white">{activeFilters.length}</span>
              )}
            </button>

            {filtersOpen && (
              <div className="absolute top-full right-0 left-0 z-30 mt-2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-200">
                <div className="space-y-2">
                  {filterRows.map(([label, value, set, options]) => (
                    <label key={label} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-xs font-medium text-slate-500">{label}</span>
                      <select value={value} onChange={(e) => set(e.target.value)} className={cx(field, "py-1.5 text-xs")}>
                        {options.map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={!activeFilters.length}
                    className="text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
                  >
                    Clear all
                  </button>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(false)}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-indigo-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100"
                >
                  <span className="truncate">{f.label}</span>
                  <button type="button" onClick={f.clear} className="rounded-full p-0.5 hover:bg-indigo-100" aria-label={`Remove filter: ${f.label}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              {activeFilters.length > 1 && (
                <button type="button" onClick={clearFilters} className="px-1 text-xs font-medium text-slate-500 hover:text-slate-800">
                  Clear all
                </button>
              )}
            </div>
          )}

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
        </div>

        <ul className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
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
              <li key={c.id} id={`conv-${c.id}`}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={cx(
                    "relative flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left transition",
                    isSelected ? "bg-indigo-50/70" : "hover:bg-slate-50",
                  )}
                >
                  {/* the platform's colour down the left edge */}
                  <span className={cx("absolute inset-y-0 left-0 w-1", brandOf(c.channel).bar)} aria-hidden />
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
                    <p className="truncate text-xs text-slate-500">
                      <span className={cx("font-semibold", brandOf(c.channel).text)}>{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
                      {" · "}
                      {c.property?.name ?? "No property linked"}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <p className={cx("min-w-0 flex-1 truncate text-sm", unread ? "text-slate-900" : "text-slate-500")}>
                        {preview ? `${preview.outbound ? `${replier(preview.sentBy)}: ` : ""}${messagePreview(preview.body)}` : "No messages yet"}
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
                      {ACTIVE.includes(c.status) && c.ai_priority && PRIORITY_CHIP[c.ai_priority] && (
                        <Chip className={PRIORITY_CHIP[c.ai_priority]!.className}>{PRIORITY_CHIP[c.ai_priority]!.label}</Chip>
                      )}
                      {c.ai_category && c.ai_category !== "other" && (
                        <Chip className="bg-white text-slate-600 ring-slate-200">{CATEGORY_LABEL[c.ai_category] ?? c.ai_category}</Chip>
                      )}
                      <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-[11px] text-slate-400">
                        {assignedTo(c.assigned_to) && <Avatar name={assignedTo(c.assigned_to)!.full_name} src={assignedTo(c.assigned_to)!.avatar_url} size="xs" />}
                        {staffName(c.assigned_to) ?? "Unassigned"}
                      </span>
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
      <aside className="scroll-thin relative min-h-0 overflow-y-auto border-l border-slate-200 bg-white max-xl:hidden">
        {selected && <DetailsPanel key={selected.id} conversation={selected} onChanged={load} />}
      </aside>
    </div>
  );
}
