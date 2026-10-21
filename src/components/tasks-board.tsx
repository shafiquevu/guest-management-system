"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/components/app-shell";
import { dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type Task = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "in_progress" | "waiting" | "completed" | "cancelled" | "overdue";
  assigned_to: string | null;
  due_at: string | null;
  created_at: string;
  property: { name: string } | null;
  guest: { full_name: string } | null;
};

const STATUSES: Task["status"][] = ["open", "in_progress", "waiting", "completed", "cancelled"];
const PRIORITY_STYLE: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600",
  normal: "bg-blue-50 text-blue-700",
  high: "bg-amber-100 text-amber-800",
  urgent: "bg-red-100 text-red-700",
};

export function TasksBoard() {
  const { supabase, profile, canWrite } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [view, setView] = useState<"open" | "mine" | "done">("open");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase
      .from("tasks")
      .select("id, title, description, category, priority, status, assigned_to, due_at, created_at, property:properties(name), guest:guests(full_name)")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (view === "done") q = q.in("status", ["completed", "cancelled"]);
    else q = q.not("status", "in", "(completed,cancelled)");
    if (view === "mine") q = q.eq("assigned_to", profile.id);
    const { data, error } = await q.limit(300);
    if (error) setError(error.message);
    setTasks((data ?? []) as unknown as Task[]);
  }, [supabase, view, profile.id]);

  useLoader(load);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("active", true)
      .order("full_name")
      .then(({ data }) => setStaff((data ?? []) as { id: string; full_name: string }[]));
    const sub = supabase
      .channel("tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [supabase, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("tasks").insert({
      organization_id: profile.organization_id,
      title: title.trim(),
      category: "general",
      priority,
      due_at: due ? new Date(due).toISOString() : null,
      assigned_to: assignee || null,
      created_by: profile.id,
    });
    if (error) return setError(error.message);
    setTitle("");
    setDue("");
    load();
  }

  async function setStatus(task: Task, status: Task["status"]) {
    const done = status === "completed";
    const { error } = await supabase
      .from("tasks")
      .update({
        status,
        completed_at: done ? new Date().toISOString() : null,
        completed_by: done ? profile.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    if (error) return setError(error.message);
    await supabase.from("task_events").insert({
      organization_id: profile.organization_id,
      task_id: task.id,
      actor_id: profile.id,
      event_type: "status_changed",
      old_status: task.status,
      new_status: status,
    });
    load();
  }

  async function assign(task: Task, to: string) {
    await supabase.from("tasks").update({ assigned_to: to || null }).eq("id", task.id);
    load();
  }

  const name = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "Unassigned";
  const overdue = (t: Task) => t.due_at && new Date(t.due_at) < new Date() && !["completed", "cancelled"].includes(t.status);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Tasks</h1>
        <div className="ml-4 flex gap-1">
          {(["open", "mine", "done"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${view === v ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {v === "open" ? "Open" : v === "mine" ? "Mine" : "Done"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canWrite && (
        <form onSubmit={create} className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" className="min-w-60 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5" />
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" aria-label="Priority">
            {["low", "normal", "high", "urgent"].map((p) => <option key={p}>{p}</option>)}
          </select>
          <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" aria-label="Due" />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5" aria-label="Assign to">
            <option value="">Unassigned</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
          <button className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">Add</button>
        </form>
      )}

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No tasks.</td></tr>
            )}
            {tasks.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{t.title}</div>
                  <div className="text-xs text-slate-500">
                    {[t.guest?.full_name, t.property?.name].filter(Boolean).join(" · ") || t.category}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>
                </td>
                <td className={`px-3 py-2 text-xs ${overdue(t) ? "font-medium text-red-600" : "text-slate-600"}`}>
                  {t.due_at ? dateTime(t.due_at) : "–"}
                  {overdue(t) && " · overdue"}
                </td>
                <td className="px-3 py-2">
                  {canWrite ? (
                    <select value={t.assigned_to ?? ""} onChange={(e) => assign(t, e.target.value)} className="rounded border border-slate-300 px-1.5 py-1 text-xs" aria-label="Assigned to">
                      <option value="">Unassigned</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs">{name(t.assigned_to)}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    disabled={!canWrite}
                    value={t.status}
                    onChange={(e) => setStatus(t, e.target.value as Task["status"])}
                    className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    aria-label="Status"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
