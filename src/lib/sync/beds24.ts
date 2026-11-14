import "server-only";

import { beds24All, type Beds24Booking, type Beds24Message, type Beds24Property } from "@/lib/beds24/client";
import {
  channelForBooking,
  directionFor,
  guestName,
  messageId,
  nightsGuests,
  normaliseEmail,
  normalisePhone,
  safeBooking,
  sameText,
  threadId,
  type Channel,
} from "@/lib/beds24/map";
import { savePhotos } from "@/lib/attachments";
import { organizationId, supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Beds24 -> Supabase.
 *
 * One conversation per booking (Beds24 keeps one message thread per booking),
 * keyed `beds24:<bookingId>`. Every message is keyed `beds24:<messageId>` and
 * written with ON CONFLICT DO NOTHING, so a webhook retry, an overlapping poll
 * and a manual "Sync now" can all run on the same data without duplicating a
 * single line.
 *
 * Status and assignment are never overwritten by a sync -- those belong to the
 * staff. A new guest message does reopen a resolved conversation.
 */

export type SyncReport = {
  messagesSeen: number;
  messagesAdded: number;
  repliesMatched: number;
  conversationsTouched: number;
  conversationsReopened: number;
  errors: string[];
};

type Options = {
  /** Only these bookings (webhook). Otherwise every booking with recent messages. */
  bookingIds?: number[];
  /** How far back to look, in days. */
  maxAgeDays?: number;
};

const ALL_STATUSES = ["confirmed", "request", "new", "cancelled", "black", "inquiry"];

export async function syncBeds24(options: Options = {}): Promise<SyncReport> {
  const db = supabaseAdmin();
  const orgId = await organizationId();
  const report: SyncReport = {
    messagesSeen: 0,
    messagesAdded: 0,
    repliesMatched: 0,
    conversationsTouched: 0,
    conversationsReopened: 0,
    errors: [],
  };

  const connectionId = await ensureConnection(orgId);

  try {
    const messages = await beds24All<Beds24Message>("/bookings/messages", {
      maxAge: Math.min(Math.max(options.maxAgeDays ?? 3, 1), 999),
      bookingId: options.bookingIds?.length ? options.bookingIds : undefined,
    });
    report.messagesSeen = messages.length;

    const byBooking = new Map<number, Beds24Message[]>();
    for (const m of messages) {
      if (!m.bookingId || directionFor(m.source) === null) continue;
      const list = byBooking.get(m.bookingId) ?? [];
      list.push(m);
      byBooking.set(m.bookingId, list);
    }

    if (byBooking.size) {
      const bookings = await fetchBookings([...byBooking.keys()]);
      const propertyIds = await ensureProperties(
        orgId,
        [...new Set(bookings.map((b) => b.propertyId).filter((x): x is number => Boolean(x)))],
      );

      for (const booking of bookings) {
        try {
          await syncBooking(orgId, connectionId, booking, byBooking.get(booking.id) ?? [], propertyIds, report);
        } catch (e) {
          report.errors.push(`booking ${booking.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    await db
      .from("channel_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: report.errors[0] ?? null })
      .eq("id", connectionId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    report.errors.push(message);
    await db.from("channel_connections").update({ last_error: message }).eq("id", connectionId);
  }

  return report;
}

// ─── pieces ─────────────────────────────────────────────────────────────────

async function ensureConnection(orgId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("channel_connections")
    .upsert(
      { organization_id: orgId, channel: "beds24", display_name: "Beds24", active: true },
      { onConflict: "organization_id,channel,display_name" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`channel connection: ${error?.message}`);
  return data.id;
}

async function fetchBookings(ids: number[]): Promise<Beds24Booking[]> {
  const out: Beds24Booking[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    out.push(
      ...(await beds24All<Beds24Booking>("/bookings", {
        id: ids.slice(i, i + 50),
        status: ALL_STATUSES,
      })),
    );
  }
  return out;
}

/** Beds24 property id -> our property uuid, creating any we have not seen. */
async function ensureProperties(orgId: string, beds24Ids: number[]): Promise<Map<number, string>> {
  const db = supabaseAdmin();
  const map = new Map<number, string>();
  if (!beds24Ids.length) return map;

  const { data: existing } = await db
    .from("properties")
    .select("id, external_id")
    .eq("organization_id", orgId)
    .in("external_id", beds24Ids.map(String));
  for (const p of existing ?? []) map.set(Number(p.external_id), p.id);

  const missing = beds24Ids.filter((id) => !map.has(id));
  if (missing.length) {
    const fetched = await beds24All<Beds24Property>("/properties", { id: missing });
    for (const p of fetched) {
      const { data, error } = await db
        .from("properties")
        .upsert(
          {
            organization_id: orgId,
            external_id: String(p.id),
            name: p.name || `Property ${p.id}`,
            address: p.address || null,
            city: p.city || null,
            state: p.state || null,
            country: p.country || null,
            postcode: p.postcode || null,
            property_type: p.propertyType || null,
            check_in_time: p.checkInStart || null,
            check_out_time: p.checkOutEnd || null,
          },
          { onConflict: "organization_id,external_id" },
        )
        .select("id")
        .single();
      if (error || !data) throw new Error(`property ${p.id}: ${error?.message}`);
      map.set(p.id, data.id);
    }
  }
  return map;
}

/** The same person across bookings and channels: matched on email, then phone. */
async function ensureGuest(orgId: string, booking: Beds24Booking): Promise<string> {
  const db = supabaseAdmin();
  const email = normaliseEmail(booking.email);
  const phone = normalisePhone(booking.mobile || booking.phone);

  for (const [channel, address] of [["email", email], ["phone", phone]] as const) {
    if (!address) continue;
    const { data } = await db
      .from("guest_identities")
      .select("guest_id")
      .eq("organization_id", orgId)
      .eq("channel", channel)
      .eq("address", address)
      .maybeSingle();
    if (data?.guest_id) {
      await linkIdentities(orgId, data.guest_id, booking, email, phone);
      return data.guest_id;
    }
  }

  const { data, error } = await db
    .from("guests")
    .upsert(
      {
        organization_id: orgId,
        external_id: `beds24-booking:${booking.id}`,
        full_name: guestName(booking),
        first_name: booking.firstName || null,
        last_name: booking.lastName || null,
        email,
        phone,
        country: booking.country2 || booking.country || null,
      },
      { onConflict: "organization_id,external_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`guest: ${error?.message}`);
  await linkIdentities(orgId, data.id, booking, email, phone);
  return data.id;
}

async function linkIdentities(
  orgId: string,
  guestId: string,
  booking: Beds24Booking,
  email: string | null,
  phone: string | null,
) {
  const rows = [
    { channel: "beds24_booking", address: String(booking.id) },
    ...(email ? [{ channel: "email", address: email }] : []),
    ...(phone ? [{ channel: "phone", address: phone }] : []),
  ].map((r) => ({ ...r, organization_id: orgId, guest_id: guestId }));
  await supabaseAdmin()
    .from("guest_identities")
    .upsert(rows, { onConflict: "organization_id,channel,address", ignoreDuplicates: true });
}

async function syncBooking(
  orgId: string,
  connectionId: string,
  booking: Beds24Booking,
  messages: Beds24Message[],
  propertyIds: Map<number, string>,
  report: SyncReport,
) {
  const db = supabaseAdmin();
  const channel: Channel = channelForBooking(booking.channel);
  const propertyId = booking.propertyId ? propertyIds.get(booking.propertyId) ?? null : null;
  const guestId = await ensureGuest(orgId, booking);

  const { data: reservation, error: resErr } = await db
    .from("reservations")
    .upsert(
      {
        organization_id: orgId,
        external_id: String(booking.id),
        source_channel: channel,
        property_id: propertyId,
        guest_id: guestId,
        confirmation_code: booking.apiReference || booking.reference || null,
        status: booking.status || null,
        check_in: booking.arrival ? `${booking.arrival}T00:00:00Z` : null,
        check_out: booking.departure ? `${booking.departure}T00:00:00Z` : null,
        number_of_guests: nightsGuests(booking),
        raw_data: safeBooking(booking),
      },
      { onConflict: "organization_id,source_channel,external_id" },
    )
    .select("id")
    .single();
  if (resErr || !reservation) throw new Error(`reservation: ${resErr?.message}`);

  const { data: conversation, error: convErr } = await db
    .from("conversations")
    .upsert(
      {
        organization_id: orgId,
        channel_connection_id: connectionId,
        channel,
        external_thread_id: threadId(booking.id),
        guest_id: guestId,
        reservation_id: reservation.id,
        property_id: propertyId,
        subject: guestName(booking),
      },
      { onConflict: "organization_id,channel,external_thread_id" },
    )
    .select("id, status")
    .single();
  if (convErr || !conversation) throw new Error(`conversation: ${convErr?.message}`);

  // Replies sent from this app are stored as local:<key> until Beds24 echoes
  // them back with an id. Match them by text so they are not stored twice.
  const { data: localReplies } = await db
    .from("messages")
    .select("id, body")
    .eq("conversation_id", conversation.id)
    .like("external_message_id", "local:%")
    .in("status", ["sent", "pending"]);
  const unmatched = [...(localReplies ?? [])];

  const { data: known } = await db
    .from("messages")
    .select("external_message_id")
    .eq("conversation_id", conversation.id)
    .like("external_message_id", "beds24:%");
  const knownIds = new Set((known ?? []).map((k) => k.external_message_id));

  const toInsert = [];
  for (const m of messages) {
    const direction = directionFor(m.source)!;
    const extId = messageId(m.id);
    if (knownIds.has(extId)) continue;

    if (direction === "outbound") {
      const i = unmatched.findIndex((local) => sameText(local.body, m.message));
      if (i >= 0) {
        await db
          .from("messages")
          .update({ external_message_id: extId, status: "sent", sent_at: m.time ?? null })
          .eq("id", unmatched[i].id);
        unmatched.splice(i, 1);
        report.repliesMatched++;
        continue;
      }
    }

    toInsert.push({
      organization_id: orgId,
      conversation_id: conversation.id,
      channel,
      external_message_id: extId,
      direction,
      status: direction === "outbound" ? "sent" : m.read ? "read" : "delivered",
      sender_name: m.source === "guest" ? guestName(booking) : m.source === "system" ? "System" : "Host (Beds24)",
      body: m.message ?? "",
      content_type: m.source === "system" ? "system" : "text",
      raw_payload: m,
      received_at: direction === "inbound" ? m.time ?? null : null,
      sent_at: direction === "outbound" ? m.time ?? null : null,
      read_at: direction === "inbound" && m.read ? m.time ?? null : null,
    });
  }

  let newInbound = 0;
  if (toInsert.length) {
    const { data: inserted, error } = await db
      .from("messages")
      .upsert(toInsert, {
        onConflict: "organization_id,channel,external_message_id",
        ignoreDuplicates: true,
      })
      .select("id, body, direction, content_type");
    if (error) throw new Error(`messages: ${error.message}`);
    report.messagesAdded += inserted?.length ?? 0;
    // Airbnb photo links die after an hour; keep a copy while they still work.
    await savePhotos(orgId, inserted ?? []);
    newInbound = (inserted ?? []).filter((m) => m.direction === "inbound" && m.content_type !== "system").length;
  }

  await refreshConversation(conversation.id, newInbound > 0 && ["resolved", "archived"].includes(conversation.status));
  if (newInbound > 0 && ["resolved", "archived"].includes(conversation.status)) report.conversationsReopened++;
  report.conversationsTouched++;
}

/** Recompute the list-view fields from the messages themselves. */
export async function refreshConversation(conversationId: string, reopen = false) {
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("messages")
    .select("direction, content_type, received_at, sent_at, created_at, read_at")
    .eq("conversation_id", conversationId);

  const at = (m: { received_at: string | null; sent_at: string | null; created_at: string }) =>
    m.received_at || m.sent_at || m.created_at;
  const times = (rows ?? []).map(at).sort();
  const inbound = (rows ?? []).filter((m) => m.direction === "inbound" && m.content_type !== "system");
  const outbound = (rows ?? []).filter((m) => m.direction === "outbound");
  const latest = (list: typeof inbound) => list.map(at).sort().at(-1) ?? null;

  await db
    .from("conversations")
    .update({
      first_message_at: times[0] ?? null,
      last_message_at: times.at(-1) ?? null,
      last_inbound_at: latest(inbound),
      last_outbound_at: latest(outbound),
      unread_count: inbound.filter((m) => !m.read_at).length,
      updated_at: new Date().toISOString(),
      ...(reopen ? { status: "open", resolved_at: null } : {}),
    })
    .eq("id", conversationId);
}
