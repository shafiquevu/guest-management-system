import "server-only";

import { BUCKET, ensureBucket } from "@/lib/attachments";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/sync/beds24";
import { downloadMedia } from "@/lib/whatsapp/client";
import type { WaEvent, WaMessage, WaReaction, WaStatus } from "@/lib/whatsapp/parse";

/**
 * WhatsApp webhook events -> Supabase.
 *
 * One conversation per guest number, keyed `whatsapp:<digits>`; every message
 * is keyed `whatsapp:<wamid>` and written with ON CONFLICT DO NOTHING, so a
 * repeated webhook delivery never creates a duplicate.
 *
 * A new number is matched to an existing guest by phone (from their booking),
 * which links the chat to that guest's latest reservation and property.
 * Status and assignment belong to the staff; a new guest message reopens a
 * resolved conversation.
 */

export type WaReport = { messagesAdded: number; statusesApplied: number; reactionsApplied: number; conversationsTouched: number; ignored?: string };

type Connection = { id: string; organization_id: string; external_phone_number: string | null };

export async function whatsappConnection(): Promise<Connection | null> {
  const { data } = await supabaseAdmin()
    .from("channel_connections")
    .select("id, organization_id, external_phone_number")
    .eq("channel", "whatsapp")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Connection) ?? null;
}

export async function ingestWhatsApp(events: WaEvent[]): Promise<WaReport> {
  const report: WaReport = { messagesAdded: 0, statusesApplied: 0, reactionsApplied: 0, conversationsTouched: 0 };
  if (!events.length) return report;
  const conn = await whatsappConnection();
  if (!conn) return { ...report, ignored: "WhatsApp is not connected in Settings" };

  const messages = events.filter((e): e is WaMessage => e.kind === "message" || e.kind === "echo");
  const byGuest = new Map<string, WaMessage[]>();
  for (const m of messages) (byGuest.get(m.guest) ?? byGuest.set(m.guest, []).get(m.guest)!).push(m);
  for (const [guest, list] of byGuest) {
    report.messagesAdded += await saveMessages(conn, guest, list);
    report.conversationsTouched++;
  }

  for (const s of events.filter((e): e is WaStatus => e.kind === "status")) {
    if (await applyStatus(conn.organization_id, s)) report.statusesApplied++;
  }

  // After the messages, so a reaction to a message in the same delivery finds it.
  for (const r of events.filter((e): e is WaReaction => e.kind === "reaction")) {
    if (await applyReaction(conn.organization_id, r)) report.reactionsApplied++;
  }

  const business = messages.find((m) => m.businessNumber)?.businessNumber;
  await supabaseAdmin()
    .from("channel_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_error: null,
      ...(business && !conn.external_phone_number ? { external_phone_number: `+${business}` } : {}),
    })
    .eq("id", conn.id);
  return report;
}

async function saveMessages(conn: Connection, guest: string, list: WaMessage[]): Promise<number> {
  const db = supabaseAdmin();
  const orgId = conn.organization_id;
  const threadKey = `whatsapp:${guest}`;
  const name = list.find((m) => m.guestName)?.guestName ?? "";

  let { data: conversation } = await db
    .from("conversations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("channel", "whatsapp")
    .eq("external_thread_id", threadKey)
    .maybeSingle();

  if (!conversation) {
    const guestId = await ensureGuest(orgId, guest, name);
    const { data: reservation } = await db
      .from("reservations")
      .select("id, property_id")
      .eq("organization_id", orgId)
      .eq("guest_id", guestId)
      .order("check_in", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await db
      .from("conversations")
      .upsert(
        {
          organization_id: orgId,
          channel_connection_id: conn.id,
          channel: "whatsapp",
          external_thread_id: threadKey,
          guest_id: guestId,
          reservation_id: reservation?.id ?? null,
          property_id: reservation?.property_id ?? null,
          subject: `WhatsApp · ${name || `+${guest}`}`,
        },
        { onConflict: "organization_id,channel,external_thread_id" },
      )
      .select("id, status")
      .single();
    if (error || !data) throw new Error(`conversation: ${error?.message}`);
    conversation = data;
  }

  const rows = list.map((m) => {
    const ours = m.kind === "echo";
    return {
      organization_id: orgId,
      conversation_id: conversation!.id,
      channel: "whatsapp",
      external_message_id: `whatsapp:${m.id}`,
      direction: ours ? "outbound" : "inbound",
      status: ours ? "sent" : "delivered",
      sender_name: ours ? "Team (WhatsApp app)" : m.guestName || `+${m.guest}`,
      sender_address: ours ? (m.businessNumber ? `+${m.businessNumber}` : null) : `+${m.guest}`,
      recipient_address: ours ? `+${m.guest}` : m.businessNumber ? `+${m.businessNumber}` : null,
      body: m.text || "(empty message)",
      content_type: "text",
      raw_payload: {
        id: m.id,
        type: m.type,
        kind: m.kind,
        ...(m.media ? { media: m.media } : {}),
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      },
      received_at: ours ? null : m.at,
      sent_at: ours ? m.at : null,
    };
  });
  const { data: inserted, error } = await db
    .from("messages")
    .upsert(rows, { onConflict: "organization_id,channel,external_message_id", ignoreDuplicates: true })
    .select("id, direction, external_message_id");
  if (error) throw new Error(`messages: ${error.message}`);

  const byExt = new Map(list.map((m) => [`whatsapp:${m.id}`, m]));
  for (const row of inserted ?? []) {
    const media = byExt.get(row.external_message_id)?.media;
    if (media) await saveMedia(orgId, row.id, media);
  }

  const newInbound = (inserted ?? []).filter((r) => r.direction === "inbound").length;
  const reopen = newInbound > 0 && ["resolved", "archived"].includes(conversation.status);
  await refreshConversation(conversation.id, reopen);
  return inserted?.length ?? 0;
}

const RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/** Delivery receipts for messages we sent. Never moves a message backwards (read stays read). */
async function applyStatus(orgId: string, s: WaStatus): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: msg } = await db
    .from("messages")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("channel", "whatsapp")
    .eq("external_message_id", `whatsapp:${s.id}`)
    .maybeSingle();
  if (!msg) return false;

  if (s.status === "failed") {
    await db.from("messages").update({ status: "failed", provider_error: s.error ?? "WhatsApp could not deliver this message." }).eq("id", msg.id);
    return true;
  }
  if ((RANK[s.status] ?? 0) <= (RANK[msg.status] ?? 0)) return false;
  await db
    .from("messages")
    .update({
      status: s.status,
      ...(s.status === "delivered" ? { delivered_at: s.at } : {}),
      ...(s.status === "read" ? { read_at: s.at } : {}),
    })
    .eq("id", msg.id);
  return true;
}

/** The guest behind a WhatsApp number: an existing one (matched by phone from a booking) if we know it. */
async function ensureGuest(orgId: string, number: string, name: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: known } = await db
    .from("guest_identities")
    .select("guest_id")
    .eq("organization_id", orgId)
    .eq("channel", "whatsapp")
    .eq("address", number)
    .maybeSingle();
  if (known?.guest_id) return known.guest_id;

  // Booking phones are stored as typed (+44 7700…, 07700…), so match on the last 9 digits.
  let guestId: string | null = null;
  if (number.length >= 9) {
    const { data: phones } = await db
      .from("guest_identities")
      .select("guest_id, address")
      .eq("organization_id", orgId)
      .eq("channel", "phone")
      .like("address", `%${number.slice(-9)}`)
      .limit(5);
    const ids = [...new Set((phones ?? []).map((p) => p.guest_id))];
    if (ids.length === 1) guestId = ids[0]; // two different guests on one number: don't guess
  }

  if (!guestId) {
    const { data, error } = await db
      .from("guests")
      .upsert(
        { organization_id: orgId, external_id: `whatsapp:${number}`, full_name: name || `+${number}`, phone: `+${number}` },
        { onConflict: "organization_id,external_id" },
      )
      .select("id")
      .single();
    if (error || !data) throw new Error(`guest: ${error?.message}`);
    guestId = data.id as string;
  }

  await db
    .from("guest_identities")
    .upsert(
      [
        { organization_id: orgId, guest_id: guestId, channel: "whatsapp", address: number },
        { organization_id: orgId, guest_id: guestId, channel: "phone", address: `+${number}` },
      ],
      { onConflict: "organization_id,channel,address", ignoreDuplicates: true },
    );
  return guestId;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
};

/** Copy a guest's photo / voice note / video / file into private storage. Never throws. */
async function saveMedia(orgId: string, messageId: string, media: NonNullable<WaMessage["media"]>) {
  try {
    await ensureBucket();
    const { bytes, type } = await downloadMedia(media.id);
    if (bytes.byteLength > 20 * 1024 * 1024) return; // the bucket's limit
    const safe = (media.filename ?? "").replace(/[^\w.\- ]+/g, "").trim();
    const name = safe || `${type.split("/")[0] || "file"}.${EXT[type] ?? "bin"}`;
    const path = `${orgId}/${messageId}/${name}`;
    const db = supabaseAdmin();
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    if (error) throw new Error(error.message);
    await db.from("message_attachments").insert({
      organization_id: orgId,
      message_id: messageId,
      file_name: name,
      file_type: type,
      file_size: bytes.byteLength,
      storage_path: path,
    });
  } catch (e) {
    console.error("whatsapp media", media.id, e instanceof Error ? e.message : e);
  }
}

/**
 * A reaction from the guest (or from the team on the phone app) is shown on
 * the message it reacts to, not as a message of its own. Kept in
 * raw_payload.reactions as { guest: "👍", team: "❤️" }; an empty emoji removes it.
 */
export async function applyReaction(orgId: string, r: Pick<WaReaction, "target" | "emoji" | "by">): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: msg } = await db
    .from("messages")
    .select("id, raw_payload")
    .eq("organization_id", orgId)
    .eq("channel", "whatsapp")
    .eq("external_message_id", `whatsapp:${r.target}`)
    .maybeSingle();
  if (!msg) return false;
  const raw = (msg.raw_payload ?? {}) as Record<string, unknown>;
  const reactions = { ...((raw.reactions ?? {}) as Record<string, string>) };
  if (r.emoji) reactions[r.by] = r.emoji;
  else delete reactions[r.by];
  await db.from("messages").update({ raw_payload: { ...raw, reactions } }).eq("id", msg.id);
  return true;
}
