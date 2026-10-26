import { dailySummary } from "@/lib/daily-summary";
import { secretMatches } from "@/lib/secrets";

export const maxDuration = 30;

/**
 * n8n calls this once a morning with header x-sync-secret: SYNC_SECRET and
 * emails the result to the managers: { email: { to, subject, text, html } }.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-sync-secret"), process.env.SYNC_SECRET)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json({ email: await dailySummary() });
}
