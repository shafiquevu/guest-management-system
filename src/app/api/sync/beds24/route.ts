import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { isConfigured } from "@/lib/beds24/client";
import { secretMatches } from "@/lib/secrets";
import { syncBeds24 } from "@/lib/sync/beds24";

export const maxDuration = 60;

/**
 * Pull recent Beds24 messages into the inbox.
 *
 * Called by:
 *   - the n8n schedule every 5 minutes, with header x-sync-secret: SYNC_SECRET
 *   - an admin/manager pressing "Sync now" (Bearer token)
 *
 * Body (optional): { "maxAgeDays": 30 } for a first backfill.
 */
export async function POST(request: Request) {
  try {
    const fromSchedule = secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET);
    if (!fromSchedule) await requireStaff(request, ["admin", "manager"]);
    if (!isConfigured()) {
      return Response.json(
        { error: "Beds24 is not connected yet (BEDS24_REFRESH_TOKEN missing)." },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const maxAgeDays = Number(body?.maxAgeDays) || 3;
    const report = await syncBeds24({ maxAgeDays });
    // "Sync now": let the AI read new guest messages once the response is sent.
    // The schedule doesn't need this -- n8n calls /api/jobs/alerts next, which triages first.
    if (!fromSchedule) after(() => triagePending());
    return Response.json({ ok: report.errors.length === 0, ...report });
  } catch (error) {
    return errorResponse(error);
  }
}
