import { BUCKET } from "@/lib/attachments";
import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Signed links (valid 1 hour) for the stored photos in one conversation.
 * Body: { conversationId } -> { byMessage: { [messageId]: string[] } }
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request);
    const { conversationId } = await request.json().catch(() => ({}));
    if (!conversationId) return Response.json({ error: "conversationId is required" }, { status: 400 });

    const db = supabaseAdmin();
    const { data: conversation } = await db
      .from("conversations")
      .select("id, organization_id, assigned_to, property_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const { data: rows } = await db
      .from("message_attachments")
      .select("message_id, storage_path, messages!inner(conversation_id)")
      .eq("messages.conversation_id", conversationId)
      .not("storage_path", "is", null)
      .order("file_name");
    if (!rows?.length) return Response.json({ byMessage: {} });

    const { data: signed } = await db.storage
      .from(BUCKET)
      .createSignedUrls(rows.map((r) => r.storage_path as string), 3600);

    const byMessage: Record<string, string[]> = {};
    rows.forEach((r, i) => {
      const url = signed?.[i]?.signedUrl;
      if (url) (byMessage[r.message_id as string] ??= []).push(url);
    });
    return Response.json({ byMessage });
  } catch (error) {
    return errorResponse(error);
  }
}
