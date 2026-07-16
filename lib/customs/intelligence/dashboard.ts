/**
 * Customs Intelligence — dashboard aggregate CONTRACTS (Phase 7.1A). PURE.
 * ---------------------------------------------------------------------------
 * Reusable aggregates over Declaration[] + the timeline. Contracts only — no dashboard UI
 * is built (that is a later phase). Deterministic; `now`/dates injected for testability.
 * Nothing here fabricates a metric — each is computed from real declaration facts.
 */
import { isCleared, isTerminal, type DeclarationStatus } from "./state-machine";
import type { Declaration } from "./domain";
import type { TimelineEvent } from "./timeline";

/** Declarations still in flight — not cleared and not terminal. */
export function pendingCount(decls: Declaration[]): number {
  return decls.filter((d) => !isCleared(d.status) && !isTerminal(d.status)).length;
}

export function releasedCount(decls: Declaration[]): number {
  return decls.filter((d) => isCleared(d.status)).length;
}

/** Declarations awaiting/undergoing inspection. */
export function inspectionQueue(decls: Declaration[]): Declaration[] {
  return decls.filter((d) => d.status === "INSPECTION" || d.inspection.status === "PENDING");
}

/** Average clearance time (submit → release) in days, or null when none is measurable. */
export function averageClearanceDays(decls: Declaration[]): number | null {
  const spans: number[] = [];
  for (const d of decls) {
    const sub = d.provider.submittedAt ? new Date(d.provider.submittedAt).getTime() : null;
    const rel = d.release?.releasedAt ? new Date(d.release.releasedAt).getTime() : null;
    if (sub !== null && rel !== null && rel >= sub) spans.push((rel - sub) / 86_400_000);
  }
  if (spans.length === 0) return null;
  return Math.round((spans.reduce((s, x) => s + x, 0) / spans.length) * 10) / 10;
}

/** Total assessed duties per currency. */
export function dutyTotals(decls: Declaration[]): { currency: string; total: number }[] {
  const by = new Map<string, number>();
  for (const d of decls) for (const duty of d.duties) {
    by.set(duty.currency, Math.round(((by.get(duty.currency) ?? 0) + duty.amount) * 100) / 100);
  }
  return [...by.entries()].map(([currency, total]) => ({ currency, total })).sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

/** Timeline events grouped by calendar day (YYYY-MM-DD), ascending. */
export function dailyActivity(events: TimelineEvent[]): { date: string; count: number }[] {
  const by = new Map<string, number>();
  for (const e of events) {
    const day = e.occurredAt.slice(0, 10);
    by.set(day, (by.get(day) ?? 0) + 1);
  }
  return [...by.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Count by status (for a status-breakdown widget). */
export function statusBreakdown(decls: Declaration[]): Partial<Record<DeclarationStatus, number>> {
  const out: Partial<Record<DeclarationStatus, number>> = {};
  for (const d of decls) out[d.status] = (out[d.status] ?? 0) + 1;
  return out;
}

export type CustomsDashboard = {
  total: number;
  pending: number;
  released: number;
  inspectionQueueSize: number;
  averageClearanceDays: number | null;
  dutyTotals: { currency: string; total: number }[];
  dailyActivity: { date: string; count: number }[];
  statusBreakdown: Partial<Record<DeclarationStatus, number>>;
};

/** Compose the full dashboard contract from declarations + their timeline. */
export function buildCustomsDashboard(decls: Declaration[], events: TimelineEvent[]): CustomsDashboard {
  return {
    total: decls.length,
    pending: pendingCount(decls),
    released: releasedCount(decls),
    inspectionQueueSize: inspectionQueue(decls).length,
    averageClearanceDays: averageClearanceDays(decls),
    dutyTotals: dutyTotals(decls),
    dailyActivity: dailyActivity(events),
    statusBreakdown: statusBreakdown(decls),
  };
}
