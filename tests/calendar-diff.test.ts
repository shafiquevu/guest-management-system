import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedNights, compare, type Snapshot } from "../src/lib/calendar/diff.ts";

const snap = (calendar: Snapshot["rooms"][number]["calendar"]): Snapshot => ({
  takenAt: "2026-11-11T10:00:00Z",
  from: "2026-11-11",
  to: "2026-12-31",
  rooms: [{ roomId: 1, propertyId: 10, name: "Flat 1", calendar }],
});
const base = [{ from: "2026-11-11", to: "2026-12-31", numAvail: 1, minStay: 1, override: "none", price1: 93 }];

test("no change, no report", () => {
  assert.deepEqual(compare(snap(base), snap(base), "2026-11-11"), []);
});

test("a price change over some nights is one readable run", () => {
  const next = snap([
    { from: "2026-11-11", to: "2026-12-11", numAvail: 1, minStay: 1, override: "none", price1: 93 },
    { from: "2026-12-12", to: "2026-12-20", numAvail: 1, minStay: 1, override: "none", price1: 120 },
    { from: "2026-12-21", to: "2026-12-31", numAvail: 1, minStay: 1, override: "none", price1: 93 },
  ]);
  const c = compare(snap(base), next, "2026-11-11");
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].field, c[0].before, c[0].after, c[0].from, c[0].to, c[0].nights], ["price", "93", "120", "2026-12-12", "2026-12-20", 9]);
});

test("min stay and closed dates are reported", () => {
  const next = snap([{ from: "2026-11-11", to: "2026-12-31", numAvail: 1, minStay: 3, override: "blackout", price1: 93 }]);
  const fields = compare(snap(base), next, "2026-11-11").map((c) => `${c.field}:${c.before}->${c.after}`);
  assert.deepEqual(fields.sort(), ["closed:open->closed (blackout)", "minStay:1->3"]);
});

test("availability taken by a booking is not reported; unexplained availability is", () => {
  const next = snap([
    { from: "2026-11-11", to: "2026-11-14", numAvail: 0, minStay: 1, override: "none", price1: 93 },
    { from: "2026-11-15", to: "2026-12-31", numAvail: 1, minStay: 1, override: "none", price1: 93 },
  ]);
  const explained = new Set(bookedNights(1, "2026-11-11", "2026-11-14")); // nights 11, 12, 13
  const c = compare(snap(base), next, "2026-11-11", explained);
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].field, c[0].from, c[0].to], ["availability", "2026-11-14", "2026-11-14"]);
});

test("past nights and new rooms are ignored", () => {
  const next = snap([{ from: "2026-11-11", to: "2026-12-31", numAvail: 1, minStay: 1, override: "none", price1: 50 }]);
  next.rooms.push({ roomId: 2, propertyId: 20, calendar: base });
  const c = compare(snap(base), next, "2026-12-30");
  assert.deepEqual(c.map((x) => [x.roomId, x.from, x.nights]), [[1, "2026-12-30", 2]]);
});
