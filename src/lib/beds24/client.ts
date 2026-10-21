import "server-only";

/**
 * Beds24 API V2.
 *
 * Auth: a refresh token (from an invite code, kept alive by being used at least
 * once every 30 days) is exchanged for a short-lived access token, sent as the
 * `token` header. A long-life token works too, if Beds24 issued one.
 *
 * Every response carries a five-minute credit budget. The client reads it so a
 * sync can stop early instead of being locked out mid-run.
 */

const BASE = "https://beds24.com/api/v2";

export class Beds24Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export class Beds24NotConfigured extends Error {}

type Query = Record<string, string | number | boolean | (string | number)[] | undefined>;

let cached: { token: string; expiresAt: number } | null = null;

export function isConfigured(): boolean {
  return Boolean(process.env.BEDS24_LONG_LIFE_TOKEN || process.env.BEDS24_REFRESH_TOKEN);
}

async function accessToken(): Promise<string> {
  const longLife = process.env.BEDS24_LONG_LIFE_TOKEN;
  if (longLife) return longLife;

  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = process.env.BEDS24_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Beds24NotConfigured(
      "Beds24 is not connected: set BEDS24_REFRESH_TOKEN (or BEDS24_LONG_LIFE_TOKEN).",
    );
  }

  const res = await fetch(`${BASE}/authentication/token`, {
    headers: { refreshToken },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    throw new Beds24Error(
      `Beds24 refused the refresh token (${res.status}). Generate a new invite code.`,
      res.status,
      body,
    );
  }
  cached = {
    token: body.token,
    expiresAt: Date.now() + Number(body.expiresIn ?? 3600) * 1000,
  };
  return cached.token;
}

function buildUrl(path: string, query?: Query): string {
  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export type Credit = { remaining: number | null; resetsIn: number | null };

export async function beds24<T = unknown>(
  method: "GET" | "POST",
  path: string,
  options: { query?: Query; body?: unknown } = {},
): Promise<{ data: T; credit: Credit }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(buildUrl(path, options.query), {
      method,
      headers: {
        token: await accessToken(),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });

    // An access token can be revoked early; get a fresh one once.
    if (res.status === 401 && attempt === 0 && !process.env.BEDS24_LONG_LIFE_TOKEN) {
      cached = null;
      continue;
    }

    const body = await res.json().catch(() => null);
    const credit: Credit = {
      remaining: numberHeader(res, "X-FiveMinCreditLimit-Remaining"),
      resetsIn: numberHeader(res, "X-FiveMinCreditLimit-ResetsIn"),
    };

    if (!res.ok || (body && typeof body === "object" && "success" in body && body.success === false)) {
      const reason =
        (body && typeof body === "object" && "error" in body && String(body.error)) ||
        `HTTP ${res.status}`;
      throw new Beds24Error(`Beds24 ${method} ${path}: ${reason}`, res.status, body);
    }
    return { data: body as T, credit };
  }
  throw new Beds24Error("Beds24 authentication failed twice", 401);
}

function numberHeader(res: Response, name: string): number | null {
  const v = res.headers.get(name);
  return v === null ? null : Number(v);
}

/** Every page of a list endpoint. Stops early if the credit budget runs low. */
export async function beds24All<T>(path: string, query: Query = {}, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, credit } = await beds24<{ data?: T[]; pages?: { nextPageExists?: boolean } }>(
      "GET",
      path,
      { query: { ...query, page } },
    );
    out.push(...(data.data ?? []));
    if (!data.pages?.nextPageExists) break;
    if (credit.remaining !== null && credit.remaining < 50) {
      throw new Beds24Error(
        `Beds24 credit budget nearly used up; resets in ${credit.resetsIn ?? "?"}s`,
        429,
      );
    }
  }
  return out;
}

// ─── Shapes we read (only the fields we use) ────────────────────────────────

export type Beds24Message = {
  id: number;
  bookingId: number;
  propertyId?: number;
  roomId?: number;
  time?: string;
  read?: boolean | null;
  message?: string;
  source?: "host" | "guest" | "internalNote" | "system";
  attachmentName?: string | null;
  attachmentMimeType?: string | null;
};

export type Beds24Booking = {
  id: number;
  propertyId?: number;
  roomId?: number;
  unitId?: number;
  channel?: string;
  status?: string;
  arrival?: string;
  departure?: string;
  numAdult?: number;
  numChild?: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  country?: string;
  country2?: string;
  reference?: string;
  apiReference?: string;
  [key: string]: unknown;
};

export type Beds24Property = {
  id: number;
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postcode?: string;
  propertyType?: string;
  checkInStart?: string;
  checkOutEnd?: string;
};
