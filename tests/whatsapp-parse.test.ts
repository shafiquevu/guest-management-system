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
  const media = events.map((e) => (e.kind === "message" || e.kind === "echo" ? e.media : undefined));
  assert.deepEqual(media, [
    { id: "media1", mime: "image/jpeg" },
    { id: "media2", mime: "audio/ogg; codecs=opus" },
    { id: "media3", mime: "application/pdf", filename: "passport.pdf" },
    undefined,
  ]);
});

import { attachmentBody, checkAttachment, mediaKind, safeFileName } from "../src/lib/whatsapp/media.ts";

test("attachments are sent as the right WhatsApp type", () => {
  assert.equal(mediaKind("image/jpeg"), "image");
  assert.equal(mediaKind("image/heic"), "document"); // WhatsApp only takes JPEG/PNG photos
  assert.equal(mediaKind("video/mp4"), "video");
  assert.equal(mediaKind("audio/ogg; codecs=opus"), "audio");
  assert.equal(mediaKind("application/pdf"), "document");
});

test("WhatsApp size limits are explained in plain words", () => {
  assert.equal(checkAttachment({ name: "a.jpg", type: "image/jpeg", size: 2_000_000 }), null);
  assert.match(checkAttachment({ name: "a.jpg", type: "image/jpeg", size: 6 * 1024 * 1024 }) ?? "", /Photos can be up to 5 MB/);
  assert.match(checkAttachment({ name: "a.pdf", type: "application/pdf", size: 25 * 1024 * 1024 }) ?? "", /Files can be up to 20 MB/);
  assert.equal(checkAttachment({ name: "", type: "", size: 0 }), "That file is empty.");
});

test("sent attachments read like received ones in the thread", () => {
  assert.equal(attachmentBody("image", "x.jpg", "the door"), "📷 Photo\nthe door");
  assert.equal(attachmentBody("document", "invoice.pdf", ""), "📎 Document (invoice.pdf)");
  assert.equal(safeFileName("../my <invoice>.pdf"), "my invoice.pdf");
});

test("replies carry the quoted message id, reactions attach to their message", () => {
  const events = parseWebhook(
    wrap("messages", {
      messages: [
        { from: "447700900222", id: "wamid.R", timestamp: "1762950000", type: "text", text: { body: "yes that one" }, context: { from: "447700900111", id: "wamid.A" } },
        { from: "447700900222", id: "wamid.X", timestamp: "1762950001", type: "reaction", reaction: { message_id: "wamid.A", emoji: "👍" } },
      ],
    }),
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].kind === "message" && events[0].replyTo, "wamid.A");
  assert.deepEqual(events[1], { kind: "reaction", target: "wamid.A", emoji: "👍", by: "guest", guest: "447700900222" });

  const echoes = parseWebhook(
    wrap("smb_message_echoes", {
      message_echoes: [{ from: "447700900111", to: "447700900222", id: "wamid.Y", timestamp: "1762950002", type: "reaction", reaction: { message_id: "wamid.R", emoji: "" } }],
    }),
  );
  assert.deepEqual(echoes, [{ kind: "reaction", target: "wamid.R", emoji: "", by: "team", guest: "447700900222" }]);
});

test("a guest's edit changes the original message instead of adding an '(edit)' bubble", () => {
  const events = parseWebhook(
    wrap("messages", {
      messages: [{
        from: "447700900222", id: "wamid.E", timestamp: "1762950100", type: "edit",
        edit: { original_message_id: "wamid.A", message: { type: "text", text: { body: "Check-in at 3pm please" } } },
      }],
    }),
  );
  assert.deepEqual(events, [{ kind: "change", target: "wamid.A", text: "Check-in at 3pm please", guest: "447700900222" }]);
});

test("a deleted message is marked, not added", () => {
  const events = parseWebhook(
    wrap("messages", {
      messages: [{ from: "447700900222", id: "wamid.R", timestamp: "1762950200", type: "revoke", revoke: { original_message_id: "wamid.A" } }],
    }),
  );
  assert.deepEqual(events, [{ kind: "change", target: "wamid.A", text: null, guest: "447700900222" }]);
});
