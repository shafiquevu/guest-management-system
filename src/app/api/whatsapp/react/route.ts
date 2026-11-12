import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyReaction } from "@/lib/sync/whatsapp";
import { sendWhatsAppReaction, whatsappConfigured } from "@/lib/whatsapp/client";

/** The reactions offered in the inbox (WhatsApp's own quick set). */
const ALLOWED = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * React to a WhatsApp message from the inbox.
 * Body: { messageId, emoji } — emoji "" removes the team's reaction.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    const input = await request.json().catch(() => ({}));
    const emoji = String(input?.emoji ?? "");
    if (emoji && !ALLOWED.includes(emoji)) return Response.json({ error: "Unsupported reaction." }, { status: 400 });
    if (!whatsappConfigured()) return Response.json({ error: "WhatsApp is not connected." }, { status: 503 });

    const db = supabaseAdmin();
    const { data: msg } = await db
      .from("messages")
      .select("id, conversation_id, external_message_id")
      .eq("id", String(input?.messageId ?? ""))
      .maybeSingle();
    const { data: conversation } = msg
      ? await db
          .from("conversations")
          .select("id, organization_id, channel, assigned_to, property_id, external_thread_id")
          .eq("id", msg.conversation_id)
          .maybeSingle()
      : { data: null };
    if (!msg || !conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Message not found." }, { status: 404 });
    }
    const ext = String(msg.external_message_id ?? "");
    const number = String(conversation.external_thread_id ?? "").replace(/^whatsapp:/, "");
    if (conversation.channel !== "whatsapp" || !ext.startsWith("whatsapp:") || !/^\d{7,15}$/.test(number)) {
      return Response.json({ error: "Only WhatsApp messages can get a reaction." }, { status: 400 });
    }

    const wamid = ext.slice("whatsapp:".length);
    try {
      await sendWhatsAppReaction(number, wamid, emoji);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
    await applyReaction(conversation.organization_id, { target: wamid, emoji, by: "team" });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
