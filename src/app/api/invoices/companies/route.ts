import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST { id?, name, ... }            add or edit a company invoices are issued from
 * PUT  { prefix, nextNumber }        the shared invoice number series (admins)
 */
const FIELDS: Record<string, string> = {
  name: "name",
  tradingAs: "trading_as",
  address: "address",
  companyNo: "company_no",
  vatNo: "vat_no",
  email: "email",
  phone: "phone",
  website: "website",
  logoUrl: "logo_url",
  accountName: "account_name",
  accountNo: "account_no",
  sortCode: "sort_code",
  footerNote: "footer_note",
  defaultNotes: "default_notes",
};

export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const row: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(FIELDS)) {
      const v = String(input[k] ?? "").trim();
      row[col] = v ? v.slice(0, 2000) : null;
    }
    if (!row.name) return Response.json({ error: "Give the company a name." }, { status: 400 });
    row.active = input.active === false ? false : true;
    row.updated_at = new Date().toISOString();

    const db = supabaseAdmin();
    const id = String(input.id ?? "").trim();
    const query = id
      ? db.from("invoice_companies").update(row).eq("id", id).eq("organization_id", staff.organizationId)
      : db.from("invoice_companies").insert({ ...row, organization_id: staff.organizationId });
    const { data, error } = await query.select("id").maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Company not found." }, { status: 404 });
    return Response.json({ ok: true, id: data.id });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin"]);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const prefix = String(input.prefix ?? "").trim().toUpperCase();
    const next = Number(input.nextNumber);
    if (!/^[A-Z0-9]{1,10}$/.test(prefix)) return Response.json({ error: "Use letters and numbers only for the prefix." }, { status: 400 });
    if (!Number.isInteger(next) || next < 1) return Response.json({ error: "The next number must be a whole number above 0." }, { status: 400 });

    const db = supabaseAdmin();
    // Never step backwards onto a number that is already used.
    const { data: used } = await db
      .from("invoices")
      .select("invoice_no")
      .eq("organization_id", staff.organizationId)
      .like("invoice_no", `${prefix}-%`);
    const highest = (used ?? []).reduce((m, r) => Math.max(m, Number(String(r.invoice_no).split("-").pop()) || 0), 0);
    if (next <= highest) {
      return Response.json({ error: `Number ${highest} is already used. The next number must be above it.` }, { status: 400 });
    }
    const { error } = await db
      .from("invoice_settings")
      .upsert({ organization_id: staff.organizationId, prefix, next_number: next, updated_at: new Date().toISOString() });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
