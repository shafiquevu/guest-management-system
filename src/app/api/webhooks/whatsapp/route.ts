import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { secretMatches } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ingestWhatsApp, whatsappConnection } from "@/lib/sync/whatsapp";
import { parseWebhook } from "@/lib/whatsapp/parse";

export const maxDuration = 30;

/**
 * 360dialog WhatsApp webhook: guest messages, replies sent from the WhatsApp
 * Business app (Coexistence echoes) and delivery receipts.
 *
 * Registered automatically by "Connect WhatsApp" in Settings as
 *   https://<app>/api/webhooks/whatsapp?key=<WHATSAPP_WEBHOOK_KEY>
 * 360dialog does not sign its webhooks, so the key in the address is the only
 * proof a call is genuine; anything without it is refused.
 *
 * Always answers 200 once the key is right, even if saving fails, because a
 * non-200 makes 360dialog retry and eventually pause the webhook; the error is
 * recorded on the connection so Settings shows "Needs attention".
 */
export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!secretMatches(key, process.env.WHATSAPP_WEBHOOK_KEY)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const events = parseWebhook(body);
  if (!events.length) return Response.json({ ok: true, ignored: "no messages or receipts" });

  try {
    const report = await ingestWhatsApp(events);
    if (report.messagesAdded) after(() => triagePending());
    return Response.json({ ok: true, ...report });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const conn = await whatsappConnection().catch(() => null);
    if (conn) await supabaseAdmin().from("channel_connections").update({ last_error: message }).eq("id", conn.id);
    console.error("whatsapp webhook:", message);
    return Response.json({ ok: false, error: "saved with errors" });
  }
}
