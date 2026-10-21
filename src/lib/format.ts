export const CHANNEL_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking_com: "Booking.com",
  beds24: "Direct",
  whatsapp: "WhatsApp",
  gmail: "Email",
};

/** Channel identity: a brand-ish tint plus the name, never colour alone. */
export const CHANNEL_STYLE: Record<string, { chip: string; dot: string; letter: string }> = {
  airbnb: { chip: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500", letter: "A" },
  booking_com: { chip: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-600", letter: "B" },
  beds24: { chip: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-500", letter: "D" },
  whatsapp: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", letter: "W" },
  gmail: { chip: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", letter: "E" },
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Today", "Yesterday", or a full date -- for separators in a thread. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** True when the guest spoke last and nobody has answered yet. */
export function awaitingReply(c: { last_inbound_at: string | null; last_outbound_at: string | null }): boolean {
  if (!c.last_inbound_at) return false;
  return !c.last_outbound_at || c.last_inbound_at > c.last_outbound_at;
}

export type Stay = { label: string; tone: "upcoming" | "soon" | "inhouse" | "past" | "cancelled" };

/** Where the guest is in their stay, from the reservation dates. */
export function stayStatus(r: {
  check_in: string | null;
  check_out: string | null;
  status?: string | null;
} | null): Stay | null {
  if (!r || !r.check_in || !r.check_out) return null;
  if (r.status === "cancelled") return { label: "Cancelled", tone: "cancelled" };
  const day = (iso: string) => iso.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const inDay = day(r.check_in);
  const outDay = day(r.check_out);
  if (today < inDay) {
    const days = Math.round((Date.parse(inDay) - Date.parse(today)) / 86400000);
    if (days === 1) return { label: "Arrives tomorrow", tone: "soon" };
    if (days <= 7) return { label: `Arrives in ${days} days`, tone: "soon" };
    return { label: "Upcoming", tone: "upcoming" };
  }
  if (today === inDay) return { label: "Arrives today", tone: "soon" };
  if (today < outDay) return { label: "In house", tone: "inhouse" };
  if (today === outDay) return { label: "Checks out today", tone: "inhouse" };
  return { label: "Checked out", tone: "past" };
}

export const STAY_STYLE: Record<Stay["tone"], string> = {
  upcoming: "bg-sky-50 text-sky-700 ring-sky-200",
  soon: "bg-violet-50 text-violet-700 ring-violet-200",
  inhouse: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  past: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

export const BOOKING_STATUS: Record<string, string> = {
  new: "Confirmed (new)",
  confirmed: "Confirmed",
  request: "Request",
  inquiry: "Enquiry",
  cancelled: "Cancelled",
  black: "Blocked",
};

/** A stored phone number made readable; adds the + the channels drop. */
export function prettyPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 7) return raw;
  return `+${digits}`;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const AVATAR_TINTS = [
  "bg-indigo-100 text-indigo-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-sky-100 text-sky-700",
  "bg-lime-100 text-lime-800",
  "bg-fuchsia-100 text-fuchsia-700",
];

/** A stable tint per person, so the same guest always looks the same. */
export function avatarTint(seed: string | null | undefined): string {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function minutesLabel(minutes: number | null): string {
  if (minutes === null || !isFinite(minutes)) return "–";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

/** What the AI triage agent says a thread is about. */
export const CATEGORY_LABEL: Record<string, string> = {
  check_in: "Check-in",
  check_out: "Check-out",
  access: "Access",
  wifi: "Wi-Fi",
  parking: "Parking",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  amenities: "Amenities",
  booking_change: "Booking change",
  cancellation: "Cancellation",
  refund: "Refund",
  payment: "Payment",
  complaint: "Complaint",
  noise: "Noise",
  damage: "Damage",
  lost_item: "Lost item",
  local_info: "Local info",
  emergency: "Emergency",
  thanks: "Thanks",
  other: "Other",
};

/** Only the priorities worth a glance get a chip. */
export const PRIORITY_CHIP: Record<string, { label: string; className: string } | undefined> = {
  urgent: { label: "Urgent", className: "bg-red-600 text-white ring-red-600" },
  high: { label: "High", className: "bg-orange-50 text-orange-700 ring-orange-200" },
};

export type MessageImage = { src: string; href: string };

const safeUrl = (u: string | undefined) => (u && /^https:\/\//i.test(u) ? u.replace(/&amp;/g, "&") : null);

/**
 * Airbnb photos arrive from Beds24 as HTML: <a href="full"><img src="thumb"></a>.
 * Split a message into plain text plus its images; never render the HTML itself.
 */
export function parseMessage(body: string | null | undefined): { text: string; images: MessageImage[] } {
  const images: MessageImage[] = [];
  let rest = (body ?? "").replace(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const src = safeUrl(inner.match(/<img\b[^>]*?src="([^"]*)"/i)?.[1]) ?? safeUrl(href);
    const link = safeUrl(href) ?? src;
    if (src && link) {
      images.push({ src, href: link });
      return "";
    }
    return inner;
  });
  rest = rest.replace(/<img\b[^>]*?src="([^"]*)"[^>]*>/gi, (_m, src: string) => {
    const s = safeUrl(src);
    if (s) images.push({ src: s, href: s });
    return "";
  });
  const text = rest
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return { text, images };
}

/** One line for list previews and the AI: text, or "Photo". */
export function messagePreview(body: string | null | undefined): string {
  const { text, images } = parseMessage(body);
  if (text) return images.length ? `📷 ${text}` : text;
  return images.length ? (images.length > 1 ? `📷 ${images.length} photos` : "📷 Photo") : "";
}
