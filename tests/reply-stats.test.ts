import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTSIDE_APP, replyReport, type ConvMeta, type StatMsg } from "../src/lib/reply-stats.ts";

const t = (min: number) => new Date(Date.UTC(2026, 10, 10, 9, 0) + min * 60_000).toISOString();
const convs = new Map<string, ConvMeta>([
  ["c1", { channel: "airbnb", property: "Omega House", guest: "Pax" }],
  ["c2", { channel: "whatsapp", property: "Redgate House", guest: "Eusebio" }],
]);
const names = (id: string) => ({ s1: "Ayesha" } as Record<string, string>)[id] ?? id;

test("a wait runs from the first unanswered guest message to the next reply", () => {
  const msgs: StatMsg[] = [
    { conversation_id: "c1", direction: "inbound", sent_by: null, at: t(0) },
    { conversation_id: "c1", direction: "inbound", sent_by: null, at: t(10) }, // same wait, not a new one
    { conversation_id: "c1", direction: "outbound", sent_by: "s1", at: t(30) },
    { conversation_id: "c2", direction: "inbound", sent_by: null, at: t(0) },
    { conversation_id: "c2", direction: "outbound", sent_by: null, at: t(90) },
  ];
  const r = replyReport(msgs, convs, names, new Date(t(200)));
  assert.equal(r.answeredWaits, 2);
  assert.equal(r.avgMinutes, 60);
  assert.equal(r.withinHour, 0.5);
  assert.deepEqual(r.byStaff.map((b) => [b.key, b.avgMinutes]).sort(), [["Ayesha", 30], [OUTSIDE_APP, 90]]);
  assert.deepEqual(r.byChannel.map((b) => b.key).sort(), ["airbnb", "whatsapp"]);
  assert.equal(r.slowest[0].guest, "Eusebio");
});

test("an unanswered guest is still waiting, not averaged in", () => {
  const msgs: StatMsg[] = [
    { conversation_id: "c1", direction: "outbound", sent_by: "s1", at: t(0) }, // reply with nothing to answer
    { conversation_id: "c1", direction: "inbound", sent_by: null, at: t(20) },
  ];
  const r = replyReport(msgs, convs, names, new Date(t(140)));
  assert.equal(r.answeredWaits, 0);
  assert.equal(r.avgMinutes, null);
  assert.equal(r.stillWaiting.length, 1);
  assert.equal(r.stillWaiting[0].minutes, 120);
});

test("median of an even count is the middle pair's average", () => {
  const msgs: StatMsg[] = [10, 20, 30, 100].flatMap((gap, i) => [
    { conversation_id: `x${i}`, direction: "inbound", sent_by: null, at: t(0) },
    { conversation_id: `x${i}`, direction: "outbound", sent_by: null, at: t(gap) },
  ]);
  assert.equal(replyReport(msgs, new Map(), names, new Date(t(500))).medianMinutes, 25);
});
