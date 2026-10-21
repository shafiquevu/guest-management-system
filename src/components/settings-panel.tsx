"use client";

import { useCallback, useState, type FormEvent } from "react";
import { KeyRound, RefreshCw, UserPlus } from "lucide-react";
import { useApp, type Role } from "@/components/app-shell";
import { Avatar, btn, Card, Chip, cx, field, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type StaffRow = { id: string; full_name: string; email: string; role: Role; active: boolean };
type Connection = { id: string; channel: string; display_name: string; active: boolean; last_sync_at: string | null; last_error: string | null };

const ROLES: { key: Role; label: string; help: string }[] = [
  { key: "admin", label: "Admin", help: "Everything, including staff and settings" },
  { key: "manager", label: "Manager", help: "All conversations, properties and saved replies" },
  { key: "agent", label: "Agent", help: "Only the properties ticked for them" },
  { key: "read_only", label: "Read only", help: "Can look, cannot change anything" },
];

export function SettingsPanel() {
  const { supabase, profile, api, isManager } = useApp();
  const isAdmin = profile.role === "admin";

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
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
        ? { ok: true, text: `Sync complete: ${res.data.messagesAdded} new messages across ${res.data.conversationsTouched} conversations.` }
        : { ok: false, text: `Sync problem: ${res.data.error ?? res.data.errors?.[0] ?? res.status}` },
    );
    load();
  }

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    const res = await api("/api/admin/staff", { json: form });
    if (!res.ok) return setNotice({ ok: false, text: res.data.error ?? "Could not create the login." });
    setNotice({ ok: true, text: `Login created for ${form.email}. Share the first password with them; they can change it here.` });
    setForm({ fullName: "", email: "", role: "agent", password: "" });
    load();
  }

  async function patchStaff(id: string, changes: Record<string, unknown>) {
    const res = await api("/api/admin/staff", { method: "PATCH", json: { id, ...changes } });
    if (!res.ok) setNotice({ ok: false, text: res.data.error ?? "Could not save." });
    load();
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) return setNotice({ ok: false, text: "Use at least 10 characters." });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setNotice(error ? { ok: false, text: error.message } : { ok: true, text: "Your password has been changed." });
    setNewPassword("");
  }

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PageHeader title="Settings" subtitle="Channels, staff access and your account." />

        {notice && (
          <p className={cx("rounded-lg px-4 py-2.5 text-sm", notice.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}>{notice.text}</p>
        )}

        {isManager && (
          <Card
            title="Channels"
            action={
              <div className="flex gap-2">
                <button disabled={syncing} onClick={() => sync(30)} className={btn.secondary}>Load last 30 days</button>
                <button disabled={syncing} onClick={() => sync(3)} className={btn.primary}>
                  <RefreshCw className={cx("h-4 w-4", syncing && "animate-spin")} /> {syncing ? "Syncing…" : "Sync now"}
                </button>
              </div>
            }
          >
            {connections.length === 0 && <p className="text-sm text-slate-500">Nothing synced yet. Press “Sync now”.</p>}
            {connections.map((c) => (
              <div key={c.id} className="flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">B24</span>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{c.display_name} <span className="font-normal text-slate-500">· Airbnb & Booking.com</span></p>
                  <p className="text-xs text-slate-500">Last sync {c.last_sync_at ? dateTime(c.last_sync_at) : "never"}</p>
                  {c.last_error && <p className="mt-1 text-xs text-red-600">{c.last_error}</p>}
                </div>
                <Chip className={c.last_error ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}>
                  {c.last_error ? "Needs attention" : "Connected"}
                </Chip>
              </div>
            ))}
            <div className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-2">
              {["WhatsApp", "Gmail"].map((n) => (
                <div key={n} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">{n}</span>
                  <Chip className="bg-slate-100 text-slate-500 ring-slate-200">Not connected yet</Chip>
                </div>
              ))}
            </div>
          </Card>
        )}

        {isAdmin && (
          <Card title={`Staff (${staff.length})`}>
            <div className="-mx-4 -mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Person</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Properties</th>
                    <th className="px-4 py-2.5">Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staff.map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={s.full_name} size="sm" />
                          <div>
                            <p className="font-medium text-slate-900">{s.full_name}</p>
                            <p className="text-xs text-slate-500">{s.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select value={s.role} onChange={(e) => patchStaff(s.id, { role: e.target.value })} className={cx(field, "w-36 py-1.5 text-xs")} aria-label="Role">
                          {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {s.role === "agent" ? (
                          <div className="flex max-w-md flex-wrap gap-1.5">
                            {properties.length === 0 && <span className="text-xs text-slate-400">No properties yet</span>}
                            {properties.map((p) => {
                              const on = (assignments[s.id] ?? []).includes(p.id);
                              return (
                                <button
                                  key={p.id}
                                  onClick={() => {
                                    const current = assignments[s.id] ?? [];
                                    patchStaff(s.id, { propertyIds: on ? current.filter((x) => x !== p.id) : [...current, p.id] });
                                  }}
                                  className={cx(
                                    "rounded-full px-2.5 py-1 text-xs ring-1",
                                    on ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50",
                                  )}
                                  aria-pressed={on}
                                >
                                  {p.name}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">All properties</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input type="checkbox" checked={s.active} onChange={(e) => patchStaff(s.id, { active: e.target.checked })} aria-label={`${s.full_name} active`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form onSubmit={createStaff} className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-900"><UserPlus className="h-4 w-4" /> Add a staff member</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <input required placeholder="Full name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={field} />
                <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className={field} aria-label="Role">
                  {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                <input required minLength={10} placeholder="First password (10+ characters)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={field} />
              </div>
              <p className="mt-2 text-xs text-slate-500">{ROLES.find((r) => r.key === form.role)?.help}</p>
              <button className={cx(btn.primary, "mt-3")}>Create login</button>
            </form>
          </Card>
        )}

        <Card title="Your password">
          <form onSubmit={changePassword} className="flex max-w-lg gap-2">
            <input type="password" minLength={10} placeholder="New password (10+ characters)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={field} aria-label="New password" />
            <button className={btn.secondary}><KeyRound className="h-4 w-4" /> Change</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
