import { test } from "node:test";
import assert from "node:assert/strict";
import { messagePreview, parseMessage } from "../src/lib/format.ts";

const airbnb =
  '<a href="https://a0.muscache.com/im/pictures-signed/x.jpeg?a=1&amp;b=2"><img src="https://a0.muscache.com/im/pictures-signed/x.jpeg?a=1&amp;b=2&im_w=1200" style="height:100px"></a>';

test("airbnb photo becomes an image, not text", () => {
  const r = parseMessage(airbnb);
  assert.equal(r.text, "");
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].href, "https://a0.muscache.com/im/pictures-signed/x.jpeg?a=1&b=2");
  assert.equal(messagePreview(airbnb), "📷 Photo");
});

test("plain text is untouched", () => {
  assert.deepEqual(parseMessage("Hi, what is the Wi-Fi? <3"), { text: "Hi, what is the Wi-Fi? <3", images: [] });
});

test("non-https links are not turned into images", () => {
  const r = parseMessage('<a href="javascript:alert(1)"><img src="javascript:x"></a>see');
  assert.equal(r.images.length, 0);
  assert.equal(r.text, "see");
});
