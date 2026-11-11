import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { secretMatches } from "@/lib/secrets";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Gmail through Google's API, authorised by the mailbox owner.
 *
 * An admin presses "Connect Gmail" in Settings, signs in with Google and
 * approves read + send. Google returns a refresh token, which is stored
 * encrypted in channel_connections.metadata (never sent to the browser in
 * plain form) and exchanged for short-lived access tokens when needed.
 *
 * Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET (a Google Cloud "Web
 * application" OAuth client whose redirect URI is <app>/api/gmail/callback),
 * and SYNC_SECRET, which also keys the encryption.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message);
  }
}

export function gmailConfigured(): boolean {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.SYNC_SECRET);
}

export function redirectUri(origin: string): string {
  const base = (process.env.APP_URL || origin).replace(/\/$/, "");
  return `${base}/api/gmail/callback`;
}

// ─── signed state for the OAuth round trip ─────────────────────────────────

const sign = (data: string) =>
  createHmac("sha256", `gmail-state:${process.env.SYNC_SECRET}`).update(data).digest("base64url");

export function makeState(staffId: string): string {
  const data = Buffer.from(JSON.stringify({ s: staffId, e: Date.now() + 10 * 60_000, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${data}.${sign(data)}`;
}

/** The staff id that started the connection, or null if the state is forged or stale. */
export function readState(state: string | null): string | null {
  const [data, mac] = (state ?? "").split(".");
  if (!data || !secretMatches(mac, sign(data))) return null;
  try {
    const { s, e } = JSON.parse(Buffer.from(data, "base64url").toString());
    return typeof s === "string" && e > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function authUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

// ─── tokens ────────────────────────────────────────────────────────────────

const key = () => createHash("sha256").update(`gmail-token:${process.env.SYNC_SECRET}`).digest();

export function encrypt(text: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function decrypt(packed: string): string {
  const [iv, tag, body] = packed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      ...params,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GmailError(
      body.error === "invalid_grant"
        ? "Google no longer accepts this connection. Connect Gmail again in Settings."
        : `Google sign-in failed: ${body.error_description || body.error || res.status}`,
      res.status,
    );
  }
  return body as { access_token: string; expires_in: number; refresh_token?: string };
}

export async function exchangeCode(code: string, origin: string) {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
}

export type GmailConnection = { id: string; organizationId: string; email: string; refreshToken: string };

/** The active Gmail connection, if one has been set up. */
export async function gmailConnection(): Promise<GmailConnection | null> {
  const { data } = await supabaseAdmin()
    .from("channel_connections")
    .select("id, organization_id, mailbox_email, metadata, active")
    .eq("channel", "gmail")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  const packed = (data?.metadata as { refresh_token?: string } | null)?.refresh_token;
  if (!data || !packed || !data.mailbox_email) return null;
  try {
    return { id: data.id, organizationId: data.organization_id, email: data.mailbox_email, refreshToken: decrypt(packed) };
  } catch {
    return null; // SYNC_SECRET changed: the stored token can't be read, so Gmail must be connected again
  }
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(conn: GmailConnection): Promise<string> {
  const hit = accessCache.get(conn.id);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const t = await tokenRequest({ refresh_token: conn.refreshToken, grant_type: "refresh_token" });
  accessCache.set(conn.id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
  return t.access_token;
}

/** Call the Gmail API for this mailbox. */
export async function gmail<T>(
  conn: GmailConnection | { accessToken: string },
  path: string,
  init: { method?: string; query?: Record<string, string | number | string[] | undefined>; body?: unknown } = {},
): Promise<T> {
  const token = "accessToken" in conn ? conn.accessToken : await accessToken(conn);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) q.append(k, String(one));
  }
  const res = await fetch(`${API}${path}${q.size ? `?${q}` : ""}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new GmailError(`Gmail ${res.status}: ${body?.error?.message ?? "request failed"}`, res.status);
  return body as T;
}
