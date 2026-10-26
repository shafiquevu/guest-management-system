"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlarmClock, Plus, User } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { Avatar, btn, Chip, cx, field, PageHeader, Tabs } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type Status = "open" | "in_progress" | "waiting" | "completed" | "cancelled" | "overdue";
type Task = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: Status;
  assigned_to: string | null;
  due_at: string | null;
  created_at: string;
  property: { name: string } | null;
  guest: { full_name: string } | null;
};

const COLUMNS: { key: Status[]; label: string; target: Status }[] = [
  { key: ["open", "overdue"], label: "To do", target: "open" },
  { key: ["in_progress"], label: "In progress", target: "in_progress" },
  { key: ["waiting"], label: "Waiting", target: "waiting" },
  { key: ["completed"], label: "Done", target: "completed" },
];

const PRIORITY: Record<Task["priority"], string> = {
  low: "bg-slate-100 text-slate-600 ring-slate-200",
  normal: "bg-sky-50 text-sky-700 ring-sky-200",
  high: "bg-amber-50 text-amber-800 ring-amber-200",
  urgent: "bg-red-50 text-red-700 ring-red-200",
};

export function TasksBoard() {
  const { supabase, profile, canWrite } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [view, setView] = useState<"all" | "mine">("all");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 14 * 86400000).toISOString();
    let q = supabase
      .from("tasks")
      .select("id, title, description, category, priority, status, assigned_to, due_at, created_at, property:properties(name), guest:guests(full_name)")
      .neq("status", "cancelled")
      .or(`status.neq.completed,completed_at.gte.${since}`)
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (view === "mine") q = q.eq("assigned_to", profile.id);
    const { data, error } = await q.limit(500);
    if (error) setError(error.message);
    setTasks((data ?? []) as unknown as Task[]);
  }, [supabase, view, profile.id]);
  useLoader(load);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name");
    setStaff((data ?? []) as { id: string; full_name: string }[]);
  }, [supabase]);
  useLoader(loadStaff);

  useEffect(() => {
    const sub = supabase
      .channel("tasks-board")
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

  async function move(task: Task, status: Status) {
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

  const name = (id: string | null) => staff.find((s) => s.id === id)?.full_name;
  const overdue = (t: Task) => !!t.due_at && new Date(t.due_at) < new Date() && t.status !== "completed";

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-6 py-5">
        <PageHeader
          title="Tasks"
          subtitle="Guest requests and jobs for the team. Tasks created from a conversation link back to the guest."
          actions={
            <div className="w-56">
              <Tabs value={view} onChange={setView} items={[{ key: "all", label: "Everyone" }, { key: "mine", label: "Mine" }]} />
            </div>
          }
        />
        {canWrite && (
          <form onSubmit={create} className="flex flex-wrap gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" className={cx(field, "min-w-64 flex-1")} aria-label="New task" />
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={cx(field, "w-32 capitalize")} aria-label="Priority">
              {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={cx(field, "w-52")} aria-label="Due" />
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={cx(field, "w-44")} aria-label="Assign to">
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <button className={btn.primary}><Plus className="h-4 w-4" /> Add</button>
          </form>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="scroll-thin grid min-h-0 flex-1 grid-cols-4 gap-4 overflow-auto p-6 max-lg:grid-cols-2">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.key.includes(t.status));
          return (
            <div key={col.label} className="flex min-h-0 flex-col rounded-xl bg-slate-100/70 p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <h2 className="text-sm font-semibold text-slate-700">{col.label}</h2>
                <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-600 shadow-sm">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.length === 0 && <p className="px-2 py-4 text-center text-xs text-slate-400">Nothing here</p>}
                {items.map((t) => (
                  <article key={t.id} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
                    <div className="flex items-start gap-2">
                      <p className={cx("flex-1 text-sm font-medium text-slate-900", t.status === "completed" && "text-slate-400 line-through")}>{t.title}</p>
                      {t.category.startsWith("ai_") && <Chip className="bg-indigo-50 text-indigo-700">From AI</Chip>}
                      <Chip className={PRIORITY[t.priority]}>{t.priority}</Chip>
                    </div>
                    {(t.guest || t.property) && (
                      <p className="mt-1 truncate text-xs text-slate-500">{[t.guest?.full_name, t.property?.name].filter(Boolean).join(" · ")}</p>
                    )}
                    {t.due_at && (
                      <p className={cx("mt-2 flex items-center gap-1 text-xs", overdue(t) ? "font-medium text-red-600" : "text-slate-500")}>
                        <AlarmClock className="h-3.5 w-3.5" /> {overdue(t) ? "Overdue · " : ""}{dateTime(t.due_at)}
                      </p>
                    )}
                    <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2.5">
                      {name(t.assigned_to) ? <Avatar name={name(t.assigned_to)} size="sm" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-400"><User className="h-3.5 w-3.5" /></span>}
                      {canWrite ? (
                        <>
                          <select value={t.assigned_to ?? ""} onChange={(e) => assign(t, e.target.value)} className="min-w-0 flex-1 rounded-md border-0 bg-transparent py-1 pr-6 pl-1 text-xs text-slate-600 hover:bg-slate-50" aria-label="Assigned to">
                            <option value="">Unassigned</option>
                            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                          </select>
                          <select value={col.target} onChange={(e) => move(t, e.target.value as Status)} className="rounded-md border-0 bg-slate-50 py-1 pr-6 pl-2 text-xs text-slate-700 ring-1 ring-slate-200" aria-label="Move to">
                            {COLUMNS.map((c) => <option key={c.target} value={c.target}>{c.label}</option>)}
                            <option value="cancelled">Cancel task</option>
                          </select>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">{name(t.assigned_to) ?? "Unassigned"}</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
