import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { beds24, isConfigured } from "@/lib/beds24/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/sync/beds24";

export const maxDuration = 30;

type MultiPostResult = { success?: boolean; errors?: { message?: string }[] }[];

/**
 * Reply to a guest.
 *
 * Body: { conversationId, body, clientKey }  -- a new reply
 *       { retryMessageId }                   -- try a failed reply again
 *
 * The reply is stored first as `pending` under local:<clientKey>, so a double
 * click or a retried request cannot send twice. Then it goes to Beds24, and
 * the row becomes `sent` or `failed` with the reason. The sync later swaps
 * local:<clientKey> for Beds24's own message id by matching the text.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    const input = await request.json().catch(() => ({}));
    const db = supabaseAdmin();

    let row: { id: string; conversation_id: string; body: string; status: string } | null = null;

    if (input?.retryMessageId) {
      const { data } = await db
        .from("messages")
        .select("id, conversation_id, body, status")
        .eq("id", String(input.retryMessageId))
        .single();
      if (!data || data.status !== "failed") {
        return Response.json({ error: "Only a failed reply can be retried." }, { status: 400 });
      }
      row = data;
    }

    const conversationId = row?.conversation_id ?? String(input?.conversationId ?? "");
    const text = (row?.body ?? String(input?.body ?? "")).trim();
    const clientKey = String(input?.clientKey ?? "");

    if (!conversationId) return Response.json({ error: "Missing conversation." }, { status: 400 });
    if (!text || text.length > 5000) {
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
    if (!["airbnb", "booking_com", "beds24"].includes(conversation.channel)) {
      return Response.json({ error: "Replying on this channel is not connected yet." }, { status: 400 });
    }

    const { data: reservation } = await db
      .from("reservations")
      .select("external_id")
      .eq("id", conversation.reservation_id)
      .single();
    const bookingId = Number(reservation?.external_id);
    if (!bookingId) return Response.json({ error: "This conversation has no booking to reply to." }, { status: 400 });

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
            body: text,
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
    } else {
      await db.from("messages").update({ status: "pending", provider_error: null }).eq("id", row.id);
    }

    if (!isConfigured()) {
      await db
        .from("messages")
        .update({ status: "failed", provider_error: "Beds24 is not connected." })
        .eq("id", row.id);
      return Response.json({ messageId: row.id, status: "failed", error: "Beds24 is not connected." }, { status: 503 });
    }

    let status: "sent" | "failed" = "failed";
    let providerError: string | null = null;
    let providerResponse: unknown = null;
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

    const now = new Date().toISOString();
    await db
      .from("messages")
      .update({
        status,
        provider_error: providerError,
        provider_response: providerResponse,
        sent_at: status === "sent" ? now : null,
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
