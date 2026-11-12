import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { beds24, isConfigured } from "@/lib/beds24/client";
import { sendGmailReply } from "@/lib/gmail/send";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/sync/beds24";
import { BUCKET } from "@/lib/attachments";
import { sendWhatsAppMedia, sendWhatsAppText, whatsappConfigured } from "@/lib/whatsapp/client";
import { attachmentBody, checkAttachment, mediaKind, safeFileName } from "@/lib/whatsapp/media";

export const maxDuration = 30;

type MultiPostResult = { success?: boolean; errors?: { message?: string }[] }[];

/**
 * Reply to a guest.
 *
 * Body: { conversationId, body, clientKey }  -- a new reply
 *       { ..., attachment: { path, name, type, size } }
 *                                            -- WhatsApp only: a file already uploaded
 *                                               via /api/attachments/upload; body is the caption
 *       { ..., replyToMessageId }            -- WhatsApp only: quote one of the thread's messages
 *       { retryMessageId }                   -- try a failed reply again
 *
 * The reply is stored first as `pending` under local:<clientKey>, so a double
 * click or a retried request cannot send twice. Then it goes to Beds24, and
 * the row becomes `sent` or `failed` with the reason. The sync later swaps
 * local:<clientKey> for Beds24's own message id by matching the text.
 * Email conversations go out through the connected Gmail mailbox instead,
 * and take Gmail's message id straight away. WhatsApp conversations go out
 * through 360dialog and take WhatsApp's id (wamid), so delivery receipts and
 * the webhook find the same row.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    const input = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    type Attachment = { path: string; name: string; type: string; size?: number };
    let row: { id: string; conversation_id: string; body: string; status: string; raw_payload?: unknown } | null = null;

    if (input?.retryMessageId) {
      const { data } = await db
        .from("messages")
        .select("id, conversation_id, body, status, raw_payload")
        .eq("id", String(input.retryMessageId))
        .single();
      if (!data || data.status !== "failed") {
        return Response.json({ error: "Only a failed reply can be retried." }, { status: 400 });
      }
      row = data;
    }

    // A retried attachment keeps its file and caption in raw_payload.
    const stored = (row?.raw_payload ?? null) as { attachment?: Attachment; caption?: string; reply_to?: string } | null;
    const attachment: Attachment | null = stored?.attachment
      ?? (input?.attachment?.path
        ? { path: String(input.attachment.path), name: String(input.attachment.name ?? "file"), type: String(input.attachment.type ?? ""), size: Number(input.attachment.size) || 0 }
        : null);
    const conversationId = row?.conversation_id ?? String(input?.conversationId ?? "");
    const text = attachment ? (stored?.caption ?? String(input?.body ?? "")).trim() : (row?.body ?? String(input?.body ?? "")).trim();
    const clientKey = String(input?.clientKey ?? "");

    if (!conversationId) return Response.json({ error: "Missing conversation." }, { status: 400 });
    if ((!text && !attachment) || text.length > 5000) {
      return Response.json({ error: "Write a reply between 1 and 5000 characters." }, { status: 400 });
    }
    if (!row && !/^[\w-]{8,64}$/.test(clientKey)) {
      return Response.json({ error: "Missing request key." }, { status: 400 });
    }

    const { data: conversation } = await db
      .from("conversations")
      .select("id, organization_id, channel, assigned_to, property_id, reservation_id, status, first_response_at")
      .eq("id", conversationId)
      .single();
    if (!conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }
    const viaGmail = conversation.channel === "gmail";
    const viaWhatsApp = conversation.channel === "whatsapp";
    if (!viaGmail && !viaWhatsApp && !["airbnb", "booking_com", "beds24"].includes(conversation.channel)) {
      return Response.json({ error: "Replying on this channel is not connected yet." }, { status: 400 });
    }

    if (attachment) {
      if (!viaWhatsApp) return Response.json({ error: "Attachments can be sent on WhatsApp conversations only." }, { status: 400 });
      // Only files uploaded for this organisation, through our upload slot.
      if (!attachment.path.startsWith(`${conversation.organization_id}/outbox/`) || attachment.path.includes("..")) {
        return Response.json({ error: "Unknown attachment." }, { status: 400 });
      }
      if (!row && attachment.size) {
        const problem = checkAttachment(attachment as { name: string; type: string; size: number });
        if (problem) return Response.json({ error: problem }, { status: 400 });
      }
    }
    const kind = attachment ? mediaKind(attachment.type) : null;

    // Quoting a message: WhatsApp needs that message's own id (wamid), so only
    // messages that came from or went through WhatsApp can be replied to.
    let replyTo: string | null = stored?.reply_to ?? null;
    if (!row && input?.replyToMessageId && viaWhatsApp) {
      const { data: quoted } = await db
        .from("messages")
        .select("external_message_id")
        .eq("id", String(input.replyToMessageId))
        .eq("conversation_id", conversation.id)
        .maybeSingle();
      const ext = String(quoted?.external_message_id ?? "");
      if (ext.startsWith("whatsapp:")) replyTo = ext.slice("whatsapp:".length);
    }
    const fileName = attachment ? safeFileName(attachment.name) : "";

    let waNumber = "";
    if (viaWhatsApp) {
      const { data: thread } = await db.from("conversations").select("external_thread_id").eq("id", conversation.id).single();
      waNumber = String(thread?.external_thread_id ?? "").replace(/^whatsapp:/, "");
      if (!/^\d{7,15}$/.test(waNumber)) return Response.json({ error: "This chat has no WhatsApp number to reply to." }, { status: 400 });
    }

    let bookingId = 0;
    if (!viaGmail && !viaWhatsApp) {
      const { data: reservation } = await db
        .from("reservations")
        .select("external_id")
        .eq("id", conversation.reservation_id)
        .single();
      bookingId = Number(reservation?.external_id);
      if (!bookingId) return Response.json({ error: "This conversation has no booking to reply to." }, { status: 400 });
    }

    if (!row) {
      const { data: inserted } = await db
        .from("messages")
        .upsert(
          {
            organization_id: conversation.organization_id,
            conversation_id: conversation.id,
            channel: conversation.channel,
            external_message_id: `local:${clientKey}`,
            direction: "outbound",
            status: "pending",
            sender_name: staff.fullName,
            sent_by: staff.id,
            body: attachment && kind ? attachmentBody(kind, fileName, text) : text,
            ...(attachment || replyTo
              ? { raw_payload: { ...(attachment ? { attachment, caption: text } : {}), ...(replyTo ? { reply_to: replyTo } : {}) } }
              : {}),
          },
          { onConflict: "organization_id,channel,external_message_id", ignoreDuplicates: true },
        )
        .select("id, conversation_id, body, status")
        .maybeSingle();
      if (!inserted) {
        // Same clientKey already used: this is a double submit. Report the original.
        const { data: existing } = await db
          .from("messages")
          .select("id, status")
          .eq("organization_id", conversation.organization_id)
          .eq("channel", conversation.channel)
          .eq("external_message_id", `local:${clientKey}`)
          .single();
        return Response.json({ messageId: existing?.id, status: existing?.status, duplicate: true });
      }
      row = inserted;
      // The thread shows the file straight away, like a received one.
      if (attachment && inserted) {
        await db.from("message_attachments").insert({
          organization_id: conversation.organization_id,
          message_id: inserted.id,
          file_name: fileName,
          file_type: attachment.type || null,
          file_size: attachment.size || null,
          storage_path: attachment.path,
        });
      }
    } else {
      await db.from("messages").update({ status: "pending", provider_error: null }).eq("id", row.id);
    }

    if (viaWhatsApp && !whatsappConfigured()) {
      await db
        .from("messages")
        .update({ status: "failed", provider_error: "WhatsApp is not connected." })
        .eq("id", row.id);
      return Response.json({ messageId: row.id, status: "failed", error: "WhatsApp is not connected." }, { status: 503 });
    }

    if (!viaGmail && !viaWhatsApp && !isConfigured()) {
      await db
        .from("messages")
        .update({ status: "failed", provider_error: "Beds24 is not connected." })
        .eq("id", row.id);
      return Response.json({ messageId: row.id, status: "failed", error: "Beds24 is not connected." }, { status: 503 });
    }

    let status: "sent" | "failed" = "failed";
    let providerError: string | null = null;
    let providerResponse: unknown = null;
    let externalId: string | null = null;
    if (viaGmail) {
      try {
        const sent = await sendGmailReply(conversation.id, text);
        providerResponse = sent;
        externalId = `gmail:${sent.id}`; // the next sync recognises it and doesn't import it twice
        status = "sent";
      } catch (e) {
        providerError = e instanceof Error ? e.message : String(e);
      }
    } else if (viaWhatsApp) {
      try {
        let sent: { id: string; raw: unknown };
        if (attachment && kind) {
          const { data: link, error: linkError } = await db.storage.from(BUCKET).createSignedUrl(attachment.path, 600);
          if (linkError || !link) throw new Error(`The file could not be read: ${linkError?.message ?? "not found"}`);
          sent = await sendWhatsAppMedia(waNumber, kind, link.signedUrl, text, fileName, replyTo ?? undefined);
        } else {
          sent = await sendWhatsAppText(waNumber, text, replyTo ?? undefined);
        }
        providerResponse = sent.raw;
        externalId = `whatsapp:${sent.id}`; // delivery receipts arrive under this id
        status = "sent";
      } catch (e) {
        providerError = e instanceof Error ? e.message : String(e);
      }
    } else {
      try {
        const { data } = await beds24<MultiPostResult>("POST", "/bookings/messages", {
          body: [{ bookingId, message: text }],
        });
        providerResponse = data;
        if (Array.isArray(data) && data[0]?.success) {
          status = "sent";
        } else {
          providerError = data?.[0]?.errors?.map((e) => e.message).filter(Boolean).join("; ") || "Beds24 did not accept the message.";
        }
      } catch (e) {
        providerError = e instanceof Error ? e.message : String(e);
      }
    }

    const now = new Date().toISOString();
    await db
      .from("messages")
      .update({
        status,
        provider_error: providerError,
        provider_response: providerResponse,
        sent_at: status === "sent" ? now : null,
        ...(externalId ? { external_message_id: externalId } : {}),
      })
      .eq("id", row.id);

    if (status === "sent") {
      await refreshConversation(conversation.id);
      if (!conversation.first_response_at) {
        await db.from("conversations").update({ first_response_at: now }).eq("id", conversation.id);
      }
      await db.from("conversation_events").insert({
        organization_id: conversation.organization_id,
        conversation_id: conversation.id,
        actor_id: staff.id,
        event_type: "reply_sent",
        data: { message_id: row.id },
      });
    }

    return Response.json(
      { messageId: row.id, status, error: providerError },
      { status: status === "sent" ? 200 : 502 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
