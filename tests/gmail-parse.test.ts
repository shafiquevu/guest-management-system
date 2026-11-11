import { test } from "node:test";
import assert from "node:assert/strict";
import { address, attachmentNames, bodyText, isGuestMail, type GmailMessage } from "../src/lib/gmail/parse.ts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const mail = (headers: Record<string, string>, payload: Partial<GmailMessage["payload"]> = {}): GmailMessage => ({
  id: "m1",
  threadId: "t1",
  payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })), ...payload },
});

test("reads names and addresses from From headers", () => {
  assert.deepEqual(address('"Jane Doe" <Jane@Example.com>'), { name: "Jane Doe", email: "jane@example.com" });
  assert.deepEqual(address("guest@example.com"), { name: "", email: "guest@example.com" });
});

test("keeps the new text and drops the quoted earlier emails", () => {
  const text = "Hi, what time is check-in?\nThanks, Jane\n\nOn Mon, 10 Nov 2026 at 09:00, Samara House <team@x.com> wrote:\n> Welcome!\n> See you soon";
  const m = mail({}, { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64(text) } }] });
  assert.equal(bodyText(m), "Hi, what time is check-in?\nThanks, Jane");
});

test("handles Gmail's two-line 'wrote:' and Outlook's From/Sent blocks", () => {
  const two = "Yes please\n\nOn Mon, 10 Nov 2026 at 09:00 Samara House\n<team@x.com> wrote:\n> old";
  assert.equal(bodyText(mail({}, { mimeType: "text/plain", body: { data: b64(two) } })), "Yes please");
  const outlook = "Arriving at 6pm\n\nFrom: Samara House <team@x.com>\nSent: Monday\nSubject: Booking";
  assert.equal(bodyText(mail({}, { mimeType: "text/plain", body: { data: b64(outlook) } })), "Arriving at 6pm");
});

test("falls back to HTML when there is no plain text", () => {
  const html = "<div>Hello<br>Is parking free?</div><blockquote>old thread</blockquote>";
  assert.equal(bodyText(mail({}, { mimeType: "text/html", body: { data: b64(html) } })), "Hello\nIs parking free?");
});

test("lists attachment names", () => {
  const m = mail({}, { mimeType: "multipart/mixed", parts: [
    { mimeType: "text/plain", body: { data: b64("see photo") } },
    { mimeType: "image/jpeg", filename: "leak.jpg", body: { attachmentId: "a1", size: 10 } },
  ] });
  assert.deepEqual(attachmentNames(m.payload), ["leak.jpg"]);
});

test("ignores platform notifications, automated senders and newsletters", () => {
  assert.equal(isGuestMail(mail({}), "jane@gmail.com"), true);
  assert.equal(isGuestMail(mail({}), "automated@airbnb.com"), false);
  assert.equal(isGuestMail(mail({}), "noreply@guest.booking.com"), false);
  assert.equal(isGuestMail(mail({}), "no-reply@hotel.com"), false);
  assert.equal(isGuestMail(mail({ "List-Unsubscribe": "<mailto:x>" }), "news@shop.com"), false);
  assert.equal(isGuestMail(mail({ "Auto-Submitted": "auto-replied" }), "jane@gmail.com"), false);
  assert.equal(isGuestMail(mail({}), "notification.jane@gmail.com"), true);
});
