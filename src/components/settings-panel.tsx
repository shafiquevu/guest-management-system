"use client";

import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { useApp, type Role } from "@/components/app-shell";
import { dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type StaffRow = { id: string; full_name: string; email: string; role: Role; active: boolean };
type Connection = { id: string; channel: string; display_name: string; active: boolean; last_sync_at: string | null; last_error: string | null };

const ROLES: Role[] = ["admin", "manager", "agent", "read_only"];

export function SettingsPanel() {
  const { supabase, profile, api } = useApp();
  const isAdmin = profile.role === "admin";
  const canSync = profile.role === "admin" || profile.role === "manager";

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [form, setForm] = useState({ fullName: "", email: "", role: "agent" as Role, password: "" });
  const [newPassword, setNewPassword] = useState("");

  const load = useCallback(async () => {
    const [{ data: s }, { data: p }, { data: ps }, { data: c }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, active").order("full_name"),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("property_staff").select("profile_id, property_id"),
      supabase.from("channel_connections").select("id, channel, display_name, active, last_sync_at, last_error"),
    ]);
    setStaff((s ?? []) as StaffRow[]);
    setProperties((p ?? []) as { id: string; name: string }[]);
    const map: Record<string, string[]> = {};
    for (const row of ps ?? []) (map[row.profile_id] ??= []).push(row.property_id);
    setAssignments(map);
    setConnections((c ?? []) as Connection[]);
  }, [supabase]);

  useLoader(load);

  async function sync(maxAgeDays: number) {
    setSyncing(true);
    setNotice(null);
    const res = await api("/api/sync/beds24", { json: { maxAgeDays } });
    setSyncing(false);
    setNotice(
      res.ok
        ? `Synced: ${res.data.messagesAdded} new messages, ${res.data.conversationsTouched} conversations.`
        : `Sync problem: ${res.data.error ?? res.data.errors?.[0] ?? res.status}`,
    );
    load();
  }

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    const res = await api("/api/admin/staff", { json: form });
    if (!res.ok) return setNotice(res.data.error ?? "Could not create the login.");
    setNotice(`Login created for ${form.email}. Give them the first password; they can change it in Settings.`);
    setForm({ fullName: "", email: "", role: "agent", password: "" });
    load();
  }

  async function patchStaff(id: string, changes: Record<string, unknown>) {
    const res = await api("/api/admin/staff", { method: "PATCH", json: { id, ...changes } });
    if (!res.ok) setNotice(res.data.error ?? "Could not save.");
    load();
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) return setNotice("Use at least 10 characters.");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setNotice(error ? error.message : "Password changed.");
    setNewPassword("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 text-sm">
      <h1 className="text-lg font-semibold">Settings</h1>
      {notice && <p className="rounded-md bg-slate-100 px-3 py-2 text-slate-800">{notice}</p>}

      {canSync && (
        <Card title="Channels">
          {connections.length === 0 && <p className="text-slate-500">Nothing synced yet. Press “Sync now”.</p>}
          {connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-2">
              <div>
                <div className="font-medium">{c.display_name}</div>
                <div className="text-xs text-slate-500">
                  Last sync: {c.last_sync_at ? dateTime(c.last_sync_at) : "never"}
                </div>
                {c.last_error && <div className="text-xs text-red-600">{c.last_error}</div>}
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${c.last_error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                {c.last_error ? "Problem" : "OK"}
              </span>
            </div>
          ))}
          <div className="mt-3 flex gap-2">
            <button disabled={syncing} onClick={() => sync(3)} className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button disabled={syncing} onClick={() => sync(30)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50">
              Load last 30 days
            </button>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card title="Staff">
          <table className="w-full">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="py-1.5">Name</th>
                <th>Role</th>
                <th>Properties (agents see only these)</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">
                    <div className="font-medium">{s.full_name}</div>
                    <div className="text-xs text-slate-500">{s.email}</div>
                  </td>
                  <td>
                    <select value={s.role} onChange={(e) => patchStaff(s.id, { role: e.target.value })} className="rounded border border-slate-300 px-1.5 py-1 text-xs" aria-label="Role">
                      {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
                    </select>
                  </td>
                  <td>
                    {s.role === "agent" ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {properties.length === 0 && <span className="text-xs text-slate-400">No properties yet</span>}
                        {properties.map((p) => {
                          const on = (assignments[s.id] ?? []).includes(p.id);
                          return (
                            <label key={p.id} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => {
                                  const current = assignments[s.id] ?? [];
                                  patchStaff(s.id, {
                                    propertyIds: on ? current.filter((x) => x !== p.id) : [...current, p.id],
                                  });
                                }}
                              />
                              {p.name}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">All properties</span>
                    )}
                  </td>
                  <td>
                    <input type="checkbox" checked={s.active} onChange={(e) => patchStaff(s.id, { active: e.target.checked })} aria-label="Active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form onSubmit={createStaff} className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-4 md:grid-cols-5">
            <input required placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5" />
            <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5" />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="rounded-md border border-slate-300 px-2 py-1.5" aria-label="Role">
              {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </select>
            <input required minLength={10} placeholder="First password (10+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1.5" />
            <button className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">Add staff</button>
          </form>
        </Card>
      )}

      <Card title="Your password">
        <form onSubmit={changePassword} className="flex gap-2">
          <input type="password" minLength={10} placeholder="New password (10+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-2 py-1.5" />
          <button className="rounded-md bg-slate-900 px-3 py-1.5 font-medium text-white">Change</button>
        </form>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
