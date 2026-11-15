import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 2 * 1024 * 1024;

/** POST multipart { file } -> { url }. The company form saves the URL. */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Choose a logo." }, { status: 400 });
    const ext = TYPES[file.type];
    if (!ext) return Response.json({ error: "Use a PNG, JPG or WebP logo." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "The logo must be under 2 MB." }, { status: 400 });

    const db = supabaseAdmin();
    const path = `${staff.organizationId}/logo-${Date.now()}.${ext}`;
    const { error } = await db.storage
      .from("invoice-logos")
      .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, url: db.storage.from("invoice-logos").getPublicUrl(path).data.publicUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
