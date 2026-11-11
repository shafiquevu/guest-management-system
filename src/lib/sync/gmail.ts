import "server-only";

import { gmail, gmailConnection, GmailError, type GmailConnection } from "@/lib/gmail/client";
import { address, attachmentNames, bodyText, header, isGuestMail, type GmailMessage } from "@/lib/gmail/parse";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation, type SyncReport } from "@/lib/sync/beds24";

/**
 * Gmail -> Supabase.
 *
 * One conversation per Gmail thread, keyed `gmail:<threadId>`; every email is
 * keyed `gmail:<messageId>` and written with ON CONFLICT DO NOTHING, so the
 * 5-minute schedule and "Sync now" can overlap without duplicates.
 *
 * Only threads started by someone outside the team, who is not an automated
 * sender, become conversations. The sender is matched to an existing guest by
 * email address, which links the thread to that guest's latest booking.
 *
 * Status and assignment belong to the staff and are never overwritten; a new
 * guest email reopens a resolved conversation.
 */

type Thread = { id: string; messages?: GmailMessage[] };

const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH"];
const MAX_LIST = 500;

export function emptyReport(): SyncReport {
  return { messagesSeen: 0, messagesAdded: 0, repliesMatched: 0, conversationsTouched: 0, conversationsReopened: 0, errors: [] };
}

export async function syncGmail(options: { maxAgeDays?: number } = {}): Promise<SyncReport | null> {
  const conn = await gmailConnection();
  if (!conn) return null;

  const db = supabaseAdmin();
  const report = emptyReport();
  const days = Math.min(Math.max(options.maxAgeDays ?? 3, 1), 365);

  try {
    // Guest emails that arrived recently. Our own replies come with their threads.
    const listed: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const page = await gmail<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(conn, "/messages", {
        query: {
          q: `in:inbox newer_than:${days}d -category:promotions -category:social -category:forums -category:updates`,
          maxResults: 100,
          pageToken,
        },
      });
      listed.push(...(page.messages ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && listed.length < MAX_LIST);
    report.messagesSeen = listed.length;

    // Threads with at least one email we don't have yet.
    const known = new Set<string>();
    const ids = listed.map((m) => `gmail:${m.id}`);
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db
        .from("messages")
        .select("external_message_id")
        .eq("organization_id", conn.organizationId)
        .eq("channel", "gmail")
        .in("external_message_id", ids.slice(i, i + 200));
      for (const r of data ?? []) known.add(r.external_message_id);
    }
    const threads = [...new Set(listed.filter((m) => !known.has(`gmail:${m.id}`)).map((m) => m.threadId))];

    for (const threadId of threads) {
      try {
        const thread = await gmail<Thread>(conn, `/threads/${threadId}`, { query: { format: "full" } });
        await syncThread(conn, thread, report);
      } catch (e) {
        report.errors.push(`thread ${threadId}: ${e instanceof Error ? e.message : String(e)}`);
        if (e instanceof GmailError && (e.status === 401 || e.status === 403 || e.status === 429)) break;
      }
    }

    await db
      .from("channel_connections")
      .update({ last_sync_at: new Date().toISOString(), last_error: report.errors[0] ?? null })
      .eq("id", conn.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    report.errors.push(message);
    await db.from("channel_connections").update({ last_error: message }).eq("id", conn.id);
  }
  return report;
}

async function syncThread(conn: GmailConnection, thread: Thread, report: SyncReport) {
  const db = supabaseAdmin();
  const orgId = conn.organizationId;
  const mailbox = conn.email.toLowerCase();
  const messages = (thread.messages ?? [])
    .filter((m) => !(m.labelIds ?? []).some((l) => SKIP_LABELS.includes(l)))
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));

  const isOurs = (m: GmailMessage) => address(header(m, "From")).email === mailbox;
  const firstGuest = messages.find((m) => !isOurs(m));
  if (!firstGuest) return;
  const guest = address(header(firstGuest, "From"));

  const threadKey = `gmail:${thread.id}`;
  const { data: existing } = await db
    .from("conversations")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("channel", "gmail")
    .eq("external_thread_id", threadKey)
    .maybeSingle();
  // A new thread must look like a real person writing in; an existing one keeps syncing.
  if (!existing && !isGuestMail(firstGuest, guest.email)) return;

  let conversation = existing;
  if (!conversation) {
    const guestId = await ensureGuest(orgId, guest.email, guest.name);
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
          channel: "gmail",
          external_thread_id: threadKey,
          guest_id: guestId,
          reservation_id: reservation?.id ?? null,
          property_id: reservation?.property_id ?? null,
          subject: header(firstGuest, "Subject") || "(no subject)",
        },
        { onConflict: "organization_id,channel,external_thread_id" },
      )
      .select("id, status")
      .single();
    if (error || !data) throw new Error(`conversation: ${error?.message}`);
    conversation = data;
  }

  const { data: knownRows } = await db
    .from("messages")
    .select("external_message_id")
    .eq("conversation_id", conversation.id)
    .like("external_message_id", "gmail:%");
  const knownIds = new Set((knownRows ?? []).map((r) => r.external_message_id));

  const rows = [];
  for (const m of messages) {
    const extId = `gmail:${m.id}`;
    if (knownIds.has(extId)) continue;
    const ours = isOurs(m);
    const from = address(header(m, "From"));
    const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null;
    const files = attachmentNames(m.payload);
    const text = bodyText(m);
    const unread = (m.labelIds ?? []).includes("UNREAD");
    rows.push({
      organization_id: orgId,
      conversation_id: conversation.id,
      channel: "gmail",
      external_message_id: extId,
      direction: ours ? "outbound" : "inbound",
      status: ours ? "sent" : unread ? "delivered" : "read",
      sender_name: ours ? "Team (Gmail)" : from.name || from.email,
      sender_address: from.email,
      recipient_address: header(m, "To") || null,
      body: [text, files.length ? `📎 ${files.join(", ")}` : ""].filter(Boolean).join("\n\n") || "(empty email)",
      content_type: "text",
      raw_payload: {
        id: m.id,
        threadId: m.threadId,
        messageId: header(m, "Message-ID") || header(m, "Message-Id"),
        references: header(m, "References"),
        subject: header(m, "Subject"),
        from: header(m, "From"),
        to: header(m, "To"),
        cc: header(m, "Cc"),
        labelIds: m.labelIds ?? [],
        attachments: files,
      },
      received_at: ours ? null : at,
      sent_at: ours ? at : null,
      read_at: !ours && !unread ? at : null,
    });
  }

  let newInbound = 0;
  if (rows.length) {
    const { data: inserted, error } = await db
      .from("messages")
      .upsert(rows, { onConflict: "organization_id,channel,external_message_id", ignoreDuplicates: true })
      .select("id, direction");
    if (error) throw new Error(`messages: ${error.message}`);
    report.messagesAdded += inserted?.length ?? 0;
    newInbound = (inserted ?? []).filter((m) => m.direction === "inbound").length;
  }

  const reopen = newInbound > 0 && ["resolved", "archived"].includes(conversation.status);
  await refreshConversation(conversation.id, reopen);
  if (reopen) report.conversationsReopened++;
  report.conversationsTouched++;
}

/** The guest behind an email address: an existing one (from a booking) if we know the address. */
async function ensureGuest(orgId: string, email: string, name: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: known } = await db
    .from("guest_identities")
    .select("guest_id")
    .eq("organization_id", orgId)
    .eq("channel", "email")
    .eq("address", email)
    .maybeSingle();
  if (known?.guest_id) return known.guest_id;

  const fullName = name || email.split("@")[0];
  const { data, error } = await db
    .from("guests")
    .upsert(
      { organization_id: orgId, external_id: `gmail:${email}`, full_name: fullName, email },
      { onConflict: "organization_id,external_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`guest: ${error?.message}`);
  await db
    .from("guest_identities")
    .upsert(
      { organization_id: orgId, guest_id: data.id, channel: "email", address: email },
      { onConflict: "organization_id,channel,address", ignoreDuplicates: true },
    );
  return data.id;
}
