/**
 * Response times for the Reports page and the Monday email.
 *
 * A "wait" starts at the first guest message after the last staff reply and
 * ends at the next staff reply. Each answered wait is credited to whoever sent
 * that reply (or "Outside the app" when it was sent on Airbnb / WhatsApp / the
 * phone and synced in, so we cannot know who), to the conversation's channel
 * and to its property. Waits still open at the end of the period are reported
 * separately as "still waiting", never averaged in as if answered.
 *
 * Pure functions, so the maths is tested without a database.
 */

export type StatMsg = {
  conversation_id: string;
  direction: string;
  sent_by: string | null;
  at: string; // ISO time the message happened
};
export type ConvMeta = { channel: string; property: string | null; guest: string | null };

export type Bucket = { key: string; replies: number; avgMinutes: number | null; medianMinutes: number | null; withinHour: number | null };
export type OpenWait = { conversationId: string; guest: string | null; property: string | null; channel: string; minutes: number };
export type ReplyReport = {
  guestMessages: number;
  replies: number;
  answeredWaits: number;
  avgMinutes: number | null;
  medianMinutes: number | null;
  withinHour: number | null; // share of waits answered within 60 minutes, 0..1
  byStaff: Bucket[];
  byChannel: Bucket[];
  byProperty: Bucket[];
  slowest: (OpenWait & { answered: true })[];
  stillWaiting: OpenWait[];
};

export const OUTSIDE_APP = "Outside the app";

function bucketOf(key: string, gaps: number[]): Bucket {
  if (!gaps.length) return { key, replies: 0, avgMinutes: null, medianMinutes: null, withinHour: null };
  const sorted = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    key,
    replies: gaps.length,
    avgMinutes: gaps.reduce((a, b) => a + b, 0) / gaps.length,
    medianMinutes: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    withinHour: gaps.filter((g) => g <= 60).length / gaps.length,
  };
}

export function replyReport(
  messages: StatMsg[],
  convs: Map<string, ConvMeta>,
  staffName: (id: string) => string,
  now: Date,
): ReplyReport {
  const byConv = new Map<string, StatMsg[]>();
  for (const m of messages) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }

  const all: number[] = [];
  const staff = new Map<string, number[]>();
  const channel = new Map<string, number[]>();
  const property = new Map<string, number[]>();
  const answered: (OpenWait & { answered: true })[] = [];
  const stillWaiting: OpenWait[] = [];
  const push = (map: Map<string, number[]>, key: string, v: number) => map.set(key, [...(map.get(key) ?? []), v]);

  for (const [id, list] of byConv) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    const meta = convs.get(id) ?? { channel: "unknown", property: null, guest: null };
    let waitingSince: string | null = null;
    for (const m of list) {
      if (m.direction === "inbound" && !waitingSince) waitingSince = m.at;
      if (m.direction === "outbound" && waitingSince) {
        const gap = Math.max(0, (Date.parse(m.at) - Date.parse(waitingSince)) / 60_000);
        all.push(gap);
        push(staff, m.sent_by ? staffName(m.sent_by) : OUTSIDE_APP, gap);
        push(channel, meta.channel, gap);
        push(property, meta.property ?? "No property", gap);
        answered.push({ conversationId: id, guest: meta.guest, property: meta.property, channel: meta.channel, minutes: gap, answered: true });
        waitingSince = null;
      }
    }
    if (waitingSince) {
      stillWaiting.push({
        conversationId: id, guest: meta.guest, property: meta.property, channel: meta.channel,
        minutes: Math.max(0, (now.getTime() - Date.parse(waitingSince)) / 60_000),
      });
    }
  }

  const buckets = (map: Map<string, number[]>) =>
    [...map].map(([k, v]) => bucketOf(k, v)).sort((a, b) => b.replies - a.replies);
  const overall = bucketOf("all", all);

  return {
    guestMessages: messages.filter((m) => m.direction === "inbound").length,
    replies: messages.filter((m) => m.direction === "outbound").length,
    answeredWaits: all.length,
    avgMinutes: overall.avgMinutes,
    medianMinutes: overall.medianMinutes,
    withinHour: overall.withinHour,
    byStaff: buckets(staff),
    byChannel: buckets(channel),
    byProperty: buckets(property),
    slowest: answered.sort((a, b) => b.minutes - a.minutes).slice(0, 10),
    stillWaiting: stillWaiting.sort((a, b) => b.minutes - a.minutes).slice(0, 20),
  };
}
