import "server-only";

import { organizationId, supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Staff alerts, sent by n8n.
 *
 *   escalated  the AI flagged the thread for a manager (safety, refund, complaint...)
 *   waiting    a guest has had no reply for ALERT_WAIT_MINUTES (default 15)
 *
 * Each alert is recorded in sync_events under a key that includes the guest's
 * latest message time, so it fires once per guest message, never on every run.
 * A thread the AI marked "no reply needed" (a thank-you) does not raise a
 * waiting alert.
 */

export type Alert = {
  kind: "escalated" | "waiting" | "task_overdue";
  /** Claimed once in sync_events, so each alert is sent a single time. */
  key: string;
  conversationId: string | null;
  guest: string;
  property: string;
  channel: string;
  waitingMinutes: number;
  priority: string | null;
  summary: string | null;
  reason: string | null;
  link: string;
  to: string[];
};

type Conv = {
  id: string;
  status: string;
  channel: string;
  assigned_to: string | null;
  last_inbound_at: string;
  last_outbound_at: string | null;
  ai_priority: string | null;
  ai_summary: string | null;
  ai_flag: string | null;
  ai_category: string | null;
  guest: { full_name: string } | null;
  property: { name: string } | null;
};

const CHANNEL: Record<string, string> = { airbnb: "Airbnb", booking_com: "Booking.com", beds24: "Direct", whatsapp: "WhatsApp", gmail: "Email" };

export async function collectAlerts(): Promise<Alert[]> {
  const db = supabaseAdmin();
  const orgId = await organizationId();
  const waitMinutes = Number(process.env.ALERT_WAIT_MINUTES) || 15;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const now = Date.now();

  const [{ data: convs }, { data: staff }, { data: overdue }] = await Promise.all([
    db
      .from("conversations")
      .select(
        "id, status, channel, assigned_to, last_inbound_at, last_outbound_at, ai_priority, ai_summary, ai_flag, ai_category, guest:guests(full_name), property:properties(name)",
      )
      .in("status", ["open", "pending", "escalated"])
      .gte("last_inbound_at", new Date(now - 2 * 86_400_000).toISOString())
      .limit(500),
    db.from("profiles").select("id, email, role, active").eq("active", true),
    db
      .from("tasks")
      .select("id, title, priority, assigned_to, due_at, conversation_id, guest:guests(full_name), property:properties(name)")
      .in("status", ["open", "in_progress", "waiting", "overdue"])
      .lt("due_at", new Date(now).toISOString())
      .gte("due_at", new Date(now - 7 * 86_400_000).toISOString())
      .limit(200),
  ]);

  const managers = (staff ?? []).filter((s) => s.role === "admin" || s.role === "manager").map((s) => s.email as string);
  const emailOf = new Map((staff ?? []).map((s) => [s.id as string, s.email as string]));

  const candidates: Alert[] = [];
  for (const c of (convs ?? []) as unknown as Conv[]) {
    const awaiting = !c.last_outbound_at || c.last_outbound_at < c.last_inbound_at;
    const waited = Math.round((now - new Date(c.last_inbound_at).getTime()) / 60_000);
    const base = {
      key: "",
      conversationId: c.id,
      guest: c.guest?.full_name ?? "Guest",
      property: c.property?.name ?? "Unknown property",
      channel: CHANNEL[c.channel] ?? c.channel,
      waitingMinutes: awaiting ? waited : 0,
      priority: c.ai_priority,
      summary: c.ai_summary,
      reason: c.ai_flag,
      link: appUrl ? `${appUrl}/inbox?c=${c.id}` : `/inbox?c=${c.id}`,
    };
    const assignee = c.assigned_to ? emailOf.get(c.assigned_to) : undefined;
    const to = [...new Set([...(assignee ? [assignee] : []), ...managers])];

    if (c.status === "escalated") {
      candidates.push({ ...base, key: `alert:escalated:${c.id}:${c.last_inbound_at}`, kind: "escalated", to });
    } else if (awaiting && waited >= waitMinutes && c.ai_category !== "thanks") {
      // First alert goes to the assignee; if nobody is assigned, to the managers.
      candidates.push({ ...base, key: `alert:waiting:${c.id}:${c.last_inbound_at}`, kind: "waiting", to: assignee ? [assignee] : managers });
    }
  }

  // A task past its due time: once per due time, to the assignee or else the managers.
  type OverdueTask = {
    id: string;
    title: string;
    priority: string;
    assigned_to: string | null;
    due_at: string;
    conversation_id: string | null;
    guest: { full_name: string } | null;
    property: { name: string } | null;
  };
  for (const t of (overdue ?? []) as unknown as OverdueTask[]) {
    const assignee = t.assigned_to ? emailOf.get(t.assigned_to) : undefined;
    candidates.push({
      kind: "task_overdue",
      key: `alert:task_overdue:${t.id}:${t.due_at}`,
      conversationId: t.conversation_id,
      guest: t.guest?.full_name ?? "",
      property: t.property?.name ?? "",
      channel: "",
      waitingMinutes: Math.round((now - new Date(t.due_at).getTime()) / 60_000),
      priority: t.priority,
      summary: t.title,
      reason: null,
      link: appUrl ? `${appUrl}/tasks` : "/tasks",
      to: assignee ? [assignee] : managers,
    });
  }

  if (!candidates.length) return [];

  // Claim each alert once. ignoreDuplicates returns only the rows newly written.
  const keyOf = (a: Alert) => a.key;
  const { data: claimed, error } = await db
    .from("sync_events")
    .upsert(
      candidates.map((a) => ({
        organization_id: orgId,
        channel: "beds24",
        event_type: `alert_${a.kind}`,
        external_event_id: keyOf(a),
        status: "processed",
        processed_at: new Date().toISOString(),
        payload: { conversationId: a.conversationId, to: a.to },
      })),
      { onConflict: "organization_id,channel,external_event_id", ignoreDuplicates: true },
    )
    .select("external_event_id");
  if (error) throw new Error(error.message);

  const fresh = new Set((claimed ?? []).map((r) => r.external_event_id as string));
  const order = { escalated: 0, waiting: 1, task_overdue: 2 };
  return candidates
    .filter((a) => fresh.has(keyOf(a)))
    .sort((a, b) => (a.kind === b.kind ? b.waitingMinutes - a.waitingMinutes : order[a.kind] - order[b.kind]));
}

/** A ready-to-send email for n8n: one message covering every new alert. */
export function alertEmail(alerts: Alert[]) {
  const escalated = alerts.filter((a) => a.kind === "escalated");
  const waiting = alerts.filter((a) => a.kind === "waiting");
  const tasks = alerts.filter((a) => a.kind === "task_overdue");
  const subject = escalated.length
    ? `URGENT: ${escalated.length} guest issue${escalated.length > 1 ? "s" : ""} need a manager`
    : waiting.length
      ? `${waiting.length} guest${waiting.length > 1 ? "s" : ""} waiting for a reply`
      : `${tasks.length} task${tasks.length > 1 ? "s" : ""} overdue`;
  const late = (m: number) => (m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`);
  const taskLine = (a: Alert) =>
    [`${a.summary}`, [a.property, a.guest].filter(Boolean).join(" · ") || null, `Overdue by ${late(a.waitingMinutes)}`, `Open: ${a.link}`]
      .filter(Boolean)
      .join("\n");

  const line = (a: Alert) =>
    [
      `${a.guest} · ${a.property} · ${a.channel}`,
      a.reason ? `Why: ${a.reason}` : null,
      a.summary ? `Wants: ${a.summary}` : null,
      a.waitingMinutes ? `Waiting ${a.waitingMinutes < 60 ? `${a.waitingMinutes} min` : `${Math.round(a.waitingMinutes / 60)} h`}` : null,
      `Open: ${a.link}`,
    ]
      .filter(Boolean)
      .join("\n");

  const text = [
    escalated.length ? `NEEDS A MANAGER\n\n${escalated.map(line).join("\n\n")}` : null,
    waiting.length ? `WAITING FOR A REPLY\n\n${waiting.map(line).join("\n\n")}` : null,
    tasks.length ? `OVERDUE TASKS\n\n${tasks.map(taskLine).join("\n\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n――――――――\n\n");

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const card = (a: Alert) => `
    <div style="border:1px solid #e2e8f0;border-left:4px solid ${a.kind === "escalated" ? "#dc2626" : "#f59e0b"};border-radius:8px;padding:12px 14px;margin:0 0 10px">
      <div style="font-weight:600;color:#0f172a">${esc(a.guest)} <span style="font-weight:400;color:#64748b">· ${esc(a.property)} · ${esc(a.channel)}</span></div>
      ${a.reason ? `<div style="color:#b91c1c;margin-top:4px">${esc(a.reason)}</div>` : ""}
      ${a.summary ? `<div style="color:#334155;margin-top:4px">${esc(a.summary)}</div>` : ""}
      ${a.waitingMinutes ? `<div style="color:#64748b;font-size:13px;margin-top:4px">Waiting ${a.waitingMinutes < 60 ? `${a.waitingMinutes} min` : `${Math.round(a.waitingMinutes / 60)} h`}</div>` : ""}
      <a href="${esc(a.link)}" style="display:inline-block;margin-top:8px;color:#4f46e5;font-weight:600">Open conversation →</a>
    </div>`;
  const taskCard = (a: Alert) => `
    <div style="border:1px solid #e2e8f0;border-left:4px solid #6366f1;border-radius:8px;padding:12px 14px;margin:0 0 10px">
      <div style="font-weight:600;color:#0f172a">${esc(a.summary ?? "Task")}</div>
      ${a.property || a.guest ? `<div style="color:#64748b;margin-top:4px">${esc([a.property, a.guest].filter(Boolean).join(" · "))}</div>` : ""}
      <div style="color:#b91c1c;font-size:13px;margin-top:4px">Overdue by ${late(a.waitingMinutes)}</div>
      <a href="${esc(a.link)}" style="display:inline-block;margin-top:8px;color:#4f46e5;font-weight:600">Open tasks →</a>
    </div>`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px">
    ${escalated.length ? `<h3 style="color:#b91c1c">Needs a manager</h3>${escalated.map(card).join("")}` : ""}
    ${waiting.length ? `<h3 style="color:#b45309">Waiting for a reply</h3>${waiting.map(card).join("")}` : ""}
    ${tasks.length ? `<h3 style="color:#4338ca">Overdue tasks</h3>${tasks.map(taskCard).join("")}` : ""}
  </div>`;

  const to = [...new Set(alerts.flatMap((a) => a.to))];
  return { to: to.join(","), subject, text, html };
}
