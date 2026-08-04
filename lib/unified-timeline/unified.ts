import "server-only";

/**
 * UT-2 — the merged Unified Timeline reader. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE dossier, ONE history, composed from two planes that each stay where they
 * are. This module owns no table, writes nothing, synchronises nothing and
 * copies nothing between stores — it reads two sources and orders the result.
 *
 * `audit_log` is not read here and never will be: it is forensic, and a
 * timeline that mixes "what happened to this shipment" with "who edited which
 * row" answers neither question well.
 *
 * Both planes are gated before they are read. Plane A leans on the ledger's own
 * RLS policy (which since UT-1 says exactly the right thing); Plane B is gated
 * in the application, because the observation stores' policies are
 * `transport:read`-based rather than dossier-derived. Neither path can widen the
 * other: an entry appears only if its own plane admitted it.
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { clientSafeEventTypes } from "@/lib/workflow/events/types";
import { readDecisionPlane, MAX_PAGE, DEFAULT_PAGE } from "./decision-plane";
import { readObservationPlane } from "./observation-plane";
import {
  assignChronology, compareUnified, fromDecisionEntry, truncateAtGroupBoundary,
  encodeUnifiedCursor, decodeUnifiedCursor, isBeforeUnifiedCursor, toClientSafe,
  type UnifiedEntry,
} from "./merged";

export type UnifiedQuery = {
  dossierId: string;
  limit?: number;
  /** Opaque; from `nextCursor`. */
  cursor?: string;
};

export type UnifiedPage = {
  entries: UnifiedEntry[];
  nextCursor: string | null;
  /** At least one entry's position among its neighbours is not a recorded fact. */
  containsUnprovenOrder: boolean;
  /** Planes that actually contributed — so a caller can say what it is missing. */
  planesPresent: ("decision" | "observation")[];
};

/**
 * One dossier's merged history, newest first.
 *
 * Ordering, grouping and page boundaries all come from `merged.ts`, so the
 * doctrine is stated once. A page never splits a chronology group: half a
 * simultaneous set reads as "the rest happened later", which is the misreading
 * grouping exists to prevent.
 */
export async function readUnifiedTimeline(query: UnifiedQuery): Promise<UnifiedPage> {
  const empty: UnifiedPage = {
    entries: [], nextCursor: null, containsUnprovenOrder: false, planesPresent: [],
  };

  const user = await getCurrentUser();
  if (!user) return empty;

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor ? decodeUnifiedCursor(query.cursor) : null;

  // Overshoot: the merge and the group-safe truncation both need headroom, and
  // a short page while more rows exist would look like the end of history.
  const scan = Math.min(limit * 3, MAX_PAGE * 3);

  const [decision, observation] = await Promise.all([
    readDecisionPlane({ dossierId: query.dossierId, limit: Math.min(scan, MAX_PAGE) }),
    readObservationPlane({ tenantId: user.tenantId, dossierId: query.dossierId, userId: user.id }),
  ]);

  const safeTypes = new Set(clientSafeEventTypes().map((e) => e.type));
  const merged: UnifiedEntry[] = [
    ...decision.entries.map((e) => fromDecisionEntry(e, safeTypes.has(e.eventType))),
    ...observation,
  ];

  // Belt and braces: every entry must belong to the dossier asked for. Plane B
  // resolved it by key and Plane A filtered on it, so a mismatch would mean a
  // reader defect — and a timeline is the last place to let one through.
  const scoped = merged.filter(
    (e) => e.dossierId === query.dossierId && e.tenantId === user.tenantId,
  );

  const withChronology = assignChronology(scoped)
    .map((e) => ({ ...e, paginationToken: `${e.occurredAt}|${e.entryId}` }))
    .sort((a, b) => -compareUnified(a, b)); // newest first for reading

  const afterCursor = cursor
    ? withChronology.filter((e) => isBeforeUnifiedCursor(e, cursor))
    : withChronology;

  const { page, hasMore } = truncateAtGroupBoundary(afterCursor, limit);
  const last = page[page.length - 1];

  return {
    entries: page,
    nextCursor: hasMore && last
      ? encodeUnifiedCursor({ occurredAt: last.occurredAt, entryId: last.entryId })
      : null,
    containsUnprovenOrder: page.some((e) => !e.chronologyProvable),
    planesPresent: [
      ...(page.some((e) => e.plane === "decision") ? (["decision"] as const) : []),
      ...(page.some((e) => e.plane === "observation") ? (["observation"] as const) : []),
    ],
  };
}

/**
 * The customer-facing view of the same history.
 *
 * UT-2 BUILDS this contract and nothing exposes it: no portal route consumes it
 * and no portal permission was created. Wiring it is UT-5, after RATIFY-UT-3
 * and RATIFY-UT-4 decide what a customer may see of positions and ETAs.
 */
export async function readClientSafeTimeline(query: UnifiedQuery): Promise<UnifiedPage> {
  const page = await readUnifiedTimeline(query);
  const entries = toClientSafe(page.entries);
  return {
    entries,
    nextCursor: page.nextCursor,
    // Recomputed over what SURVIVES the filter: the customer's page must be
    // truthful about ITS own chronology, not about rows they cannot see.
    containsUnprovenOrder: entries.some((e) => !e.chronologyProvable),
    planesPresent: [
      ...(entries.some((e) => e.plane === "decision") ? (["decision"] as const) : []),
      ...(entries.some((e) => e.plane === "observation") ? (["observation"] as const) : []),
    ],
  };
}

export type { UnifiedEntry };
