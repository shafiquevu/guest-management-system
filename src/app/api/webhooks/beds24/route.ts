import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { isConfigured } from "@/lib/beds24/client";
import { secretMatches } from "@/lib/secrets";
import { organizationId, supabaseAdmin } from "@/lib/supabase/admin";
import { syncBeds24 } from "@/lib/sync/beds24";

export const maxDuration = 60;

/**
 * Beds24 booking webhook. Set in Beds24 -> Settings -> Properties -> Access ->
 * Booking Webhook, as:
 *
 *   https://<your-app>/api/webhooks/beds24?key=<BEDS24_WEBHOOK_KEY>
 *
 * Beds24 sends the booking, not the message, so this re-reads that booking's
 * thread. Each delivery is recorded once in sync_events; a repeat delivery of
 * the same event is acknowledged and ignored. The 5-minute poll catches
 * anything a webhook misses.
 */
export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!secretMatches(key, process.env.BEDS24_WEBHOOK_KEY)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Version 2 sends JSON { timeStamp, booking: { id } }; version 1 sends a flat bookId.
  const url = new URL(request.url);
  const raw = await request.text().catch(() => "");
  let payload: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped webhook body
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = Object.fromEntries(new URLSearchParams(raw));
  }
  const bookingId = Number(
    payload?.booking?.id ?? payload?.bookId ?? payload?.bookid ?? url.searchParams.get("bookid") ?? url.searchParams.get("bookId"),
  );
  if (!bookingId) return Response.json({ ok: true, ignored: "no booking id" });

  const db = supabaseAdmin();
  const orgId = await organizationId();
  const eventId = `booking:${bookingId}:${payload?.timeStamp ?? Date.now()}`;

  const { data: event } = await db
    .from("sync_events")
    .upsert(
      {
        organization_id: orgId,
        channel: "beds24",
        event_type: "booking_webhook",
        external_event_id: eventId,
        payload: { booking: { id: bookingId, status: payload?.booking?.status ?? null } },
      },
      { onConflict: "organization_id,channel,external_event_id", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (!event) return Response.json({ ok: true, duplicate: true });
  if (!isConfigured()) return Response.json({ ok: false, error: "Beds24 not connected" }, { status: 503 });

  const report = await syncBeds24({ bookingIds: [bookingId], maxAgeDays: 60 });
  after(() => triagePending());
  await db
    .from("sync_events")
    .update({
      status: report.errors.length ? "failed" : "processed",
      error_message: report.errors.join("; ").slice(0, 1000) || null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", event.id);

  // Always 200 so Beds24 does not retry forever; failures are in sync_events
  // and the poll will pick the booking up again.
  return Response.json({ ok: report.errors.length === 0, ...report });
}
