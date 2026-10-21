import { canSeeConversation, errorResponse, requireStaff } from "@/lib/auth/staff";
import { beds24, isConfigured } from "@/lib/beds24/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { refreshConversation } from "@/lib/sync/beds24";

/**
 * Mark a conversation's guest messages as read -- here, and in Beds24 so the
 * unread badge clears there too. Read-only staff can open a thread without
 * clearing it for everyone else.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/conversations/[id]/read">) {
  try {
    const staff = await requireStaff(request);
    const { id } = await ctx.params;
    const db = supabaseAdmin();

    const { data: conversation } = await db
      .from("conversations")
      .select("id, organization_id, assigned_to, property_id")
      .eq("id", id)
      .single();
    if (!conversation || !(await canSeeConversation(staff, conversation))) {
      return Response.json({ error: "Conversation not found." }, { status: 404 });
    }
    if (staff.role === "read_only") return Response.json({ ok: true, unchanged: true });

    const { data: unread } = await db
      .from("messages")
      .select("id, external_message_id")
      .eq("conversation_id", id)
      .eq("direction", "inbound")
      .is("read_at", null);
    if (!unread?.length) return Response.json({ ok: true, marked: 0 });

    const now = new Date().toISOString();
    await db
      .from("messages")
      .update({ read_at: now, status: "read" })
      .in("id", unread.map((m) => m.id));

    const beds24Ids = unread
      .map((m) => /^beds24:(\d+)$/.exec(m.external_message_id ?? "")?.[1])
      .filter((x): x is string => Boolean(x))
      .map(Number);
    if (beds24Ids.length && isConfigured()) {
      try {
        await beds24("POST", "/bookings/messages", {
          body: beds24Ids.map((mid) => ({ id: mid, read: true })),
        });
      } catch (e) {
        // Not worth failing the click over; the inbox is already correct.
        console.warn("could not mark read in Beds24", e);
      }
    }

    await refreshConversation(id);
    return Response.json({ ok: true, marked: unread.length });
  } catch (error) {
    return errorResponse(error);
  }
}
