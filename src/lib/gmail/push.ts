import "server-only";

import { gmail, gmailConnection } from "@/lib/gmail/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Instant guest emails: Gmail push notifications through Google Pub/Sub.
 *
 * Gmail tells a Pub/Sub topic whenever the inbox changes; a push subscription
 * on that topic calls /api/webhooks/gmail?key=<GMAIL_PUSH_KEY>, which syncs
 * straight away. Gmail's "watch" lasts 7 days, so it is renewed here once a
 * day (from the 5-minute jobs run) and right after Gmail is connected.
 *
 * Needs GMAIL_PUBSUB_TOPIC ("projects/<project>/topics/<topic>", in the same
 * Google Cloud project as the Gmail OAuth client, with
 * gmail-api-push@system.gserviceaccount.com allowed to publish) and
 * GMAIL_PUSH_KEY (any long random string, also in the subscription's URL).
 * Without them nothing changes: the inbox still checks Gmail on its own.
 */

const RENEW_BEFORE_MS = 24 * 3600_000;

export function gmailPushConfigured(): boolean {
  return Boolean(process.env.GMAIL_PUBSUB_TOPIC && process.env.GMAIL_PUSH_KEY);
}

export type WatchResult = { ran: boolean; reason?: string; expires?: string };

export async function ensureGmailWatch(force = false): Promise<WatchResult> {
  if (!gmailPushConfigured()) return { ran: false, reason: "push not configured" };
  const conn = await gmailConnection();
  if (!conn) return { ran: false, reason: "Gmail not connected" };

  const db = supabaseAdmin();
  const { data: row } = await db.from("channel_connections").select("metadata").eq("id", conn.id).single();
  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  const expires = Date.parse(String(metadata.watch_expires ?? ""));
  if (!force && expires - Date.now() > RENEW_BEFORE_MS) return { ran: false, reason: "watch still valid", expires: String(metadata.watch_expires) };
  // After a failure (e.g. the topic's permissions aren't set up), try again once a day, not every run.
  const failedAt = Date.parse(String(metadata.watch_failed_at ?? ""));
  if (!force && Date.now() - failedAt < RENEW_BEFORE_MS) return { ran: false, reason: `waiting after error: ${metadata.watch_error}` };

  try {
    const res = await gmail<{ historyId: string; expiration: string }>(conn, "/watch", {
      method: "POST",
      body: { topicName: process.env.GMAIL_PUBSUB_TOPIC, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" },
    });
    const at = new Date(Number(res.expiration)).toISOString();
    await db
      .from("channel_connections")
      .update({ metadata: { ...metadata, watch_expires: at, watch_error: null, watch_failed_at: null } })
      .eq("id", conn.id);
    return { ran: true, expires: at };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await db
      .from("channel_connections")
      .update({ metadata: { ...metadata, watch_error: reason, watch_failed_at: new Date().toISOString() } })
      .eq("id", conn.id);
    return { ran: false, reason };
  }
}
