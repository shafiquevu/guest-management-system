"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-shell";
import { awaitingReply, CHANNEL_LABEL, CHANNEL_STYLE, timeAgo } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { Thread } from "./thread";
import { DetailsPanel } from "./details-panel";

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
  reservation: { confirmation_code: string | null; check_in: string | null; check_out: string | null } | null;
};

export type StaffOption = { id: string; full_name: string };

const STATUS_TABS = [
  { key: "active", label: "Open", statuses: ["open", "pending", "escalated"] },
  { key: "resolved", label: "Resolved", statuses: ["resolved"] },
  { key: "archived", label: "Archived", statuses: ["archived"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SELECT = `id, channel, status, subject, unread_count, last_message_at, last_inbound_at,
  last_outbound_at, assigned_to, property_id, reservation_id,
  guest:guests(id, full_name, email, phone),
  property:properties(id, name),
  reservation:reservations(confirmation_code, check_in, check_out)`;

export function Inbox() {
  const { supabase, profile } = useApp();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);

  const [tab, setTab] = useState("active");
  const [channel, setChannel] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [assignee, setAssignee] = useState<"all" | "me" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const [onlyUnread, setOnlyUnread] = useState(false);

  const load = useCallback(async () => {
    const statuses = STATUS_TABS.find((t) => t.key === tab)?.statuses ?? [];
    let query = supabase.from("conversations").select(SELECT).order("last_message_at", {
      ascending: false,
      nullsFirst: false,
    });
    if (statuses.length) query = query.in("status", statuses);
    if (channel) query = query.eq("channel", channel);
    if (propertyId) query = query.eq("property_id", propertyId);
    if (assignee === "me") query = query.eq("assigned_to", profile.id);
    if (assignee === "unassigned") query = query.is("assigned_to", null);
    if (onlyUnread) query = query.gt("unread_count", 0);
    const { data, error } = await query.limit(300);
    setLoading(false);
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    setConversations((data ?? []) as unknown as ConversationRow[]);
  }, [supabase, tab, channel, propertyId, assignee, onlyUnread, profile.id]);

  useLoader(load);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("active", true)
      .order("full_name")
      .then(({ data }) => setStaff((data ?? []) as StaffOption[]));
    supabase
      .from("properties")
      .select("id, name")
      .order("name")
      .then(({ data }) => setProperties((data ?? []) as { id: string; name: string }[]));
  }, [supabase]);

  // Live: any change to a conversation reloads the list (debounced).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const channelSub = supabase
      .channel("inbox-conversations")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(load, 400);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channelSub);
    };
  }, [supabase, load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) =>
      [c.guest?.full_name, c.guest?.email, c.guest?.phone, c.property?.name, c.reservation?.confirmation_code, c.subject]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [conversations, search]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.full_name;

  return (
    <div className="grid h-full grid-cols-[340px_minmax(0,1fr)_320px] max-lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* ── list ── */}
      <section className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-2 border-b border-slate-200 p-3">
          <div className="flex gap-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                  tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search guest, property, booking code"
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
          <div className="grid grid-cols-3 gap-1.5">
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" aria-label="Channel">
              <option value="">All channels</option>
              {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" aria-label="Property">
              <option value="">All properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)} className="rounded-md border border-slate-300 px-1.5 py-1 text-xs" aria-label="Assigned to">
              <option value="all">Anyone</option>
              <option value="me">Mine</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
            Unread only
          </label>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto">
          {loading && <li className="p-4 text-sm text-slate-500">Loading…</li>}
          {loadError && <li className="p-4 text-sm text-red-600">{loadError}</li>}
          {!loading && !loadError && visible.length === 0 && (
            <li className="p-4 text-sm text-slate-500">No conversations here.</li>
          )}
          {visible.map((c) => {
            const waiting = awaitingReply(c) && ["open", "pending", "escalated"].includes(c.status);
            return (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full border-b border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50 ${
                    selectedId === c.id ? "bg-blue-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {c.unread_count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />}
                    <span className={`truncate text-sm ${c.unread_count > 0 ? "font-semibold" : "font-medium"} text-slate-900`}>
                      {c.guest?.full_name ?? c.subject ?? "Guest"}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={`rounded px-1.5 py-0.5 ${CHANNEL_STYLE[c.channel] ?? ""}`}>
                      {CHANNEL_LABEL[c.channel] ?? c.channel}
                    </span>
                    <span className="truncate">{c.property?.name ?? "No property"}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {waiting && <span className="text-amber-700">Awaiting reply · {timeAgo(c.last_inbound_at)}</span>}
                    {c.status === "escalated" && <span className="text-red-600">Escalated</span>}
                    <span className="ml-auto text-slate-400">{staffName(c.assigned_to) ?? "Unassigned"}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── thread ── */}
      <section className="flex min-h-0 flex-col">
        {selected ? (
          <Thread key={selected.id} conversation={selected} onChanged={load} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            Choose a conversation.
          </div>
        )}
      </section>

      {/* ── details ── */}
      <aside className="min-h-0 overflow-y-auto border-l border-slate-200 bg-white max-lg:hidden">
        {selected && <DetailsPanel key={selected.id} conversation={selected} staff={staff} onChanged={load} />}
      </aside>
    </div>
  );
}
