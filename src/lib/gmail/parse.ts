/**
 * Pure reading of Gmail API message shapes. No I/O, so it is unit-tested.
 */

export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
};

export function header(m: GmailMessage, name: string): string {
  const h = m.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** "Jane Doe <jane@x.com>" -> { name: "Jane Doe", email: "jane@x.com" } */
export function address(value: string): { name: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const email = value.trim().toLowerCase();
  return { name: "", email };
}

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

function find(part: GmailPart | undefined, type: string): string | null {
  if (!part) return null;
  if (part.mimeType === type && part.body?.data && !part.filename) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const hit = find(p, type);
    if (hit) return hit;
  }
  return null;
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * The new text of an email: plain text if present, else the HTML flattened,
 * with the quoted earlier conversation and the trailing whitespace removed.
 */
export function bodyText(m: GmailMessage): string {
  const raw = find(m.payload, "text/plain") ?? htmlToText(find(m.payload, "text/html") ?? "");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Where the quoted reply begins (Gmail, Outlook, Apple Mail, mobile clients).
    // Gmail sometimes wraps "On <date>, <name> wrote:" over two lines.
    if (/^On .{4,200}wrote:\s*$/i.test(line)) break;
    if (/^On .{4,200}$/.test(line) && /^.{0,120}wrote:\s*$/i.test(lines[i + 1] ?? "")) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^_{10,}\s*$/.test(line)) break;
    if (/^From:\s.+/i.test(line) && /^(Sent|Date):\s/i.test(lines[i + 1] ?? "")) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Attachment names, so staff know something was attached even before attachments are supported. */
export function attachmentNames(part: GmailPart | undefined, acc: string[] = []): string[] {
  if (!part) return acc;
  if (part.filename && part.body?.attachmentId) acc.push(part.filename);
  for (const p of part.parts ?? []) attachmentNames(p, acc);
  return acc;
}

/**
 * Mail that is not a guest writing to the team: platform notifications (they
 * arrive through Beds24 instead), automated senders, bounces and newsletters.
 */
const IGNORED_DOMAINS = [
  "airbnb.com", "booking.com", "beds24.com", "google.com", "googlemail.com", "accounts.google.com",
  "facebookmail.com", "linkedin.com", "stripe.com", "paypal.com", "amazon.com", "amazonaws.com",
];

export function isGuestMail(m: GmailMessage, fromEmail: string): boolean {
  const domain = fromEmail.split("@")[1] ?? "";
  if (IGNORED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return false;
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounces?)([+-][^@]*)?@/i.test(fromEmail)) return false;
  if (header(m, "List-Unsubscribe") || /bulk|list|junk/i.test(header(m, "Precedence"))) return false;
  if (header(m, "Auto-Submitted") && !/^no$/i.test(header(m, "Auto-Submitted"))) return false;
  return true;
}
