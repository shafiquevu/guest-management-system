import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { listTemplates, whatsappConfigured } from "@/lib/whatsapp/client";

/**
 * The approved WhatsApp templates "New chat" can start a conversation with.
 * GET -> { templates: WaTemplate[] }  (empty when none are approved yet)
 */
export async function GET(request: Request) {
  try {
    await requireStaff(request, ["admin", "manager", "agent"]);
    if (!whatsappConfigured()) return Response.json({ templates: [], error: "WhatsApp is not connected." });
    try {
      return Response.json({ templates: await listTemplates() });
    } catch (e) {
      return Response.json({ templates: [], error: e instanceof Error ? e.message : String(e) });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
