"use client";

import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronUp, Paperclip, Reply, ReplyAll } from "lucide-react";
import { Avatar, cx } from "@/components/ui";
import { clock, dayLabel } from "@/lib/format";

export type EmailMessage = {
  id: string;
  direction: "inbound" | "outbound";
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  body: string | null;
  sender_name: string | null;
  sender_address: string | null;
  recipient_address: string | null;
  provider_error: string | null;
  raw_payload: { subject?: string; from?: string; to?: string; cc?: string; bcc?: string } | null;
};

/** Every address in a header like `"Ann" <a@x.com>, b@y.com`. */
export function addresses(header: string | null | undefined): string[] {
  return [...new Set((header ?? "").match(/[^\s<>,;"']+@[^\s<>,;"']+/g)?.map((a) => a.toLowerCase()) ?? [])];
}

/**
 * Split an email into what was written now and the quoted history below it
 * ("On Tue, … wrote:", Outlook's "From: … Sent: …", "-----Original Message-----").
 * The history is folded away, like an email client does.
 */
export function splitQuoted(body: string): { text: string; quoted: string } {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line, i) => {
    const l = line.trim();
    if (/^On .{4,200}wrote:$/i.test(l)) return true;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(l)) return true;
    if (/^_{8,}$/.test(l) && /^From:/i.test(lines[i + 1]?.trim() ?? "")) return true;
    if (/^From:\s/i.test(l) && lines.slice(i + 1, i + 4).some((n) => /^(Sent|Date):\s/i.test(n.trim()))) return true;
    return false;
  });
  if (start <= 0) return { text: body.trim(), quoted: "" };
  return { text: lines.slice(0, start).join("\n").trim(), quoted: lines.slice(start).join("\n").trim() };
}

/** One email, shown the way an email client shows it: header, body, folded history. */
export function EmailCard({
  m,
  name,
  avatar,
  at,
  label,
  open,
  onToggle,
  onReply,
  onRetry,
  files = [],
  onOpenPhoto,
}: {
  onOpenPhoto?: (url: string) => void;
  files?: { url: string; type: string; name: string }[];
  m: EmailMessage;
  name: string;
  avatar?: string | null;
  at: string;
  label?: string;
  open: boolean;
  onToggle: () => void;
  onReply?: (all: boolean) => void;
  onRetry?: () => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const raw = m.raw_payload ?? {};
  const from = m.sender_address || addresses(raw.from)[0] || "";
  const to = raw.to || m.recipient_address || "";
  const cc = raw.cc || "";
  const { text, quoted } = splitQuoted(m.body ?? "");
  const outbound = m.direction === "outbound";

  return (
    <article className={cx("rounded-xl bg-white shadow-sm ring-1", m.status === "failed" ? "ring-red-300" : "ring-slate-200")}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <Avatar name={name} src={avatar ?? undefined} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-semibold text-slate-900">
              {name}
              {from && <span className="ml-1.5 font-normal text-slate-500">&lt;{from}&gt;</span>}
            </p>
            <span className="shrink-0 text-xs text-slate-400">
              {dayLabel(at)} {clock(at)}
            </span>
          </div>
          {open ? (
            <div className="mt-0.5 space-y-0.5 text-xs text-slate-500">
              {to && <p className="truncate"><span className="text-slate-400">To:</span> {to}</p>}
              {cc && <p className="truncate"><span className="text-slate-400">Cc:</span> {cc}</p>}
              {outbound && raw.bcc && <p className="truncate"><span className="text-slate-400">Bcc:</span> {raw.bcc}</p>}
              {label && <p className="text-slate-400">{label}</p>}
            </div>
          ) : (
            <p className="mt-0.5 truncate text-sm text-slate-500">{text.replace(/\s+/g, " ") || "(empty email)"}</p>
          )}
        </div>
        {open ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pt-3 pb-3">
          {files.length > 0 && (
            // Attachments sit above the text, like an email client: photos as thumbnails, other files as cards.
            <div className="mb-3 flex flex-wrap gap-2">
              {files.map((f) =>
                f.type.startsWith("image/") ? (
                  <a
                    key={f.url}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!onOpenPhoto) return;
                      e.preventDefault();
                      onOpenPhoto(f.url);
                    }}
                    className="block h-28 w-44 cursor-zoom-in overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200 hover:ring-slate-300"
                    title="Open photo"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
                    <img src={f.url} alt="Attached photo" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                  </a>
                ) : (
                  <a
                    key={f.url}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-56 max-w-full items-center gap-2.5 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200 hover:bg-slate-50"
                    title="Open file"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-[10px] font-bold text-indigo-600 uppercase">
                      {f.name.includes(".") ? f.name.split(".").pop()!.slice(0, 4) : <Paperclip className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">{f.name}</span>
                      <span className="block text-xs text-slate-400">Click to open</span>
                    </span>
                  </a>
                ),
              )}
            </div>
          )}
          <div className="text-sm leading-relaxed whitespace-pre-line text-slate-800 [overflow-wrap:anywhere]">{text || "(empty email)"}</div>
          {quoted && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowQuoted((s) => !s)}
                className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold tracking-widest text-slate-500 hover:bg-slate-200"
                title={showQuoted ? "Hide earlier messages" : "Show earlier messages"}
              >
                •••
              </button>
              {showQuoted && (
                <div className="mt-2 border-l-2 border-slate-200 pl-3 text-xs leading-relaxed whitespace-pre-line text-slate-500 [overflow-wrap:anywhere]">
                  {quoted}
                </div>
              )}
            </div>
          )}

          {m.status === "failed" && (
            <p className="mt-3 flex items-center gap-2 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5" /> Not sent: {m.provider_error ?? "unknown error"}
              {onRetry && (
                <button type="button" className="font-semibold underline" onClick={onRetry}>Retry</button>
              )}
            </p>
          )}

          {onReply && !outbound && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onReply(false)}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              >
                <Reply className="h-3.5 w-3.5" /> Reply
              </button>
              {addresses(`${to},${cc}`).length > 1 && (
                <button
                  type="button"
                  onClick={() => onReply(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                >
                  <ReplyAll className="h-3.5 w-3.5" /> Reply all
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
