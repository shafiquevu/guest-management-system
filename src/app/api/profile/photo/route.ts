import { errorResponse, requireStaff, type Staff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Staff profile photos. Anyone can change their own; an admin can change anyone's.
 *
 * POST   multipart { file, profileId? }  upload and set the photo
 * DELETE { profileId? }                  remove it
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a photo." }, { status: 400 });
    const ext = TYPES[file.type];
    if (!ext) return Response.json({ error: "Use a PNG, JPG or WebP photo." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "The photo must be under 2 MB." }, { status: 400 });

    const target = await targetProfile(staff, form?.get("profileId"));
    if (target instanceof Response) return target;

    const db = supabaseAdmin();
    const path = `${staff.organizationId}/${target.id}-${Date.now()}.${ext}`;
    const { error } = await db.storage
      .from("avatars")
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const url = db.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    await db.from("profiles").update({ avatar_url: url, updated_at: new Date().toISOString() }).eq("id", target.id);
    await removeFile(target.avatar_url);
    return Response.json({ ok: true, avatarUrl: url });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const staff = await requireStaff(request);
    const input = await request.json().catch(() => ({}));
    const target = await targetProfile(staff, input?.profileId);
    if (target instanceof Response) return target;

    await supabaseAdmin().from("profiles").update({ avatar_url: null, updated_at: new Date().toISOString() }).eq("id", target.id);
    await removeFile(target.avatar_url);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

async function targetProfile(staff: Staff, requested: unknown) {
  const id = typeof requested === "string" && requested ? requested : staff.id;
  if (id !== staff.id && staff.role !== "admin") {
    return Response.json({ error: "Only an admin can change someone else's photo." }, { status: 403 });
  }
  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id, organization_id, avatar_url")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.organization_id !== staff.organizationId) {
    return Response.json({ error: "Staff member not found." }, { status: 404 });
  }
  return data as { id: string; organization_id: string; avatar_url: string | null };
}

/** Delete the previous photo file, if it is one of ours. */
async function removeFile(url: string | null) {
  const path = url?.split("/storage/v1/object/public/avatars/")[1];
  if (path) await supabaseAdmin().storage.from("avatars").remove([path]);
}
