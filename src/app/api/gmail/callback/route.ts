import { encrypt, exchangeCode, gmail, readState } from "@/lib/gmail/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Google sends the admin back here after they approve (or cancel) access.
 * The signed state proves the request started from our Settings page, by an
 * active admin, in the last ten minutes.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(new URL(`/settings?gmail=${encodeURIComponent(result)}`, url.origin), 303);

  if (url.searchParams.get("error")) return back("cancelled");
  const staffId = readState(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!staffId || !code) return back("expired");

  const db = supabaseAdmin();
  const { data: admin } = await db
    .from("profiles")
    .select("id, organization_id, role, active")
    .eq("id", staffId)
    .single();
  if (!admin?.active || admin.role !== "admin") return back("not-allowed");

  try {
    const tokens = await exchangeCode(code, url.origin);
    if (!tokens.refresh_token) return back("no-refresh-token");
    const profile = await gmail<{ emailAddress: string }>({ accessToken: tokens.access_token }, "/profile");

    const { error } = await db.from("channel_connections").upsert(
      {
        organization_id: admin.organization_id,
        channel: "gmail",
        display_name: "Gmail",
        active: true,
        mailbox_email: profile.emailAddress.toLowerCase(),
        metadata: { refresh_token: encrypt(tokens.refresh_token), connected_by: admin.id, connected_at: new Date().toISOString() },
        last_error: null,
      },
      { onConflict: "organization_id,channel,display_name" },
    );
    if (error) throw new Error(error.message);
    return back("connected");
  } catch (e) {
    console.error("gmail connect", e);
    return back("failed");
  }
}
