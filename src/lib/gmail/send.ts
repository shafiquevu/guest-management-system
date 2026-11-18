import "server-only";
import { gmail, gmailConnection } from "@/lib/gmail/client";
import { address } from "@/lib/gmail/parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Raw = { threadId?: string; messageId?: string; references?: string; subject?: string; from?: string; to?: string; cc?: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** RFC 2047 encoding, so names and subjects in any language arrive intact. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/**
 * Reply in the guest's Gmail thread, from the connected mailbox, to the last
 * person who wrote in. Returns Gmail's id for the sent email.
 */
/** Addresses typed by staff ("a@x.com, b@y.com; c@z.com"): valid ones, lower-cased, no repeats; null if any is invalid. */
export function emailList(input: unknown): string[] | null {
  const parts = (Array.isArray(input) ? input.join(",") : String(input ?? ""))
    .split(/[,;\s]+/)
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  if (parts.some((a) => !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(a))) return null;
  return [...new Set(parts)].slice(0, 20);
}

export type SentEmail = { id: string; to: string; cc: string[]; bcc: string[] };

export async function sendGmailReply(
  conversationId: string,
  text: string,
  opts: { replyAll?: boolean; cc?: string[]; bcc?: string[] } = {},
): Promise<SentEmail> {
  const conn = await gmailConnection();
  if (!conn) throw new Error("Gmail is not connected. An admin can connect it in Settings.");

  const { data: last } = await supabaseAdmin()
    .from("messages")
    .select("raw_payload, sender_address")
    .eq("conversation_id", conversationId)
    .eq("channel", "gmail")
    .eq("direction", "inbound")
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // A chat we started ("New chat") has no reply from the guest yet: write again
  // to the address we wrote to, in the same thread.
  const { data: ours } = last
    ? { data: null }
    : await supabaseAdmin()
        .from("messages")
        .select("raw_payload, recipient_address")
        .eq("conversation_id", conversationId)
        .eq("channel", "gmail")
        .eq("direction", "outbound")
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const raw = ((last ?? ours)?.raw_payload ?? {}) as Raw;
  const to = last?.sender_address || (last ? address(raw.from ?? "").email : ours?.recipient_address || "");
  if (!to || !raw.threadId) throw new Error("There is no guest email in this conversation to reply to.");

  const subject = raw.subject ? (/^re:/i.test(raw.subject) ? raw.subject : `Re: ${raw.subject}`) : "Re: your message";
  const references = [raw.references, raw.messageId].filter(Boolean).join(" ").trim();
  // Reply all: everyone else on the guest's email (its To and Cc), never our own mailbox.
  // Plus anyone staff added in Cc / Bcc.
  const all = opts.replyAll
    ? (`${raw.to ?? ""},${raw.cc ?? ""}`.match(/[^\s<>,;"']+@[^\s<>,;"']+/g)?.map((a) => a.toLowerCase()) ?? [])
    : [];
  const self = [to.toLowerCase(), conn.email.toLowerCase()];
  const cc = [...new Set([...all, ...(opts.cc ?? [])])].filter((a) => !self.includes(a));
  const bcc = [...new Set(opts.bcc ?? [])].filter((a) => !self.includes(a) && !cc.includes(a));
  const mime = [
    `From: ${conn.email}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${word(subject)}`,
    ...(raw.messageId ? [`In-Reply-To: ${raw.messageId}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");

  const sent = await gmail<{ id: string }>(conn, "/messages/send", {
    method: "POST",
    body: { raw: Buffer.from(mime, "utf8").toString("base64url"), threadId: raw.threadId },
  });
  return { id: sent.id, to, cc, bcc };
}

/**
 * Start a new email thread from the connected mailbox ("New chat").
 * Returns Gmail's ids, so the guest's reply lands in the same conversation.
 */
export async function sendGmailNew(
  to: string,
  subject: string,
  text: string,
  opts: { cc?: string[]; bcc?: string[] } = {},
): Promise<{ id: string; threadId: string; from: string; cc: string[]; bcc: string[] }> {
  const conn = await gmailConnection();
  if (!conn) throw new Error("Gmail is not connected. An admin can connect it in Settings.");
  const self = [to.toLowerCase(), conn.email.toLowerCase()];
  const cc = [...new Set(opts.cc ?? [])].filter((a) => !self.includes(a));
  const bcc = [...new Set(opts.bcc ?? [])].filter((a) => !self.includes(a) && !cc.includes(a));
  const mime = [
    `From: ${conn.email}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${word(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");
  const sent = await gmail<{ id: string; threadId: string }>(conn, "/messages/send", {
    method: "POST",
    body: { raw: Buffer.from(mime, "utf8").toString("base64url") },
  });
  if (!sent?.id || !sent.threadId) throw new Error("Gmail sent the email but returned no thread id.");
  return { ...sent, from: conn.email, cc, bcc };
}
