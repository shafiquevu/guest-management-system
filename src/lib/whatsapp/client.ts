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

/** Send a text to a guest; `replyTo` (a wamid) shows it as a reply to that message. Returns WhatsApp's message id. */
export async function sendWhatsAppText(to: string, text: string, replyTo?: string): Promise<{ id: string; raw: unknown }> {
  const data = await d360<{ messages?: { id: string }[] }>("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
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
  replyTo?: string,
): Promise<{ id: string; raw: unknown }> {
  const media: Record<string, string> = { link };
  if (caption && kind !== "audio") media.caption = caption;
  if (kind === "document") media.filename = fileName;
  const data = await d360<{ messages?: { id: string }[] }>("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
    type: kind,
    [kind]: media,
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the request but returned no message id.");
  if (caption && kind === "audio") await sendWhatsAppText(to, caption).catch(() => null);
  return { id, raw: data };
}

/** React to a message with an emoji; an empty emoji removes our reaction. */
export async function sendWhatsAppReaction(to: string, messageId: string, emoji: string): Promise<void> {
  await d360("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  });
}

/**
 * Message templates, for starting a chat. WhatsApp only lets a business write
 * first (or after 24 hours of silence) with a template Meta has approved.
 * Templates are created in WhatsApp Manager / the 360dialog hub; this lists
 * the approved ones that need nothing but text: a template whose header is a
 * photo, video or document, or whose button carries a variable, is left out.
 */
export type WaTemplate = {
  name: string;
  language: string;
  category: string;
  /** The body as Meta stores it, with {{1}} or {{name}} placeholders. */
  body: string;
  /** Placeholders in order of appearance, without the braces: ["1", "2"] or ["guest_name"]. */
  params: string[];
  /** A text header, if any (no variables). */
  header: string | null;
  footer: string | null;
};

type RawTemplate = {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; format?: string; text?: string; buttons?: { url?: string; text?: string }[] }[];
};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

export function templateParams(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** The template's body with the placeholders filled in: what the guest will read. */
export function renderTemplate(t: Pick<WaTemplate, "body" | "header" | "footer">, values: Record<string, string>): string {
  const body = t.body.replace(PLACEHOLDER, (_, k: string) => values[k] ?? `{{${k}}}`);
  return [t.header, body, t.footer].filter(Boolean).join("\n\n");
}

export async function listTemplates(): Promise<WaTemplate[]> {
  const data = await d360<{ waba_templates?: RawTemplate[] }>("GET", "/v1/configs/templates?limit=200");
  const out: WaTemplate[] = [];
  for (const t of data.waba_templates ?? []) {
    if (String(t.status ?? "").toLowerCase() !== "approved" || !t.name || !t.language) continue;
    const parts = t.components ?? [];
    const header = parts.find((c) => String(c.type).toUpperCase() === "HEADER");
    const body = parts.find((c) => String(c.type).toUpperCase() === "BODY");
    const footer = parts.find((c) => String(c.type).toUpperCase() === "FOOTER");
    const buttons = parts.find((c) => String(c.type).toUpperCase() === "BUTTONS");
    if (!body?.text) continue;
    if (header && (String(header.format ?? "TEXT").toUpperCase() !== "TEXT" || templateParams(header.text ?? "").length)) continue;
    if ((buttons?.buttons ?? []).some((b) => templateParams(b.url ?? "").length)) continue;
    out.push({
      name: t.name,
      language: t.language,
      category: String(t.category ?? "").toLowerCase(),
      body: body.text,
      params: templateParams(body.text),
      header: header?.text ?? null,
      footer: footer?.text ?? null,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Send an approved template. `values` fills its body placeholders. Returns WhatsApp's message id. */
export async function sendWhatsAppTemplate(
  to: string,
  t: Pick<WaTemplate, "name" | "language" | "params">,
  values: Record<string, string>,
): Promise<{ id: string; raw: unknown }> {
  // Numbered placeholders ({{1}}) are filled by position; named ones ({{guest_name}}) by name.
  const named = t.params.some((p) => !/^\d+$/.test(p));
  const parameters = t.params.map((p) => ({
    type: "text",
    text: values[p] ?? "",
    ...(named ? { parameter_name: p } : {}),
  }));
  const data = await d360<{ messages?: { id: string }[] }>("POST", "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: t.name,
      language: { code: t.language },
      ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}),
    },
  });
  const id = data.messages?.[0]?.id;
  if (!id) throw new WhatsAppError("WhatsApp accepted the template but returned no message id.");
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
