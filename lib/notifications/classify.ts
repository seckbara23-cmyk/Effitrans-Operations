/**
 * Task due-date classification — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Phase 1.6. The single source of truth for "is this task overdue / due today /
 * upcoming", shared by the task row indicator and (later) reminder generation.
 * `now` is injected so it is fully unit-testable. Day boundaries are computed in
 * UTC: Effitrans operates on Dakar time (GMT+0 ≡ UTC) and the server runs in
 * UTC, so the UTC day is the operational day — and the helper stays free of host
 * timezone surprises.
 */
export type DueState = "overdue" | "today" | "upcoming" | "none";

const TERMINAL = new Set(["DONE", "CANCELLED"]);

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

export function classifyDue(
  dueAt: string | null | undefined,
  status: string,
  now: Date,
): DueState {
  if (!dueAt) return "none";
  if (TERMINAL.has(status)) return "none"; // completed/cancelled work is never "due"
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return "none";
  if (due < startOfDay(now).getTime()) return "overdue";
  if (due <= endOfDay(now).getTime()) return "today";
  return "upcoming";
}
