/**
 * Pure translation from Beds24's shapes to ours. No I/O, so it is the part
 * that gets unit tests: a wrong mapping here is a reply sent to the wrong
 * thread or a guest message filed as ours.
 */

import type { Beds24Booking, Beds24Message } from "./client";

export type Channel = "beds24" | "airbnb" | "booking_com" | "whatsapp" | "gmail";

/** Which inbox channel a Beds24 booking belongs to. */
export function channelForBooking(bookingChannel: string | undefined): Channel {
  switch ((bookingChannel ?? "").toLowerCase()) {
    case "airbnb":
      return "airbnb";
    case "booking":
      return "booking_com";
    default:
      return "beds24";
  }
}

/** Guest and OTA messages come in; host messages go out; internal notes are not part of the thread. */
export function directionFor(source: Beds24Message["source"]): "inbound" | "outbound" | null {
  if (source === "guest" || source === "system") return "inbound";
  if (source === "host") return "outbound";
  return null;
}

export const threadId = (bookingId: number | string) => `beds24:${bookingId}`;
export const messageId = (beds24Id: number | string) => `beds24:${beds24Id}`;

/** Whitespace-insensitive comparison, used to match a reply we sent to the copy Beds24 returns. */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  return norm(a) !== "" && norm(a) === norm(b);
}

export function guestName(b: Pick<Beds24Booking, "firstName" | "lastName">): string {
  return [b.firstName, b.lastName].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "Guest";
}

/** Digits only, with a leading + kept, so the same phone matches across channels. */
export function normalisePhone(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7) return null;
  return (s.startsWith("+") ? "+" : "") + digits;
}

export function normaliseEmail(raw: string | undefined | null): string | null {
  const s = (raw ?? "").trim().toLowerCase();
  return s.includes("@") ? s : null;
}

/** The booking without payment tokens or anything else that must not sit in a jsonb column. */
export function safeBooking(b: Beds24Booking): Record<string, unknown> {
  const drop = new Set(["stripeToken", "pcibookingToken", "invoiceItems", "infoItems"]);
  return Object.fromEntries(Object.entries(b).filter(([k]) => !drop.has(k)));
}

export function nightsGuests(b: Pick<Beds24Booking, "numAdult" | "numChild">): number | null {
  const n = (b.numAdult ?? 0) + (b.numChild ?? 0);
  return n > 0 ? n : null;
}
