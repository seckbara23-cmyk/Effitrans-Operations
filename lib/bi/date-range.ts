/**
 * Report date-range filtering (Phase 3.0 / 3.0B) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * The single predicate the BI service uses to keep invoices / payments / files
 * whose ISO date falls within the reporting-center [from, to] window. Extracted
 * so date filtering is unit-testable without the server BI service. Bounds are
 * inclusive; a null/absent bound means "unbounded on that side". A null date is
 * treated as OUT of any bounded range.
 */
export type DateRange = { from?: string | null; to?: string | null };

export function inDateRange(iso: string | null, r: DateRange): boolean {
  if (!iso) return false;
  if (r.from && iso < r.from) return false;
  if (r.to && iso > r.to) return false;
  return true;
}
