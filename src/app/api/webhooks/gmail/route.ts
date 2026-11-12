import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { secretMatches } from "@/lib/secrets";
import { syncGmail } from "@/lib/sync/gmail";

export const maxDuration = 60;

/**
 * Gmail push (Google Pub/Sub push subscription):
 *   https://<app>/api/webhooks/gmail?key=<GMAIL_PUSH_KEY>
 *
 * The notification only says "the inbox changed", so this runs the normal
 * Gmail sync (new emails only, no duplicates). It answers at once and syncs
 * afterwards, so Pub/Sub never times out and retries.
 */
export async function POST(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!secretMatches(key, process.env.GMAIL_PUSH_KEY)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  after(async () => {
    try {
      const report = await syncGmail({ maxAgeDays: 1 });
      if (report?.messagesAdded) await triagePending();
    } catch (e) {
      console.error("gmail push sync:", e instanceof Error ? e.message : e);
    }
  });
  return new Response(null, { status: 204 });
}
