import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureProperties } from "@/lib/sync/beds24";

/**
 * POST   { propertyId?, label, category?, amount, date, supplier? }  add an expense
 * DELETE { id }                                                     remove one
 *
 * propertyId is the Beds24 property id (what the report shows); it is mapped to
 * our own property row, creating it if this is the first time we see it. No
 * propertyId means a general cost, counted in the totals only.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const input = await request.json().catch(() => ({}));
    const label = String(input?.label ?? "").trim();
    const amount = Number(input?.amount);
    const date = String(input?.date ?? "");
    if (!label) return Response.json({ error: "Say what the expense was for." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) return Response.json({ error: "Enter an amount above zero." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Pick a date." }, { status: 400 });

    let propertyId: string | null = null;
    if (input?.propertyId) {
      const map = await ensureProperties(staff.organizationId, [Number(input.propertyId)]);
      propertyId = map.get(Number(input.propertyId)) ?? null;
      if (!propertyId) return Response.json({ error: "Unknown property." }, { status: 400 });
    }

    const { error } = await supabaseAdmin().from("property_expenses").insert({
      organization_id: staff.organizationId,
      property_id: propertyId,
      label,
      category: input?.category ? String(input.category) : null,
      amount: Math.round(amount * 100) / 100,
      expense_date: date,
      supplier: input?.supplier ? String(input.supplier).trim() : null,
      created_by: staff.id,
      updated_by: staff.id,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const input = await request.json().catch(() => ({}));
    const { error } = await supabaseAdmin()
      .from("property_expenses")
      .delete()
      .eq("id", String(input?.id ?? ""))
      .eq("organization_id", staff.organizationId);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
