import { connection } from "next/server";
import { errorResponse, requireStaff } from "@/lib/auth/staff";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Incidents: the issues the AI escalates (refunds, complaints, damage, access
 * problems...) plus any a manager records. One per conversation.
 *
 * GET                                   -> incidents, newest first, with guest/property/owner
 * POST { id, status?, assignedTo?, resolutionNotes? }   update one (admins, managers)
 *
 * Resolving or closing needs a note, so the record says what was done.
 */
const STATUSES = ["open", "investigating", "resolved", "closed"] as const;

export async function GET(request: Request) {
  await connection();
  try {
    const staff = await requireStaff(request, ["admin", "manager", "read_only"]);
    const db = supabaseAdmin();
    const [{ data, error }, { data: people }] = await Promise.all([
      db
        .from("incidents")
        .select(
          "id, conversation_id, title, description, category, priority, status, assigned_to, resolved_at, resolution_notes, created_at, updated_at, guest:guests(full_name), property:properties(name)",
        )
        .eq("organization_id", staff.organizationId)
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("profiles").select("id, full_name, role, active").eq("organization_id", staff.organizationId).eq("active", true).order("full_name"),
    ]);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ incidents: data ?? [], staff: people ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "manager"]);
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(input.id ?? "");
    const db = supabaseAdmin();
    const { data: current } = await db
      .from("incidents")
      .select("id, status, resolution_notes")
      .eq("id", id)
      .eq("organization_id", staff.organizationId)
      .maybeSingle();
    if (!current) return Response.json({ error: "Incident not found." }, { status: 404 });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.status !== undefined) {
      const status = String(input.status);
      if (!STATUSES.includes(status as (typeof STATUSES)[number])) return Response.json({ error: "Unknown status." }, { status: 400 });
      patch.status = status;
      patch.resolved_at = status === "resolved" || status === "closed" ? new Date().toISOString() : null;
    }
    if (input.assignedTo !== undefined) {
      const who = input.assignedTo ? String(input.assignedTo) : null;
      if (who) {
        const { data: person } = await db.from("profiles").select("id").eq("id", who).eq("organization_id", staff.organizationId).maybeSingle();
        if (!person) return Response.json({ error: "That staff member was not found." }, { status: 400 });
      }
      patch.assigned_to = who;
    }
    if (input.resolutionNotes !== undefined) patch.resolution_notes = String(input.resolutionNotes).trim().slice(0, 4000) || null;

    const closing = patch.status === "resolved" || patch.status === "closed";
    const notes = (patch.resolution_notes ?? current.resolution_notes) as string | null;
    if (closing && !notes) return Response.json({ error: "Add a note saying what was done before resolving." }, { status: 400 });

    const { error } = await db.from("incidents").update(patch).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
