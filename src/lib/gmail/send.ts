import "server-only";
import { gmail, gmailConnection } from "@/lib/gmail/client";
import { address } from "@/lib/gmail/parse";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Raw = { threadId?: string; messageId?: string; references?: string; subject?: string; from?: string; cc?: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** RFC 2047 encoding, so names and subjects in any language arrive intact. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/**
 * Reply in the guest's Gmail thread, from the connected mailbox, to the last
 * person who wrote in. Returns Gmail's id for the sent email.
 */
export async function sendGmailReply(conversationId: string, text: string): Promise<{ id: string }> {
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
  const raw = (last?.raw_payload ?? {}) as Raw;
  const to = last?.sender_address || address(raw.from ?? "").email;
  if (!to || !raw.threadId) throw new Error("There is no guest email in this conversation to reply to.");

  const subject = raw.subject ? (/^re:/i.test(raw.subject) ? raw.subject : `Re: ${raw.subject}`) : "Re: your message";
  const references = [raw.references, raw.messageId].filter(Boolean).join(" ").trim();
  const mime = [
    `From: ${conn.email}`,
    `To: ${to}`,
    `Subject: ${word(subject)}`,
    ...(raw.messageId ? [`In-Reply-To: ${raw.messageId}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text).replace(/.{76}/g, "$&\r\n"),
  ].join("\r\n");

  return gmail<{ id: string }>(conn, "/messages/send", {
    method: "POST",
    body: { raw: Buffer.from(mime, "utf8").toString("base64url"), threadId: raw.threadId },
  });
}
