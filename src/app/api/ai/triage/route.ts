import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { aiConfigured, triagePending } from "@/lib/ai/triage";
import { secretMatches } from "@/lib/secrets";

export const maxDuration = 60;

/**
 * Run the triage agent now over threads with unread-by-AI guest messages.
 * Admin/manager (Bearer) or x-sync-secret.
 * Body: { "limit": 8, "sinceDays": 14 } (max 20 threads, 90 days back).
 * Reports the tokens used so the cost is visible.
 */
export async function POST(request: Request) {
  try {
    if (!secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET)) {
      await requireStaff(request, ["admin", "manager"]);
    }
    if (!aiConfigured()) return Response.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 8, 1), 20);
    const sinceDays = Math.min(Math.max(Number(body?.sinceDays) || 14, 1), 90);
    return Response.json(await triagePending(limit, sinceDays));
  } catch (error) {
    return errorResponse(error);
  }
}
