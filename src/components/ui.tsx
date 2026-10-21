"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { avatarTint, CHANNEL_LABEL, CHANNEL_STYLE, initials } from "@/lib/format";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50",
  ghost:
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50",
};

export const field =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:text-slate-500";

export function Avatar({ name, size = "md" }: { name: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-7 w-7 text-[11px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" }[size];
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", dims, avatarTint(name))}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** Channel: a coloured mark plus its name, so identity is never colour alone. */
export function ChannelBadge({ channel, compact = false }: { channel: string; compact?: boolean }) {
  const style = CHANNEL_STYLE[channel] ?? CHANNEL_STYLE.beds24;
  const label = CHANNEL_LABEL[channel] ?? channel;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", style.chip)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden />
      {compact ? null : label}
      {compact && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** A small avatar with the channel's mark in the corner. */
export function GuestAvatar({ name, channel }: { name: string | null | undefined; channel: string }) {
  const style = CHANNEL_STYLE[channel] ?? CHANNEL_STYLE.beds24;
  return (
    <span className="relative inline-flex">
      <Avatar name={name} />
      <span
        className={cx(
          "absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-white",
          style.dot,
        )}
        title={CHANNEL_LABEL[channel] ?? channel}
      >
        {style.letter}
      </span>
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", className)}>
      {children}
    </span>
  );
}

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl bg-white shadow-sm ring-1 ring-slate-200", className)}>
      {title && (
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">{icon}</div>
      <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-slate-500">{text}</p>}
    </div>
  );
}

/** A collapsible block in a side panel. */
export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
        aria-expanded={open}
      >
        {title}
        <ChevronDown className={cx("h-4 w-4 transition-transform", open ? "" : "-rotate-90")} />
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

export function Field({ label, value, copy }: { label: string; value: string | null | undefined; copy?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="group flex items-start justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-right text-slate-900">
        <span className="wrap-break-word">{value || "–"}</span>
        {copy && value && (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(value);
              setDone(true);
              setTimeout(() => setDone(false), 1200);
            }}
            className="rounded p-0.5 text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100"
            aria-label={`Copy ${label}`}
          >
            {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
      </span>
    </div>
  );
}

/** Tabs with optional counts. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { key: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
      {items.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
            value === t.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className={cx("rounded-full px-1.5 text-[10px]", value === t.key ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600")}>
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
