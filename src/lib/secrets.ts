import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Constant-time comparison for shared secrets in headers and URLs. */
export function secretMatches(given: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
