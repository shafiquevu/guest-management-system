import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { isConfigured } from "@/lib/beds24/client";
import { buildFinanceReport } from "@/lib/finance";

export const maxDuration = 60;

/**
 * GET /api/finance?month=2026-10  -> the month's finance report.
 * Admins, managers and read-only users; agents only work their own properties.
 */
export async function GET(request: Request) {
  await connection(); // per request, never prerendered
  try {
    const staff = await requireStaff(request, ["admin", "manager", "read_only"]);
    if (!isConfigured()) {
      return Response.json({ error: "Beds24 is not connected, so there are no bookings to report on." }, { status: 503 });
    }
    const month = new URL(request.url).searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    try {
      return Response.json(await buildFinanceReport(staff.organizationId, month));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
