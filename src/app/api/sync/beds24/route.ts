import { after } from "next/server";
import { triagePending } from "@/lib/ai/triage";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { isConfigured } from "@/lib/beds24/client";
import { secretMatches } from "@/lib/secrets";
import { syncBeds24 } from "@/lib/sync/beds24";
import { emptyReport as emptyErrors, syncGmail } from "@/lib/sync/gmail";

export const maxDuration = 60;

/**
 * Pull recent Beds24 messages (and Gmail, once connected) into the inbox.
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
    // Agents work the inbox, so they can press Sync too; the 30-day backfill stays admin/manager.
    const staff = fromSchedule ? null : await requireStaff(request, ["admin", "manager", "agent"]);
    const body = await request.json().catch(() => ({}));
    const asked = Number(body?.maxAgeDays) || 3;
    const maxAgeDays = staff && staff.role === "agent" ? Math.min(asked, 3) : asked;

    // The same schedule keeps both channels current; one failing never stops the other.
    const [beds24, gmail] = await Promise.all([
      isConfigured() ? syncBeds24({ maxAgeDays }) : null,
      syncGmail({ maxAgeDays }).catch((e) => ({ ...emptyErrors(), errors: [e instanceof Error ? e.message : String(e)] })),
    ]);
    if (!beds24 && !gmail) {
      return Response.json({ error: "No channel is connected yet (Beds24 or Gmail)." }, { status: 503 });
    }

    const parts = [beds24, gmail].filter((r) => r !== null);
    const sum = (k: "messagesSeen" | "messagesAdded" | "repliesMatched" | "conversationsTouched" | "conversationsReopened") =>
      parts.reduce((n, r) => n + r[k], 0);
    const errors = [
      ...(beds24?.errors ?? []).map((e) => `Beds24: ${e}`),
      ...(gmail?.errors ?? []).map((e) => `Gmail: ${e}`),
    ];
    // "Sync now": let the AI read new guest messages once the response is sent.
    // The schedule doesn't need this -- n8n calls /api/jobs/alerts next, which triages first.
    if (!fromSchedule) after(() => triagePending());
    return Response.json({
      ok: errors.length === 0,
      messagesSeen: sum("messagesSeen"),
      messagesAdded: sum("messagesAdded"),
      repliesMatched: sum("repliesMatched"),
      conversationsTouched: sum("conversationsTouched"),
      conversationsReopened: sum("conversationsReopened"),
      errors,
      beds24,
      gmail,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
