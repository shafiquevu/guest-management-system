import { test } from "node:test";
import assert from "node:assert/strict";
import { messageText, parseWebhook, sendErrorText } from "../src/lib/whatsapp/parse.ts";

const wrap = (field: string, value: object) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "waba1", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { display_phone_number: "44 7700 900111", phone_number_id: "p1" }, ...value } }] }],
});

test("a guest text becomes a message with name and number", () => {
  const events = parseWebhook(
    wrap("messages", {
      contacts: [{ profile: { name: "Jane Doe" }, wa_id: "447700900222" }],
      messages: [{ from: "447700900222", id: "wamid.A", timestamp: "1762950000", type: "text", text: { body: " What time is check-in? " } }],
    }),
  );
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    kind: "message",
    id: "wamid.A",
    guest: "447700900222",
    guestName: "Jane Doe",
    at: new Date(1762950000 * 1000).toISOString(),
    text: "What time is check-in?",
    type: "text",
    businessNumber: "447700900111",
  });
});

test("photos, documents and locations read as short labels with captions", () => {
  assert.equal(messageText({ type: "image", image: { caption: "the broken tap" } }), "📷 Photo\nthe broken tap");
  assert.equal(messageText({ type: "document", document: { filename: "passport.pdf" } }), "📎 Document (passport.pdf)");
  assert.equal(messageText({ type: "location", location: { latitude: 51.5, longitude: -0.1 } }), "📍 51.5, -0.1");
  assert.equal(messageText({ type: "audio", audio: {} }), "🎤 Voice message");
  assert.equal(messageText({ type: "reaction", reaction: { emoji: "👍" } }), "Reacted 👍");
});

test("replies sent from the phone app arrive as echoes to the guest", () => {
  const events = parseWebhook(
    wrap("smb_message_echoes", {
      message_echoes: [{ from: "447700900111", to: "447700900222", id: "wamid.B", timestamp: "1762950100", type: "text", text: { body: "Check-in is from 3pm" } }],
    }),
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "echo");
  assert.equal(events[0].kind !== "status" && events[0].guest, "447700900222");
  assert.equal(events[0].kind !== "status" && events[0].text, "Check-in is from 3pm");
});

test("delivery receipts become statuses, failures keep the reason", () => {
  const events = parseWebhook(
    wrap("messages", {
      statuses: [
        { id: "wamid.C", status: "read", timestamp: "1762950200", recipient_id: "447700900222" },
        { id: "wamid.D", status: "failed", timestamp: "1762950300", recipient_id: "447700900222", errors: [{ code: 131026, title: "Message undeliverable" }] },
        { id: "wamid.E", status: "deleted", timestamp: "1762950300", recipient_id: "447700900222" },
      ],
    }),
  );
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.kind === "status" && e.status), ["read", "failed"]);
  assert.equal(events[1].kind === "status" && events[1].error, "Message undeliverable");
});

test("anything else is ignored", () => {
  assert.deepEqual(parseWebhook(null), []);
  assert.deepEqual(parseWebhook({ entry: [{ changes: [{ field: "history", value: { history: [] } }] }] }), []);
  assert.deepEqual(parseWebhook(wrap("messages", { messages: [{ id: "x" }] })), []);
});

test("send errors read in plain language", () => {
  assert.match(sendErrorText({ error: { code: 131047, message: "Re-engagement message" } }, 400), /24 hours/);
  assert.match(sendErrorText({}, 401), /API key/);
  assert.equal(sendErrorText({ error: { message: "Invalid parameter" } }, 400), "WhatsApp: Invalid parameter");
});

test("photos, voice notes and documents carry their media id for download", () => {
  const events = parseWebhook(
    wrap("messages", {
      messages: [
        { from: "447700900222", id: "wamid.P", timestamp: "1762950000", type: "image", image: { id: "media1", mime_type: "image/jpeg", caption: "door panel" } },
        { from: "447700900222", id: "wamid.V", timestamp: "1762950001", type: "audio", audio: { id: "media2", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { from: "447700900222", id: "wamid.D", timestamp: "1762950002", type: "document", document: { id: "media3", mime_type: "application/pdf", filename: "passport.pdf" } },
        { from: "447700900222", id: "wamid.L", timestamp: "1762950003", type: "location", location: { latitude: 1, longitude: 2 } },
      ],
    }),
  );
  const media = events.map((e) => (e.kind !== "status" ? e.media : undefined));
  assert.deepEqual(media, [
    { id: "media1", mime: "image/jpeg" },
    { id: "media2", mime: "audio/ogg; codecs=opus" },
    { id: "media3", mime: "application/pdf", filename: "passport.pdf" },
    undefined,
  ]);
});
