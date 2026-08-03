/**
 * EC-3D — commercial dashboard metrics. PURE.
 * ---------------------------------------------------------------------------
 * No I/O: takes the quotations the workspace already loaded and computes the
 * six cards. Pure so "accepted today" can be tested at a timezone boundary
 * without a database, which is where this kind of metric actually breaks.
 *
 * DAY BOUNDARIES ARE TENANT-LOCAL, not UTC. `tenantToday` is reused from
 * lib/operations/kpi/windows — THE one tenant-day source — rather than reimplemented — a metric that says "today" while
 * meaning "UTC today" is wrong for eight hours a day in Dakar, and Phase 10.0D
 * already had to fix exactly that class of defect.
 *
 * NO MONEY appears here. Amounts live on lines, in integer minor units, and a
 * per-currency total is a different question from a count of decisions; mixing
 * them is how a currency-blind KPI gets shipped.
 */
import { tenantToday } from "@/lib/operations/kpi/windows";
import type { QuotationStatus } from "./model";

export type MetricQuotation = {
  status: QuotationStatus;
  sentAt: string | null;
  acceptedOn: string | null;
  declinedOn: string | null;
  convertedAt: string | null;
  convertedFileId: string | null;
};

export type CommercialMetrics = {
  awaitingCustomer: number;
  acceptedToday: number;
  declinedToday: number;
  /** Mean days from SENT to the customer's decision. Null when nothing decided. */
  averageResponseDays: number | null;
  /** ACCEPTED and not yet converted — the conversion queue's depth. */
  pendingConversion: number;
  convertedThisMonth: number;
};

/** `YYYY-MM` of a tenant-local day string. */
function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** Whole days between two ISO dates, floor at 0. Dates, not timestamps. */
function daysBetween(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso.slice(0, 10));
  const b = Date.parse(toIso.slice(0, 10));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function commercialMetrics(
  quotations: readonly MetricQuotation[],
  timeZone: string,
  now: Date = new Date(),
): CommercialMetrics {
  const today = tenantToday(timeZone, now);
  const month = monthOf(today);

  let awaitingCustomer = 0, acceptedToday = 0, declinedToday = 0;
  let pendingConversion = 0, convertedThisMonth = 0;
  const responses: number[] = [];

  for (const q of quotations) {
    if (q.status === "SENT") awaitingCustomer += 1;

    // ACCEPTED is a state a quotation LEAVES on conversion, so "pending
    // conversion" is the accepted-and-unconverted set, not "everything ever
    // accepted" — which would keep counting rows already handed to Operations.
    if (q.status === "ACCEPTED" && !q.convertedFileId) pendingConversion += 1;

    if (q.acceptedOn?.slice(0, 10) === today) acceptedToday += 1;
    if (q.declinedOn?.slice(0, 10) === today) declinedToday += 1;

    if (q.convertedAt && monthOf(q.convertedAt.slice(0, 10)) === month) convertedThisMonth += 1;

    // Response time is measured only where BOTH ends are known. A quotation
    // sent but undecided has no response time yet — counting it as 0 would
    // silently drag the average toward zero as the backlog grows.
    const decidedOn = q.acceptedOn ?? q.declinedOn;
    if (q.sentAt && decidedOn) {
      const d = daysBetween(q.sentAt, decidedOn);
      if (d !== null) responses.push(d);
    }
  }

  const averageResponseDays = responses.length
    ? Math.round((responses.reduce((s, d) => s + d, 0) / responses.length) * 10) / 10
    : null;

  return {
    awaitingCustomer, acceptedToday, declinedToday,
    averageResponseDays, pendingConversion, convertedThisMonth,
  };
}
