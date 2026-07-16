/**
 * Logistics Command Center — pure composition (Phase 7.3C). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Composes the SAFE aggregates already produced by each domain's bounded read service
 * (road / ocean / air / customs) into consolidated KPIs, per-platform derived state, a
 * merged attention queue, and sorted upcoming movements. It re-implements NO domain
 * calculation — it only combines numbers the domains already computed. `now` is injected.
 */
export type LogisticsMode = "road" | "ocean" | "air" | "customs";
export type PlatformState = "normal" | "attention" | "critical" | "no_data";
export type AttentionSeverity = "critical" | "warning" | "info";

/** Per-module safe summary handed to the composer (no raw rows, no PII beyond file/client). */
export type ModuleSummary = {
  available: boolean; // authorized AND its read succeeded
  hasData: boolean; // the module actually has operational rows (never "normal" on empty)
  critical: number; // count of critical-severity facts
  warning: number; // count of warning-severity facts
};

/**
 * Derive a platform card's overall state HONESTLY. An unavailable/empty module is
 * "no_data" — never "normal" (an empty module is not proof it is configured/healthy).
 */
export function platformState(s: ModuleSummary): PlatformState {
  if (!s.available || !s.hasData) return "no_data";
  if (s.critical > 0) return "critical";
  if (s.warning > 0) return "attention";
  return "normal";
}

export type UnifiedAlert = {
  mode: LogisticsMode;
  severity: AttentionSeverity;
  reference: string | null; // file number / safe ref
  clientName: string | null;
  reason: string; // short, safe (no raw provider error)
  link: string;
  occurredAt?: string | null; // for age ordering when available
};

const SEV_RANK: Record<AttentionSeverity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Merge per-mode attention items: dedupe (mode+reference+reason), order by severity then age
 * (oldest first within a severity), bound the result. Stable + honest — no fabricated items.
 */
export function mergeAttention(items: UnifiedAlert[], cap = 12): UnifiedAlert[] {
  const seen = new Set<string>();
  const deduped: UnifiedAlert[] = [];
  for (const a of items) {
    const key = `${a.mode}|${a.reference ?? ""}|${a.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(a);
  }
  deduped.sort((a, b) => {
    const s = SEV_RANK[a.severity] - SEV_RANK[b.severity];
    if (s !== 0) return s;
    const ta = a.occurredAt ? new Date(a.occurredAt).getTime() : Infinity;
    const tb = b.occurredAt ? new Date(b.occurredAt).getTime() : Infinity;
    return ta - tb; // older first
  });
  return deduped.slice(0, cap);
}

export function countBySeverity(items: UnifiedAlert[], severity: AttentionSeverity): number {
  return items.filter((a) => a.severity === severity).length;
}

export type UpcomingMovement = {
  mode: LogisticsMode;
  reference: string | null;
  clientName: string | null;
  route: string;
  at: string; // ISO — REAL date only
  status: string;
  link: string;
};

/** Keep only movements with a real future-or-recent date, sorted chronologically, bounded.
 *  Items with a missing/invalid date are dropped (never inferred). */
export function sortUpcoming(items: UpcomingMovement[], cap = 10): UpcomingMovement[] {
  return items
    .filter((m) => !!m.at && Number.isFinite(new Date(m.at).getTime()))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, cap);
}

export type OceanKpis = { inTransit: number; containersLoaded: number; arriving7d: number; delayed: number; stale: number; exceptions: number; awaitingCustoms: number };
export type AirKpis = { flightsToday: number; awaitingLoading: number; inFlight: number; arriving: number; delayed: number; exceptions: number };
export type RoadKpis = { readyForDispatch: number; assigned: number; inTransit: number; podRequired: number; overdue: number };
export type CustomsKpis = { pending: number; inspection: number; awaitingPayment: number; released: number; blockedRejected: number };

export type HeadlineKpis = {
  movementsInProgress: number;
  arrivingWithin7Days: number;
  overdueOps: number;
  criticalAlerts: number;
  awaitingCustoms: number;
  exceptions: number;
};

/**
 * Consolidated headline KPIs. Each is a documented SUM of per-mode counts — it counts
 * MOVEMENTS/operations across modes, not distinct files (a file in two modes is counted in
 * each). Unauthorized/unavailable modules contribute 0. See logistics-kpi-definitions.md.
 */
export function headlineKpis(input: {
  ocean?: OceanKpis | null;
  air?: AirKpis | null;
  road?: RoadKpis | null;
  customs?: CustomsKpis | null;
  criticalAlerts: number;
}): HeadlineKpis {
  const o = input.ocean, a = input.air, r = input.road, c = input.customs;
  return {
    movementsInProgress: (o?.inTransit ?? 0) + (a?.inFlight ?? 0) + (r?.inTransit ?? 0),
    arrivingWithin7Days: (o?.arriving7d ?? 0) + (a?.arriving ?? 0),
    overdueOps: (o?.delayed ?? 0) + (a?.delayed ?? 0) + (r?.overdue ?? 0),
    criticalAlerts: input.criticalAlerts,
    awaitingCustoms: (c?.pending ?? 0) + (o?.awaitingCustoms ?? 0),
    exceptions: (o?.exceptions ?? 0) + (a?.exceptions ?? 0),
  };
}
