"use client";

import { useState, useSyncExternalStore } from "react";
import type { FormEvent } from "react";

type Task = {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  category: string;
  priority: "normal";
  status: "open" | "completed";
};

const STORAGE_KEY = "burkyflow-demo-tasks-v1";

function subscribe() {
  return () => {};
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;

  const task = value as Record<string, unknown>;

  return (
    typeof task.id === "string" &&
    typeof task.organization_id === "string" &&
    typeof task.title === "string" &&
    typeof task.description === "string" &&
    typeof task.category === "string" &&
    task.priority === "normal" &&
    (task.status === "open" || task.status === "completed")
  );
}

function loadTasks(): Task[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];

    const parsed: unknown = JSON.parse(saved);

    return Array.isArray(parsed) && parsed.every(isTask) ? parsed : [];
  } catch {
    return [];
  }
}

export default function TaskBoard() {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  if (!ready) {
    return (
      <section className="bg-slate-100 p-6 text-slate-600">
        Loading saved demo tasks...
      </section>
    );
  }

  return <BrowserTaskBoard />;
}

function BrowserTaskBoard() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [guestName, setGuestName] = useState("Test Guest");
  const [message, setMessage] = useState(
    "Please send the check-in instructions."
  );
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  function saveTasks(nextTasks: Task[], successMessage: string) {
    setTasks(nextTasks);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTasks));
      setFeedback(successMessage);
    } catch {
      setFeedback(
        "Browser saving failed. Changes are available only until refresh."
      );
    }
  }

  async function createDemoTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setFeedback("Processing the message through n8n...");

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guest_name: guestName,
          message,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not create the demo task.");
      }

      if (!isTask(result.task)) {
        throw new Error("The server returned an invalid task.");
      }

      saveTasks(
        [result.task, ...tasks],
        "Task received from n8n and saved in this browser."
      );
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleTask(id: string) {
    const nextTasks: Task[] = tasks.map((task) =>
      task.id === id
        ? {
            ...task,
            status: task.status === "open" ? "completed" : "open",
          }
        : task
    );

    saveTasks(nextTasks, "Task status updated.");
  }

  function clearDemoTasks() {
    if (window.confirm("Delete all demo tasks saved in this browser?")) {
      saveTasks([], "Demo tasks cleared.");
    }
  }

  const openCount = tasks.filter((task) => task.status === "open").length;

  return (
    <section className="bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Staff Tasks</h2>
            <p className="mt-2 text-sm text-slate-600">
              {openCount} open · {tasks.length - openCount} completed
            </p>
          </div>

          <button
            type="button"
            onClick={clearDemoTasks}
            disabled={!tasks.length || loading}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40"
          >
            Clear Demo Tasks
          </button>
        </div>

        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Demo data only. Tasks are saved in this browser when storage is
          available. They are not shared with other users or saved to
          Supabase. Use fictional guest details.
        </p>

        <form
          onSubmit={createDemoTask}
          className="my-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
        >
          <h3 className="text-lg font-semibold">Test Message Processing</h3>

          <label className="block text-sm font-medium">
            Guest Name
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              maxLength={200}
              disabled={loading}
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <label className="block text-sm font-medium">
            Guest Message
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={5000}
              rows={3}
              required
              disabled={loading}
              className="mt-2 block w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>

          <button
            type="submit"
            disabled={loading || !message.trim()}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Processing..." : "Create Demo Task"}
          </button>

          <p role="status" className="text-sm text-slate-600">
            {feedback}
          </p>
        </form>

        {!tasks.length && (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            No tasks yet. Submit a sample message above.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tasks.map((task) => (
            <article
              key={task.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  {task.category}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {task.priority} priority
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  {task.status}
                </span>
              </div>

              <h3 className="mt-4 text-lg font-semibold">{task.title}</h3>

              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {task.description}
              </p>

              <button
                type="button"
                onClick={() => toggleTask(task.id)}
                disabled={loading}
                className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {task.status === "open" ? "Mark Completed" : "Reopen Task"}
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}