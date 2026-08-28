/**
 * D3 — the working-day calendar's vocabulary and row shape.
 *
 * A PLAIN module, deliberately. `calendar-actions.ts` carries "use server", and
 * such a file may export ONLY async functions — a constant array like
 * `CALENDAR_DAY_KINDS` is an object export and fails the build at page-data
 * collection, not at typecheck, which is why it survives `tsc` and dies in CI.
 * Values and types live here; the actions file exports actions and nothing else.
 */
export const CALENDAR_DAY_KINDS = ["PUBLIC_HOLIDAY", "COMPANY_CLOSURE"] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

export type CalendarActionResult = { ok: true; id: string } | { ok: false; error: string };

export type CalendarDayRow = {
  id: string;
  day: string;
  kind: CalendarDayKind;
  label: string;
};
