"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertCircle, BookOpen, Check, CheckCheck, CheckCircle2, Clock, RotateCcw, Send, ShieldAlert, Sparkles } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Avatar, btn, ChannelBadge, cx } from "@/components/ui";
import { CATEGORY_LABEL, CHANNEL_LABEL, clock, dayLabel } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import type { ConversationRow, StaffOption } from "./inbox";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  body: string | null;
  content_type: string;
  sender_name: string | null;
  provider_error: string | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
};

type SavedReply = { id: string; question: string; answer: string; category: string; property_id: string | null };

const when = (m: Message) => m.received_at || m.sent_at || m.created_at;
const REPLYABLE = ["airbnb", "booking_com", "beds24"];

export function Thread({
  conversation,
  staff,
  onChanged,
}: {
  conversation: ConversationRow;
  staff: StaffOption[];
  onChanged: () => void;
}) {
  const { supabase, api, canWrite, profile } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReply[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, direction, status, body, content_type, sender_name, provider_error, received_at, sent_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at");
    setMessages(((data ?? []) as Message[]).sort((a, b) => when(a).localeCompare(when(b))));
  }, [supabase, conversation.id]);
  useLoader(load);

  const loadSaved = useCallback(async () => {
    const { data } = await supabase
      .from("faq_entries")
      .select("id, question, answer, category, property_id")
      .eq("active", true)
      .order("category");
    setSaved(
      ((data ?? []) as SavedReply[]).filter((r) => !r.property_id || r.property_id === conversation.property_id),
    );
  }, [supabase, conversation.property_id]);
  useLoader(loadSaved);

  // Opening a conversation marks it read (once).
  const markedRead = useRef(false);
  useEffect(() => {
    if (markedRead.current || conversation.unread_count === 0 || !canWrite) return;
    markedRead.current = true;
    api(`/api/conversations/${conversation.id}/read`, { method: "POST" }).then(onChanged);
  }, [api, canWrite, conversation.id, conversation.unread_count, onChanged]);

  useEffect(() => {
    const sub = supabase
      .channel(`thread-${conversation.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `conversation_id=eq.${conversation.id}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [supabase, conversation.id, load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Grow the reply box with its content, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const res = await api("/api/send", {
      json: { conversationId: conversation.id, body: text, clientKey: crypto.randomUUID() },
    });
    setSending(false);
    if (res.ok) setDraft("");
    else setSendError(res.data?.error ?? "The reply could not be sent.");
    load();
    onChanged();
  }

  async function retry(messageId: string) {
    const res = await api("/api/send", { json: { retryMessageId: messageId } });
    if (!res.ok) setSendError(res.data?.error ?? "Still failing.");
    load();
  }

  async function setStatus(status: string) {
    await supabase
      .from("conversations")
      .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", conversation.id);
    await supabase.from("conversation_events").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      actor_id: profile.id,
      event_type: "status_changed",
      data: { status },
    });
    onChanged();
  }

  async function assign(to: string) {
    await supabase
      .from("conversations")
      .update({ assigned_to: to || null, updated_at: new Date().toISOString() })
      .eq("id", conversation.id);
    await supabase.from("conversation_events").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      actor_id: profile.id,
      event_type: "assigned",
      data: { assigned_to: to || null },
    });
    onChanged();
  }

  const canReply = REPLYABLE.includes(conversation.channel);
  const resolved = conversation.status === "resolved" || conversation.status === "archived";
  const guestName = conversation.guest?.full_name ?? "Guest";

  // Group consecutive messages from the same side within 5 minutes.
  const rows = useMemo(
    () =>
      messages.map((m, i) => {
        const prev = messages[i - 1];
        const newDay = !prev || dayLabel(when(prev)) !== dayLabel(when(m));
        const grouped =
          !!prev &&
          !newDay &&
          prev.content_type !== "system" &&
          prev.direction === m.direction &&
          prev.sender_name === m.sender_name &&
          Date.parse(when(m)) - Date.parse(when(prev)) < 5 * 60_000;
        return { m, newDay, grouped };
      }),
    [messages],
  );

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <Avatar name={guestName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-slate-900">{guestName}</h2>
            <ChannelBadge channel={conversation.channel} />
          </div>
          <p className="truncate text-xs text-slate-500">
            {conversation.property?.name ?? "No property linked"}
            {conversation.reservation?.confirmation_code ? ` · ${conversation.reservation.confirmation_code}` : ""}
          </p>
        </div>
        {canWrite && (
          <>
            <select
              value={conversation.assigned_to ?? ""}
              onChange={(e) => assign(e.target.value)}
              className="max-w-40 rounded-lg border-0 bg-slate-50 py-1.5 pr-7 pl-2.5 text-xs text-slate-700 ring-1 ring-slate-200"
              aria-label="Assign conversation"
            >
              <option value="">Unassigned</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
            {resolved ? (
              <button onClick={() => setStatus("open")} className={btn.secondary}>
                <RotateCcw className="h-4 w-4" /> Reopen
              </button>
            ) : (
              <button onClick={() => setStatus("resolved")} className={btn.secondary}>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Resolve
              </button>
            )}
          </>
        )}
      </div>

      {/* AI read of the thread */}
      {conversation.status === "escalated" ? (
        <div className="flex items-start gap-2.5 border-b border-red-200 bg-red-50 px-5 py-2.5 text-sm">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-red-800">Needs a manager{conversation.ai_flag ? `: ${conversation.ai_flag}` : ""}</p>
            {conversation.ai_summary && <p className="text-red-700">{conversation.ai_summary}</p>}
          </div>
          {canWrite && (
            <button onClick={() => setStatus("open")} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100">
              Clear escalation
            </button>
          )}
        </div>
      ) : (
        conversation.ai_summary && (
          <div className="flex items-start gap-2.5 border-b border-slate-200 bg-indigo-50/60 px-5 py-2 text-sm">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
            <p className="min-w-0 flex-1 text-slate-700">
              {conversation.ai_category && conversation.ai_category !== "other" && (
                <span className="font-medium text-slate-900">{CATEGORY_LABEL[conversation.ai_category] ?? conversation.ai_category} · </span>
              )}
              {conversation.ai_summary}
            </p>
          </div>
        )
      )}

      {/* messages */}
      <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && <p className="text-center text-sm text-slate-500">No messages yet.</p>}
        {rows.map(({ m, newDay, grouped }) => (
          <Fragment key={m.id}>
            {newDay && (
              <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                {dayLabel(when(m))}
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {m.content_type === "system" ? (
              <div className="mx-auto my-2 max-w-[80%] rounded-lg bg-slate-100 px-3 py-1.5 text-center text-xs text-slate-500">
                {m.body} · {clock(when(m))}
              </div>
            ) : (
              <div className={cx("flex items-end gap-2", m.direction === "outbound" ? "justify-end" : "justify-start", grouped ? "mt-1" : "mt-3")}>
                {m.direction === "inbound" && (
                  <span className={cx("w-7 shrink-0", grouped && "invisible")}>
                    <Avatar name={guestName} size="sm" />
                  </span>
                )}
                <div className={cx("max-w-[72%]", m.direction === "outbound" && "items-end")}>
                  <div
                    className={cx(
                      "rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm",
                      m.direction === "outbound"
                        ? cx("bg-indigo-600 text-white", m.status === "failed" && "bg-red-600")
                        : "bg-white text-slate-900 ring-1 ring-slate-200",
                    )}
                  >
                    <p className="whitespace-pre-wrap wrap-break-word">{m.body}</p>
                  </div>
                  {!grouped || m.status === "failed" ? (
                    <div className={cx("mt-1 flex items-center gap-1 px-1 text-[11px] text-slate-400", m.direction === "outbound" && "justify-end")}>
                      {m.direction === "outbound" && <span>{m.sender_name ?? "Host"} ·</span>}
                      <span>{clock(when(m))}</span>
                      {m.direction === "outbound" && <DeliveryIcon status={m.status} />}
                    </div>
                  ) : null}
                  {m.status === "failed" && (
                    <div className="mt-1 flex items-center justify-end gap-2 px-1 text-xs text-red-700">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Not sent: {m.provider_error ?? "unknown error"}
                      {canWrite && (
                        <button className="font-semibold underline" onClick={() => retry(m.id)}>
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Fragment>
        ))}
        <div ref={bottom} />
      </div>

      {/* composer */}
      {canWrite && canReply ? (
        <form onSubmit={send} className="border-t border-slate-200 bg-white px-5 py-3">
          {sendError && (
            <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" /> {sendError}
            </p>
          )}
          <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-indigo-500">
            <textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
              }}
              rows={2}
              maxLength={5000}
              placeholder={`Reply to ${guestName} on ${CHANNEL_LABEL[conversation.channel] ?? "this channel"}…`}
              className="block w-full resize-none rounded-t-xl border-0 bg-transparent px-3.5 pt-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              aria-label="Reply"
            />
            <div className="relative flex items-center gap-2 px-2 pb-2">
              <button
                type="button"
                onClick={() => setShowSaved((s) => !s)}
                className={btn.ghost}
                aria-expanded={showSaved}
              >
                <BookOpen className="h-4 w-4" /> Saved replies
              </button>
              {showSaved && (
                <div className="scroll-thin absolute bottom-11 left-2 z-10 max-h-72 w-96 overflow-y-auto rounded-xl bg-white p-1 shadow-lg ring-1 ring-slate-200">
                  {saved.length === 0 && (
                    <p className="p-3 text-sm text-slate-500">No saved replies yet. Add them under Saved replies.</p>
                  )}
                  {saved.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setDraft((d) => (d.trim() ? `${d.trim()}\n\n${r.answer}` : r.answer));
                        setShowSaved(false);
                        box.current?.focus();
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <span className="block text-sm font-medium text-slate-900">{r.question}</span>
                      <span className="block truncate text-xs text-slate-500">{r.answer}</span>
                    </button>
                  ))}
                </div>
              )}
              <span className="ml-auto text-[11px] text-slate-400">Ctrl+Enter to send</span>
              <button type="submit" disabled={sending || !draft.trim()} className={btn.primary}>
                <Send className="h-4 w-4" />
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <div className="border-t border-slate-200 bg-white px-5 py-3 text-xs text-slate-500">
          {canWrite ? "Replying on this channel is not connected yet." : "You have read-only access."}
        </div>
      )}
    </>
  );
}

function DeliveryIcon({ status }: { status: Message["status"] }) {
  const map = {
    pending: { icon: Clock, label: "Sending" },
    sent: { icon: Check, label: "Sent" },
    delivered: { icon: CheckCheck, label: "Delivered" },
    read: { icon: CheckCheck, label: "Read" },
    failed: { icon: AlertCircle, label: "Failed" },
  }[status];
  const Icon = map.icon;
  return (
    <span className={cx("inline-flex items-center gap-0.5", status === "failed" ? "text-red-600" : status === "read" ? "text-indigo-500" : "")}>
      <Icon className="h-3.5 w-3.5" />
      <span className="sr-only">{map.label}</span>
      <span aria-hidden>{map.label}</span>
    </span>
  );
}
