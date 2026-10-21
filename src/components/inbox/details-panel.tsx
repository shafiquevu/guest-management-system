"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "@/components/app-shell";
import { dateOnly, dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import type { ConversationRow, StaffOption } from "./inbox";

type Reservation = {
  confirmation_code: string | null;
  status: string | null;
  check_in: string | null;
  check_out: string | null;
  number_of_guests: number | null;
};
type Property = {
  name: string;
  address: string | null;
  city: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  check_in_instructions: string | null;
  parking_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
};
type Note = { id: string; body: string; created_at: string; author: { full_name: string } | null };

const STATUSES = ["open", "pending", "escalated", "resolved", "archived"];

export function DetailsPanel({
  conversation,
  staff,
  onChanged,
}: {
  conversation: ConversationRow;
  staff: StaffOption[];
  onChanged: () => void;
}) {
  const { supabase, profile, canWrite } = useApp();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [message, setMessage] = useState<string | null>(null);

  const loadNotes = useCallback(async () => {
    const { data } = await supabase
      .from("internal_notes")
      .select("id, body, created_at, author:profiles(full_name)")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: false });
    setNotes((data ?? []) as unknown as Note[]);
  }, [supabase, conversation.id]);

  const loadContext = useCallback(async () => {
    const [res, prop] = await Promise.all([
      conversation.reservation_id
        ? supabase
            .from("reservations")
            .select("confirmation_code, status, check_in, check_out, number_of_guests")
            .eq("id", conversation.reservation_id)
            .single()
        : Promise.resolve({ data: null }),
      conversation.property_id
        ? supabase
            .from("properties")
            .select("name, address, city, check_in_time, check_out_time, check_in_instructions, parking_instructions, wifi_name, wifi_password")
            .eq("id", conversation.property_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);
    setReservation(res.data as Reservation | null);
    setProperty(prop.data as Property | null);
  }, [supabase, conversation.reservation_id, conversation.property_id]);

  useLoader(loadNotes);
  useLoader(loadContext);

  async function logEvent(event_type: string, data: Record<string, unknown>) {
    await supabase.from("conversation_events").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      actor_id: profile.id,
      event_type,
      data,
    });
  }

  async function update(changes: Record<string, unknown>, event: string) {
    const { error } = await supabase
      .from("conversations")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", conversation.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    await logEvent(event, changes);
    onChanged();
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    const { error } = await supabase.from("internal_notes").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      author_id: profile.id,
      body: note.trim(),
    });
    if (error) return setMessage(error.message);
    setNote("");
    loadNotes();
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (!taskTitle.trim()) return;
    const { error } = await supabase.from("tasks").insert({
      organization_id: profile.organization_id,
      conversation_id: conversation.id,
      property_id: conversation.property_id,
      reservation_id: conversation.reservation_id,
      guest_id: conversation.guest?.id ?? null,
      title: taskTitle.trim(),
      category: "guest_request",
      priority: taskPriority,
      created_by: profile.id,
      assigned_to: conversation.assigned_to,
    });
    if (error) return setMessage(error.message);
    setTaskTitle("");
    setMessage("Task created.");
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      {message && <p className="rounded bg-slate-100 px-2 py-1.5 text-xs text-slate-700">{message}</p>}

      <Section title="Conversation">
        <label className="block text-xs text-slate-500" htmlFor="status">Status</label>
        <select
          id="status"
          disabled={!canWrite}
          value={conversation.status}
          onChange={(e) =>
            update(
              { status: e.target.value, resolved_at: e.target.value === "resolved" ? new Date().toISOString() : null },
              "status_changed",
            )
          }
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 capitalize"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <label className="mt-3 block text-xs text-slate-500" htmlFor="assignee">Assigned to</label>
        <select
          id="assignee"
          disabled={!canWrite}
          value={conversation.assigned_to ?? ""}
          onChange={(e) => update({ assigned_to: e.target.value || null }, "assigned")}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        >
          <option value="">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </Section>

      <Section title="Guest">
        <Row k="Name" v={conversation.guest?.full_name} />
        <Row k="Email" v={conversation.guest?.email} />
        <Row k="Phone" v={conversation.guest?.phone} />
      </Section>

      <Section title="Reservation">
        <Row k="Code" v={reservation?.confirmation_code} />
        <Row k="Status" v={reservation?.status} />
        <Row k="Check-in" v={dateOnly(reservation?.check_in)} />
        <Row k="Check-out" v={dateOnly(reservation?.check_out)} />
        <Row k="Guests" v={reservation?.number_of_guests?.toString()} />
      </Section>

      <Section title="Property">
        <Row k="Name" v={property?.name} />
        <Row k="Address" v={[property?.address, property?.city].filter(Boolean).join(", ")} />
        <Row k="Check-in from" v={property?.check_in_time?.slice(0, 5)} />
        <Row k="Check-out by" v={property?.check_out_time?.slice(0, 5)} />
        <Row k="Wi-Fi" v={property?.wifi_name ? `${property.wifi_name} / ${property.wifi_password ?? ""}` : null} />
        {property?.check_in_instructions && <Long k="Check-in instructions" v={property.check_in_instructions} />}
        {property?.parking_instructions && <Long k="Parking" v={property.parking_instructions} />}
      </Section>

      <Section title="Internal notes">
        {canWrite && (
          <form onSubmit={addNote} className="mb-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Only staff can see notes"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5"
            />
            <button className="mt-1 rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white">Add note</button>
          </form>
        )}
        {notes.length === 0 && <p className="text-xs text-slate-500">No notes.</p>}
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-amber-50 px-2 py-1.5">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {n.author?.full_name ?? "Staff"} · {dateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      {canWrite && (
        <Section title="Create task">
          <form onSubmit={addTask} className="space-y-1.5">
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="e.g. Send extra towels to unit 3"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5"
            />
            <div className="flex gap-1.5">
              <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-2 py-1">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white">Create</button>
            </div>
          </form>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-slate-500">{k}</span>
      <span className="text-right text-slate-900">{v || "–"}</span>
    </div>
  );
}

function Long({ k, v }: { k: string; v: string }) {
  return (
    <div className="mt-1.5">
      <div className="text-slate-500">{k}</div>
      <p className="whitespace-pre-wrap text-slate-900">{v}</p>
    </div>
  );
}
