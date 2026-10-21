import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type Role = "admin" | "manager" | "agent" | "read_only";

export type Staff = {
  id: string;
  organizationId: string;
  fullName: string;
  role: Role;
};

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

/**
 * The signed-in staff member behind an API request.
 *
 * The browser sends its Supabase access token as a Bearer header; it is
 * verified with Supabase and matched to an active profile. Nothing the caller
 * says about themselves is trusted.
 */
export async function requireStaff(request: Request, allowed?: Role[]): Promise<Staff> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new AuthError("Sign in first.", 401);

  const admin = supabaseAdmin();
  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData.user) throw new AuthError("Your session has expired. Sign in again.", 401);

  const { data: profile } = await admin
    .from("profiles")
    .select("id, organization_id, full_name, role, active")
    .eq("id", userData.user.id)
    .single();
  if (!profile || !profile.active) throw new AuthError("This account is not active.", 403);

  const staff: Staff = {
    id: profile.id,
    organizationId: profile.organization_id,
    fullName: profile.full_name,
    role: profile.role as Role,
  };
  if (allowed && !allowed.includes(staff.role)) {
    throw new AuthError("You do not have permission to do that.", 403);
  }
  return staff;
}

/** May this staff member see (and so act on) this conversation? Mirrors app_can_see_conversation(). */
export async function canSeeConversation(
  staff: Staff,
  conversation: { organization_id: string; assigned_to: string | null; property_id: string | null },
): Promise<boolean> {
  if (conversation.organization_id !== staff.organizationId) return false;
  if (staff.role !== "agent") return true;
  if (conversation.assigned_to === staff.id || conversation.property_id === null) return true;
  const { data } = await supabaseAdmin()
    .from("property_staff")
    .select("property_id")
    .eq("profile_id", staff.id)
    .eq("property_id", conversation.property_id)
    .maybeSingle();
  return Boolean(data);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return Response.json({ error: message }, { status: 500 });
}
