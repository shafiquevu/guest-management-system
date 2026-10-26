import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { draftReply } from "@/lib/ai/draft";
import { aiConfigured } from "@/lib/ai/triage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Suggest a reply for the reply box. Body: { conversationId }.
 * Returns { reply, missing, manager_needed }. Never sends anything: staff
 * review the draft and press Send themselves.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    if (!aiConfigured()) return Response.json({ error: "AI is not switched on yet." }, { status: 503 });
    const body = await request.json().catch(() => ({}));
    const conversationId = String(body?.conversationId ?? "");
    if (!conversationId) return Response.json({ error: "Missing conversation." }, { status: 400 });

    const { data: conversation } = await supabaseAdmin()
      .from("conversations")
      .select("organization_id, assigned_to, property_id")
      .eq("id", conversationId)
      .single();
    if (!conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }

    const draft = await draftReply(conversationId);
    return Response.json({ reply: draft.reply, missing: draft.missing, manager_needed: draft.manager_needed });
  } catch (error) {
    return errorResponse(error);
  }
}
