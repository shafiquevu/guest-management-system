"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, MessageCircle, X } from "lucide-react";
import { useApp } from "@/components/app-shell";
import { btn, cx, field } from "@/components/ui";

type Template = {
  name: string;
  language: string;
  category: string;
  body: string;
  params: string[];
  header: string | null;
  footer: string | null;
};

const fill = (t: Template, values: Record<string, string>) =>
  [t.header, t.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => values[k]?.trim() || `{{${k}}}`), t.footer]
    .filter(Boolean)
    .join("\n\n");

/**
 * Start a conversation with a guest who hasn't written in.
 * WhatsApp needs a Meta-approved template for the first message; email is free text.
 */
export function NewChat({ onClose, onOpened }: { onClose: () => void; onOpened: (conversationId: string) => void }) {
  const { api } = useApp();
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api("/api/whatsapp/templates").then((res) => {
      if (!live) return;
      setTemplates(res.data?.templates ?? []);
      setTemplateError(res.ok ? (res.data?.error ?? null) : (res.data?.error ?? `Could not load templates (${res.status}).`));
    });
    return () => {
      live = false;
    };
  }, [api]);

  const template = useMemo(() => templates?.find((t) => `${t.name}|${t.language}` === picked) ?? null, [templates, picked]);

  async function send() {
    setSending(true);
    setError(null);
    const res = await api("/api/conversations/new", {
      json:
        channel === "whatsapp"
          ? { channel, phone, name, template: template && { name: template.name, language: template.language }, values }
          : { channel, email, name, subject, body, cc, bcc },
    });
    setSending(false);
    if (!res.ok || !res.data?.conversationId) {
      setError(res.data?.error ?? `Could not start the chat (${res.status}).`);
      return;
    }
    onOpened(res.data.conversationId);
  }

  const ready =
    channel === "whatsapp"
      ? phone.replace(/\D/g, "").length >= 8 && !!template && template.params.every((p) => values[p]?.trim())
      : /\S+@\S+\.\S+/.test(email) && subject.trim() && body.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-[8vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        className="scroll-thin max-h-[84vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">New chat</h2>
          <button onClick={onClose} className={btn.ghost} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {([
            ["whatsapp", "WhatsApp", MessageCircle],
            ["email", "Email", Mail],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setChannel(key)}
              className={cx(
                "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1",
                channel === key ? "bg-indigo-50 text-indigo-700 ring-indigo-300" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
              )}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Guest name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="e.g. Sarah Khan" />
          </label>

          {channel === "whatsapp" ? (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">WhatsApp number, with country code</span>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={field} placeholder="+44 7700 900123" inputMode="tel" />
              </label>

              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-100">
                WhatsApp only allows the first message to a guest to be a template approved by Meta. Once the guest replies,
                you can chat normally. If you already have a chat with this number, it opens instead.
              </p>

              {templates === null ? (
                <p className="text-sm text-slate-500">Loading templates…</p>
              ) : templates.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 ring-1 ring-slate-100">
                  No approved templates yet. Create one in WhatsApp Manager (360dialog hub → Templates), wait for Meta to approve
                  it, then it appears here. Until then, start the chat from the WhatsApp Business app; it will show up in the inbox.
                  {templateError && <span className="mt-1 block text-xs text-slate-400">{templateError}</span>}
                </p>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">Template</span>
                    <select value={picked} onChange={(e) => { setPicked(e.target.value); setValues({}); }} className={field}>
                      <option value="">Choose a template…</option>
                      {templates.map((t) => (
                        <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                          {t.name.replace(/_/g, " ")} ({t.language})
                        </option>
                      ))}
                    </select>
                  </label>
                  {template?.params.map((p) => (
                    <label key={p} className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-500">{/^\d+$/.test(p) ? `Value {{${p}}}` : p.replace(/_/g, " ")}</span>
                      <input value={values[p] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))} className={field} />
                    </label>
                  ))}
                  {template && (
                    <div>
                      <span className="mb-1 block text-xs font-medium text-slate-500">The guest will receive</span>
                      <p className="rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-line text-slate-800 ring-1 ring-emerald-100">{fill(template, values)}</p>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className={field} placeholder="guest@example.com" inputMode="email" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Cc (optional)</span>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} className={field} placeholder="a@x.com, b@y.com" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">Bcc (optional)</span>
                  <input value={bcc} onChange={(e) => setBcc(e.target.value)} className={field} placeholder="hidden copy" />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Subject</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} placeholder="Your stay at…" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500">Message</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className={field} />
              </label>
            </>
          )}

          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-100">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={btn.secondary}>Cancel</button>
            <button type="button" onClick={send} disabled={!ready || sending} className={btn.primary}>
              {sending ? "Sending…" : "Send and open chat"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
