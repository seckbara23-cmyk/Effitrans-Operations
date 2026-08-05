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
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalFileSummary } from "@/lib/portal/service";
import { clientSafeEventTypes, isClientSafeEvent } from "@/lib/workflow/events/types";
import { deriveProvenance, labelFor, projectMetadata } from "./contract";
import { readDecisionPlane, MAX_PAGE, DEFAULT_PAGE } from "./decision-plane";
import { readObservationPlane, fetchObservations } from "./observation-plane";
import {
  assignChronology, compareUnified, fromDecisionEntry, truncateAtGroupBoundary,
  encodeUnifiedCursor, decodeUnifiedCursor, isBeforeUnifiedCursor, toClientSafe,
  type UnifiedEntry, type Plane,
} from "./merged";
import type { EventOrigin } from "./contract";
import {
  matchesFilter, matchesOrigin, matchesPlane, type TimelineFilter,
} from "./presentation";

export type UnifiedQuery = {
  dossierId: string;
  limit?: number;
  /** Opaque; from `nextCursor`. */
  cursor?: string;
  /**
   * UT-4 presentation filters. They narrow what is SHOWN and never what is
   * TRUE: see the chronology note in `readUnifiedTimeline`.
   */
  filter?: TimelineFilter;
  plane?: Plane | null;
  origin?: EventOrigin | null;
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

  // CHRONOLOGY IS ASSIGNED BEFORE FILTERING, and this order is load-bearing.
  //
  // An entry is unprovable because something else shared its instant. If the
  // filter ran first, hiding that something else would make the survivor look
  // individually ordered — the filter would have MANUFACTURED provability, and
  // a user narrowing to "Commercial" would be shown a firmer history than
  // exists. Assigning first means `chronologyProvable` describes what happened,
  // not what is currently on screen.
  const withChronology = assignChronology(scoped)
    .map((e) => ({ ...e, paginationToken: `${e.occurredAt}|${e.entryId}` }))
    .sort((a, b) => -compareUnified(a, b)); // newest first for reading

  const filtered = withChronology.filter(
    (e) =>
      matchesFilter(e, query.filter ?? "all") &&
      matchesPlane(e, query.plane ?? null) &&
      matchesOrigin(e, query.origin ?? null),
  );

  const afterCursor = cursor
    ? filtered.filter((e) => isBeforeUnifiedCursor(e, cursor))
    : filtered;

  return assemblePage(afterCursor, limit);
}

/**
 * The shared assembly step: truncate on a group boundary, mint the cursor, and
 * report what the page contains.
 *
 * Extracted at UT-5 so the customer projection cannot drift from the internal
 * one. Ordering, grouping and page boundaries are the properties the whole
 * programme is about; two copies of them would eventually disagree, and the
 * customer would be the last to find out.
 */
function assemblePage(entries: UnifiedEntry[], limit: number): UnifiedPage {
  const { page, hasMore } = truncateAtGroupBoundary(entries, limit);
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
 * UT-5 — the CUSTOMER's view of the same history.
 *
 * WHY THIS IS NOT SIMPLY `readUnifiedTimeline` + a filter. That reader resolves a
 * STAFF session (`getCurrentUser`) and authorizes through staff visibility. A
 * portal user is a different identity system entirely — `client_user`, not
 * `app_user` — and holds no staff permission, so the internal reader returns an
 * empty page for them. Feeding the portal from it would have shipped a timeline
 * that is always blank, or forced a bypass.
 *
 * So the customer path has its OWN gate and shares EVERYTHING else:
 *
 *   1. `requirePortalUser()` establishes the customer.
 *   2. `getPortalFileSummary()` is the isolation boundary — it reads on the
 *      RLS-bound client, so a dossier belonging to another client simply is not
 *      there. Customer isolation is the database's answer, not a filter here.
 *   3. Decision entries are taken through the `clientSafe` ALLOW-LIST, never a
 *      deny-filter: a type nobody classified is omitted, so forgetting is a
 *      missing row rather than a disclosure.
 *   4. Observations reuse the SAME adapter as staff (`fetchObservations`),
 *      behind the gate established in step 2.
 *   5. Ordering, grouping, chronology-provability and page boundaries come from
 *      the SAME `assignChronology` / `assemblePage` the internal timeline uses.
 *
 * The customer therefore sees fewer entries than staff — never a different
 * history, and never a firmer one: `chronologyProvable` survives the projection,
 * so where the platform cannot prove an order, it does not pretend to the
 * customer either.
 */
export async function readClientSafeTimeline(query: UnifiedQuery): Promise<UnifiedPage> {
  const empty: UnifiedPage = {
    entries: [], nextCursor: null, containsUnprovenOrder: false, planesPresent: [],
  };

  const portalUser = await requirePortalUser();
  // THE customer-isolation gate. RLS-bound: another client's dossier is absent,
  // not filtered, so there is nothing here to get wrong.
  const summary = await getPortalFileSummary(query.dossierId);
  if (!summary) return empty;

  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor ? decodeUnifiedCursor(query.cursor) : null;

  const safeTypes = new Set(clientSafeEventTypes().map((e) => e.type));
  const admin = getAdminSupabaseClient();

  const [decisionRows, observations] = await Promise.all([
    admin
      .from("business_event")
      // The customer projection does not SELECT what it must not expose.
      // Dropping actor, metadata and subject here rather than nulling them after
      // the fact means the values never leave the database, so no later edit to
      // the mapping can leak one by accident.
      .select(
        "id, tenant_id, dossier_id, event_type, event_domain, " +
          "event_version, source, ordinal, occurred_at",
      )
      .eq("tenant_id", portalUser.tenantId)
      .eq("dossier_id", query.dossierId)
      .in("event_type", [...safeTypes])
      .order("occurred_at", { ascending: false })
      .limit(MAX_PAGE),
    fetchObservations(portalUser.tenantId, query.dossierId),
  ]);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const decisions: UnifiedEntry[] = ((decisionRows.data ?? []) as any[]).map((r) =>
    fromDecisionEntry(
      {
        eventId: r.id, tenantId: r.tenant_id, dossierId: r.dossier_id,
        // Not projected: the empty subject is what "withheld" looks like here.
        subjectType: "", subjectId: null, eventType: r.event_type,
        domain: r.event_domain, eventVersion: r.event_version,
        occurredAt: r.occurred_at,
        ordinal: r.ordinal === null || r.ordinal === undefined ? null : Number(r.ordinal),
        // Staff identity never crosses into the customer's view.
        actorId: null, actorName: null,
        labelFr: labelFor(r.event_type),
        provenance: deriveProvenance({ source: r.source, actorUserId: null }),
        metadata: {},
        orderingGroup: "", chronologyProvable: false,
      },
      // Re-checked against the registry per row rather than assumed from the
      // query. The `.in()` filter above and `toClientSafe` below are then two
      // independent barriers: if either is ever edited away, the other still
      // refuses. Hardcoding `true` here would have made the second one blind.
      isClientSafeEvent(r.event_type),
    ),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const merged = [...decisions, ...observations].filter(
    (e) => e.dossierId === query.dossierId && e.tenantId === portalUser.tenantId,
  );

  // Chronology BEFORE the client-safe narrowing, for the same reason UT-4 assigns
  // it before filtering: hiding an internal entry that shared an instant must not
  // make the customer's entry look individually ordered.
  const withChronology = assignChronology(merged)
    .map((e) => ({ ...e, paginationToken: `${e.occurredAt}|${e.entryId}` }))
    .sort((a, b) => -compareUnified(a, b));

  const safe = toClientSafe(withChronology);
  const afterCursor = cursor ? safe.filter((e) => isBeforeUnifiedCursor(e, cursor)) : safe;

  return assemblePage(afterCursor, limit);
}

export type { UnifiedEntry };
