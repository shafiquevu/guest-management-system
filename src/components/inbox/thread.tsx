"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, BookOpen, Check, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, ExternalLink, FileText, ImageOff, Paperclip, Reply, RotateCcw, Send, ShieldAlert, SmilePlus, Sparkles, X } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Avatar, btn, ChannelBadge, cx } from "@/components/ui";
import { CATEGORY_LABEL, CHANNEL_LABEL, clock, dayLabel, messagePreview, parseMessage, type MessageImage } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import { ACCEPT, checkFileFor } from "@/lib/whatsapp/media";
import { EmailCard } from "./email-card";
import type { ConversationRow, StaffOption } from "./inbox";

type Message = {
  id: string;
  direction: "inbound" | "outbound";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  body: string | null;
  content_type: string;
  sender_name: string | null;
  sender_address: string | null;
  recipient_address: string | null;
  sent_by: string | null;
  provider_error: string | null;
  received_at: string | null;
  sent_at: string | null;
  created_at: string;
  external_message_id: string | null;
  raw_payload: {
    reply_to?: string;
    reactions?: Record<string, string>;
    edited?: boolean;
    deleted?: boolean;
    original_body?: string;
    subject?: string;
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
  } | null;
};

/** WhatsApp's quick reactions. */
const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

type SavedReply = { id: string; question: string; answer: string; category: string; property_id: string | null };

const when = (m: Message) => m.received_at || m.sent_at || m.created_at;
const REPLYABLE = ["airbnb", "booking_com", "beds24", "gmail", "whatsapp"];

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
  const [loaded, setLoaded] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [files, setFiles] = useState<Record<string, StoredFile[]>>({});
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const picker = useRef<HTMLInputElement>(null);
  const canAttach = conversation.channel === "whatsapp" || conversation.channel === "gmail";
  // WhatsApp chats are drawn like the WhatsApp app.
  const isWa = conversation.channel === "whatsapp";
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // Email: reply to everyone on the email (To + Cc), not just the sender.
  const [replyAll, setReplyAll] = useState(false);
  // Email: extra people to copy in (comma-separated), shown on demand.
  const [ccOpen, setCcOpen] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  // Email: which emails are unfolded (the newest one is, by default).
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const isEmail = conversation.channel === "gmail";
  const [reactFor, setReactFor] = useState<string | null>(null);

  // A thumbnail for a chosen photo; freed when the file changes.
  const preview = useMemo(() => (file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function choose(f: File | undefined) {
    if (!f) return;
    const problem = checkFileFor(conversation.channel, f);
    if (problem) return setSendError(problem);
    setSendError(null);
    setFile(f);
    box.current?.focus();
  }
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedReply[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiNote, setAiNote] = useState<{ missing: string[]; managerNeeded: boolean } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // When the current signed photo links were issued (they last an hour).
  const linkedAt = useRef(0);
  const load = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, direction, status, body, content_type, sender_name, sender_address, recipient_address, sent_by, provider_error, received_at, sent_at, created_at, external_message_id, raw_payload")
      .eq("conversation_id", conversation.id)
      .order("created_at");
    const rows = ((data ?? []) as Message[]).sort((a, b) => when(a).localeCompare(when(b)));
    // Stored copies of photos (the original Airbnb links expire after an hour).
    // WhatsApp photos, voice notes and files are stored copies too. Fetched
    // before the messages are shown, so the thread appears once, complete.
    if (conversation.channel === "whatsapp" || conversation.channel === "gmail" || rows.some((m) => parseMessage(m.body).images.length)) {
      const res = await api("/api/attachments", { json: { conversationId: conversation.id } });
      if (res.ok) {
        // Every call signs fresh links; keep the ones already on screen so the
        // photos don't reload (blink) on each live update, until they near expiry.
        const fresh = Date.now() - linkedAt.current > 45 * 60_000;
        if (fresh) linkedAt.current = Date.now();
        const keep = <T,>(prev: Record<string, T[]>, next: Record<string, T[]>) => {
          if (fresh) return next;
          const out: Record<string, T[]> = {};
          for (const [id, list] of Object.entries(next)) out[id] = prev[id]?.length === list.length ? prev[id] : list;
          return out;
        };
        setPhotos((prev) => keep(prev, res.data.byMessage ?? {}));
        setFiles((prev) => keep(prev, res.data.files ?? {}));
      }
    }
    setMessages(rows);
    setLoaded(true);
  }, [supabase, api, conversation.id, conversation.channel]);
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
    if ((!text && !file) || sending) return;
    setSending(true);
    setSendError(null);

    // A file goes straight to private storage first, then the send references it.
    let attachment: { path: string; name: string; type: string; size: number } | undefined;
    if (file) {
      const slot = await api("/api/attachments/upload", {
        json: { conversationId: conversation.id, name: file.name, type: file.type, size: file.size },
      });
      if (!slot.ok) {
        setSending(false);
        return setSendError(slot.data?.error ?? "The file could not be uploaded.");
      }
      const { error } = await supabase.storage
        .from("message-attachments")
        .uploadToSignedUrl(slot.data.path, slot.data.token, file, { contentType: file.type || "application/octet-stream" });
      if (error) {
        setSending(false);
        return setSendError(`The file could not be uploaded: ${error.message}`);
      }
      attachment = { path: slot.data.path, name: file.name, type: file.type, size: file.size };
    }

    const res = await api("/api/send", {
      json: {
        conversationId: conversation.id,
        body: text,
        clientKey: crypto.randomUUID(),
        ...(attachment ? { attachment } : {}),
        ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
        ...(isEmail && replyAll ? { replyAll: true } : {}),
        ...(isEmail && cc.trim() ? { cc } : {}),
        ...(isEmail && bcc.trim() ? { bcc } : {}),
      },
    });
    setSending(false);
    if (res.ok) {
      setDraft("");
      setFile(null);
      setReplyTo(null);
      setReplyAll(false);
      setCc("");
      setBcc("");
      setCcOpen(false);
      setAiNote(null);
    } else setSendError(res.data?.error ?? "The reply could not be sent.");
    load();
    onChanged();
  }

  // The AI fills the reply box only; staff edit it and press Send themselves.
  async function suggest() {
    if (drafting) return;
    if (draft.trim() && !window.confirm("Replace what you've written with an AI suggestion?")) return;
    setDrafting(true);
    setSendError(null);
    const res = await api("/api/ai/draft", { json: { conversationId: conversation.id } });
    setDrafting(false);
    if (!res.ok) {
      setSendError(res.data?.error ?? "Could not draft a reply.");
      return;
    }
    setDraft(res.data.reply);
    setAiNote({ missing: res.data.missing ?? [], managerNeeded: Boolean(res.data.manager_needed) });
    box.current?.focus();
  }

  async function react(messageId: string, emoji: string) {
    setReactFor(null);
    const res = await api("/api/whatsapp/react", { json: { messageId, emoji } });
    if (!res.ok) setSendError(res.data?.error ?? "The reaction could not be sent.");
    load();
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

  const author = (m: Message) => staff.find((s) => s.id === m.sent_by);
  // Replies sent from the Airbnb app or Beds24 arrive without a name: Beds24 does not say who wrote them.
  const replyLabel = (m: Message) =>
    m.sent_by ? `Replied by ${m.sent_by === profile.id ? "you" : (author(m)?.full_name ?? m.sender_name ?? "staff")}` : "Sent outside the inbox";

  const canReply = REPLYABLE.includes(conversation.channel);
  const lastEmailId = isEmail ? [...messages].reverse().find((m) => m.content_type !== "system")?.id : undefined;
  // Who a reply goes to, shown above the email composer.
  const lastInbound = isEmail ? [...messages].reverse().find((m) => m.direction === "inbound" && m.content_type !== "system") : undefined;
  const replyTarget = lastInbound?.sender_address || [...messages].reverse().find((m) => m.direction === "outbound")?.recipient_address || "";
  const replyCc = useMemo(() => {
    if (!lastInbound?.raw_payload) return [] as string[];
    const ours = new Set(messages.filter((m) => m.direction === "outbound" && m.sender_address).map((m) => m.sender_address!.toLowerCase()));
    const list = `${lastInbound.raw_payload.to ?? ""},${lastInbound.raw_payload.cc ?? ""}`.match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? [];
    return [...new Set(list.map((a) => a.toLowerCase()))].filter((a) => a !== replyTarget.toLowerCase() && !ours.has(a));
  }, [lastInbound, messages, replyTarget]);
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

  // Every photo in the conversation, oldest first, for the full-screen viewer.
  const gallery = useMemo<GalleryItem[]>(
    () =>
      messages.flatMap((m) => {
        if (m.content_type === "system") return [];
        const { text, images } = messageParts(m.body, photos[m.id], files[m.id]);
        const sender = m.direction === "inbound" ? guestName : m.sender_name || "Team";
        return images.map((img) => ({ ...img, caption: text, sender, at: when(m) }));
      }),
    [messages, photos, files, guestName],
  );
  const [viewer, setViewer] = useState<number | null>(null);
  const openPhoto = (src: string) => {
    const i = gallery.findIndex((g) => g.src === src);
    if (i >= 0) setViewer(i);
  };
  const hasPhotos = (m: Message) => messageParts(m.body, photos[m.id], files[m.id]).images.length > 0;
  // WhatsApp replies point at a message by its WhatsApp id.
  const byWamid = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) if (m.external_message_id?.startsWith("whatsapp:")) map.set(m.external_message_id.slice(9), m);
    return map;
  }, [messages]);
  const canQuote = (m: Message) => canWrite && conversation.channel === "whatsapp" && !!m.external_message_id?.startsWith("whatsapp:");
  const who = (m: Message) =>
    m.direction === "inbound"
      ? guestName
      : m.sent_by
        ? m.sent_by === profile.id
          ? "You"
          : (author(m)?.full_name ?? m.sender_name ?? "Team")
        : (m.sender_name ?? "Team");

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

      {viewer !== null && gallery[viewer] && (
        <PhotoViewer items={gallery} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}

      {/* messages */}
      <div
        className={cx("scroll-thin relative min-h-0 flex-1 overflow-y-auto py-4", isWa ? "bg-[#efeae2] px-[6%]" : "px-5")}
        style={isWa ? { backgroundImage: WA_WALLPAPER } : undefined}
      >
        {loaded && messages.length === 0 && <p className="text-center text-sm text-slate-500">No messages yet.</p>}
        {isEmail && conversation.subject && (
          <h2 className="mb-1 text-lg font-semibold text-slate-900">{conversation.subject.replace(/^(re|fw|fwd):\s*/i, "")}</h2>
        )}
        {rows.map(({ m, newDay, grouped }) => (
          <Fragment key={m.id}>
            {newDay && isWa ? (
              <div className="sticky top-0 z-10 my-3 flex justify-center">
                <span className="rounded-lg bg-white px-3 py-1 text-xs text-[#54656f] shadow-sm">{dayLabel(when(m))}</span>
              </div>
            ) : newDay && (
              <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                {dayLabel(when(m))}
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {m.content_type === "system" ? (
              <div
                className={cx(
                  "mx-auto my-2 w-fit max-w-[80%] rounded-lg px-3 py-1.5 text-center text-xs",
                  isWa ? "bg-[#ffeecd] text-[#54656f] shadow-sm" : "bg-slate-100 text-slate-500",
                )}
              >
                {m.body} · {clock(when(m))}
              </div>
            ) : isEmail ? (
              <div className="mt-3">
                <EmailCard
                  m={m}
                  name={m.direction === "inbound" ? m.sender_name || guestName : author(m)?.full_name ?? m.sender_name ?? "Team"}
                  avatar={m.direction === "outbound" ? author(m)?.avatar_url : null}
                  at={when(m)}
                  label={m.direction === "outbound" ? replyLabel(m) : undefined}
                  open={unfolded[m.id] ?? (m.id === lastEmailId || m.status === "failed")}
                  onToggle={() => setUnfolded((u) => ({ ...u, [m.id]: !(u[m.id] ?? (m.id === lastEmailId || m.status === "failed")) }))}
                  onReply={
                    canWrite && canReply
                      ? (all) => {
                          setReplyAll(all);
                          box.current?.focus();
                        }
                      : undefined
                  }
                  onRetry={canWrite ? () => retry(m.id) : undefined}
                  files={[
                    ...(photos[m.id] ?? []).map((url) => ({ url, type: "image/*", name: "Photo" })),
                    ...(files[m.id] ?? []),
                  ]}
                  onOpenPhoto={openPhoto}
                />
              </div>
            ) : (
              <div
                className={cx(
                  "flex items-end gap-2",
                  m.direction === "outbound" ? "justify-end" : "justify-start",
                  isWa ? (grouped ? "mt-0.5" : "mt-2.5") : grouped ? "mt-1" : "mt-3",
                )}
              >
                {m.direction === "inbound" && !isWa && (
                  <span className={cx("w-7 shrink-0", grouped && "invisible")}>
                    <Avatar name={guestName} size="sm" />
                  </span>
                )}
                <div className={cx("group relative", isWa ? "max-w-[65%]" : "max-w-[72%]", m.direction === "outbound" && "items-end")}>
                  {canQuote(m) && (
                    <div
                      className={cx(
                        "absolute top-1 z-10 flex gap-0.5 rounded-full bg-white p-0.5 opacity-0 shadow ring-1 ring-slate-200 transition group-hover:opacity-100 focus-within:opacity-100",
                        m.direction === "outbound" ? "right-full mr-1.5" : "left-full ml-1.5",
                        reactFor === m.id && "opacity-100",
                      )}
                    >
                      <button
                        type="button"
                        title="Reply"
                        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        onClick={() => {
                          setReplyTo(m);
                          box.current?.focus();
                        }}
                      >
                        <Reply className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        title="React"
                        className="rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                        onClick={() => setReactFor((id) => (id === m.id ? null : m.id))}
                      >
                        <SmilePlus className="h-4 w-4" />
                      </button>
                      {reactFor === m.id && (
                        <div className={cx("absolute bottom-full mb-1 flex gap-0.5 rounded-full bg-white p-1 shadow-lg ring-1 ring-slate-200", m.direction === "outbound" ? "right-0" : "left-0")}>
                          {REACTIONS.map((e) => (
                            <button
                              key={e}
                              type="button"
                              className={cx("rounded-full px-1.5 py-0.5 text-lg leading-none hover:bg-slate-100", m.raw_payload?.reactions?.team === e && "bg-indigo-50")}
                              onClick={() => react(m.id, m.raw_payload?.reactions?.team === e ? "" : e)}
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {isWa ? (
                    <WaBubble
                      m={m}
                      tail={!grouped}
                      name={m.direction === "outbound" && !grouped && m.sent_by !== profile.id ? who(m) : null}
                      title={m.direction === "outbound" ? replyLabel(m) : undefined}
                      photos={photos}
                      files={files}
                      onOpen={openPhoto}
                      quote={
                        m.raw_payload?.reply_to ? (
                          <Quote
                            quoted={byWamid.get(m.raw_payload.reply_to) ?? null}
                            who={(q) => who(q)}
                            dark={false}
                            padded={false}
                            photos={photos}
                            files={files}
                          />
                        ) : null
                      }
                    />
                  ) : (
                  <div
                    className={cx(
                      "rounded-2xl text-sm leading-relaxed shadow-sm",
                      hasPhotos(m) ? "w-72 max-w-full overflow-hidden" : "px-3.5 py-2",
                      m.direction === "outbound"
                        ? cx("bg-indigo-600 text-white", m.status === "failed" && "bg-red-600")
                        : cx("bg-white text-slate-900", !hasPhotos(m) && "ring-1 ring-slate-200"),
                    )}
                  >
                    {m.raw_payload?.reply_to && (
                      <Quote
                        quoted={byWamid.get(m.raw_payload.reply_to) ?? null}
                        who={(q) => who(q)}
                        dark={m.direction === "outbound"}
                        padded={hasPhotos(m)}
                        photos={photos}
                        files={files}
                      />
                    )}
                    <div className={cx(m.raw_payload?.deleted && "line-through opacity-60")}>
                      <MessageBody body={m.body} stored={photos[m.id]} files={files[m.id]} onOpen={openPhoto} />
                    </div>
                    {(m.raw_payload?.edited || m.raw_payload?.deleted) && (
                      <p
                        className={cx("mt-0.5 text-[11px] italic", m.direction === "outbound" ? "text-indigo-200" : "text-slate-400", hasPhotos(m) && "px-3.5 pb-2")}
                        title={m.raw_payload?.original_body && m.raw_payload.original_body !== m.body ? `First version: ${m.raw_payload.original_body}` : undefined}
                      >
                        {m.raw_payload?.deleted ? "Deleted on WhatsApp" : "Edited"}
                      </p>
                    )}
                  </div>
                  )}
                  {m.raw_payload?.reactions && Object.keys(m.raw_payload.reactions).length > 0 && (
                    <div className={cx("flex px-2", m.direction === "outbound" ? "justify-end" : "justify-start", isWa ? "relative z-1 -mt-1.5" : "-mt-2")}>
                      <span className="relative inline-flex gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-sm shadow ring-1 ring-slate-200">
                        {Object.entries(m.raw_payload.reactions).map(([by, e]) => (
                          <span key={by} title={by === "team" ? "Your team" : guestName}>{e}</span>
                        ))}
                      </span>
                    </div>
                  )}
                  {!isWa && (!grouped || m.status === "failed") ? (
                    <div className={cx("mt-1 flex items-center gap-1 px-1 text-[11px] text-slate-400", m.direction === "outbound" && "justify-end")}>
                      {m.direction === "outbound" && <span>{replyLabel(m)} ·</span>}
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
                {m.direction === "outbound" && !isWa && (
                  <span className={cx("w-7 shrink-0", grouped && "invisible")} title={replyLabel(m)}>
                    <Avatar name={author(m)?.full_name ?? "Host"} src={author(m)?.avatar_url} size="sm" />
                  </span>
                )}
              </div>
            )}
          </Fragment>
        ))}
        <div ref={bottom} />
      </div>

      {/* composer */}
      {canWrite && canReply ? (
        <form onSubmit={send} className={cx("border-t border-slate-200 px-5 py-3", isWa ? "bg-[#f0f2f5]" : "bg-white")}>
          {sendError && (
            <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" /> {sendError}
            </p>
          )}
          {aiNote && draft && (
            <div className="mb-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
              <span className="font-semibold">AI suggestion. Read it before sending.</span>
              {aiNote.missing.length > 0 && <> Fill in: {aiNote.missing.join(", ")}.</>}
              {aiNote.managerNeeded && <> The guest is asking for something a manager must approve.</>}
            </div>
          )}
          <div
            className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-indigo-500"
            onDragOver={(e) => canAttach && e.preventDefault()}
            onDrop={(e) => {
              if (!canAttach) return;
              e.preventDefault();
              choose(e.dataTransfer.files?.[0]);
            }}
          >
            {isEmail && replyTarget && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-3.5 py-2 text-xs text-slate-500">
                <span><span className="text-slate-400">To:</span> {replyTarget}</span>
                {replyAll && replyCc.length > 0 && <span><span className="text-slate-400">Cc:</span> {replyCc.join(", ")}</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  {replyCc.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setReplyAll((a) => !a)}
                      className={cx("rounded-md px-2 py-0.5 font-medium ring-1", replyAll ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}
                    >
                      {replyAll ? "Replying to all" : "Reply all"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCcOpen((o) => !o)}
                    className={cx("rounded-md px-2 py-0.5 font-medium ring-1", ccOpen ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "text-slate-600 ring-slate-200 hover:bg-slate-50")}
                  >
                    Cc / Bcc
                  </button>
                </span>
              </div>
            )}
            {isEmail && ccOpen && (
              <div className="space-y-1 border-b border-slate-100 px-3.5 py-2 text-xs">
                <label className="flex items-center gap-2">
                  <span className="w-8 text-slate-400">Cc</span>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="name@example.com, another@example.com"
                    className="min-w-0 flex-1 rounded-md border-0 bg-slate-50 px-2 py-1 text-xs text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-8 text-slate-400">Bcc</span>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="Hidden copy: others will not see these addresses"
                    className="min-w-0 flex-1 rounded-md border-0 bg-slate-50 px-2 py-1 text-xs text-slate-900 ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </label>
              </div>
            )}
            {replyTo && (
              <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
                <div className="min-w-0 flex-1 border-l-4 border-emerald-500 pl-2">
                  <p className="text-xs font-semibold text-emerald-700">Replying to {who(replyTo)}</p>
                  <p className="truncate text-xs text-slate-500">{messagePreview(replyTo.body)}</p>
                </div>
                <button type="button" onClick={() => setReplyTo(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Cancel reply">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {file && (
              <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                  <img src={preview} alt="" className="h-12 w-12 rounded-md object-cover" />
                ) : (
                  <span className="flex h-12 w-12 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                    <FileText className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                  <p className="text-xs text-slate-500">
                    {(file.size / 1024 / 1024).toFixed(1)} MB · {isEmail ? "attached to your reply" : "the text below is sent as its caption"}
                  </p>
                </div>
                <button type="button" onClick={() => setFile(null)} className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Remove file">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <textarea
              ref={box}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
              }}
              rows={2}
              maxLength={5000}
              placeholder={file && !isEmail ? "Add a caption (optional)…" :`Reply to ${guestName} on ${CHANNEL_LABEL[conversation.channel] ?? "this channel"}…`}
              className="block w-full resize-none rounded-t-xl border-0 bg-transparent px-3.5 pt-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              aria-label="Reply"
            />
            <div className="relative flex items-center gap-2 px-2 pb-2">
              {canAttach && (
                <>
                  <input
                    ref={picker}
                    type="file"
                    accept={isEmail ? undefined : ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      choose(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" onClick={() => picker.current?.click()} className={btn.ghost} title={isEmail ? "Attach a file (up to 20 MB)" : "Attach a photo, video, voice note or file"}>
                    <Paperclip className="h-4 w-4" /> Attach
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowSaved((s) => !s)}
                className={btn.ghost}
                aria-expanded={showSaved}
              >
                <BookOpen className="h-4 w-4" /> Saved replies
              </button>
              <button type="button" onClick={suggest} disabled={drafting} className={btn.ghost}>
                <Sparkles className="h-4 w-4" /> {drafting ? "Drafting…" : "Suggest reply"}
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
              <button type="submit" disabled={sending || (!draft.trim() && !file)} className={btn.primary}>
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

/** WhatsApp's beige chat wallpaper with a faint doodle pattern. */
/** Small line doodles (24×24 units) scattered over the wallpaper. Our own drawings, in WhatsApp's light style. */
const DOODLES = [
  "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8.5 10h.01M15.5 10h.01M8 14.5c2 2.5 6 2.5 8 0", // smiley
  "M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20z", // heart
  "M4 7h16v11H4zM4 7l8 6 8-6", // envelope
  "M7 4h10v16H7zM11 17h2", // phone
  "M12 3l2.6 5.6 6 .6-4.5 4 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.5-4 6-.6z", // star
  "M5 8h3l2-3h4l2 3h3v11H5zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", // camera
  "M9 18V6l10-2v12M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM19 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z", // music
  "M6 18c-2 0-3-1.5-3-3.5S4.5 11 6.5 11C7 8 9 6 12 6s5 2 5.5 5c2 0 3.5 1.5 3.5 3.5S20 18 18 18z", // cloud
  "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", // sun
  "M4 14h13a3 3 0 0 0 3-3V8H4zM20 9h1a2 2 0 0 1 0 4h-1M7 18h8", // cup
  "M3 12l8-8h6l4 4v6l-8 8zM15 8h.01", // tag
  "M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4z", // pin
  "M5 21V4M5 4h12l-2 4 2 4H5", // flag
  "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v10H5zM12 14v2", // lock
  "M4 6h16v10H8l-4 4z", // speech bubble
  "M12 4a4 4 0 0 0-4 4v4l-2 3h12l-2-3V8a4 4 0 0 0-4-4zM10 18a2 2 0 0 0 4 0", // bell
  "M3 10l9-6 9 6M5 9v11h14V9M10 20v-6h4v6", // house
  "M14 4l6 6-9 9H5v-6zM12 6l6 6", // pencil
  "M6 4h12M6 20h12M7 4c0 5 10 5 10 8s-10 3-10 8M17 4c0 5-10 5-10 8", // hourglass
  "M12 4l2 4h4l-3 3 1 5-4-2-4 2 1-5-3-3h4z", // small star
  "M8 3h8l-1 7a3 3 0 0 1-6 0zM12 13v6M8 21h8", // glass
  "M3 17l6-6 4 4 8-8M15 7h6v6", // chart
];
const WA_DOODLES = (() => {
  const size = 360;
  const step = 45;
  // A fixed pseudo-random sequence: the same wallpaper on every load, but no visible rows.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let out = "";
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const ox = x + rand() * 22 - 6;
      const oy = y + rand() * 22 - 6;
      const angle = Math.round(rand() * 80 - 40);
      const scale = (1 + rand() * 0.45).toFixed(2);
      const d = DOODLES[Math.floor(rand() * DOODLES.length)];
      out += `<path transform='translate(${ox.toFixed(1)} ${oy.toFixed(1)}) rotate(${angle} 12 12) scale(${scale})' d='${d}'/>`;
      // Tiny dots and dashes in the gaps, like WhatsApp's filler.
      const fx = (x + step * 0.75 + rand() * 6).toFixed(1);
      const fy = (y + step * 0.8 + rand() * 6).toFixed(1);
      out += rand() > 0.5 ? `<circle cx='${fx}' cy='${fy}' r='1.6'/>` : `<path d='M${fx} ${fy}l4 -3'/>`;
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' fill='none' stroke='#d3c8b6' stroke-width='1.25' stroke-linecap='round' stroke-linejoin='round'>${out}</svg>`;
})();
const WA_WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(WA_DOODLES)}")`;

/** WhatsApp ticks: one grey (sent), two grey (delivered), two blue (read). */
function WaTicks({ status }: { status: Message["status"] }) {
  const label = { pending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" }[status];
  const Icon = status === "pending" ? Clock : status === "failed" ? AlertCircle : status === "sent" ? Check : CheckCheck;
  return (
    <span title={label} className={cx("inline-flex", status === "read" ? "text-[#53bdeb]" : status === "failed" ? "text-red-600" : "")}>
      <Icon className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One WhatsApp message, drawn like the WhatsApp app: green (ours) or white bubble, tail, time and ticks inside. */
function WaBubble({
  m,
  tail,
  name,
  title,
  photos,
  files,
  onOpen,
  quote,
}: {
  m: Message;
  tail: boolean;
  name: string | null;
  title?: string;
  photos: Record<string, string[]>;
  files: Record<string, StoredFile[]>;
  onOpen: (src: string) => void;
  quote: ReactNode;
}) {
  const out = m.direction === "outbound";
  const { text, images } = messageParts(m.body, photos[m.id], files[m.id]);
  const edited = !!m.raw_payload?.edited && !m.raw_payload?.deleted;
  const deleted = !!m.raw_payload?.deleted;
  const note = deleted ? "Deleted" : edited ? "Edited" : "";
  const where: "text" | "photo" | "below" = text ? "text" : images.length ? "photo" : "below";
  // Room at the end of the last line, so the time sits beside the text like on WhatsApp.
  const spacer = <span aria-hidden className="inline-block align-bottom" style={{ width: (out ? 70 : 50) + (note ? 46 : 0) }} />;
  const bg = out ? "bg-[#d9fdd3]" : "bg-white";

  return (
    <div
      title={title}
      className={cx(
        "relative rounded-lg text-[14.2px] leading-4.75 text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
        bg,
        tail && (out ? "rounded-tr-none" : "rounded-tl-none"),
        images.length ? "w-72 max-w-full p-0.75" : "px-2 pt-1.5 pb-2",
        m.status === "failed" && "ring-1 ring-red-400",
      )}
    >
      {tail && (
        <span
          aria-hidden
          className={cx(
            "absolute top-0 h-3 w-2",
            bg,
            out ? "-right-2 [clip-path:polygon(0_0,100%_0,0_100%)]" : "-left-2 [clip-path:polygon(0_0,100%_0,100%_100%)]",
          )}
        />
      )}
      {name && <p className={cx("mb-0.5 text-[12.8px] font-medium text-[#027eb5]", images.length > 0 && "px-1.5 pt-1")}>{name}</p>}
      {quote}
      <div
        className={cx(deleted && "text-[#667781] line-through")}
        title={m.raw_payload?.original_body && m.raw_payload.original_body !== m.body ? `First version: ${m.raw_payload.original_body}` : undefined}
      >
        <MessageBody body={m.body} stored={photos[m.id]} files={files[m.id]} onOpen={onOpen} tail={where === "text" ? spacer : undefined} compact />
      </div>
      <span
        className={cx(
          "flex items-center gap-1 text-[11px] leading-none whitespace-nowrap",
          where === "below" ? "mt-1 justify-end" : "absolute",
          where === "text" && (images.length ? "right-2.5 bottom-2" : "right-2 bottom-1.5"),
          where === "photo" && "right-2.5 bottom-2 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]",
          where !== "photo" && "text-[#667781]",
        )}
      >
        {note && <span className="italic">{note}</span>}
        {clock(when(m))}
        {out && <WaTicks status={m.status} />}
      </span>
    </div>
  );
}

/** Text plus any photos (Airbnb sends them as links); the HTML itself is never rendered. */
type StoredFile = { url: string; type: string; name: string };

/** WhatsApp bodies start with a label ("📷 Photo") that the real photo or player replaces. */
const MEDIA_LABEL = /^(📷 Photo|🎥 Video|🎤 Voice message|📎 Document(?: \([^)]*\))?|Sticker)\n?/u;

/** The text and photos of one message: stored copies win over the original (expiring) links. */
function messageParts(body: string | null, stored?: string[], files?: StoredFile[]): { text: string; images: MessageImage[] } {
  const parsed = parseMessage(body);
  const text = stored?.length || files?.length ? parsed.text.replace(MEDIA_LABEL, "").trim() : parsed.text;
  const images: MessageImage[] = stored?.length ? stored.map((url) => ({ src: url, href: url })) : parsed.images;
  return { text, images };
}

function MessageBody({
  body,
  stored,
  files,
  onOpen,
  tail,
  compact,
}: {
  body: string | null;
  stored?: string[];
  files?: StoredFile[];
  onOpen?: (src: string) => void;
  /** Placed at the end of the text (room for the time in a WhatsApp bubble). */
  tail?: ReactNode;
  /** WhatsApp bubble: tighter caption, rounded photos. */
  compact?: boolean;
}) {
  const { text, images } = messageParts(body, stored, files);
  if (images.length) {
    // WhatsApp style: the photo fills the bubble, the caption sits underneath.
    return (
      <>
        <div className={cx("grid gap-0.5", images.length > 1 && "grid-cols-2", compact && "overflow-hidden rounded-md")}>
          {images.map((img) => (
            <Photo key={img.src} image={img} onOpen={onOpen} />
          ))}
        </div>
        {text && (
          <p className={cx("whitespace-pre-wrap wrap-break-word", compact ? "px-1.5 pt-1.5 pb-1" : "px-3 py-2")}>
            {text}
            {tail}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      {text && (
        <p className="whitespace-pre-wrap wrap-break-word">
          {text}
          {tail}
        </p>
      )}
      {files?.map((f) => (
        <div key={f.url} className={cx(text || images.length ? "mt-2" : "")}>
          {f.type.startsWith("audio/") ? (
            <audio controls preload="none" src={f.url} className="max-w-full" />
          ) : f.type.startsWith("video/") ? (
            <video controls preload="metadata" src={f.url} className="max-h-64 max-w-full rounded-lg" />
          ) : (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1.5 text-xs underline">
              📎 {f.name}
            </a>
          )}
        </div>
      ))}
    </>
  );
}

function Photo({ image, onOpen }: { image: MessageImage; onOpen?: (src: string) => void }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    // Airbnb photo links are signed and expire after a while.
    return (
      <a href={image.href} target="_blank" rel="noopener noreferrer" className="m-2 inline-flex items-center gap-1.5 rounded-lg bg-black/10 px-2.5 py-1.5 text-xs underline">
        <ImageOff className="h-3.5 w-3.5" /> Photo expired (view it in Airbnb)
      </a>
    );
  }
  return (
    <a
      href={image.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (!onOpen) return;
        e.preventDefault();
        onOpen(image.src);
      }}
      className="block cursor-zoom-in bg-black/5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- signed third-party URLs; next/image would need every host whitelisted */}
      <img
        src={image.src}
        alt="Photo in conversation"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="block max-h-80 w-full object-cover"
      />
    </a>
  );
}

type GalleryItem = MessageImage & { caption: string; sender: string; at: string };

/** Full-screen photo viewer, WhatsApp style: arrows or ← → to move, Esc to close, thumbnails below. */
function PhotoViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const strip = useRef<HTMLDivElement>(null);
  const go = useCallback((d: number) => onIndex(Math.min(items.length - 1, Math.max(0, index + d))), [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);

  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [index]);

  if (!item) return null;

  async function download() {
    try {
      const res = await fetch(item.href);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photo-${item.at.slice(0, 10)}.${(blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg")}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(item.href, "_blank", "noopener,noreferrer"); // links that refuse cross-site reads
    }
  }

  const iconBtn = "rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white";
  const navBtn = "absolute rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20";
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{item.sender}</p>
          <p className="text-xs text-white/60">
            {dayLabel(item.at)} at {clock(item.at)}
            {items.length > 1 && ` · ${index + 1} of ${items.length}`}
          </p>
        </div>
        <button className={iconBtn} onClick={download} title="Download">
          <Download className="h-5 w-5" />
        </button>
        <a className={iconBtn} href={item.href} target="_blank" rel="noopener noreferrer" title="Open in new tab">
          <ExternalLink className="h-5 w-5" />
        </a>
        <button className={iconBtn} onClick={onClose} title="Close (Esc)">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-16">
        {index > 0 && (
          <button
            className={cx(navBtn, "left-3")}
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            title="Previous (←)"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage / third-party URLs */}
        <img
          src={item.src}
          alt="Photo in conversation"
          referrerPolicy="no-referrer"
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
        {index < items.length - 1 && (
          <button
            className={cx(navBtn, "right-3")}
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            title="Next (→)"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {item.caption && <p className="mx-auto max-w-2xl px-4 pt-3 text-center text-sm whitespace-pre-wrap text-white/90">{item.caption}</p>}
        {items.length > 1 ? (
          <div ref={strip} className="mt-3 flex justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-3">
            {items.map((g, i) => (
              <button
                key={g.src}
                data-i={i}
                onClick={() => onIndex(i)}
                className={cx(
                  "h-14 w-14 shrink-0 overflow-hidden rounded-md ring-2",
                  i === index ? "ring-emerald-400" : "opacity-60 ring-transparent hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails of the same signed URLs */}
                <img src={g.src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <div className="h-4" />
        )}
      </div>
    </div>
  );
}

/** The message a WhatsApp reply quotes, shown at the top of the bubble (WhatsApp style). */
function Quote({
  quoted,
  who,
  dark,
  padded,
  photos,
  files,
}: {
  quoted: Message | null;
  who: (m: Message) => string;
  dark: boolean;
  padded: boolean;
  photos: Record<string, string[]>;
  files: Record<string, StoredFile[]>;
}) {
  const fromGuest = quoted?.direction === "inbound";
  // Guest messages get a green bar and name, the team's a blue one — like WhatsApp's per-sender colours.
  const bar = fromGuest ? (dark ? "bg-emerald-300" : "bg-emerald-500") : dark ? "bg-sky-300" : "bg-indigo-500";
  const name = fromGuest ? (dark ? "text-emerald-200" : "text-emerald-700") : dark ? "text-sky-200" : "text-indigo-700";

  let icon = "";
  let line = "";
  let thumb: string | undefined;
  if (quoted) {
    const body = quoted.body ?? "";
    const label = body.match(MEDIA_LABEL)?.[1] ?? "";
    icon = label ? label.split(" ")[0] : "";
    const { text, images } = messageParts(body, photos[quoted.id], files[quoted.id]);
    const caption = (label ? body.replace(MEDIA_LABEL, "").trim() : text) || "";
    line = caption || (label ? label.replace(/^\S+\s/, "") : messagePreview(body)) || (images.length ? "Photo" : "");
    if (images.length && !icon) icon = "📷";
    thumb = images[0]?.src;
  }

  return (
    <div
      className={cx(
        "mb-1.5 flex overflow-hidden rounded-lg text-xs",
        dark ? "bg-black/20 text-white/85" : "bg-slate-100 text-slate-600",
        padded && "m-1.5 mb-0",
      )}
    >
      <span className={cx("w-1 shrink-0", bar)} aria-hidden />
      <div className="min-w-0 flex-1 px-2 py-1.5">
        {quoted ? (
          <>
            <p className={cx("truncate font-semibold", name)}>{who(quoted)}</p>
            <p className="line-clamp-2 whitespace-pre-wrap">
              {icon && <span className="mr-1">{icon}</span>}
              {line}
            </p>
          </>
        ) : (
          <p className="italic">A message that is not in this conversation</p>
        )}
      </div>
      {thumb && (
        // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
        <img src={thumb} alt="" referrerPolicy="no-referrer" className="h-14 w-14 shrink-0 object-cover" />
      )}
    </div>
  );
}
