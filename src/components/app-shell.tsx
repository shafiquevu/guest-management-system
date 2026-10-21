"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "manager" | "agent" | "read_only";

export type Profile = {
  id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: Role;
};

type AppContextValue = {
  supabase: SupabaseClient;
  session: Session;
  profile: Profile;
  canWrite: boolean;
  /** fetch() to our own API with the signed-in user's token attached. */
  // The API returns JSON whose shape depends on the route; callers read the fields they asked for.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: (path: string, init?: RequestInit & { json?: unknown }) => Promise<{ ok: boolean; status: number; data: any }>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = use(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppShell>");
  return value;
}

const NAV = [
  { href: "/inbox", label: "Inbox" },
  { href: "/tasks", label: "Tasks" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(current: Session | null) {
      if (!current) {
        router.replace("/login");
        return;
      }
      setSession(current);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, organization_id, full_name, email, role, active")
        .eq("id", current.user.id)
        .single();
      if (cancelled) return;
      if (error || !data || !data.active) {
        setProblem("Your login works, but it has no active staff profile. Ask an admin to set you up.");
        return;
      }
      setProfile(data as Profile);
    }
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!next) router.replace("/login");
      else setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, router]);

  const api = useCallback<AppContextValue["api"]>(
    async (path, init = {}) => {
      const { data } = await supabase.auth.getSession();
      const { json, headers, ...rest } = init;
      const res = await fetch(path, {
        ...rest,
        method: rest.method ?? (json !== undefined ? "POST" : "GET"),
        headers: {
          ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
          Authorization: `Bearer ${data.session?.access_token ?? ""}`,
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data: body };
    },
    [supabase],
  );

  if (problem) {
    return (
      <Centered>
        <p className="text-sm text-slate-700">{problem}</p>
        <button className="mt-4 text-sm text-blue-600 underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Centered>
    );
  }
  if (!session || !profile) {
    return (
      <Centered>
        <p className="text-sm text-slate-500">Loading…</p>
      </Centered>
    );
  }

  const value: AppContextValue = {
    supabase,
    session,
    profile,
    canWrite: profile.role !== "read_only",
    api,
  };

  return (
    <AppContext value={value}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-6 border-b border-slate-200 bg-white px-4 py-2.5">
          <span className="font-semibold text-slate-900">Guest Inbox</span>
          <nav className="flex gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  pathname.startsWith(item.href)
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span>
              {profile.full_name} · <span className="capitalize">{profile.role.replace("_", " ")}</span>
            </span>
            <button className="text-blue-600 hover:underline" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1">{children}</main>
      </div>
    </AppContext>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">{children}</div>
    </div>
  );
}
