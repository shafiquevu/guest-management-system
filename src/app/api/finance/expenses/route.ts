import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { EXPENSE_PROPERTY_PREFIX } from "@/lib/finance";

/**
 * POST   { property?, label, category?, amount, date, supplier? }  add an expense
 * DELETE { id }                                                   remove one
 *
 * `property` is the GH Ledger property name (what the report shows), kept in
 * the notes as "Property: <name>". No property means a general cost, counted
 * in the totals only.
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

    const property = String(input?.property ?? "").trim();

    const { error } = await supabaseAdmin().from("property_expenses").insert({
      organization_id: staff.organizationId,
      property_id: null,
      notes: property ? `${EXPENSE_PROPERTY_PREFIX}${property}` : null,
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
