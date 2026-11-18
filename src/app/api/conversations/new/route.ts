import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { sendGmailNew } from "@/lib/gmail/send";
import { gmailConnection } from "@/lib/gmail/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/sync/beds24";
import { ensureEmailGuest } from "@/lib/sync/gmail";
import { ensureWhatsAppConversation, whatsappConnection } from "@/lib/sync/whatsapp";
import { listTemplates, renderTemplate, sendWhatsAppTemplate, whatsappConfigured } from "@/lib/whatsapp/client";

export const maxDuration = 30;

/**
 * "New chat": staff write to a guest first.
 *
 * WhatsApp: { channel: "whatsapp", phone, name?, template, values }
 *   WhatsApp only lets a business start a chat (or write after 24 hours of
 *   silence) with a template Meta approved, so the first message is always one.
 *   If a chat with this number already exists, nothing is sent: the inbox opens
 *   it ({ existing: true }) and the reply box takes it from there.
 *
 * Email:    { channel: "email", email, name?, subject, body }
 *   A new Gmail thread from the connected mailbox. The guest's reply arrives in
 *   the same conversation through the normal email sync.
 *
 * -> { conversationId, existing? } or { error }
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    const input = await request.json().catch(() => ({}));
    const db = supabaseAdmin();
    const name = String(input?.name ?? "").trim().slice(0, 120);

    // Agents see only chats assigned to them, so a chat they start is theirs.
    const assign = async (id: string) => {
      await db.from("conversations").update({ assigned_to: staff.id }).eq("id", id).is("assigned_to", null);
    };
    const event = (conversationId: string, data: Record<string, unknown>) =>
      db.from("conversation_events").insert({
        organization_id: staff.organizationId,
        conversation_id: conversationId,
        actor_id: staff.id,
        event_type: "chat_started",
        data,
      });

    if (input?.channel === "whatsapp") {
      // Digits only, with the country code: "+44 7700 900123" -> 447700900123.
      const phone = String(input?.phone ?? "").replace(/[^\d]/g, "").replace(/^00/, "");
      if (!/^\d{8,15}$/.test(phone)) {
        return Response.json({ error: "Enter the full number with the country code, e.g. +44 7700 900123." }, { status: 400 });
      }
      if (!whatsappConfigured()) return Response.json({ error: "WhatsApp is not connected." }, { status: 503 });
      const conn = await whatsappConnection();
      if (!conn || conn.organization_id !== staff.organizationId) {
        return Response.json({ error: "WhatsApp is not connected in Settings." }, { status: 503 });
      }

      const { data: known } = await db
        .from("conversations")
        .select("id, organization_id, channel, assigned_to, property_id")
        .eq("organization_id", staff.organizationId)
        .eq("channel", "whatsapp")
        .eq("external_thread_id", `whatsapp:${phone}`)
        .maybeSingle();
      if (known) {
        if (!(await canSeeConversation(staff, known))) {
          return Response.json({ error: "There is already a chat with this number, assigned to someone else." }, { status: 409 });
        }
        return Response.json({ conversationId: known.id, existing: true });
      }

      const templates = await listTemplates();
      const template = templates.find((t) => t.name === input?.template?.name && t.language === input?.template?.language);
      if (!template) return Response.json({ error: "Pick an approved template." }, { status: 400 });
      const values: Record<string, string> = {};
      for (const p of template.params) {
        const v = String(input?.values?.[p] ?? "").trim();
        if (!v) return Response.json({ error: `Fill in {{${p}}}.` }, { status: 400 });
        values[p] = v.slice(0, 500);
      }

      // Send first: a number that isn't on WhatsApp must not leave an empty chat behind.
      let sent: { id: string; raw: unknown };
      try {
        sent = await sendWhatsAppTemplate(phone, template, values);
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
      const conversation = await ensureWhatsAppConversation(conn, phone, name);
      const now = new Date().toISOString();
      await db.from("messages").upsert(
        {
          organization_id: staff.organizationId,
          conversation_id: conversation.id,
          channel: "whatsapp",
          external_message_id: `whatsapp:${sent.id}`,
          direction: "outbound",
          status: "sent",
          sender_name: staff.fullName,
          sent_by: staff.id,
          recipient_address: `+${phone}`,
          body: renderTemplate(template, values),
          content_type: "text",
          raw_payload: { template: template.name, language: template.language, values },
          provider_response: sent.raw,
          sent_at: now,
        },
        { onConflict: "organization_id,channel,external_message_id", ignoreDuplicates: true },
      );
      await refreshConversation(conversation.id);
      await assign(conversation.id);
      await event(conversation.id, { channel: "whatsapp", template: template.name });
      return Response.json({ conversationId: conversation.id });
    }

    if (input?.channel === "email") {
      const email = String(input?.email ?? "").trim().toLowerCase();
      const subject = String(input?.subject ?? "").trim().slice(0, 200);
      const body = String(input?.body ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
      if (!subject) return Response.json({ error: "Add a subject." }, { status: 400 });
      if (!body || body.length > 5000) return Response.json({ error: "Write a message between 1 and 5000 characters." }, { status: 400 });
      const conn = await gmailConnection();
      if (!conn || conn.organizationId !== staff.organizationId) {
        return Response.json({ error: "Gmail is not connected. An admin can connect it in Settings." }, { status: 503 });
      }

      let sent: { id: string; threadId: string; from: string };
      try {
        sent = await sendGmailNew(email, subject, body);
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
      const guestId = await ensureEmailGuest(staff.organizationId, email, name);
      const { data: conversation, error } = await db
        .from("conversations")
        .upsert(
          {
            organization_id: staff.organizationId,
            channel_connection_id: conn.id,
            channel: "gmail",
            external_thread_id: `gmail:${sent.threadId}`,
            guest_id: guestId,
            subject,
          },
          { onConflict: "organization_id,channel,external_thread_id" },
        )
        .select("id")
        .single();
      if (error || !conversation) throw new Error(`conversation: ${error?.message}`);
      const now = new Date().toISOString();
      await db.from("messages").upsert(
        {
          organization_id: staff.organizationId,
          conversation_id: conversation.id,
          channel: "gmail",
          // The email sync knows this id and won't import the sent email twice.
          external_message_id: `gmail:${sent.id}`,
          direction: "outbound",
          status: "sent",
          sender_name: staff.fullName,
          sent_by: staff.id,
          sender_address: sent.from,
          recipient_address: email,
          body,
          content_type: "text",
          raw_payload: { id: sent.id, threadId: sent.threadId, subject, to: email, from: sent.from },
          sent_at: now,
        },
        { onConflict: "organization_id,channel,external_message_id", ignoreDuplicates: true },
      );
      await refreshConversation(conversation.id);
      await assign(conversation.id);
      await event(conversation.id, { channel: "email" });
      return Response.json({ conversationId: conversation.id });
    }

    return Response.json({ error: "Choose WhatsApp or email." }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
