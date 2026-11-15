import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET    -> the full invoice (items included)
 * DELETE -> only a draft can be deleted; a sent or paid invoice is cancelled
 *           instead, so its number stays on record.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  await connection();
  try {
    const staff = await requireStaff(request, ["admin", "manager", "read_only"]);
    const { id } = await ctx.params;
    const { data } = await supabaseAdmin()
      .from("invoices")
      .select("*")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (!data) return Response.json({ error: "Invoice not found." }, { status: 404 });
    return Response.json({ invoice: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const { id } = await ctx.params;
    const db = supabaseAdmin();
    const { data } = await db
      .from("invoices")
      .select("id, status")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (!data) return Response.json({ error: "Invoice not found." }, { status: 404 });
    if (data.status !== "draft") {
      return Response.json({ error: "Only a draft can be deleted. Mark a sent invoice as Cancelled instead." }, { status: 400 });
    }
    const { error } = await db.from("invoices").delete().eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
