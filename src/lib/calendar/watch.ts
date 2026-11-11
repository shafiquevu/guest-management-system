import "server-only";

import { beds24All, isConfigured, type Beds24Booking } from "@/lib/beds24/client";
import { addDays, bookedNights, compare, type CalendarRoom, type Change, type Snapshot } from "@/lib/calendar/diff";
import { button, card, emailLayout, esc, pill, sectionTitle } from "@/lib/email-layout";
import { organizationId, supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Calendar watch: did anyone change prices, minimum stays, closed dates or
 * availability in Beds24?
 *
 * About once an hour (it rides on the 5-minute alerts job) it reads every
 * room's calendar for the next DAYS days, compares it with the previous
 * reading, and queues one summary email for admins and managers when
 * something moved. Availability that moved because of a booking is normal
 * and left out.
 *
 * This only READS. The app has no permission to change calendars or prices.
 *
 * The latest reading lives in sync_events (event "calendar_snapshot"); each
 * change report is a "calendar_change" event, pending until it is emailed.
 */

const DAYS = 120;
const EVERY_MS = 55 * 60_000;
const SNAPSHOT_KEY = "calendar:snapshot";
const STATUSES = ["confirmed", "request", "new", "cancelled", "black", "inquiry"];

export type WatchResult =
  | { ran: false; reason: string }
  | { ran: true; baseline: boolean; changes: number; rooms: number };

export async function watchCalendar(options: { force?: boolean } = {}): Promise<WatchResult> {
  if (!isConfigured()) return { ran: false, reason: "Beds24 not connected" };
  const db = supabaseAdmin();
  const orgId = await organizationId();

  const { data: row } = await db
    .from("sync_events")
    .select("id, payload")
    .eq("organization_id", orgId)
    .eq("channel", "beds24")
    .eq("external_event_id", SNAPSHOT_KEY)
    .maybeSingle();
  const prev = (row?.payload ?? null) as Snapshot | null;
  if (prev && !options.force && Date.now() - Date.parse(prev.takenAt) < EVERY_MS) {
    return { ran: false, reason: "checked less than an hour ago" };
  }

  const today = new Date().toISOString().slice(0, 10);
  const end = addDays(today, DAYS);
  const rooms = await beds24All<CalendarRoom>("/inventory/rooms/calendar", {
    startDate: today,
    endDate: end,
    includeNumAvail: true,
    includeMinStay: true,
    includeOverride: true,
    includePrices: true,
  });
  const next: Snapshot = {
    takenAt: new Date().toISOString(),
    from: today,
    to: end,
    rooms: rooms.map((r) => ({ roomId: r.roomId, propertyId: r.propertyId, name: r.name, calendar: r.calendar })),
  };

  let changes: Change[] = [];
  if (prev) {
    // Bookings made, changed or cancelled since the last reading explain availability moves.
    const bookings = await beds24All<Beds24Booking>("/bookings", {
      modifiedFrom: prev.takenAt.slice(0, 19),
      status: STATUSES,
    });
    const explained = new Set(bookings.flatMap((b) => bookedNights(Number(b.roomId), b.arrival, b.departure)));
    changes = compare(prev, next, today, explained);
  }

  await db.from("sync_events").upsert(
    {
      organization_id: orgId,
      channel: "beds24",
      event_type: "calendar_snapshot",
      external_event_id: SNAPSHOT_KEY,
      status: "processed",
      processed_at: next.takenAt,
      payload: next,
    },
    { onConflict: "organization_id,channel,external_event_id" },
  );

  if (changes.length) {
    const names = await propertyNames(orgId, [...new Set(changes.map((c) => c.propertyId))]);
    await db.from("sync_events").insert({
      organization_id: orgId,
      channel: "beds24",
      event_type: "calendar_change",
      external_event_id: `calendar:change:${next.takenAt}`,
      status: "pending",
      payload: { since: prev!.takenAt, until: next.takenAt, changes, properties: names },
    });
  }
  return { ran: true, baseline: !prev, changes: changes.length, rooms: next.rooms.length };
}

async function propertyNames(orgId: string, beds24Ids: number[]): Promise<Record<string, string>> {
  if (!beds24Ids.length) return {};
  const { data } = await supabaseAdmin()
    .from("properties")
    .select("external_id, name")
    .eq("organization_id", orgId)
    .in("external_id", beds24Ids.map(String));
  return Object.fromEntries((data ?? []).map((p) => [p.external_id, p.name]));
}

type Report = { since: string; until: string; changes: Change[]; properties: Record<string, string> };

/** Take the oldest unsent change report, marking it sent. Null when there is none. */
export async function takeCalendarReport(): Promise<{ to: string; subject: string; text: string; html: string } | null> {
  const db = supabaseAdmin();
  const { data: pending } = await db
    .from("sync_events")
    .select("id, payload")
    .eq("event_type", "calendar_change")
    .eq("status", "pending")
    .order("received_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pending) return null;

  // Claim it: only the run that flips pending -> processed sends the email.
  const { data: claimed } = await db
    .from("sync_events")
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return null;

  const { data: staff } = await db.from("profiles").select("email, role").eq("active", true);
  const to = [
    ...(staff ?? []).filter((p) => p.role === "admin" || p.role === "manager").map((p) => p.email as string),
    ...(process.env.CALENDAR_ALERT_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  ];
  if (!to.length) return null;
  return calendarEmail(pending.payload as Report, [...new Set(to)]);
}

const LABEL: Record<Change["field"], string> = {
  price: "Price",
  minStay: "Minimum stay",
  closed: "Closed dates",
  availability: "Availability",
};
const COLOUR: Record<Change["field"], [string, string]> = {
  price: ["#fef3c7", "#92400e"],
  minStay: ["#e0e7ff", "#3730a3"],
  closed: ["#fee2e2", "#991b1b"],
  availability: ["#f1f5f9", "#334155"],
};

const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
const span = (c: Change) => (c.nights === 1 ? day(c.from) : `${day(c.from)} – ${day(c.to)} (${c.nights} nights)`);

export function calendarEmail(report: Report, to: string[]) {
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const byProperty = new Map<number, Change[]>();
  for (const c of report.changes) byProperty.set(c.propertyId, [...(byProperty.get(c.propertyId) ?? []), c]);
  const propertyName = (id: number) => report.properties[String(id)] ?? byProperty.get(id)?.[0]?.room ?? `Property ${id}`;
  const count = byProperty.size;
  const subject = `Calendar changed on ${count} ${count === 1 ? "property" : "properties"} (${when(report.until)})`;

  const MAX_ROWS = 8;
  const MAX_PROPS = 30;
  const props = [...byProperty.entries()].sort((a, b) => b[1].length - a[1].length);

  const cards = props.slice(0, MAX_PROPS).map(([id, list]) => {
    const rows = list.slice(0, MAX_ROWS).map((c) =>
      `<div style="margin-top:6px;font-size:13px;line-height:1.5;color:#334155">${pill(LABEL[c.field], ...COLOUR[c.field])}<b>${esc(c.before)} → ${esc(c.after)}</b> · ${esc(span(c))}${list.some((x) => x.roomId !== c.roomId) ? ` <span style="color:#94a3b8">· ${esc(c.room)}</span>` : ""}</div>`,
    );
    const more = list.length > MAX_ROWS ? `<div style="margin-top:6px;font-size:12px;color:#94a3b8">and ${list.length - MAX_ROWS} more changes</div>` : "";
    return card(`<div style="font-size:15px;font-weight:600;color:#0f172a">${esc(propertyName(id))}</div>${rows.join("")}${more}`, "#d97706");
  });

  const html = emailLayout({
    heading: `Calendar changes on ${count} ${count === 1 ? "property" : "properties"}`,
    subheading: `Between ${when(report.since)} and ${when(report.until)} (UK time)`,
    preheader: `${report.changes.length} changes to prices, minimum stays or open dates in Beds24`,
    accent: "#d97706",
    body: `
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155">
        Prices, minimum stays, closed dates or availability changed in Beds24. If nobody on your team planned this, check the
        properties below. Changes caused by bookings are not included.
      </p>
      ${sectionTitle("What changed", "#92400e", report.changes.length)}
      ${cards.join("")}
      ${props.length > MAX_PROPS ? `<p style="font-size:13px;color:#64748b">and ${props.length - MAX_PROPS} more properties.</p>` : ""}
      ${appUrl ? `<div style="margin:4px 0 12px">${button(`${appUrl}/dashboard`, "Open Guest Inbox", "#d97706")}</div>` : ""}`,
    footer: "Guest Inbox checks the Beds24 calendar about once an hour and only reads it; it cannot change prices or dates. Sent to admins and managers.",
  });

  const text = [
    `Calendar changes on ${count} properties, ${when(report.since)} – ${when(report.until)} (UK time).`,
    "",
    ...props.flatMap(([id, list]) => [
      propertyName(id),
      ...list.slice(0, MAX_ROWS).map((c) => `  ${LABEL[c.field]}: ${c.before} -> ${c.after}, ${span(c)}${list.some((x) => x.roomId !== c.roomId) ? ` (${c.room})` : ""}`),
      ...(list.length > MAX_ROWS ? [`  and ${list.length - MAX_ROWS} more`] : []),
      "",
    ]),
    "Guest Inbox only reads the calendar; it cannot change prices or dates.",
  ].join("\n");

  return { to: to.join(","), subject, text, html };
}
