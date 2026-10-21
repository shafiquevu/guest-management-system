export const CHANNEL_LABEL: Record<string, string> = {
  airbnb: "Airbnb",
  booking_com: "Booking.com",
  beds24: "Beds24",
  whatsapp: "WhatsApp",
  gmail: "Email",
};

export const CHANNEL_STYLE: Record<string, string> = {
  airbnb: "bg-rose-100 text-rose-700",
  booking_com: "bg-blue-100 text-blue-700",
  beds24: "bg-slate-200 text-slate-700",
  whatsapp: "bg-green-100 text-green-700",
  gmail: "bg-amber-100 text-amber-800",
};

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
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
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** True when the guest spoke last and nobody has answered yet. */
export function awaitingReply(c: { last_inbound_at: string | null; last_outbound_at: string | null }): boolean {
  if (!c.last_inbound_at) return false;
  return !c.last_outbound_at || c.last_inbound_at > c.last_outbound_at;
}
