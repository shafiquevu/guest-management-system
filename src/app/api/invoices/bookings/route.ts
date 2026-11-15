import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { fetchLedger, ledgerConfigured } from "@/lib/ledger";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET ?q=name  -> GH Ledger bookings to start an invoice from (newest first),
 * each with any invoice already raised for it, so nobody bills a stay twice.
 */
export async function GET(request: Request) {
  await connection();
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    if (!ledgerConfigured()) return Response.json({ bookings: [], note: "GH Ledger is not connected." });
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();

    const ledger = await fetchLedger();
    const bookings = ledger.bookings
      .filter((b) => !q || [b.name, b.property, b.flat, b.platform, b.invoiceNo].join(" ").toLowerCase().includes(q))
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
      .slice(0, 25);

    const ids = bookings.map((b) => b.id).filter(Boolean);
    const { data: raised } = ids.length
      ? await supabaseAdmin()
          .from("invoices")
          .select("id, invoice_no, ledger_booking_id, status")
          .eq("organization_id", staff.organizationId)
          .in("ledger_booking_id", ids)
          .neq("status", "cancelled")
      : { data: [] };
    const byBooking = new Map((raised ?? []).map((r) => [r.ledger_booking_id, r]));

    return Response.json({
      bookings: bookings.map((b) => ({
        id: b.id,
        name: b.name,
        property: b.property,
        flat: b.flat,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        platform: b.platform,
        amount: b.grossAmount,
        ledgerInvoiceNo: b.invoiceNo,
        invoice: byBooking.get(b.id) ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
