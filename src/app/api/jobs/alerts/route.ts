import { triagePending } from "@/lib/ai/triage";
import { alertEmail, collectAlerts } from "@/lib/alerts";
import { secretMatches } from "@/lib/secrets";

export const maxDuration = 60;

/**
 * n8n calls this every 5 minutes, right after /api/sync/beds24, with header
 * x-sync-secret: SYNC_SECRET.
 *
 * It first lets the AI read any new guest messages (so a safety issue is
 * escalated before alerts are worked out), then returns only the alerts that
 * have not been sent before:
 *
 *   { count, alerts: [...], email: { to, subject, text, html } }
 *
 * n8n sends `email` when count > 0.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const triage = await triagePending();
  const alerts = await collectAlerts();
  return Response.json({
    count: alerts.length,
    triage,
    alerts,
    email: alerts.length ? alertEmail(alerts) : null,
  });
}
