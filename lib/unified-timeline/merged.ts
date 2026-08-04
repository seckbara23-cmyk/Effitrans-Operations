/**
 * UT-2 — the merged two-plane timeline contract. PURE.
 * ---------------------------------------------------------------------------
 * Extends UT-1's Decision Plane contract to carry Observation Plane entries in
 * ONE ordered history. UT-1's `contract.ts` is deliberately left untouched: it
 * is a closed phase's frozen surface, and this module sits on top of it.
 *
 * The single rule everything here serves, from DEC-B88:
 * **the merged model never invents chronology.** Where two facts cannot be
 * ordered truthfully, they are GROUPED and said to be ungrouped-able, rather
 * than given a plausible sequence.
 *
 * NOTHING IS COPIED BETWEEN PLANES. An entry is a *projection* of a row that
 * stays where it was written; no store is created, read or mirrored here.
 */
import type { EventDomain } from "@/lib/workflow/events/types";
import type { EventNature, EventOrigin, TimelineEntry } from "./contract";

/* ========================================================================== */
/* Planes                                                                     */
/* ========================================================================== */

/** Plane C (`audit_log`) is deliberately absent: it is forensic, never history. */
export const PLANES = ["decision", "observation"] as const;
export type Plane = (typeof PLANES)[number];

/** The Observation Plane's confidence grades, carried through verbatim. */
export const CONFIDENCE = ["CONFIRMED", "INFERRED", "MANUAL", "ESTIMATED"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** The freshness vocabulary already used by the shipping intelligence layer. */
export type Freshness = "LIVE" | "RECENT" | "STALE" | "VERY_STALE" | "UNKNOWN";

/* ========================================================================== */
/* The canonical merged entry                                                 */
/* ========================================================================== */

export type UnifiedEntry = {
  entryId: string;
  tenantId: string;
  dossierId: string;
  subjectType: string;
  subjectId: string | null;
  plane: Plane;
  nature: EventNature;
  origin: EventOrigin;
  eventType: string;
  /** The instant the FACT happened. Never `received_at`. */
  occurredAt: string;
  /** Plane A only, and only when recorded. Plane B never has one. */
  ordinal: number | null;
  /** Plane B only — CARRIER / AIS / PORT / …, verbatim from the row. */
  observationSource: string | null;
  /**
   * Plane B only, verbatim. `null` means the source did not state one and is
   * NEVER flattened into a fabricated grade — an unknown confidence that reads
   * as CONFIRMED is worse than no timeline at all.
   */
  confidence: Confidence | null;
  freshness: Freshness | null;
  label: string;
  /** Identifiers and status codes only; no prose, no money, no bodies. */
  summary: Record<string, string | number | boolean>;
  /** Place label where the source recorded one. Never the free-text description. */
  locationName: string | null;
  domain: EventDomain | null;
  actorId: string | null;
  actorName: string | null;
  chronologyGroup: string;
  chronologyProvable: boolean;
  clientSafe: boolean;
  /** Internal pagination determinism ONLY. Never a business sequence. */
  paginationToken: string;
};

/* ========================================================================== */
/* Ordering                                                                   */
/* ========================================================================== */

/**
 * The merged comparator.
 *
 * 1. earlier `occurredAt` first;
 * 2. **only** when both entries are Plane A **and both carry an ordinal**, the
 *    ordinal decides — that is a recorded fact;
 * 3. otherwise the entry's SOURCE id, purely so pagination is deterministic.
 *
 * Step 3 deliberately does **not** consult `plane` — and it strips the `A:`/`B:`
 * prefix before comparing, which is not cosmetic. Comparing the prefixed
 * `entryId` would put every `A:` before every `B:` at a shared instant, which is
 * a fixed plane precedence smuggled in through a string: it would tell a reader
 * that decisions happen before observations, which nothing recorded. Step 3 also
 * never claims to be chronology: entries that reach it share a
 * `chronologyGroup` and are marked `chronologyProvable: false`.
 *
 * `received_at` appears nowhere. It is when WE learned something; ordering by
 * it would reorder the world by the state of our inbox.
 */
export function compareUnified(
  a: Pick<UnifiedEntry, "occurredAt" | "ordinal" | "entryId" | "plane">,
  b: Pick<UnifiedEntry, "occurredAt" | "ordinal" | "entryId" | "plane">,
): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.plane === "decision" && b.plane === "decision" && a.ordinal !== null && b.ordinal !== null) {
    if (a.ordinal !== b.ordinal) return a.ordinal - b.ordinal;
  }
  const ka = tiebreakKey(a.entryId);
  const kb = tiebreakKey(b.entryId);
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
}

/** The source row id, with the plane prefix removed. See `compareUnified` step 3. */
function tiebreakKey(entryId: string): string {
  const i = entryId.indexOf(":");
  return i === -1 ? entryId : entryId.slice(i + 1);
}

type Groupable = Pick<UnifiedEntry, "occurredAt" | "ordinal" | "entryId" | "plane">;

/**
 * Assign the chronology group and provability, per instant.
 *
 * At a given instant:
 *   * one entry            → its own group; its position is unambiguous;
 *   * several, all Plane A, all with ordinals → each its own group, because the
 *     ordinals record their true order;
 *   * anything else (planes mixed, or a NULL ordinal present) → ONE shared
 *     group, every member `chronologyProvable: false`.
 *
 * The third case is the honest one and the reason this function exists: a
 * decision and an observation stamped at the same instant were never ordered
 * by anything, and a timeline that picks one is inventing history.
 */
export function assignChronology<T extends Groupable>(
  entries: readonly T[],
): (T & { chronologyGroup: string; chronologyProvable: boolean })[] {
  const byInstant = new Map<string, T[]>();
  for (const e of entries) {
    const bucket = byInstant.get(e.occurredAt);
    if (bucket) bucket.push(e);
    else byInstant.set(e.occurredAt, [e]);
  }

  const out: (T & { chronologyGroup: string; chronologyProvable: boolean })[] = [];
  for (const [instant, bucket] of byInstant) {
    const fullyOrdered =
      bucket.length === 1 ||
      bucket.every((e) => e.plane === "decision" && e.ordinal !== null);
    for (const e of bucket) {
      out.push({
        ...e,
        chronologyGroup: fullyOrdered ? `e:${e.entryId}` : `t:${instant}`,
        chronologyProvable: fullyOrdered,
      });
    }
  }
  return out.sort(compareUnified);
}

/* ========================================================================== */
/* Pagination                                                                 */
/* ========================================================================== */

export type UnifiedCursor = { occurredAt: string; entryId: string };

export function encodeUnifiedCursor(c: UnifiedCursor): string {
  return Buffer.from(JSON.stringify([c.occurredAt, c.entryId]), "utf8").toString("base64url");
}

export function decodeUnifiedCursor(raw: string): UnifiedCursor | null {
  try {
    const [occurredAt, entryId] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof occurredAt !== "string" || typeof entryId !== "string") return null;
    return { occurredAt, entryId };
  } catch {
    return null;
  }
}

/**
 * Strictly-before-the-cursor, in the newest-first read direction.
 *
 * Compares (occurredAt, entryId) only. The cursor deliberately carries no plane
 * and no ordinal: it is a position in a page, not a claim about sequence, and
 * inventing either field to satisfy the comparator would smuggle a precedence
 * back in through the pagination path.
 */
export function isBeforeUnifiedCursor(
  entry: { occurredAt: string; entryId: string },
  cursor: UnifiedCursor,
): boolean {
  if (entry.occurredAt !== cursor.occurredAt) return entry.occurredAt < cursor.occurredAt;
  // Same plane-agnostic key the comparator uses, or paging would disagree with
  // ordering at exactly the instants where order is least certain.
  return tiebreakKey(entry.entryId) < tiebreakKey(cursor.entryId);
}

/**
 * Truncate a page WITHOUT splitting a chronology group.
 *
 * A group means "these happened together and we cannot say in which order".
 * Cutting one across a page boundary would show the reader half a simultaneous
 * set and imply the rest came later — the exact misreading grouping exists to
 * prevent. So the page ends at the last COMPLETE group that fits; if the very
 * first group is larger than the limit it is returned whole, because returning
 * part of it would be a lie and returning none would be an empty page forever.
 */
export function truncateAtGroupBoundary<T extends { chronologyGroup: string }>(
  entries: readonly T[],
  limit: number,
): { page: T[]; hasMore: boolean } {
  if (entries.length <= limit) return { page: [...entries], hasMore: false };

  // Every index at which a new group starts — the only places a page may end.
  const boundaries: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (i === 0 || entries[i].chronologyGroup !== entries[i - 1].chronologyGroup) boundaries.push(i);
  }
  boundaries.push(entries.length);

  // The largest boundary that still fits the limit.
  let cut = 0;
  for (const b of boundaries) if (b <= limit) cut = b;

  // The first group alone exceeds the limit: return it whole rather than split
  // it, because half a simultaneous set reads as "the rest happened later".
  if (cut === 0) cut = boundaries.find((b) => b > 0) ?? entries.length;

  return { page: entries.slice(0, cut), hasMore: cut < entries.length };
}

/* ========================================================================== */
/* Client-safe projection                                                     */
/* ========================================================================== */

/**
 * Observation types a customer may see. An ALLOW-LIST, not a filter: the
 * failure mode of forgetting to classify a new type must be a missing row, not
 * a disclosure. `EXCEPTION` is deliberately absent — an exception is exactly
 * where internal detail collects, and it is a ratified decision to surface it.
 * `POSITION_UPDATE` / `ETA_UPDATE` never reach the timeline at all (DEC-B88 §4).
 */
export const CLIENT_SAFE_OBSERVATIONS = [
  "VESSEL_DEPARTED", "VESSEL_ARRIVED", "DISCHARGED", "AVAILABLE_FOR_PICKUP",
  "GATE_OUT", "DELIVERED", "CUSTOMS_RELEASED",
  "DEPARTED", "ARRIVED", "RELEASED",
] as const;

/**
 * The customer-facing view of a merged timeline.
 *
 * Removes, rather than hides: internal confidence diagnostics, freshness,
 * actor identity, the observation source, and any summary key beyond a short
 * safe allow-list. Chronology and grouping are preserved exactly — a customer
 * is entitled to the same truthfulness about what we do not know.
 *
 * UT-2 only BUILDS this contract. Nothing exposes it to the portal yet.
 */
const CLIENT_SAFE_SUMMARY_KEYS = new Set(["file_number", "file_type", "type_code", "reference"]);

export function toClientSafe(entries: readonly UnifiedEntry[]): UnifiedEntry[] {
  return entries
    .filter((e) => e.clientSafe)
    .map((e) => ({
      ...e,
      actorId: null,
      actorName: null,
      observationSource: null,
      confidence: null,
      freshness: null,
      summary: Object.fromEntries(
        Object.entries(e.summary).filter(([k]) => CLIENT_SAFE_SUMMARY_KEYS.has(k)),
      ),
    }));
}

/* ========================================================================== */
/* Decision adapter                                                           */
/* ========================================================================== */

/** Projects a UT-1 `TimelineEntry` into the merged shape. No data is copied. */
export function fromDecisionEntry(e: TimelineEntry, clientSafe: boolean): UnifiedEntry {
  return {
    entryId: `A:${e.eventId}`,
    tenantId: e.tenantId,
    dossierId: e.dossierId ?? "",
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    plane: "decision",
    nature: e.provenance.nature,
    origin: e.provenance.origin,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    ordinal: e.ordinal,
    observationSource: null,
    confidence: null,
    freshness: null,
    label: e.labelFr,
    summary: e.metadata,
    locationName: null,
    domain: e.domain,
    actorId: e.actorId,
    actorName: e.actorName,
    chronologyGroup: "",
    chronologyProvable: false,
    clientSafe,
    paginationToken: "",
  };
}
