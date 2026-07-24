/**
 * Executive KPI Engine — tenant-timezone window machinery (Phase 10.0D-1). PURE.
 * ---------------------------------------------------------------------------
 * DEC-B39: every business-day boundary resolves in the TENANT's operating
 * timezone (organization.timezone, default "Africa/Dakar") — UTC business
 * logic is forbidden. This module REUSES the platform's one proven tenant-day
 * mechanic (todayInTimezone, lib/collections/aging — the only tenant-tz-correct
 * code before this phase) rather than inventing a second one.
 *
 * All bounds are ISO DATE strings (yyyy-mm-dd), start inclusive / end
 * exclusive (DEC-B38 boundary rule). Date-string arithmetic runs through
 * Date.UTC on the DATE STRING itself, which is timezone-independent —
 * the tenant tz enters exactly once, in todayInTimezone.
 */
import { todayInTimezone } from "@/lib/collections/aging";
import type { KpiWindow } from "./types";

export const DEFAULT_TIMEZONE = "Africa/Dakar";

/** Validate an IANA timezone; fall back to the platform default on anything invalid. */
export function resolveTimezone(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** The tenant's current calendar date (yyyy-mm-dd) — THE one tenant-day source. */
export function tenantToday(timezone: string, now: Date = new Date()): string {
  return todayInTimezone(timezone, now);
}

/** Date-string + n days (pure calendar arithmetic, tz-independent). */
export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First day of the date's tenant-month. */
export function monthStart(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

/** The previous FULL tenant-month as [start, endExclusive) — the DEC-B38 comparison basis. */
export function previousMonthBounds(timezone: string, now: Date = new Date()): { start: string; end: string } {
  const thisMonthStart = monthStart(tenantToday(timezone, now));
  const [y, m] = thisMonthStart.split("-").map(Number);
  const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return { start: prevStart, end: thisMonthStart };
}

// ---------------------------------------------------------------- window constructors ----

/** Snapshot window — state at the moment of the request; no date bounds. */
export function currentWindow(timezone: string): KpiWindow {
  return { key: "current", start: null, end: null, timezone };
}

/** The tenant's today: [today 00:00, tomorrow 00:00) as date bounds. */
export function todayWindow(timezone: string, now: Date = new Date()): KpiWindow {
  const today = tenantToday(timezone, now);
  return { key: "today", start: today, end: addDays(today, 1), timezone };
}

/** Tenant month-to-date: [1st of month, tomorrow 00:00). */
export function monthToDateWindow(timezone: string, now: Date = new Date()): KpiWindow {
  const today = tenantToday(timezone, now);
  return { key: "month_to_date", start: monthStart(today), end: addDays(today, 1), timezone };
}
