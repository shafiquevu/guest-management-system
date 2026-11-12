import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { registerWebhook, whatsappConfigured } from "@/lib/whatsapp/client";

/**
 * POST   -> connect WhatsApp (admin only): tells 360dialog to send this number's
 *           messages and receipts to this app, and turns the channel on.
 * DELETE -> disconnect. Chats already in the inbox stay; new messages stop arriving.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin"]);
    if (!whatsappConfigured()) {
      return Response.json(
        { error: "WhatsApp is not set up on the server (D360_API_KEY / WHATSAPP_WEBHOOK_KEY missing)." },
        { status: 503 },
      );
    }
    try {
      await registerWebhook(new URL(request.url).origin);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }

    const db = supabaseAdmin();
    const { data: existing } = await db
      .from("channel_connections")
      .select("id")
      .eq("organization_id", staff.organizationId)
      .eq("channel", "whatsapp")
      .limit(1)
      .maybeSingle();
    const now = new Date().toISOString();
    const { error } = existing
      ? await db.from("channel_connections").update({ active: true, last_error: null, updated_at: now }).eq("id", existing.id)
      : await db.from("channel_connections").insert({
          organization_id: staff.organizationId,
          channel: "whatsapp",
          display_name: "WhatsApp",
          active: true,
          metadata: { provider: "360dialog" },
        });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin"]);
    await supabaseAdmin()
      .from("channel_connections")
      .update({ active: false, last_error: null })
      .eq("organization_id", staff.organizationId)
      .eq("channel", "whatsapp");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
