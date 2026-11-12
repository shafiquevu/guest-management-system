import { randomUUID } from "node:crypto";
import { BUCKET, ensureBucket } from "@/lib/attachments";
import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { checkAttachment, safeFileName } from "@/lib/whatsapp/media";

/**
 * A one-time upload slot for a file staff are about to send.
 *
 * Body: { conversationId, name, type, size } -> { path, token }
 *
 * The browser uploads straight to private storage with the token (Vercel caps
 * request bodies at 4.5 MB, so files never pass through this server), then
 * calls /api/send with { attachment: { path, name, type } }.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager", "agent"]);
    const input = await request.json().catch(() => ({}));
    const file = { name: String(input?.name ?? ""), type: String(input?.type ?? ""), size: Number(input?.size) || 0 };

    const db = supabaseAdmin();
    const { data: conversation } = await db
      .from("conversations")
      .select("id, organization_id, channel, assigned_to, property_id")
      .eq("id", String(input?.conversationId ?? ""))
      .maybeSingle();
    if (!conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }
    if (conversation.channel !== "whatsapp") {
      return Response.json({ error: "Attachments can be sent on WhatsApp conversations only." }, { status: 400 });
    }
    const problem = checkAttachment(file);
    if (problem) return Response.json({ error: problem }, { status: 400 });

    await ensureBucket();
    const path = `${conversation.organization_id}/outbox/${randomUUID()}/${safeFileName(file.name)}`;
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return Response.json({ error: `Upload could not start: ${error?.message}` }, { status: 500 });
    return Response.json({ path, token: data.token });
  } catch (error) {
    return errorResponse(error);
  }
}
