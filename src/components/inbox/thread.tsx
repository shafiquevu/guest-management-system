"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "@/components/app-shell";
import { CHANNEL_LABEL, dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import type { ConversationRow } from "./inbox";

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

const when = (m: Message) => m.received_at || m.sent_at || m.created_at;

export function Thread({ conversation, onChanged }: { conversation: ConversationRow; onChanged: () => void }) {
  const { supabase, api, canWrite } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, direction, status, body, content_type, sender_name, provider_error, received_at, sent_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at");
    const rows = ((data ?? []) as Message[]).sort((a, b) => when(a).localeCompare(when(b)));
    setMessages(rows);
  }, [supabase, conversation.id]);

  useLoader(load);

  // Opening a conversation marks it read (once, when it is opened).
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

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    const res = await api("/api/send", {
      json: { conversationId: conversation.id, body: text, clientKey: crypto.randomUUID() },
    });
    setSending(false);
    if (res.ok) {
      setDraft("");
    } else {
      setSendError(res.data?.error ?? "The reply could not be sent.");
    }
    load();
    onChanged();
  }

  async function retry(messageId: string) {
    const res = await api("/api/send", { json: { retryMessageId: messageId } });
    if (!res.ok) setSendError(res.data?.error ?? "Still failing.");
    load();
  }

  const canReply = ["airbnb", "booking_com", "beds24"].includes(conversation.channel);

  return (
    <>
      <div className="border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="font-medium text-slate-900">{conversation.guest?.full_name ?? "Guest"}</div>
        <div className="text-xs text-slate-500">
          {CHANNEL_LABEL[conversation.channel] ?? conversation.channel} · {conversation.property?.name ?? "No property"}
          {conversation.reservation?.confirmation_code ? ` · ${conversation.reservation.confirmation_code}` : ""}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-sm text-slate-500">No messages yet.</p>}
        {messages.map((m) =>
          m.content_type === "system" ? (
            <div key={m.id} className="mx-auto max-w-[80%] rounded-md bg-slate-100 px-3 py-1.5 text-center text-xs text-slate-500">
              {m.body} · {dateTime(when(m))}
            </div>
          ) : (
            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm ${
                  m.direction === "outbound" ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-900"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className={`mt-1 text-[11px] ${m.direction === "outbound" ? "text-blue-100" : "text-slate-400"}`}>
                  {m.sender_name ? `${m.sender_name} · ` : ""}
                  {dateTime(when(m))}
                  {m.direction === "outbound" && <> · {statusLabel(m.status)}</>}
                </div>
                {m.status === "failed" && (
                  <div className="mt-1.5 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                    Not sent: {m.provider_error ?? "unknown error"}
                    {canWrite && (
                      <button className="ml-2 font-medium underline" onClick={() => retry(m.id)}>
                        Retry
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {canWrite && canReply ? (
        <form onSubmit={send} className="border-t border-slate-200 bg-white p-3">
          {sendError && <p className="mb-2 text-sm text-red-600">{sendError}</p>}
          <div className="flex gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(e);
              }}
              rows={3}
              maxLength={5000}
              placeholder={`Reply on ${CHANNEL_LABEL[conversation.channel] ?? "this channel"}… (Ctrl+Enter to send)`}
              className="min-w-0 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim()}
              className="self-end rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      ) : (
        <div className="border-t border-slate-200 bg-white p-3 text-xs text-slate-500">
          {canWrite ? "Replying on this channel is not connected yet." : "Read-only access."}
        </div>
      )}
    </>
  );
}

function statusLabel(status: Message["status"]): string {
  return { pending: "Sending…", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" }[status];
}
