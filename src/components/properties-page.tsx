"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Building2, Check, MapPin, Search } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, cx, EmptyState, field } from "@/components/ui";
import { useLoader } from "@/lib/use-loader";

type Property = {
  id: string;
  external_id: string | null;
  name: string;
  address: string | null;
  city: string | null;
  postcode: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  check_in_instructions: string | null;
  check_out_instructions: string | null;
  parking_instructions: string | null;
  house_rules: string | null;
  notes: string | null;
};

const EDITABLE = [
  ["wifi_name", "Wi-Fi network", "input"],
  ["wifi_password", "Wi-Fi password", "input"],
  ["check_in_instructions", "Check-in instructions", "text"],
  ["check_out_instructions", "Check-out instructions", "text"],
  ["parking_instructions", "Parking", "text"],
  ["house_rules", "House rules", "text"],
  ["notes", "Internal notes about this property", "text"],
] as const;

type EditableKey = (typeof EDITABLE)[number][0];

export function PropertiesPage() {
  const { supabase, isManager } = useApp();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Record<EditableKey, string>>>({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("properties")
      .select("id, external_id, name, address, city, postcode, check_in_time, check_out_time, wifi_name, wifi_password, check_in_instructions, check_out_instructions, parking_instructions, house_rules, notes")
      .order("name");
    setProperties((data ?? []) as Property[]);
  }, [supabase]);
  useLoader(load);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? properties.filter((p) => [p.name, p.address, p.city].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))) : properties;
  }, [properties, search]);

  const selected = properties.find((p) => p.id === selectedId) ?? null;

  function choose(p: Property) {
    setSelectedId(p.id);
    setNotice(null);
    setDraft(Object.fromEntries(EDITABLE.map(([k]) => [k, p[k] ?? ""])));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    const changes = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, (v ?? "").trim() || null]));
    const { error } = await supabase
      .from("properties")
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq("id", selected.id);
    setSaving(false);
    setNotice(error ? error.message : "Saved. Staff see this in the guest panel.");
    if (!error) load();
  }

  const filled = (p: Property) => EDITABLE.filter(([k]) => k !== "notes" && p[k]).length;

  return (
    <div className="grid h-full grid-cols-[360px_minmax(0,1fr)]">
      <section className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="space-y-3 border-b border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Properties</h1>
            <span className="text-xs text-slate-500">{properties.length}</span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search properties" className={cx(field, "pl-9")} aria-label="Search properties" />
          </div>
          <p className="text-xs text-slate-500">Properties appear here automatically once a guest from them writes in.</p>
        </div>
        <ul className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 && (
            <li><EmptyState icon={<Building2 className="h-5 w-5" />} title="No properties yet" /></li>
          )}
          {visible.map((p) => {
            const done = filled(p);
            return (
              <li key={p.id}>
                <button
                  onClick={() => choose(p)}
                  className={cx("flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left", selectedId === p.id ? "bg-indigo-50/70" : "hover:bg-slate-50")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Building2 className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
                    <p className="truncate text-xs text-slate-500">{[p.address, p.city].filter(Boolean).join(", ") || "No address"}</p>
                    <p className={cx("mt-1 text-[11px]", done >= 4 ? "text-emerald-700" : "text-amber-700")}>
                      {done} of 6 guest details filled in
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="scroll-thin relative min-h-0 overflow-y-auto bg-slate-50">
        {!selected ? (
          <EmptyState icon={<Building2 className="h-5 w-5" />} title="Select a property" text="Add the details staff need when guests ask: Wi-Fi, check-in, parking and house rules." />
        ) : (
          <form onSubmit={save} className="mx-auto max-w-3xl space-y-5 p-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">{selected.name}</h2>
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                <MapPin className="h-4 w-4" />
                {[selected.address, selected.city, selected.postcode].filter(Boolean).join(", ") || "No address"}
                {selected.external_id && <span className="ml-2 text-xs text-slate-400">Beds24 #{selected.external_id}</span>}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Check-in from {selected.check_in_time?.slice(0, 5) ?? "–"} · Check-out by {selected.check_out_time?.slice(0, 5) ?? "–"}
                <span className="text-xs text-slate-400"> (from Beds24)</span>
              </p>
            </div>

            {!isManager && (
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">Only admins and managers can edit property details.</p>
            )}

            <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="grid gap-4 sm:grid-cols-2">
                {EDITABLE.filter(([, , kind]) => kind === "input").map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="text-sm font-medium text-slate-700">{label}</span>
                    <input disabled={!isManager} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={cx(field, "mt-1")} />
                  </label>
                ))}
              </div>
              {EDITABLE.filter(([, , kind]) => kind === "text").map(([key, label]) => (
                <label key={key} className="block">
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                  <textarea disabled={!isManager} rows={3} value={draft[key] ?? ""} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} className={cx(field, "mt-1")} />
                </label>
              ))}
            </div>

            {isManager && (
              <div className="flex items-center gap-3">
                <button disabled={saving} className={btn.primary}>
                  <Check className="h-4 w-4" />
                  {saving ? "Saving…" : "Save property"}
                </button>
                {notice && <span className="text-sm text-slate-600">{notice}</span>}
              </div>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
