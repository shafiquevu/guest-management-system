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

export function webhookUrl(origin: string): string {
  const base = (process.env.APP_URL || origin).replace(/\/$/, "");
  return `${base}/api/webhooks/whatsapp?key=${encodeURIComponent(process.env.WHATSAPP_WEBHOOK_KEY ?? "")}`;
}

/** Point the number's incoming messages and delivery receipts at this app. */
export async function registerWebhook(origin: string): Promise<void> {
  await d360("POST", "/v1/configs/webhook", { url: webhookUrl(origin) });
}
