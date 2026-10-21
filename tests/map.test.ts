import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelForBooking,
  directionFor,
  guestName,
  messageId,
  normaliseEmail,
  normalisePhone,
  safeBooking,
  sameText,
  threadId,
} from "../src/lib/beds24/map.ts";

test("Airbnb and Booking.com bookings land in their own channels", () => {
  assert.equal(channelForBooking("airbnb"), "airbnb");
  assert.equal(channelForBooking("booking"), "booking_com");
  assert.equal(channelForBooking("expedia"), "beds24");
  assert.equal(channelForBooking(undefined), "beds24");
});

test("guest and OTA messages come in, host messages go out, internal notes are skipped", () => {
  assert.equal(directionFor("guest"), "inbound");
  assert.equal(directionFor("system"), "inbound");
  assert.equal(directionFor("host"), "outbound");
  assert.equal(directionFor("internalNote"), null);
});

test("thread and message keys are stable, so re-syncing never duplicates", () => {
  assert.equal(threadId(123), "beds24:123");
  assert.equal(threadId("123"), threadId(123));
  assert.equal(messageId(9), "beds24:9");
});

test("a reply we sent matches Beds24's copy despite whitespace changes", () => {
  assert.ok(sameText("Hi  there,\nsee you soon", "Hi there, see you soon"));
  assert.ok(!sameText("Hi there", "Hi there!"));
  assert.ok(!sameText("", ""));
});

test("the same guest is recognised by email and phone across bookings", () => {
  assert.equal(normaliseEmail("  Jane@Example.COM "), "jane@example.com");
  assert.equal(normaliseEmail("not-an-email"), null);
  assert.equal(normalisePhone("+44 7700 900-123"), "+447700900123");
  assert.equal(normalisePhone("12"), null);
});

test("names fall back to Guest", () => {
  assert.equal(guestName({ firstName: "Jane", lastName: "Doe" }), "Jane Doe");
  assert.equal(guestName({ firstName: " ", lastName: "" }), "Guest");
});

test("payment tokens never reach the database", () => {
  const kept = safeBooking({ id: 1, firstName: "Jane", stripeToken: "tok", pcibookingToken: "pci" });
  assert.deepEqual(Object.keys(kept).sort(), ["firstName", "id"]);
});
