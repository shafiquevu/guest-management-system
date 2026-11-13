"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, KeyRound, Mail, Pencil, RefreshCw, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { useApp, type Role } from "@/components/app-shell";
import { Avatar, btn, Card, Chip, cx, field, PageHeader } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { useLoader } from "@/lib/use-loader";

type StaffRow = { id: string; full_name: string; email: string; role: Role; active: boolean; avatar_url: string | null };
/** The WhatsApp glyph (lucide has no brand icons). */
function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

type Connection = {
  id: string;
  channel: string;
  display_name: string;
  active: boolean;
  mailbox_email: string | null;
  external_phone_number: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

/** What Google's round trip came back with (/settings?gmail=…). */
const GMAIL_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Gmail connected. Guest emails will appear in the inbox within 5 minutes, or press Sync now." },
  cancelled: { ok: false, text: "Gmail was not connected: access was cancelled on Google's page." },
  expired: { ok: false, text: "That Gmail sign-in link expired. Press Connect Gmail again." },
  "not-allowed": { ok: false, text: "Only an admin can connect Gmail." },
  "no-refresh-token": { ok: false, text: "Google didn't grant lasting access. Remove this app at myaccount.google.com/permissions, then connect again." },
  failed: { ok: false, text: "Gmail could not be connected. Check the Google Cloud settings and try again." },
};

const ROLES: { key: Role; label: string; help: string }[] = [
  { key: "admin", label: "Admin", help: "Everything, including staff and settings" },
  { key: "manager", label: "Manager", help: "All conversations, properties and saved replies" },
  { key: "agent", label: "Agent", help: "Only the properties ticked for them" },
  { key: "read_only", label: "Read only", help: "Can look, cannot change anything" },
];

export function SettingsPanel() {
  const { supabase, profile, api, isManager, updateProfile } = useApp();
  const isAdmin = profile.role === "admin";

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [connections, setConnections] = useState<Connection[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", role: "agent" as Role, password: "" });
  const [newPassword, setNewPassword] = useState("");
  const [editing, setEditing] = useState<{ id: string; fullName: string; email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    const [{ data: s }, { data: p }, { data: ps }, { data: c }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, active, avatar_url").order("full_name"),
      supabase.from("properties").select("id, name").order("name"),
      supabase.from("property_staff").select("profile_id, property_id"),
      supabase.from("channel_connections").select("id, channel, display_name, active, mailbox_email, external_phone_number, last_sync_at, last_error"),
    ]);
    setStaff((s ?? []) as StaffRow[]);
    setProperties((p ?? []) as { id: string; name: string }[]);
    const map: Record<string, string[]> = {};
    for (const row of ps ?? []) (map[row.profile_id] ??= []).push(row.property_id);
    setAssignments(map);
    setConnections((c ?? []) as Connection[]);
  }, [supabase]);
  useLoader(load);

  // Back from Google: show the result once, then tidy the address bar.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("gmail");
    if (!result) return;
    window.history.replaceState(null, "", window.location.pathname);
    void Promise.resolve().then(() => setNotice(GMAIL_RESULT[result] ?? GMAIL_RESULT.failed));
  }, []);

  async function connectGmail() {
    setNotice(null);
    const res = await api("/api/gmail/connect", { json: {} });
    if (!res.ok || !res.data.url) return setNotice({ ok: false, text: res.data.error ?? "Could not start the Gmail connection." });
    window.location.href = res.data.url;
  }

  async function disconnectGmail() {
    if (!window.confirm("Disconnect Gmail? Emails already in the inbox stay; new ones stop arriving.")) return;
    const res = await api("/api/gmail/connect", { method: "DELETE" });
    setNotice(res.ok ? { ok: true, text: "Gmail disconnected." } : { ok: false, text: res.data.error ?? "Could not disconnect." });
    load();
  }

  async function connectWhatsApp() {
    setNotice(null);
    const res = await api("/api/whatsapp/connect", { json: {} });
    setNotice(
      res.ok
        ? { ok: true, text: "WhatsApp connected. New guest messages will appear in the inbox." }
        : { ok: false, text: res.data.error ?? "Could not connect WhatsApp." },
    );
    load();
  }

  async function disconnectWhatsApp() {
    if (!window.confirm("Disconnect WhatsApp? Chats already in the inbox stay; new messages stop arriving here (the phone app keeps working).")) return;
    const res = await api("/api/whatsapp/connect", { method: "DELETE" });
    setNotice(res.ok ? { ok: true, text: "WhatsApp disconnected." } : { ok: false, text: res.data.error ?? "Could not disconnect." });
    load();
  }

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

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const current = staff.find((x) => x.id === editing.id);
    const changes: Record<string, unknown> = {};
    if (editing.fullName.trim() && editing.fullName.trim() !== current?.full_name) changes.fullName = editing.fullName.trim();
    if (editing.email.trim().toLowerCase() !== current?.email) changes.email = editing.email.trim();
    if (editing.password) changes.password = editing.password;
    if (!Object.keys(changes).length) return setEditing(null);
    const res = await api("/api/admin/staff", { method: "PATCH", json: { id: editing.id, ...changes } });
    if (!res.ok) return setNotice({ ok: false, text: res.data.error ?? "Could not save." });
    setNotice({ ok: true, text: changes.password ? "Saved. Share the new password with them." : "Saved." });
    setEditing(null);
    load();
  }

  async function removeStaff(s: StaffRow) {
    if (!window.confirm(`Remove ${s.full_name}? They will no longer be able to sign in.`)) return;
    const res = await api("/api/admin/staff", { method: "DELETE", json: { id: s.id } });
    if (!res.ok) return setNotice({ ok: false, text: res.data.error ?? "Could not remove." });
    setNotice({
      ok: true,
      text: res.data.removed === "deleted"
        ? `${s.full_name} was removed.`
        : `${s.full_name} can no longer sign in. Their past messages and tasks keep their name, so they are listed under Inactive (you can restore them).`,
    });
    load();
  }

  async function setPhoto(profileId: string, file: File | null) {
    const res = file
      ? await api("/api/profile/photo", { method: "POST", body: photoForm(file, profileId) })
      : await api("/api/profile/photo", { method: "DELETE", json: { profileId } });
    if (!res.ok) return setNotice({ ok: false, text: res.data.error ?? "Could not save the photo." });
    if (profileId === profile.id) updateProfile({ avatar_url: file ? res.data.avatarUrl : null });
    setNotice({ ok: true, text: file ? "Photo saved." : "Photo removed." });
    load();
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) return setNotice({ ok: false, text: "Use at least 10 characters." });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setNotice(error ? { ok: false, text: error.message } : { ok: true, text: "Your password has been changed." });
    setNewPassword("");
  }

  const beds24Connections = connections.filter((c) => c.channel === "beds24");
  const gmail = connections.find((c) => c.channel === "gmail" && c.active) ?? null;
  const whatsapp = connections.find((c) => c.channel === "whatsapp" && c.active) ?? null;

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
            {beds24Connections.length === 0 && <p className="text-sm text-slate-500">Nothing synced yet. Press “Sync now”.</p>}
            {beds24Connections.map((c) => (
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
            <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white"><Mail className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  Gmail <span className="font-normal text-slate-500">· {gmail ? gmail.mailbox_email : "guest emails"}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {gmail ? `Last sync ${gmail.last_sync_at ? dateTime(gmail.last_sync_at) : "not yet"}` : "Sign in with the team mailbox to bring guest emails into the inbox."}
                </p>
                {gmail?.last_error && <p className="mt-1 text-xs text-red-600">{gmail.last_error}</p>}
              </div>
              {gmail && (
                <Chip className={gmail.last_error ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}>
                  {gmail.last_error ? "Needs attention" : "Connected"}
                </Chip>
              )}
              {isAdmin && (gmail
                ? <button onClick={disconnectGmail} className={btn.secondary}>Disconnect</button>
                : <button onClick={connectGmail} className={btn.primary}>Connect Gmail</button>)}
            </div>
            <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#25D366] text-white"><WhatsAppLogo className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  WhatsApp <span className="font-normal text-slate-500">· {whatsapp?.external_phone_number ?? "guest chats"}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {whatsapp
                    ? `Last message ${whatsapp.last_sync_at ? dateTime(whatsapp.last_sync_at) : "not yet"}`
                    : "Bring the business WhatsApp number into the inbox. The phone app keeps working as before."}
                </p>
                {whatsapp?.last_error && <p className="mt-1 text-xs text-red-600">{whatsapp.last_error}</p>}
              </div>
              {whatsapp && (
                <Chip className={whatsapp.last_error ? "bg-red-50 text-red-700 ring-red-200" : "bg-emerald-50 text-emerald-700 ring-emerald-200"}>
                  {whatsapp.last_error ? "Needs attention" : "Connected"}
                </Chip>
              )}
              {isAdmin && (whatsapp
                ? <button onClick={disconnectWhatsApp} className={btn.secondary}>Disconnect</button>
                : <button onClick={connectWhatsApp} className={btn.primary}>Connect WhatsApp</button>)}
            </div>
          </Card>
        )}

        {isAdmin && (
          <Card title={`Staff (${staff.filter((x) => x.active).length})`}>
            <div className="-mx-4 -mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Person</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Properties</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staff.filter((x) => x.active).map((s) => (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <PhotoPicker name={s.full_name} src={s.avatar_url} onPick={(file) => setPhoto(s.id, file)} />
                          {editing?.id === s.id ? (
                            <form onSubmit={saveEdit} className="grid gap-1.5">
                              <input required value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} className={cx(field, "py-1.5 text-xs")} aria-label="Full name" placeholder="Full name" />
                              <input required type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} className={cx(field, "py-1.5 text-xs")} aria-label="Email" placeholder="Email" />
                              <input minLength={10} value={editing.password} onChange={(e) => setEditing({ ...editing, password: e.target.value })} className={cx(field, "py-1.5 text-xs")} aria-label="New password" placeholder="New password (blank = keep)" />
                              <div className="flex gap-1.5">
                                <button className={cx(btn.primary, "px-2.5 py-1 text-xs")}>Save</button>
                                <button type="button" onClick={() => setEditing(null)} className={cx(btn.secondary, "px-2.5 py-1 text-xs")}>Cancel</button>
                              </div>
                            </form>
                          ) : (
                            <div>
                              <p className="font-medium text-slate-900">{s.full_name}</p>
                              <p className="text-xs text-slate-500">{s.email}</p>
                            </div>
                          )}
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
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditing({ id: s.id, fullName: s.full_name, email: s.email, password: "" })}
                            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit name, email or password" aria-label={`Edit ${s.full_name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {s.id !== profile.id && (
                            <button
                              onClick={() => removeStaff(s)}
                              className="rounded-md p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              title="Remove" aria-label={`Remove ${s.full_name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {staff.some((x) => !x.active) && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-sm font-medium text-slate-900">Inactive ({staff.filter((x) => !x.active).length})</p>
                <ul className="divide-y divide-slate-100">
                  {staff.filter((x) => !x.active).map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex items-center gap-2.5 opacity-60">
                        <Avatar name={s.full_name} src={s.avatar_url} />
                        <div>
                          <p className="text-sm font-medium text-slate-900">{s.full_name}</p>
                          <p className="text-xs text-slate-500">{s.email} · cannot sign in</p>
                        </div>
                      </div>
                      <button onClick={() => patchStaff(s.id, { active: true })} className={cx(btn.secondary, "px-2.5 py-1 text-xs")}>
                        <RotateCcw className="h-3.5 w-3.5" /> Restore
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

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

        <Card title="Your photo">
          <div className="flex items-center gap-4">
            <PhotoPicker name={profile.full_name} src={profile.avatar_url} size="lg" onPick={(file) => setPhoto(profile.id, file)} />
            <p className="text-sm text-slate-600">
              Shown next to your replies and on conversations assigned to you. Click it to change it.
              {profile.avatar_url && (
                <button onClick={() => setPhoto(profile.id, null)} className="ml-2 font-medium text-slate-500 underline hover:text-slate-800">
                  Remove
                </button>
              )}
            </p>
          </div>
        </Card>

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

function photoForm(file: File, profileId: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("profileId", profileId);
  return form;
}

/** A staff photo that opens a file picker when clicked. */
function PhotoPicker({
  name,
  src,
  size = "sm",
  onPick,
}: {
  name: string;
  src: string | null;
  size?: "sm" | "lg";
  onPick: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button type="button" onClick={() => input.current?.click()} className="group relative shrink-0 rounded-full" title={`Change ${name}'s photo`}>
      <Avatar name={name} src={src} size={size} />
      <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/50 text-white opacity-0 transition group-hover:opacity-100">
        <Camera className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} />
      </span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </button>
  );
}
