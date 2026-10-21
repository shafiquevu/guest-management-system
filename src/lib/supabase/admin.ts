import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses row level security, so it is only ever used on
 * the server, after the caller has been checked (see lib/auth/staff.ts).
 */
let admin: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

/** The single organisation this deployment serves. */
export async function organizationId(): Promise<string> {
  if (process.env.DEFAULT_ORGANIZATION_ID) return process.env.DEFAULT_ORGANIZATION_ID;
  const { data, error } = await supabaseAdmin()
    .from("organizations")
    .select("id")
    .order("created_at")
    .limit(1)
    .single();
  if (error || !data) throw new Error("No organisation found in the database.");
  return data.id as string;
}
