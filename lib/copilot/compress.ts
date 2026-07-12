/**
 * Copilot context compression (Phase AI-2a) — PURE, deterministic. No I/O.
 * ---------------------------------------------------------------------------
 * A large dossier (long event history, many documents) must not overflow the
 * model window. These helpers cap long lists DETERMINISTICALLY while GUARANTEEING
 * that operationally critical facts are never summarized away:
 *   - active blockers, missing documents, current department, active transport
 *     and delivery status are structured fields (never in the capped lists);
 *   - within the capped lists, "critical" items (incidents, delays, delivery/POD
 *     events, and non-approved documents) are ALWAYS kept — only routine,
 *     already-superseded entries are dropped, oldest first.
 * The caller is told how many entries were omitted so the brief stays honest.
 * Unit-tested.
 */

/** Caps (entries kept in the serialized brief). Tuned for a compact prompt. */
export const COMPRESS_LIMITS = {
  timeline: 12,
  events: 12,
  documents: 20,
} as const;

export type CapResult<T> = { items: T[]; omitted: number };

/**
 * Keep at most `max` items, but NEVER drop a `critical` one. Fills the remaining
 * budget with the earliest of the non-critical items (the caller pre-orders the
 * array — e.g. most-recent-first — so "earliest" = highest priority to keep).
 * Original order is preserved in the result.
 */
export function capItems<T>(items: T[], max: number, isCritical: (t: T) => boolean): CapResult<T> {
  if (items.length <= max) return { items: items.slice(), omitted: 0 };
  const critical = items.filter(isCritical);
  const rest = items.filter((t) => !isCritical(t));
  const budget = Math.max(0, max - critical.length);
  const keep = new Set<T>([...critical, ...rest.slice(0, budget)]);
  const ordered = items.filter((t) => keep.has(t));
  return { items: ordered, omitted: items.length - ordered.length };
}

/** Tracking-event types that must survive compression (operationally material). */
export const CRITICAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "INCIDENT_REPORTED",
  "DELAY_REPORTED",
  "DELIVERED",
  "DELIVERY_ATTEMPTED",
  "POD_RECEIVED",
  "CUSTOMS_STOP",
  "BORDER_REACHED",
]);

export function isCriticalEventType(type: string): boolean {
  return CRITICAL_EVENT_TYPES.has(type);
}

/** Document statuses that must survive compression (still need action / attention). */
const NON_SETTLED_DOC_STATUSES: ReadonlySet<string> = new Set([
  "UPLOADED",
  "PENDING_REVIEW",
  "REJECTED",
  "EXPIRED",
]);

export function isUnsettledDocStatus(status: string): boolean {
  return NON_SETTLED_DOC_STATUSES.has(status);
}
