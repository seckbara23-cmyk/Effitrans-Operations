/**
 * Client IP for audit attribution. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * `audit_log` has no ip column and this change does not add one: an IP is
 * evidence ABOUT one particular class of event, not a property of every audited
 * act, and a column would sit null on the overwhelming majority of rows. It goes
 * in the event's `after` payload, where the events that care about it carry it.
 *
 * BEST-EFFORT AND HONEST. Behind Vercel's proxy `x-forwarded-for` is set by the
 * platform, but this value is a HEADER: on a self-hosted deployment without a
 * trusted proxy it is client-supplied and therefore spoofable. It is recorded as
 * a lead for an investigation, never as proof of origin, and never as an input
 * to an authorization decision. When no header is present the audit records
 * null — an absent IP, not a fabricated one.
 */
import "server-only";
import { headers } from "next/headers";

/** First entry of x-forwarded-for (the original client), else x-real-ip, else null. */
export function parseForwardedFor(xff: string | null, xRealIp: string | null): string | null {
  const first = (xff ?? "").split(",")[0]?.trim();
  if (first) return first;
  const real = (xRealIp ?? "").trim();
  return real || null;
}

/** The requesting client's IP, or null. Never throws — audit must not fail on this. */
export function getRequestIp(): string | null {
  try {
    const h = headers();
    return parseForwardedFor(h.get("x-forwarded-for"), h.get("x-real-ip"));
  } catch {
    return null; // outside a request scope (background job, test)
  }
}
