"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  BookOpen,
  Building2,
  CheckSquare,
  Inbox as InboxIcon,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, cx } from "@/components/ui";

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
  isManager: boolean;
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

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  read_only: "Read only",
};

export function AppShell({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [counts, setCounts] = useState({ unread: 0, tasks: 0 });

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

  // Sidebar badges: unread conversations and open tasks, kept live.
  const loadCounts = useCallback(async () => {
    const [unread, tasks] = await Promise.all([
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .gt("unread_count", 0)
        .in("status", ["open", "pending", "escalated"]),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .not("status", "in", "(completed,cancelled)"),
    ]);
    setCounts({ unread: unread.count ?? 0, tasks: tasks.count ?? 0 });
  }, [supabase]);

  useEffect(() => {
    if (!profile) return;
    Promise.resolve().then(loadCounts);
    const sub = supabase
      .channel("sidebar-counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => loadCounts())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => loadCounts())
      .subscribe();
    return () => {
      supabase.removeChannel(sub);
    };
  }, [supabase, profile, loadCounts]);

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
        <button className="mt-4 text-sm font-medium text-indigo-600 hover:underline" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </Centered>
    );
  }
  if (!session || !profile) {
    return (
      <Centered>
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-label="Loading" />
      </Centered>
    );
  }

  const value: AppContextValue = {
    supabase,
    session,
    profile,
    canWrite: profile.role !== "read_only",
    isManager: profile.role === "admin" || profile.role === "manager",
    api,
  };

  const nav = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/inbox", label: "Inbox", icon: InboxIcon, count: counts.unread },
    { href: "/tasks", label: "Tasks", icon: CheckSquare, count: counts.tasks },
    { href: "/properties", label: "Properties", icon: Building2 },
    { href: "/faq", label: "Saved replies", icon: BookOpen },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
  ];

  return (
    <AppContext value={value}>
      <div className="flex h-screen">
        <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white max-md:w-16">
          <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">G</span>
            <span className="font-semibold tracking-tight text-slate-900 max-md:hidden">Guest Inbox</span>
          </div>
          <nav className="flex-1 space-y-0.5 p-2">
            {nav.map((item) => {
              const active = pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  className={cx(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                    active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1 max-md:hidden">{item.label}</span>
                  {!!item.count && (
                    <span
                      className={cx(
                        "rounded-full px-1.5 py-0.5 text-[11px] font-semibold max-md:hidden",
                        active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700",
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-slate-100 p-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={profile.full_name} size="sm" />
              <div className="min-w-0 flex-1 max-md:hidden">
                <p className="truncate text-sm font-medium text-slate-900">{profile.full_name}</p>
                <p className="text-xs text-slate-500">{ROLE_LABEL[profile.role]}</p>
              </div>
              <button
                onClick={() => supabase.auth.signOut()}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </AppContext>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="rounded-xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">{children}</div>
    </div>
  );
}
