/**
 * Unified Alert Center — composition engine (Phase 10.0E-1). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * Code-aware dedupe (DEC-B52), the EXISTING executive ordering (severity →
 * oldest → domain, DEC-B50/§6) and counts. It REUSES the shared engine's
 * canonical level list (`ALERT_LEVELS`) and its `countAlertsByLevel` — it does
 * NOT define a second severity table, a second normalizer, or a second ordering
 * doctrine. Alerts arrive already normalized (their `level` was set by
 * `normalizeSeverity` in the adapter); compose never re-scores.
 */
import { countAlertsByLevel } from "@/lib/executive/compose";
import { ALERT_LEVELS } from "@/lib/executive/types";
import type { AlertDomain, AlertSource, OperationalAlert, OperationalAlertSet } from "./types";
import { ALERT_DOMAINS } from "./types";

/** Canonical severity rank — derived from the shared engine's level list (NOT a new table). */
const levelRank = (a: OperationalAlert): number => ALERT_LEVELS.indexOf(a.level);
/** Fixed domain tie-break order (operations first … system last) — §13. */
const domainRank = (d: AlertDomain): number => ALERT_DOMAINS.indexOf(d);

/** Ascending time compare (oldest first); a null timestamp sorts AFTER any dated peer. */
function olderFirst(a: string | null, b: string | null): number {
  if (a && b) return a < b ? -1 : a > b ? 1 : 0;
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/**
 * DEC-B52 dedupe key: `code|entityType|entityId` once a code exists (count-style
 * alerts with a code but no entity dedupe by code alone); the legacy
 * `origin|reference|reason` key otherwise (incremental rollout — never
 * French-text-only once a code exists).
 */
export function alertDedupeKey(a: OperationalAlert): string {
  if (a.code) return `${a.code}|${a.entityType ?? ""}|${a.entityId ?? ""}`;
  return `${a.origin}|${a.reference ?? ""}|${a.reason}`;
}

/**
 * Collapse a same-key group into ONE survivor: highest severity wins the item;
 * its `occurredAt` is replaced by the EARLIEST in the group (the engine's
 * oldest-first urgency doctrine). Descriptions are never merged.
 */
function pickSurvivor(group: OperationalAlert[]): OperationalAlert {
  const base = [...group].sort((a, b) => levelRank(a) - levelRank(b) || olderFirst(a.occurredAt, b.occurredAt))[0];
  const earliest = group
    .map((g) => g.occurredAt)
    .filter((t): t is string => t != null)
    .sort()[0];
  return earliest ? { ...base, occurredAt: earliest } : base;
}

/** Dedupe by the code-aware key, preserving first-seen key order. */
export function dedupeAlerts(alerts: OperationalAlert[]): OperationalAlert[] {
  const groups = new Map<string, OperationalAlert[]>();
  for (const a of alerts) {
    const key = alertDedupeKey(a);
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
  }
  return [...groups.values()].map(pickSurvivor);
}

/** The EXISTING executive ordering + a deterministic domain tie-break. Never a score. */
export function orderAlerts(alerts: OperationalAlert[]): OperationalAlert[] {
  return [...alerts].sort(
    (a, b) =>
      levelRank(a) - levelRank(b) ||
      olderFirst(a.occurredAt, b.occurredAt) ||
      domainRank(a.domain) - domainRank(b.domain),
  );
}

/**
 * Assemble the composed set: dedupe → order → cap → counts (via the shared
 * `countAlertsByLevel`). `generatedAt` is injected so this stays pure/testable.
 * `sources` are computed by the reader (availability is a SET property, DEC-B58).
 */
export function composeAlertSet(
  alerts: OperationalAlert[],
  sources: AlertSource[],
  generatedAt: string,
  cap = 40,
): OperationalAlertSet {
  const merged = orderAlerts(dedupeAlerts(alerts)).slice(0, cap);
  return {
    generatedAt,
    alerts: merged,
    counts: countAlertsByLevel(merged),
    sources,
  };
}

/** The truthful empty contract — no alerts, all-zero counts, no sources consulted. */
export function emptyAlertSet(generatedAt: string): OperationalAlertSet {
  return { generatedAt, alerts: [], counts: countAlertsByLevel([]), sources: [] };
}
