import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cleanItems, STATUSES, totals, type InvoiceStatus } from "@/lib/invoices";

/**
 * GET  -> { invoices, companies, settings }        admins, managers, read-only
 * POST { id?, companyId, ... }  create or update    admins, managers
 *
 * A new invoice takes the next number in the shared series when it is first
 * saved (next_invoice_number(), atomic). A number is never reused.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  await connection();
  try {
    const staff = await requireStaff(request, ["admin", "manager", "read_only"]);
    const db = supabaseAdmin();
    const [invoices, companies, settings] = await Promise.all([
      db.from("invoices")
        .select("id, company_id, invoice_no, status, invoice_date, due_date, bill_to, customer_ref, property_ref, ledger_booking_id, total, currency, updated_at")
        .eq("organization_id", staff.organizationId)
        .order("invoice_date", { ascending: false })
        .order("invoice_no", { ascending: false })
        .limit(500),
      db.from("invoice_companies").select("*").eq("organization_id", staff.organizationId).order("name"),
      db.from("invoice_settings").select("prefix, next_number").eq("organization_id", staff.organizationId).maybeSingle(),
    ]);
    const failed = invoices.error ?? companies.error ?? settings.error;
    if (failed) {
      const missing = /does not exist|schema cache/i.test(failed.message);
      return Response.json(
        { error: missing ? "Invoices are not set up in the database yet (migration 005_invoices.sql)." : failed.message },
        { status: missing ? 503 : 400 },
      );
    }
    return Response.json({
      invoices: invoices.data ?? [],
      companies: companies.data ?? [],
      settings: settings.data ?? { prefix: "GPS", next_number: 1 },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const db = supabaseAdmin();
    const text = (k: string, max = 2000) => {
      const v = String(input[k] ?? "").trim();
      return v ? v.slice(0, max) : null;
    };

    const companyId = text("companyId");
    const billTo = text("billTo");
    const invoiceDate = text("invoiceDate");
    const dueDate = text("dueDate");
    const status = (text("status") ?? "draft") as InvoiceStatus;
    const items = cleanItems(input.items);

    if (!companyId) return Response.json({ error: "Pick the company this invoice is from." }, { status: 400 });
    if (!billTo) return Response.json({ error: "Fill in who the invoice is to." }, { status: 400 });
    if (!invoiceDate || !DATE.test(invoiceDate)) return Response.json({ error: "Pick the invoice date." }, { status: 400 });
    if (dueDate && !DATE.test(dueDate)) return Response.json({ error: "The due date is not a date." }, { status: 400 });
    if (!STATUSES.includes(status)) return Response.json({ error: "Unknown status." }, { status: 400 });
    if (!items.length) return Response.json({ error: "Add at least one line." }, { status: 400 });

    const { data: company } = await db
      .from("invoice_companies")
      .select("id")
      .eq("id", companyId)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (!company) return Response.json({ error: "That company was not found." }, { status: 400 });

    const sums = totals(items);
    const row = {
      company_id: companyId,
      status,
      invoice_date: invoiceDate,
      due_date: dueDate,
      terms: text("terms", 200),
      currency: (text("currency", 3) ?? "GBP").toUpperCase(),
      bill_to: billTo,
      customer_ref: text("customerRef", 300),
      property_ref: text("propertyRef"),
      ledger_booking_id: text("ledgerBookingId", 100),
      items,
      subtotal: sums.subtotal,
      vat: sums.vat,
      total: sums.total,
      notes: text("notes"),
      updated_by: staff.id,
      updated_at: new Date().toISOString(),
    };

    const id = text("id");
    if (id) {
      const { data, error } = await db
        .from("invoices")
        .update(row)
        .eq("id", id)
        .eq("organization_id", staff.organizationId)
        .select("id, invoice_no")
        .maybeSingle();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      if (!data) return Response.json({ error: "Invoice not found." }, { status: 404 });
      return Response.json({ ok: true, id: data.id, invoiceNo: data.invoice_no });
    }

    const { data: number, error: numError } = await db.rpc("next_invoice_number", {
      org: staff.organizationId,
      for_year: Number(invoiceDate.slice(0, 4)),
    });
    if (numError || typeof number !== "string") {
      return Response.json({ error: numError?.message ?? "Could not take an invoice number." }, { status: 400 });
    }
    const { data, error } = await db
      .from("invoices")
      .insert({ ...row, organization_id: staff.organizationId, invoice_no: number, created_by: staff.id })
      .select("id, invoice_no")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, id: data.id, invoiceNo: data.invoice_no });
  } catch (error) {
    return errorResponse(error);
  }
}
