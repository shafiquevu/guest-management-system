"use client";

import { useCallback, useState, type FormEvent } from "react";
import { BookOpen, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, Chip, cx, EmptyState, field, PageHeader } from "@/components/ui";
import { useLoader } from "@/lib/use-loader";

type Reply = {
  id: string;
  question: string;
  answer: string;
  category: string;
  property_id: string | null;
  approved_for_ai: boolean;
  active: boolean;
};

const CATEGORIES = ["check_in", "check_out", "wifi", "parking", "cleaning", "maintenance", "local_tips", "policies", "other"];
const label = (c: string) => c.replace("_", " ").replace(/^\w/, (x) => x.toUpperCase());

const EMPTY = { question: "", answer: "", category: "check_in", property_id: "", approved_for_ai: false };

export function SavedReplies() {
  const { supabase, profile, isManager } = useApp();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from("faq_entries").select("id, question, answer, category, property_id, approved_for_ai, active").order("category").order("question"),
      supabase.from("properties").select("id, name").order("name"),
    ]);
    setReplies((r.data ?? []) as Reply[]);
    setProperties((p.data ?? []) as { id: string; name: string }[]);
  }, [supabase]);
  useLoader(load);

  function edit(r: Reply | null) {
    setError(null);
    if (!r) {
      setEditing("new");
      setForm(EMPTY);
    } else {
      setEditing(r.id);
      setForm({ question: r.question, answer: r.answer, category: r.category, property_id: r.property_id ?? "", approved_for_ai: r.approved_for_ai });
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const row = {
      question: form.question.trim(),
      answer: form.answer.trim(),
      category: form.category,
      property_id: form.property_id || null,
      approved_for_ai: form.approved_for_ai,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };
    if (!row.question || !row.answer) return setError("A title and the reply text are both needed.");
    const result =
      editing === "new"
        ? await supabase.from("faq_entries").insert({ ...row, organization_id: profile.organization_id, created_by: profile.id, active: true })
        : await supabase.from("faq_entries").update(row).eq("id", editing);
    if (result.error) return setError(result.error.message);
    setEditing(null);
    load();
  }

  async function remove(r: Reply) {
    if (!confirm(`Delete "${r.question}"?`)) return;
    await supabase.from("faq_entries").delete().eq("id", r.id);
    load();
  }

  const propertyName = (id: string | null) => (id ? properties.find((p) => p.id === id)?.name ?? "One property" : "All properties");

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <PageHeader
          title="Saved replies"
          subtitle="Approved answers staff can insert into a reply with one click. Mark one for AI and the assistant may suggest it."
          actions={isManager && <button onClick={() => edit(null)} className={btn.primary}><Plus className="h-4 w-4" /> New reply</button>}
        />

        {editing && (
          <form onSubmit={save} className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block sm:col-span-3">
                <span className="text-sm font-medium text-slate-700">Title (what the guest asks)</span>
                <input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="e.g. What is the Wi-Fi password?" className={cx(field, "mt-1")} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">Category</span>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={cx(field, "mt-1")}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-slate-700">Applies to</span>
                <select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })} className={cx(field, "mt-1")}>
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Reply</span>
              <textarea rows={5} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} className={cx(field, "mt-1")} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.approved_for_ai} onChange={(e) => setForm({ ...form, approved_for_ai: e.target.checked })} />
              Approved for the AI assistant to suggest
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button className={btn.primary}>Save reply</button>
              <button type="button" onClick={() => setEditing(null)} className={btn.secondary}>Cancel</button>
            </div>
          </form>
        )}

        {replies.length === 0 && !editing ? (
          <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <EmptyState icon={<BookOpen className="h-5 w-5" />} title="No saved replies yet" text="Start with the questions guests ask most: check-in, Wi-Fi, parking." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {replies.map((r) => (
              <div key={r.id} className="flex gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{r.question}</p>
                    <Chip className="bg-slate-100 text-slate-600 ring-slate-200">{label(r.category)}</Chip>
                    <Chip className="bg-sky-50 text-sky-700 ring-sky-200">{propertyName(r.property_id)}</Chip>
                    {r.approved_for_ai && (
                      <Chip className="bg-violet-50 text-violet-700 ring-violet-200"><Sparkles className="mr-1 h-3 w-3" /> AI</Chip>
                    )}
                  </div>
                  <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{r.answer}</p>
                </div>
                {isManager && (
                  <div className="flex shrink-0 items-start gap-1">
                    <button onClick={() => edit(r)} className={btn.ghost} aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => remove(r)} className={cx(btn.ghost, "hover:text-red-600")} aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
