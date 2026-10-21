"use client";

import { useCallback, useState, type FormEvent } from "react";
import { CalendarDays, CheckSquare, Moon, Plus, StickyNote, Users } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Avatar, btn, ChannelBadge, Chip, cx, field, Field, Section } from "@/components/ui";
import { BOOKING_STATUS, dateOnly, dateTime, prettyPhone, STAY_STYLE, stayStatus } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";
import type { ConversationRow } from "./inbox";

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
  postcode: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  check_in_instructions: string | null;
  parking_instructions: string | null;
  house_rules: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
};
type Note = { id: string; body: string; created_at: string; author: { full_name: string } | null };
type Task = { id: string; title: string; status: string; priority: string; due_at: string | null };

export function DetailsPanel({ conversation, onChanged }: { conversation: ConversationRow; onChanged: () => void }) {
  const { supabase, profile, canWrite } = useApp();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [message, setMessage] = useState<string | null>(null);

  const loadNotesAndTasks = useCallback(async () => {
    const [n, t] = await Promise.all([
      supabase
        .from("internal_notes")
        .select("id, body, created_at, author:profiles(full_name)")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title, status, priority, due_at")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false }),
    ]);
    setNotes((n.data ?? []) as unknown as Note[]);
    setTasks((t.data ?? []) as Task[]);
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
            .select(
              "name, address, city, postcode, check_in_time, check_out_time, check_in_instructions, parking_instructions, house_rules, wifi_name, wifi_password",
            )
            .eq("id", conversation.property_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);
    setReservation(res.data as Reservation | null);
    setProperty(prop.data as Property | null);
  }, [supabase, conversation.reservation_id, conversation.property_id]);

  useLoader(loadNotesAndTasks);
  useLoader(loadContext);

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
    loadNotesAndTasks();
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
    loadNotesAndTasks();
    onChanged();
  }

  const stay = stayStatus(reservation);
  const nights =
    reservation?.check_in && reservation?.check_out
      ? Math.round((Date.parse(reservation.check_out) - Date.parse(reservation.check_in)) / 86400000)
      : null;
  const name = conversation.guest?.full_name ?? "Guest";

  return (
    <div className="text-sm">
      {/* guest header */}
      <div className="flex flex-col items-center border-b border-slate-100 px-4 py-5 text-center">
        <Avatar name={name} size="lg" />
        <p className="mt-2 text-base font-semibold text-slate-900">{name}</p>
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
          <ChannelBadge channel={conversation.channel} />
          {stay && <Chip className={STAY_STYLE[stay.tone]}>{stay.label}</Chip>}
        </div>
      </div>

      {message && <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{message}</p>}

      <Section title="Stay">
        {reservation ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-[11px] font-medium text-slate-500 uppercase">Check-in</p>
                <p className="mt-0.5 font-medium text-slate-900">{dateOnly(reservation.check_in)}</p>
                {property?.check_in_time && <p className="text-xs text-slate-500">from {property.check_in_time.slice(0, 5)}</p>}
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <p className="text-[11px] font-medium text-slate-500 uppercase">Check-out</p>
                <p className="mt-0.5 font-medium text-slate-900">{dateOnly(reservation.check_out)}</p>
                {property?.check_out_time && <p className="text-xs text-slate-500">by {property.check_out_time.slice(0, 5)}</p>}
              </div>
            </div>
            <div className="mb-2 flex gap-4 text-xs text-slate-600">
              {nights !== null && (
                <span className="flex items-center gap-1"><Moon className="h-3.5 w-3.5" /> {nights} night{nights === 1 ? "" : "s"}</span>
              )}
              {reservation.number_of_guests && (
                <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {reservation.number_of_guests} guest{reservation.number_of_guests === 1 ? "" : "s"}</span>
              )}
            </div>
            <Field label="Booking code" value={reservation.confirmation_code} copy />
            <Field label="Booking status" value={BOOKING_STATUS[reservation.status ?? ""] ?? reservation.status} />
          </>
        ) : (
          <p className="text-slate-500">No reservation linked.</p>
        )}
      </Section>

      <Section title="Contact">
        <Field label="Email" value={conversation.guest?.email} copy />
        <Field label="Phone" value={prettyPhone(conversation.guest?.phone)} copy />
      </Section>

      <Section title="Property">
        {property ? (
          <>
            <p className="font-medium text-slate-900">{property.name}</p>
            <p className="mb-2 text-xs text-slate-500">
              {[property.address, property.city, property.postcode].filter(Boolean).join(", ") || "No address"}
            </p>
            <Field label="Wi-Fi network" value={property.wifi_name} copy />
            <Field label="Wi-Fi password" value={property.wifi_password} copy />
            {[
              ["Check-in instructions", property.check_in_instructions],
              ["Parking", property.parking_instructions],
              ["House rules", property.house_rules],
            ].map(([k, v]) =>
              v ? (
                <div key={k} className="mt-2">
                  <p className="text-xs font-medium text-slate-500">{k}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{v}</p>
                </div>
              ) : null,
            )}
            {!property.wifi_name && !property.check_in_instructions && (
              <p className="mt-2 text-xs text-slate-500">Add Wi-Fi and check-in details under Properties.</p>
            )}
          </>
        ) : (
          <p className="text-slate-500">No property linked.</p>
        )}
      </Section>

      <Section title={`Tasks${tasks.length ? ` (${tasks.length})` : ""}`}>
        {tasks.length > 0 && (
          <ul className="mb-3 space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                <CheckSquare className={cx("h-4 w-4", t.status === "completed" ? "text-emerald-600" : "text-slate-400")} />
                <span className={cx("flex-1 truncate", t.status === "completed" && "text-slate-400 line-through")}>{t.title}</span>
                <span className="text-[11px] text-slate-500 capitalize">{t.status.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form onSubmit={addTask} className="space-y-2">
            <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Extra towels for unit 3" className={field} aria-label="New task" />
            <div className="flex gap-2">
              <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} className={cx(field, "flex-1 capitalize")} aria-label="Priority">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button className={btn.secondary}><Plus className="h-4 w-4" /> Task</button>
            </div>
          </form>
        )}
      </Section>

      <Section title={`Internal notes${notes.length ? ` (${notes.length})` : ""}`}>
        {canWrite && (
          <form onSubmit={addNote} className="mb-3">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Only your team can see notes" className={field} aria-label="New note" />
            <button className={cx(btn.secondary, "mt-2")}><StickyNote className="h-4 w-4" /> Add note</button>
          </form>
        )}
        {notes.length === 0 && <p className="text-xs text-slate-500">No notes yet.</p>}
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
              <p className="whitespace-pre-wrap text-slate-800">{n.body}</p>
              <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                <CalendarDays className="h-3 w-3" />
                {n.author?.full_name ?? "Staff"} · {dateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
