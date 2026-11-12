import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { secretMatches } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { syncGmail } from "@/lib/sync/gmail";

export const maxDuration = 60;

/** Below this, a second check is skipped: several open tabs plus n8n must not hammer Gmail. */
const MIN_GAP_MS = 20_000;

/**
 * Pull new guest emails only (quick; Beds24 stays on its 5-minute schedule).
 *
 * Called by:
 *   - the n8n schedule every minute, with header x-sync-secret: SYNC_SECRET
 *   - the inbox page every 30 seconds while someone has it open (any staff)
 *
 * Whichever comes first does the work; calls within 20 seconds of the last
 * check are answered without contacting Gmail. The inbox updates itself
 * (realtime) when new emails are written.
 */
export async function POST(request: Request) {
  try {
    const fromSchedule = secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET);
    if (!fromSchedule) await requireStaff(request);

    const { data: conn } = await supabaseAdmin()
      .from("channel_connections")
      .select("last_sync_at")
      .eq("channel", "gmail")
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn) return Response.json({ ok: true, skipped: "Gmail is not connected" });
    const since = conn.last_sync_at ? Date.now() - Date.parse(conn.last_sync_at) : Infinity;
    if (since < MIN_GAP_MS) return Response.json({ ok: true, skipped: "checked moments ago" });

    const report = await syncGmail({ maxAgeDays: 1 });
    if (report?.messagesAdded) after(() => triagePending());
    return Response.json({ ok: !report?.errors.length, ...report });
  } catch (error) {
    return errorResponse(error);
  }
}
