import { errorResponse, requireStaff, type Role } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ROLES: Role[] = ["admin", "manager", "agent", "read_only"];

/**
 * Staff accounts. Admin only.
 *
 * POST  { email, fullName, role, password, propertyIds? }  create a login
 * PATCH { id, role?, active?, fullName?, email?, password?, propertyIds? }  change one
 * DELETE { id }                                              remove one
 *
 * The admin sets a first password and passes it on; the staff member can
 * change it after signing in. propertyIds limits what an agent sees.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireStaff(request, ["admin"]);
    const input = await request.json().catch(() => ({}));
    const email = String(input?.email ?? "").trim().toLowerCase();
    const fullName = String(input?.fullName ?? "").trim();
    const role = String(input?.role ?? "agent") as Role;
    const password = String(input?.password ?? "");

    if (!email.includes("@") || !fullName) {
      return Response.json({ error: "Name and email are required." }, { status: 400 });
    }
    if (!ROLES.includes(role)) return Response.json({ error: "Unknown role." }, { status: 400 });
    if (password.length < 10) {
      return Response.json({ error: "Use a first password of at least 10 characters." }, { status: 400 });
    }

    const db = supabaseAdmin();
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !created.user) {
      return Response.json({ error: error?.message ?? "Could not create the login." }, { status: 400 });
    }

    const { error: profileError } = await db.from("profiles").insert({
      id: created.user.id,
      organization_id: admin.organizationId,
      full_name: fullName,
      email,
      role,
      active: true,
    });
    if (profileError) {
      await db.auth.admin.deleteUser(created.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }

    await setProperties(created.user.id, input?.propertyIds, admin.organizationId);
    await audit(admin.organizationId, admin.id, "staff_created", created.user.id, { email, role });
    return Response.json({ ok: true, id: created.user.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireStaff(request, ["admin"]);
    const input = await request.json().catch(() => ({}));
    const id = String(input?.id ?? "");
    const db = supabaseAdmin();

    const { data: profile } = await db
      .from("profiles")
      .select("id, organization_id")
      .eq("id", id)
      .single();
    if (!profile || profile.organization_id !== admin.organizationId) {
      return Response.json({ error: "Staff member not found." }, { status: 404 });
    }
    if (id === admin.id && (input?.active === false || (input?.role && input.role !== "admin"))) {
      return Response.json({ error: "You cannot remove your own admin access." }, { status: 400 });
    }

    const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input?.role !== undefined) {
      if (!ROLES.includes(input.role)) return Response.json({ error: "Unknown role." }, { status: 400 });
      changes.role = input.role;
    }
    if (input?.active !== undefined) changes.active = Boolean(input.active);
    if (input?.fullName) changes.full_name = String(input.fullName).trim();

    // Login details live in Supabase Auth; the profile keeps a copy of the email.
    const authChanges: Record<string, unknown> = {};
    if (input?.email !== undefined) {
      const email = String(input.email).trim().toLowerCase();
      if (!email.includes("@")) return Response.json({ error: "Enter a valid email." }, { status: 400 });
      authChanges.email = email;
      authChanges.email_confirm = true;
      changes.email = email;
    }
    if (input?.password) {
      if (String(input.password).length < 10) {
        return Response.json({ error: "Use a password of at least 10 characters." }, { status: 400 });
      }
      authChanges.password = String(input.password);
    }
    // An inactive person must not be able to sign in, not just be hidden.
    if (input?.active !== undefined) authChanges.ban_duration = input.active ? "none" : "876000h";
    if (Object.keys(authChanges).length) {
      const { error: authError } = await db.auth.admin.updateUserById(id, authChanges);
      if (authError) return Response.json({ error: authError.message }, { status: 400 });
    }

    const { error } = await db.from("profiles").update(changes).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });

    if (Array.isArray(input?.propertyIds)) await setProperties(id, input.propertyIds, admin.organizationId);
    // Never log the password itself, only that it changed.
    await audit(admin.organizationId, admin.id, "staff_updated", id, { ...changes, password_changed: Boolean(authChanges.password) });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Remove a staff member. Someone with no history is deleted outright. Someone
 * whose name is on messages, tasks or logs can't be deleted without breaking
 * that history, so their login is blocked and they are marked inactive (they
 * can be restored later).
 */
export async function DELETE(request: Request) {
  try {
    const admin = await requireStaff(request, ["admin"]);
    const input = await request.json().catch(() => ({}));
    const id = String(input?.id ?? "");
    if (id === admin.id) return Response.json({ error: "You cannot remove yourself." }, { status: 400 });
    const db = supabaseAdmin();

    const { data: profile } = await db
      .from("profiles")
      .select("id, organization_id, email")
      .eq("id", id)
      .single();
    if (!profile || profile.organization_id !== admin.organizationId) {
      return Response.json({ error: "Staff member not found." }, { status: 404 });
    }

    await db.from("property_staff").delete().eq("profile_id", id);
    const { error: delError } = await db.from("profiles").delete().eq("id", id);
    if (!delError) {
      await db.auth.admin.deleteUser(id);
      await audit(admin.organizationId, admin.id, "staff_deleted", id, { email: profile.email });
      return Response.json({ ok: true, removed: "deleted" });
    }

    // Has history (foreign keys point at them): block the login instead.
    const { error } = await db
      .from("profiles")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    await audit(admin.organizationId, admin.id, "staff_deactivated", id, { email: profile.email });
    return Response.json({ ok: true, removed: "deactivated" });
  } catch (error) {
    return errorResponse(error);
  }
}

async function setProperties(profileId: string, propertyIds: unknown, orgId: string) {
  if (!Array.isArray(propertyIds)) return;
  const db = supabaseAdmin();
  const { data: valid } = await db
    .from("properties")
    .select("id")
    .eq("organization_id", orgId)
    .in("id", propertyIds.map(String));
  await db.from("property_staff").delete().eq("profile_id", profileId);
  if (valid?.length) {
    await db
      .from("property_staff")
      .insert(valid.map((p) => ({ profile_id: profileId, property_id: p.id })));
  }
}

async function audit(orgId: string, actorId: string, action: string, entityId: string, data: unknown) {
  await supabaseAdmin().from("audit_logs").insert({
    organization_id: orgId,
    actor_id: actorId,
    action,
    entity_type: "profile",
    entity_id: entityId,
    new_data: data,
  });
}
