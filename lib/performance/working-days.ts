/**
 * D3 — working days: the frozen per-dossier délai, and per-employee capacity.
 * ---------------------------------------------------------------------------
 * Two calculations live here, and the boundary between them IS the ruling:
 *
 * 1. `delaiJoursOuvres` — the per-dossier délai, contract ICTD-D11, frozen:
 *    `MAX(0, NETWORKDAYS.INTL(complet, BAE, 1, FERIES) − 1)`, weekend Sat–Sun,
 *    same-day = 0. FERIES is the HR-maintained calendar (`hr_calendar_day`):
 *    Senegal public holidays and Effitrans exceptional closures. Employee
 *    LEAVE is not a parameter of this function and must never become one —
 *    RATIFIED 2026-08-28: leave affects only per-employee capacity.
 *
 * 2. `workedDaysInPeriod` — per-employee capacity (jours actifs): working days
 *    in the period minus the employee's approved leave, a half-day counting
 *    0,5. This is the D3 ruling proper: « jours réellement travaillés »,
 *    excluding public holidays, company closures and leave.
 *
 * Everything here is pure. Callers load the calendar and the approved leave;
 * nothing in this module reads a database, so parity is provable from
 * fixtures alone (F-SLA-06 for the délai; the D3 cases for capacity).
 */

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`[working-days] invalid date: ${iso}`);
  return t;
}

function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Weekend code 1 — Saturday/Sunday, as ICTD-D11 fixes it. */
export function isWeekend(iso: string): boolean {
  const dow = new Date(toUtc(iso)).getUTCDay();
  return dow === 0 || dow === 6;
}

/**
 * NETWORKDAYS.INTL(start, end, 1, calendar) — the count of non-weekend,
 * non-calendar days in the INCLUSIVE span. Excel returns a negative count for
 * a reversed span; no caller here wants that, so a reversed span throws.
 */
export function networkDays(startISO: string, endISO: string, calendar: ReadonlySet<string>): number {
  const start = toUtc(startISO);
  const end = toUtc(endISO);
  if (end < start) throw new Error("[working-days] end before start");
  let count = 0;
  for (let t = start; t <= end; t += DAY_MS) {
    const iso = isoOf(t);
    if (!isWeekend(iso) && !calendar.has(iso)) count += 1;
  }
  return count;
}

/**
 * ICTD-D11, verbatim. Null (blank) when either date is missing — an
 * uncomputable délai is visible as uncomputable, never as 0.
 */
export function delaiJoursOuvres(
  completeISO: string | null,
  baeISO: string | null,
  calendar: ReadonlySet<string>,
): number | null {
  if (!completeISO || !baeISO) return null;
  return Math.max(0, networkDays(completeISO, baeISO, calendar) - 1);
}

export type ApprovedLeave = {
  startISO: string;
  endISO: string;
  /**
   * Total tenths of a day, as `hr_leave_request.day_tenths` records it. Only a
   * single-day request may be partial: a request whose span is one day and
   * whose tenths are below 10 deducts tenths/10 (RATIFIED: a half-day counts
   * 0,5). A multi-day request deducts 1 for each working day it covers — its
   * tenths follow the calendar-day span and do not redistribute.
   */
  dayTenths: number;
};

/**
 * D3 — jours actifs: working days in the period, minus approved leave.
 *
 * Base = networkDays(period, calendar): weekends out, public holidays out,
 * company closures out. Each approved leave then removes the working days it
 * covers inside the period — a day that is already a weekend or a holiday is
 * not removed twice. Result is in days, with one decimal possible (0,5).
 */
export function workedDaysInPeriod(
  periodStartISO: string,
  periodEndISO: string,
  calendar: ReadonlySet<string>,
  leaves: readonly ApprovedLeave[],
): number {
  const base = networkDays(periodStartISO, periodEndISO, calendar);
  const periodStart = toUtc(periodStartISO);
  const periodEnd = toUtc(periodEndISO);

  let deducted = 0;
  for (const leave of leaves) {
    const start = Math.max(toUtc(leave.startISO), periodStart);
    const end = Math.min(toUtc(leave.endISO), periodEnd);
    if (end < start) continue; // no overlap with the period

    const singleDay = leave.startISO === leave.endISO;
    const fraction = singleDay && leave.dayTenths < 10 ? leave.dayTenths / 10 : 1;
    for (let t = start; t <= end; t += DAY_MS) {
      const iso = isoOf(t);
      if (!isWeekend(iso) && !calendar.has(iso)) deducted += fraction;
    }
  }
  // Leave can never take capacity below zero.
  return Math.max(0, Math.round((base - deducted) * 10) / 10);
}
