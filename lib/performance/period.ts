/**
 * Reporting periods, and the business date they are anchored to.
 * ---------------------------------------------------------------------------
 * TIME AUTHORITY. `dakarToday()` exists so the timezone contract is WRITTEN
 * DOWN rather than true by coincidence. Senegal observes UTC+0 year-round with
 * no daylight saving, so a UTC date and a Dakar date are the same date — but
 * "the code happens to be right because Dakar is UTC" is not a contract, it is
 * a fact nobody recorded, and the next timezone question would have to
 * rediscover it. Every caller that needs "today" for a period default goes
 * through here.
 *
 * This is for PERIOD SELECTION only. It is never the source of a business
 * timestamp: those come from the database (`now()`), never from any clock in
 * an application process, and never from a browser.
 */

/** The IANA zone Effitrans operates in. Recorded, not merely assumed. */
export const BUSINESS_TIME_ZONE = "Africa/Dakar";

/**
 * Today's business date, ISO. Runs on the server; UTC+0 makes the arithmetic
 * trivial, and the constant above says why that is legitimate rather than lucky.
 */
export function dakarToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type PeriodKind = "MONTH" | "QUARTER" | "YEAR" | "CUSTOM";

export type PerformancePeriod = {
  kind: PeriodKind;
  /** Inclusive ISO bounds. */
  startISO: string;
  endISO: string;
  label: string;
};

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
] as const;

const lastDayOf = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** The month containing `anchorISO`. */
export function monthPeriod(anchorISO: string): PerformancePeriod {
  const [y, m] = anchorISO.split("-").map(Number);
  return {
    kind: "MONTH",
    startISO: `${y}-${pad(m)}-01`,
    endISO: `${y}-${pad(m)}-${pad(lastDayOf(y, m))}`,
    label: `${MONTHS_FR[m - 1]} ${y}`,
  };
}

/** The calendar quarter containing `anchorISO`. */
export function quarterPeriod(anchorISO: string): PerformancePeriod {
  const [y, m] = anchorISO.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const first = (q - 1) * 3 + 1;
  const last = first + 2;
  return {
    kind: "QUARTER",
    startISO: `${y}-${pad(first)}-01`,
    endISO: `${y}-${pad(last)}-${pad(lastDayOf(y, last))}`,
    label: `T${q} ${y}`,
  };
}

/** The calendar year containing `anchorISO`. */
export function yearPeriod(anchorISO: string): PerformancePeriod {
  const y = Number(anchorISO.slice(0, 4));
  return { kind: "YEAR", startISO: `${y}-01-01`, endISO: `${y}-12-31`, label: String(y) };
}

/**
 * An arbitrary inclusive span. Reversed bounds throw rather than silently
 * yielding an empty period — an empty result and a nonsense request are
 * different answers and must not look alike.
 */
export function customPeriod(startISO: string, endISO: string): PerformancePeriod {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) {
    throw new Error("[period] invalid ISO date");
  }
  if (endISO < startISO) throw new Error("[period] end before start");
  return {
    kind: "CUSTOM",
    startISO,
    endISO,
    label: `${startISO} → ${endISO}`,
  };
}

/**
 * Resolve a period from URL parameters, defaulting to the current month.
 * Anything unparseable falls back to the month rather than throwing at a page
 * boundary: a mistyped query string should not 500 a management dashboard.
 */
export function resolvePeriod(params: {
  type?: string;
  anchor?: string;
  from?: string;
  to?: string;
}): PerformancePeriod {
  const anchor = params.anchor && /^\d{4}-\d{2}-\d{2}$/.test(params.anchor)
    ? params.anchor
    : dakarToday();
  switch ((params.type ?? "MONTH").toUpperCase()) {
    case "QUARTER":
      return quarterPeriod(anchor);
    case "YEAR":
      return yearPeriod(anchor);
    case "CUSTOM":
      if (params.from && params.to) {
        try {
          return customPeriod(params.from, params.to);
        } catch {
          return monthPeriod(anchor);
        }
      }
      return monthPeriod(anchor);
    default:
      return monthPeriod(anchor);
  }
}
