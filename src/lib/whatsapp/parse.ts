/**
 * WhatsApp Cloud API webhooks (as relayed by 360dialog) -> plain events.
 *
 * One delivery can carry several changes. We keep three kinds:
 *   message  a guest wrote to the business number
 *   echo     the team replied from the WhatsApp Business app on the phone
 *            (Coexistence sends these as `smb_message_echoes`)
 *   status   WhatsApp's sent / delivered / read / failed for a message we sent
 * Everything else (history sync, contact sync, account updates) is ignored.
 *
 * Pure: no database, no network, so it can be tested on its own.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped webhook body */

export type WaMessage = {
  kind: "message" | "echo";
  id: string;
  /** The guest's WhatsApp number (digits only, international, no +). */
  guest: string;
  guestName: string;
  at: string;
  text: string;
  type: string;
  businessNumber: string;
  /** A photo or file to download through 360dialog (WhatsApp media ids expire after ~30 days). */
  media?: { id: string; mime: string; filename?: string };
  /** The WhatsApp id (wamid) of the message this one replies to. */
  replyTo?: string;
};

/** A reaction (emoji) on a message; an empty emoji removes it. */
export type WaReaction = {
  kind: "reaction";
  target: string;
  emoji: string;
  by: "guest" | "team";
  guest: string;
};

export type WaStatus = {
  kind: "status";
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  at: string;
  guest: string;
  error: string | null;
};

/**
 * The guest (or the team on the phone app) edited or deleted an earlier
 * message. Shown on that message, never as a bubble of its own.
 * `text` is the new text for an edit; null for a delete (revoke).
 */
export type WaChange = {
  kind: "change";
  target: string;
  text: string | null;
  guest: string;
};

export type WaEvent = WaMessage | WaStatus | WaReaction | WaChange;

/** Meta: type "edit" -> edit.{original_message_id, message}; type "revoke" -> revoke.original_message_id. */
function changeOf(m: any, guest: string): WaChange | null {
  if (m?.type !== "edit" && m?.type !== "revoke") return null;
  const box = m[m.type] ?? {};
  const target = box.original_message_id ?? box.message_id ?? m.context?.id;
  if (!target) return null;
  if (m.type === "revoke") return { kind: "change", target: String(target), text: null, guest };
  const inner = box.message ?? {};
  const text = messageText({ ...inner, type: inner.type ?? (inner.text ? "text" : "") });
  return { kind: "change", target: String(target), text, guest };
}

const MEDIA_LABEL: Record<string, string> = {
  image: "📷 Photo",
  video: "🎥 Video",
  audio: "🎤 Voice message",
  voice: "🎤 Voice message",
  document: "📎 Document",
  sticker: "Sticker",
  location: "📍 Location",
  contacts: "👤 Contact card",
};

const iso = (ts: unknown) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};

export const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/** The readable text of one WhatsApp message, whatever its type. */
export function messageText(m: any): string {
  const type = String(m?.type ?? "");
  if (type === "text") return String(m.text?.body ?? "").trim();
  if (type === "button") return String(m.button?.text ?? "").trim();
  if (type === "interactive") {
    const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
    return String(r?.title ?? "").trim() || "(button reply)";
  }
  if (type === "reaction") return m.reaction?.emoji ? `Reacted ${m.reaction.emoji}` : "Removed a reaction";
  if (type === "location") {
    const l = m.location ?? {};
    const name = [l.name, l.address].filter(Boolean).join(", ");
    return `📍 ${name || `${l.latitude}, ${l.longitude}`}`;
  }
  if (MEDIA_LABEL[type]) {
    const media = m[type] ?? {};
    const caption = String(media.caption ?? "").trim();
    const file = type === "document" && media.filename ? ` (${media.filename})` : "";
    return [MEDIA_LABEL[type] + file, caption].filter(Boolean).join("\n");
  }
  if (type === "unsupported" || type === "unknown") return "(a message type WhatsApp can't show here)";
  return `(${type || "message"})`;
}

/** The downloadable media in a message, if any. */
export function messageMedia(m: any): WaMessage["media"] {
  const type = String(m?.type ?? "");
  if (!MEDIA_LABEL[type] || type === "location" || type === "contacts") return undefined;
  const media = m[type];
  if (!media?.id) return undefined;
  return { id: String(media.id), mime: String(media.mime_type ?? ""), ...(media.filename ? { filename: String(media.filename) } : {}) };
}

function errorText(s: any): string | null {
  const e = s?.errors?.[0];
  if (!e) return null;
  return String(e.error_data?.details || e.message || e.title || `WhatsApp error ${e.code}`);
}

export function parseWebhook(body: any): WaEvent[] {
  const events: WaEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value ?? {};
      const business = digits(value.metadata?.display_phone_number);
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) names.set(digits(c.wa_id), String(c.profile?.name ?? "").trim());

      if (change.field === "messages") {
        for (const m of value.messages ?? []) {
          if (!m?.id || !m.from) continue;
          const guest = digits(m.from);
          if (m.type === "reaction" && m.reaction?.message_id) {
            events.push({ kind: "reaction", target: String(m.reaction.message_id), emoji: String(m.reaction.emoji ?? ""), by: "guest", guest });
            continue;
          }
          const change = changeOf(m, guest);
          if (change) {
            events.push(change);
            continue;
          }
          events.push({
            kind: "message",
            id: String(m.id),
            guest,
            guestName: names.get(guest) || "",
            at: iso(m.timestamp),
            text: messageText(m),
            type: String(m.type ?? ""),
            businessNumber: business,
            ...(messageMedia(m) ? { media: messageMedia(m) } : {}),
            ...(m.context?.id ? { replyTo: String(m.context.id) } : {}),
          });
        }
        for (const s of value.statuses ?? []) {
          if (!s?.id || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
          events.push({
            kind: "status",
            id: String(s.id),
            status: s.status,
            at: iso(s.timestamp),
            guest: digits(s.recipient_id),
            error: s.status === "failed" ? errorText(s) : null,
          });
        }
      } else if (change.field === "smb_message_echoes") {
        for (const m of value.message_echoes ?? []) {
          if (!m?.id || !m.to) continue;
          const guest = digits(m.to);
          if (m.type === "reaction" && m.reaction?.message_id) {
            events.push({ kind: "reaction", target: String(m.reaction.message_id), emoji: String(m.reaction.emoji ?? ""), by: "team", guest });
            continue;
          }
          const change = changeOf(m, guest);
          if (change) {
            events.push(change);
            continue;
          }
          events.push({
            kind: "echo",
            id: String(m.id),
            guest,
            guestName: names.get(guest) || "",
            at: iso(m.timestamp),
            text: messageText(m),
            type: String(m.type ?? ""),
            businessNumber: business || digits(m.from),
            ...(messageMedia(m) ? { media: messageMedia(m) } : {}),
            ...(m.context?.id ? { replyTo: String(m.context.id) } : {}),
          });
        }
      }
    }
  }
  return events;
}

/** A plain-language reason for a failed send, from 360dialog / Meta's error body. */
export function sendErrorText(data: any, httpStatus: number): string {
  const e = data?.error ?? data?.errors?.[0] ?? data?.meta;
  const code = Number(e?.code);
  // 131047: more than 24 hours since the guest last wrote.
  if (code === 131047 || /24 hours|re-engagement/i.test(String(e?.message ?? e?.error_data?.details ?? ""))) {
    return "More than 24 hours since the guest last wrote. WhatsApp only allows an approved template now; reply from the WhatsApp Business app or wait for the guest to write again.";
  }
  if (httpStatus === 401 || httpStatus === 403) return "360dialog refused the API key. Check D360_API_KEY.";
  const detail = e?.error_data?.details || e?.message || e?.title || e?.developer_message;
  return detail ? `WhatsApp: ${detail}` : `WhatsApp did not accept the message (HTTP ${httpStatus}).`;
}
