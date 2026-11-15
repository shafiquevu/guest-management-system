import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { buildPeriodReport } from "@/lib/reports";

export const maxDuration = 60;

/** GET /api/reports?days=7|30 -> response times and volumes. Admins, managers, read-only. */
export async function GET(request: Request) {
  await connection();
  try {
    const staff = await requireStaff(request, ["admin", "manager", "read_only"]);
    const days = new URL(request.url).searchParams.get("days") === "30" ? 30 : 7;
    return Response.json(await buildPeriodReport(staff.organizationId, days));
  } catch (error) {
    return errorResponse(error);
  }
}
