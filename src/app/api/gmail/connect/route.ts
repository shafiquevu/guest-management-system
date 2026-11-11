import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { authUrl, gmailConfigured, makeState } from "@/lib/gmail/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST   -> { url }: the Google sign-in page for connecting the team mailbox (admin only).
 * DELETE -> disconnect Gmail. Conversations already imported stay in the inbox.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin"]);
    if (!gmailConfigured()) {
      return Response.json({ error: "Gmail is not set up on the server (GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing)." }, { status: 503 });
    }
    return Response.json({ url: authUrl(new URL(request.url).origin, makeState(staff.id)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin"]);
    await supabaseAdmin()
      .from("channel_connections")
      .update({ active: false, metadata: null, last_error: null })
      .eq("organization_id", staff.organizationId)
      .eq("channel", "gmail");
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
