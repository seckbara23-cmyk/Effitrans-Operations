/**
 * UT-1 — the canonical Decision Plane read contract. PURE.
 * ---------------------------------------------------------------------------
 * No I/O, no client, no session. This module defines what a timeline entry IS,
 * how two entries order, what provenance they carry, and which metadata may be
 * projected. Pure so the ordering doctrine can be tested exhaustively without a
 * database — including the case that matters most, which is the one where
 * chronology is NOT provable.
 *
 * DEC-B88 governs every rule here. The single sentence it all serves:
 * **Unified Tracking never invents chronology.**
 */
import { getEventType, type EventDomain } from "@/lib/workflow/events/types";
import { PROHIBITED_METADATA_KEYS } from "@/lib/workflow/events/metadata";

/* ========================================================================== */
/* Provenance — two axes, derived, never stored (DEC-B88 §6)                  */
/* ========================================================================== */

/**
 * WHAT KIND of fact this is.
 *
 * Every Decision Plane row is `decision` by definition — that is what the plane
 * means. The union is wider because the same contract is what UT-2 will use
 * when the Observation Plane is merged, and a field that changes meaning
 * between phases is worse than one that is briefly constant.
 */
export type EventNature = "decision" | "observation" | "computed";

/** HOW the fact reached us. */
export type EventOrigin = "human" | "system" | "external";

export type Provenance = {
  nature: EventNature;
  origin: EventOrigin;
  /**
   * Observation Plane confidence. Always null on the Decision Plane: an
   * internally committed decision is not "probably" true. Present in the type
   * so UT-2 adds no field and no consumer changes shape.
   */
  confidence: null;
};

/**
 * Origin is derived from HOW THE EVENT WAS EMITTED, not from who ultimately
 * caused it — the causing person is `actorId`, which is a different question.
 *
 *   * `db_trigger`  → system, ALWAYS, even when an actor is recorded. The
 *     emission was automatic; a human act merely preceded it.
 *   * `policy_rpc` / `app_action` with an actor → human.
 *   * the same without an actor → system (scheduled or cascaded work).
 *
 * `external` is unreachable on the Decision Plane and is documented as such:
 * nothing outside the platform can write to `business_event`. It becomes
 * reachable only when UT-2 merges carrier/AIS observations.
 */
export function deriveProvenance(row: {
  source: string;
  actorUserId: string | null;
}): Provenance {
  if (row.source === "db_trigger") return { nature: "decision", origin: "system", confidence: null };
  return {
    nature: "decision",
    origin: row.actorUserId ? "human" : "system",
    confidence: null,
  };
}

/* ========================================================================== */
/* The projection                                                             */
/* ========================================================================== */

export type TimelineEntry = {
  eventId: string;
  tenantId: string;
  dossierId: string | null;
  subjectType: string;
  subjectId: string | null;
  eventType: string;
  domain: EventDomain;
  eventVersion: number;
  occurredAt: string;
  /** NULL for pre-UT-1 events. See `orderingGroup` / `chronologyProvable`. */
  ordinal: number | null;
  actorId: string | null;
  actorName: string | null;
  labelFr: string;
  provenance: Provenance;
  metadata: Record<string, string | number | boolean>;
  /**
   * Entries sharing an `orderingGroup` are NOT provably ordered relative to one
   * another and must be rendered as simultaneous. An entry with an ordinal is
   * alone in its group — its position is proven.
   */
  orderingGroup: string;
  chronologyProvable: boolean;
};

/**
 * The grouping signal.
 *
 * With an ordinal, the event's position is a recorded fact, so it forms its own
 * group. Without one, all events sharing an instant are indistinguishable — the
 * order among them was never recorded — so they share a group and a consumer
 * must present them as simultaneous rather than pick one.
 */
export function orderingGroupOf(occurredAt: string, ordinal: number | null): string {
  return ordinal === null ? `t:${occurredAt}` : `o:${ordinal}`;
}

/* ========================================================================== */
/* Ordering (DEC-B88 §2)                                                      */
/* ========================================================================== */

/**
 * The total order: `occurred_at`, then `ordinal`, then `id`.
 *
 * Returns <0 when `a` precedes `b`. NULL ordinals sort AFTER any ordinal at the
 * same instant — deterministic, and it keeps recorded positions ahead of
 * unrecorded ones rather than interleaving them. `id` is the final tiebreaker:
 * it asserts nothing about time, it only makes pagination stable.
 *
 * This function does not, and must not, ever consult `received_at`: that is
 * when WE learned something, and sorting by it would reorder the world by the
 * state of our inbox.
 */
export function compareEntries(
  a: { occurredAt: string; ordinal: number | null; eventId: string },
  b: { occurredAt: string; ordinal: number | null; eventId: string },
): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.ordinal !== b.ordinal) {
    if (a.ordinal === null) return 1;
    if (b.ordinal === null) return -1;
    return a.ordinal - b.ordinal;
  }
  if (a.eventId === b.eventId) return 0;
  return a.eventId < b.eventId ? -1 : 1;
}

/** Chronologically ascending. Newest-first is a rendering choice, not an order. */
export function sortAscending<T extends { occurredAt: string; ordinal: number | null; eventId: string }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareEntries);
}

/**
 * Consecutive entries whose order is not provable, grouped for rendering.
 * A group of one is the normal case; a group of many is history telling the
 * truth about what it does not know.
 */
export function groupUnordered<T extends { orderingGroup: string }>(entries: readonly T[]): T[][] {
  const out: T[][] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last[0].orderingGroup === e.orderingGroup) last.push(e);
    else out.push([e]);
  }
  return out;
}

/* ========================================================================== */
/* Pagination                                                                 */
/* ========================================================================== */

export type TimelineCursor = { occurredAt: string; ordinal: number | null; eventId: string };

export function cursorOf(entry: TimelineEntry): TimelineCursor {
  return { occurredAt: entry.occurredAt, ordinal: entry.ordinal, eventId: entry.eventId };
}

/** Encoded opaquely so a consumer cannot hand-craft one from a raw ordinal. */
export function encodeCursor(c: TimelineCursor): string {
  return Buffer.from(JSON.stringify([c.occurredAt, c.ordinal, c.eventId]), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): TimelineCursor | null {
  try {
    const [occurredAt, ordinal, eventId] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof occurredAt !== "string" || typeof eventId !== "string") return null;
    if (ordinal !== null && typeof ordinal !== "number") return null;
    return { occurredAt, ordinal, eventId };
  } catch {
    return null;
  }
}

/** Strictly-before-the-cursor, in the descending (newest-first) read direction. */
export function isBeforeCursor(entry: TimelineCursor, cursor: TimelineCursor): boolean {
  return compareEntries(entry, cursor) < 0;
}

/* ========================================================================== */
/* Metadata-safe projection                                                   */
/* ========================================================================== */

/**
 * Defence in depth over a policy already enforced at write time.
 *
 * `emit_business_event` validates metadata against a per-type allow-list and
 * the prohibited-key deny-list, so a violating row should not exist. This drops
 * any prohibited key anyway, and any non-scalar value, because the read
 * contract feeds the portal and the AI layer — the two consumers where a
 * single leaked free-text field is least recoverable.
 */
export function projectMetadata(
  raw: unknown,
): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const denied = new Set<string>(PROHIBITED_METADATA_KEYS);
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (denied.has(k)) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** The registry's French label, falling back to the raw type rather than inventing one. */
export function labelFor(eventType: string): string {
  return getEventType(eventType)?.labelFr ?? eventType;
}
