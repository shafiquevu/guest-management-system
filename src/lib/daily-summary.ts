import "server-only";

import { averageReplyMinutes, awaitingReply, CHANNEL_LABEL, minutesLabel, type ReplyMsg } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The morning email for managers, sent by n8n once a day: the last 24 hours,
 * what is still waiting right now, and today's arrivals and departures.
 * Same definitions as the dashboard, so the numbers match what staff see.
 */

type Conv = {
  id: string;
  channel: string;
  status: string;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  guest: { full_name: string } | null;
  property: { name: string } | null;
};
type Task = { title: string; due_at: string | null; property: { name: string } | null };
type Stay = { check_in: string | null; check_out: string | null; guest: { full_name: string } | null; property: { name: string } | null };

export async function dailySummary() {
  const db = supabaseAdmin();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");

  const [{ data: convs }, { data: msgs }, { data: incidents }, { data: tasks }, { data: stays }, { data: staff }] = await Promise.all([
    db
      .from("conversations")
      .select("id, channel, status, last_inbound_at, last_outbound_at, guest:guests(full_name), property:properties(name)")
      .in("status", ["open", "pending", "escalated"])
      .limit(2000),
    db
      .from("messages")
      .select("conversation_id, direction, received_at, sent_at, created_at")
      .neq("content_type", "system")
      .gte("created_at", dayAgo)
      .limit(5000),
    db.from("incidents").select("id").gte("created_at", dayAgo),
    db
      .from("tasks")
      .select("title, due_at, property:properties(name)")
      .not("status", "in", "(completed,cancelled)")
      .limit(1000),
    db
      .from("reservations")
      .select("check_in, check_out, guest:guests(full_name), property:properties(name)")
      .gte("check_out", `${today}T00:00:00Z`)
      .lte("check_in", `${today}T23:59:59Z`)
      .neq("status", "cancelled")
      .limit(500),
    db.from("profiles").select("email, role, active").eq("active", true),
  ]);

  const m = (msgs ?? []) as ReplyMsg[];
  const received = m.filter((x) => x.direction === "inbound").length;
  const sent = m.filter((x) => x.direction === "outbound").length;
  const reply = averageReplyMinutes(m);

  const active = (convs ?? []) as unknown as Conv[];
  const waiting = active
    .filter(awaitingReply)
    .sort((a, b) => (a.last_inbound_at ?? "").localeCompare(b.last_inbound_at ?? ""));
  const escalated = active.filter((c) => c.status === "escalated").length;
  const open = (tasks ?? []) as unknown as Task[];
  const overdue = open.filter((t) => t.due_at && t.due_at < now.toISOString());
  const s = (stays ?? []) as unknown as Stay[];
  const arrivals = s.filter((x) => x.check_in?.slice(0, 10) === today);
  const departures = s.filter((x) => x.check_out?.slice(0, 10) === today);

  const to = (staff ?? []).filter((p) => p.role === "admin" || p.role === "manager").map((p) => p.email as string);
  const who = (x: { guest: { full_name: string } | null; property: { name: string } | null }) =>
    [x.guest?.full_name ?? "Guest", x.property?.name].filter(Boolean).join(" · ");
  const waited = (c: Conv) => minutesLabel((now.getTime() - Date.parse(c.last_inbound_at!)) / 60_000);

  const subject = `Daily summary: ${waiting.length} waiting for a reply, ${arrivals.length} arrival${arrivals.length === 1 ? "" : "s"} today`;

  const sections: [string, string[]][] = [
    [
      "Last 24 hours",
      [
        `Guest messages received: ${received}`,
        `Replies sent: ${sent}`,
        `Average reply time: ${minutesLabel(reply)}`,
        `New issues escalated to a manager: ${(incidents ?? []).length}`,
      ],
    ],
    [
      `Waiting for a reply (${waiting.length})`,
      waiting.length
        ? waiting.slice(0, 10).map((c) => `${who(c)} · ${CHANNEL_LABEL[c.channel] ?? c.channel} · waiting ${waited(c)}`)
        : ["Nobody is waiting."],
    ],
    [
      "Needs attention",
      [`Escalated conversations open: ${escalated}`, `Overdue tasks: ${overdue.length} of ${open.length} open`, ...overdue.slice(0, 8).map((t) => `· ${t.title}${t.property ? ` (${t.property.name})` : ""}`)],
    ],
    [
      `Today: ${arrivals.length} arriving, ${departures.length} leaving`,
      [...arrivals.map((x) => `Arrives: ${who(x)}`), ...departures.map((x) => `Leaves: ${who(x)}`)].slice(0, 20),
    ],
  ];

  const text = [
    ...sections.map(([h, lines]) => `${h.toUpperCase()}\n${lines.join("\n") || "None."}`),
    appUrl ? `Open the inbox: ${appUrl}/dashboard` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#0f172a">
    ${sections
      .map(
        ([h, lines]) => `<h3 style="margin:18px 0 6px">${esc(h)}</h3>
      <div style="color:#334155;line-height:1.6">${(lines.length ? lines : ["None."]).map(esc).join("<br>")}</div>`,
      )
      .join("")}
    ${appUrl ? `<p style="margin-top:18px"><a href="${esc(appUrl)}/dashboard" style="color:#4f46e5;font-weight:600">Open the dashboard →</a></p>` : ""}
  </div>`;

  return { to: to.join(","), subject, text, html };
}
