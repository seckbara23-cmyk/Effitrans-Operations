import "server-only";

/**
 * UT-1 — the canonical Decision Plane reader. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The one sanctioned way to read `business_event` as a timeline. It composes;
 * it owns nothing. Tracking has no table, writes nothing, and here does not
 * even hold a permission of its own.
 *
 * VISIBILITY IS THE DATABASE'S JOB. This reader uses the RLS-BOUND client, not
 * the admin client, precisely so the subject-based rule frozen in DEC-B88 §5
 * is enforced in ONE place — the policy corrected by migration 85 — rather than
 * restated in application code where it could drift. The deliberate contrast
 * with `lib/commercial/service.ts` (admin client + explicit gate, because it
 * reads for writers) is the reason this file says so out loud.
 *
 * Actor NAMES are the single exception: `app_user` visibility is narrower than
 * dossier visibility, so names are resolved on the admin client, tenant-scoped,
 * exactly as `lib/workflow/events/readers.ts` already does.
 *
 * WHY NOT `lib/tracking`: that module is the Phase-3.4 ROAD TELEMATICS domain
 * (driver positions, geofences, `tracking_event`) — a producer of observations,
 * not the unified read layer. Housing the Decision Plane contract beside it
 * would merge two bounded contexts in a directory listing, which is where such
 * merges usually start.
 *
 * SCOPE OF UT-1: the Decision Plane only. No Observation Plane row is read,
 * merged or copied here, and `audit_log` is not touched — it is forensic and is
 * never a timeline source.
 */
import { getServerSupabaseClient } from "@/lib/supabase/server";
import type { EventDomain } from "@/lib/workflow/events/types";
// Display names come from the EXISTING resolver — same tenant scoping, same
// admin-client reasoning (staff-directory visibility is narrower than dossier
// visibility). Exported for reuse rather than copied.
import { resolveActorNames } from "@/lib/workflow/events/readers";
import {
  deriveProvenance, orderingGroupOf, projectMetadata, labelFor,
  compareEntries, decodeCursor, encodeCursor, cursorOf,
  type TimelineEntry, type TimelineCursor,
} from "./contract";

const SELECT =
  "id, tenant_id, dossier_id, subject_type, subject_id, event_type, event_domain, " +
  "event_version, source, actor_user_id, metadata, ordinal, occurred_at";

type Row = {
  id: string;
  tenant_id: string;
  dossier_id: string | null;
  subject_type: string;
  subject_id: string | null;
  event_type: string;
  event_domain: string;
  event_version: number;
  source: string;
  actor_user_id: string | null;
  metadata: unknown;
  ordinal: number | string | null;
  occurred_at: string;
};

export const DEFAULT_PAGE = 100;
/** Hard ceiling. A timeline page is for reading, not for bulk export. */
export const MAX_PAGE = 300;

export type DecisionPlaneQuery = {
  /** One dossier's history. The dominant query. */
  dossierId?: string;
  /** A prologue subject (a quotation, a message) before a dossier exists. */
  subject?: { type: string; id: string };
  /** Narrow to specific domains. */
  domains?: readonly EventDomain[];
  limit?: number;
  /** Opaque; from `nextCursor`. */
  cursor?: string;
};

export type DecisionPlanePage = {
  entries: TimelineEntry[];
  nextCursor: string | null;
  /**
   * TRUE when the page contains at least one entry whose position among its
   * neighbours is not a recorded fact. Consumers must not present such a page
   * as a strict sequence. See `orderingGroup`.
   */
  containsUnprovenOrder: boolean;
};

/**
 * Read one page of the Decision Plane, newest first.
 *
 * PAGINATION. The order is total — (occurred_at, ordinal, id) — so a cursor is
 * a tuple, not an offset, and a page is stable while new events arrive. The
 * `occurred_at` bound is pushed to the database; the boundary itself is trimmed
 * in memory by the same comparator the contract defines. That is deliberate:
 * a pure SQL keyset would need three-term disjunctions that behave wrongly for
 * NULL ordinals, and silently dropping pre-UT-1 history from page two is a far
 * worse defect than trimming a bounded overshoot here.
 */
export async function readDecisionPlane(query: DecisionPlaneQuery): Promise<DecisionPlanePage> {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  const supabase = getServerSupabaseClient();
  let q = supabase.from("business_event").select(SELECT);

  if (query.dossierId) q = q.eq("dossier_id", query.dossierId);
  if (query.subject) q = q.eq("subject_type", query.subject.type).eq("subject_id", query.subject.id);
  if (query.domains?.length) q = q.in("event_domain", query.domains as string[]);
  // The cursor's instant is inclusive; entries at that instant are trimmed below
  // by tuple comparison, which is what makes a same-timestamp boundary correct.
  if (cursor) q = q.lte("occurred_at", cursor.occurredAt);

  // Overshoot so the in-memory trim cannot return a short page while more
  // matching rows exist at the boundary instant.
  const fetchSize = Math.min(limit * 2 + 1, MAX_PAGE * 2 + 1);
  const { data, error } = await q
    .order("occurred_at", { ascending: false })
    .order("ordinal", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(fetchSize);

  // An unreadable timeline is an EMPTY timeline, never an error page: the
  // caller may legitimately lack visibility, and RLS expresses that as no rows.
  if (error || !data) return { entries: [], nextCursor: null, containsUnprovenOrder: false };

  const rows = data as unknown as Row[];
  const names = await resolveActorNames(rows.map((r) => r.actor_user_id));

  let entries = rows.map((r) => toEntry(r, names));
  if (cursor) entries = entries.filter((e) => compareEntries(cursorOf(e), cursor) < 0);

  const hasMore = entries.length > limit;
  const page = entries.slice(0, limit);

  return {
    entries: page,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(cursorOf(page[page.length - 1])) : null,
    containsUnprovenOrder: hasUnprovenOrder(page),
  };
}

/** True when two entries in the page share an ordering group. */
function hasUnprovenOrder(entries: readonly TimelineEntry[]): boolean {
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.orderingGroup)) return true;
    seen.add(e.orderingGroup);
  }
  return false;
}

function toEntry(r: Row, names: Map<string, string>): TimelineEntry {
  // bigint arrives as a string over the wire; NULL stays NULL and is never
  // coerced to 0, which would fabricate a position for pre-UT-1 history.
  const ordinal = r.ordinal === null || r.ordinal === undefined ? null : Number(r.ordinal);
  return {
    eventId: r.id,
    tenantId: r.tenant_id,
    dossierId: r.dossier_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    eventType: r.event_type,
    domain: r.event_domain as EventDomain,
    eventVersion: r.event_version,
    occurredAt: r.occurred_at,
    ordinal,
    actorId: r.actor_user_id,
    actorName: r.actor_user_id ? names.get(r.actor_user_id) ?? null : null,
    labelFr: labelFor(r.event_type),
    provenance: deriveProvenance({ source: r.source, actorUserId: r.actor_user_id }),
    metadata: projectMetadata(r.metadata),
    orderingGroup: orderingGroupOf(r.occurred_at, ordinal),
    chronologyProvable: ordinal !== null,
  };
}

export type { TimelineEntry, TimelineCursor };
