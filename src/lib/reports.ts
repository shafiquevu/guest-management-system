import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { replyReport, type ConvMeta, type ReplyReport, type StatMsg } from "@/lib/reply-stats";

export type PeriodReport = ReplyReport & {
  days: number;
  from: string;
  to: string;
  incidents: { opened: number; resolved: number; open: number };
  conversations: number;
};

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request

/**
 * Response times and volumes for the last `days` days, for one organisation.
 * Used by the Reports page (7 or 30 days) and by Monday's weekly email.
 */
export async function buildPeriodReport(organizationId: string, days: number, now = new Date()): Promise<PeriodReport> {
  const db = supabaseAdmin();
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();

  const messages: StatMsg[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await db
      .from("messages")
      .select("conversation_id, direction, sent_by, received_at, sent_at, created_at")
      .eq("organization_id", organizationId)
      .neq("content_type", "system")
      .gte("created_at", since)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const m of data ?? []) {
      messages.push({
        conversation_id: m.conversation_id,
        direction: m.direction,
        sent_by: m.sent_by,
        at: m.received_at || m.sent_at || m.created_at,
      });
    }
    if (!data || data.length < PAGE) break;
  }

  const ids = [...new Set(messages.map((m) => m.conversation_id))];
  const convs = new Map<string, ConvMeta>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db
      .from("conversations")
      .select("id, channel, guest:guests(full_name), property:properties(name)")
      .in("id", ids.slice(i, i + 150));
    for (const c of (data ?? []) as unknown as { id: string; channel: string; guest: { full_name: string } | null; property: { name: string } | null }[]) {
      convs.set(c.id, { channel: c.channel, property: c.property?.name ?? null, guest: c.guest?.full_name ?? null });
    }
  }

  const [{ data: staff }, { data: opened }, { data: resolved }, { count: openNow }] = await Promise.all([
    db.from("profiles").select("id, full_name").eq("organization_id", organizationId),
    db.from("incidents").select("id").eq("organization_id", organizationId).gte("created_at", since),
    db.from("incidents").select("id").eq("organization_id", organizationId).gte("resolved_at", since),
    db.from("incidents").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).in("status", ["open", "investigating"]),
  ]);
  const names = new Map((staff ?? []).map((s) => [s.id as string, s.full_name as string]));

  return {
    ...replyReport(messages, convs, (id) => names.get(id) ?? "Former staff", now),
    days,
    from: since,
    to: now.toISOString(),
    conversations: ids.length,
    incidents: { opened: (opened ?? []).length, resolved: (resolved ?? []).length, open: openNow ?? 0 },
  };
}
