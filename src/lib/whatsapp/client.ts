import "server-only";

import { sendErrorText } from "@/lib/whatsapp/parse";

/**
 * WhatsApp through 360dialog (WhatsApp Business API, Coexistence: the same
 * number keeps working in the WhatsApp Business app on the phone).
 *
 * Needs:
 *   D360_API_KEY           the API key from the 360dialog hub (never in the browser)
 *   WHATSAPP_WEBHOOK_KEY   a long random string; 360dialog calls
 *                          <app>/api/webhooks/whatsapp?key=<this>, and anything
 *                          without it is refused
 *   APP_URL                the app's public address, used for that webhook
 */

const BASE = (process.env.D360_API_URL || "https://waba-v2.360dialog.io").replace(/\/$/, "");

export class WhatsAppError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.D360_API_KEY && process.env.WHATSAPP_WEBHOOK_KEY);
}

async function d360<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "D360-API-KEY": process.env.D360_API_KEY ?? "", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new WhatsAppError(sendErrorText(data, res.status), res.status);
  return data as T;
}

/** Send a text to a guest. Returns WhatsApp's message id (wamid…). */
export async function sendWhatsAppText(to: string, text: string): Promise<{ id: string; raw: unknown }> {
  const data = await d360<{ messages?: { id: string }[] }>("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the request but returned no message id.");
  return { id, raw: data };
}

/**
 * Download a photo or file a guest sent. WhatsApp gives a media id; 360dialog
 * returns a Meta link for it, which must be fetched back through 360dialog
 * (same path, 360dialog's host, our API key). Links only work for ~5 minutes,
 * so this runs as soon as the message arrives.
 */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; type: string }> {
  const meta = await d360<{ url?: string; mime_type?: string }>("GET", `/${encodeURIComponent(mediaId)}`);
  if (!meta.url) throw new WhatsAppError("360dialog returned no link for this media.");
  const link = new URL(meta.url);
  const res = await fetch(`${BASE}${link.pathname}${link.search}`, {
    headers: { "D360-API-KEY": process.env.D360_API_KEY ?? "" },
    cache: "no-store",
  });
  if (!res.ok) throw new WhatsAppError(`Media download failed (HTTP ${res.status}).`, res.status);
  const type = (res.headers.get("content-type") ?? meta.mime_type ?? "").split(";")[0].trim();
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: type || meta.mime_type || "application/octet-stream" };
}

/**
 * Send a photo, video, voice note or document. `link` is a short-lived signed
 * URL to our private storage; WhatsApp downloads the file from it once.
 * Audio can't carry a caption, so a caption on audio goes as a second text.
 */
export async function sendWhatsAppMedia(
  to: string,
  kind: "image" | "video" | "audio" | "document",
  link: string,
  caption: string,
  fileName: string,
): Promise<{ id: string; raw: unknown }> {
  const media: Record<string, string> = { link };
  if (caption && kind !== "audio") media.caption = caption;
  if (kind === "document") media.filename = fileName;
  const data = await d360<{ messages?: { id: string }[] }>("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: kind,
    [kind]: media,
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the request but returned no message id.");
  if (caption && kind === "audio") await sendWhatsAppText(to, caption).catch(() => null);
  return { id, raw: data };
}

export function webhookUrl(origin: string): string {
  const base = (process.env.APP_URL || origin).replace(/\/$/, "");
  return `${base}/api/webhooks/whatsapp?key=${encodeURIComponent(process.env.WHATSAPP_WEBHOOK_KEY ?? "")}`;
}

/** Point the number's incoming messages and delivery receipts at this app. */
export async function registerWebhook(origin: string): Promise<void> {
  await d360("POST", "/v1/configs/webhook", { url: webhookUrl(origin) });
}
