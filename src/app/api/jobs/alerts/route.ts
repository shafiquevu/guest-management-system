import { triagePending } from "@/lib/ai/triage";
import { alertEmail, collectAlerts } from "@/lib/alerts";
import { takeCalendarReport, watchCalendar } from "@/lib/calendar/watch";
import { ensureGmailWatch } from "@/lib/gmail/push";
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
 *
 * About once an hour it also reads the Beds24 calendar for price, minimum-stay,
 * closed-date and availability changes. A change report goes out on a run with
 * no guest alerts (at most 5 minutes later), as its own email.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const triage = await triagePending();
  const alerts = await collectAlerts();
  // A calendar problem must never stop guest alerts.
  const calendar = await watchCalendar().catch((e) => ({ ran: false as const, reason: e instanceof Error ? e.message : String(e) }));
  // Instant guest emails: renew Gmail's 7-day push watch once a day (a no-op otherwise).
  const gmailPush = await ensureGmailWatch().catch((e) => ({ ran: false, reason: e instanceof Error ? e.message : String(e) }));

  if (alerts.length) {
    return Response.json({ count: alerts.length, triage, alerts, calendar, gmailPush, email: alertEmail(alerts) });
  }
  const calendarEmail = await takeCalendarReport().catch(() => null);
  return Response.json({
    count: calendarEmail ? 1 : 0,
    triage,
    alerts,
    calendar,
    gmailPush,
    email: calendarEmail,
  });
}
