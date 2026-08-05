/**
 * Business event read paths (Phase WES-9K). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * TWO readers, deliberately separate:
 *
 *   readDossierTimeline   — internal staff. Runs on the RLS-ENFORCED client, so
 *                           the database policy is the gate. Visibility is
 *                           whatever `can_read_file` already says it is; this
 *                           module introduces no second, weaker notion of who
 *                           may see a dossier.
 *
 *   readClientTimeline    — customer portal. An explicit PROJECTION over the
 *                           `clientSafe` allow-list, not a filter over rows.
 *                           The distinction matters: a filter ("hide the ones
 *                           marked internal") leaks every type someone forgets
 *                           to classify. An allow-list omits them by default,
 *                           so the failure mode of forgetfulness is a missing
 *                           row, not a disclosure.
 *
 * The internal reader does NOT use the service-role client. That is a
 * departure from the other readers in this repository, and it is on purpose:
 * the RLS policy on business_event encodes exactly the visibility rule wanted
 * here, and re-implementing it in TypeScript over an RLS-bypassing client
 * would be a second copy that can drift.
 */
import "server-only";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalFileSummary } from "@/lib/portal/service";
import { clientSafeEventTypes, getEventType, type EventDomain } from "./types";

export type TimelineEvent = {
  id: string;
  type: string;
  domain: EventDomain;
  version: number;
  labelFr: string;
  occurredAt: string;
  actorUserId: string | null;
  actorName: string | null;
  subjectType: string;
  subjectId: string | null;
  metadata: Record<string, string | number | boolean>;
  source: string;
  policyVersionId: string | null;
  policyProvenance: string | null;
};

type Row = {
  id: string;
  event_type: string;
  event_domain: string;
  event_version: number;
  source: string;
  subject_type: string;
  subject_id: string | null;
  actor_user_id: string | null;
  metadata: Record<string, string | number | boolean> | null;
  policy_version_id: string | null;
  policy_provenance: string | null;
  occurred_at: string;
};

function toTimelineEvent(row: Row, actorName: string | null): TimelineEvent | null {
  const def = getEventType(row.event_type);
  // An unknown type means the ledger holds something this build does not
  // understand — most likely a newer deployment wrote it. Skipping is correct:
  // rendering a raw enum to an operator is worse than showing nothing.
  if (!def) return null;
  return {
    id: row.id,
    type: row.event_type,
    domain: def.domain,
    version: row.event_version,
    labelFr: def.labelFr,
    occurredAt: row.occurred_at,
    actorUserId: row.actor_user_id,
    actorName,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    metadata: row.metadata ?? {},
    source: row.source,
    policyVersionId: row.policy_version_id,
    policyProvenance: row.policy_provenance,
  };
}

const SELECT =
  "id, event_type, event_domain, event_version, source, subject_type, subject_id, " +
  "actor_user_id, metadata, policy_version_id, policy_provenance, occurred_at";

/**
 * One dossier's internal timeline, newest first. RLS-gated: a user who cannot
 * read the dossier gets an empty list, not an error — the same shape the rest
 * of the dossier page uses for sections it may not show.
 */
export async function readDossierTimeline(
  fileId: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  const supabase = getServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_event")
    .select(SELECT)
    .eq("dossier_id", fileId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const rows = data as unknown as Row[];
  const names = await resolveActorNames(rows.map((r) => r.actor_user_id));
  return rows
    .map((r) => toTimelineEvent(r, r.actor_user_id ? names.get(r.actor_user_id) ?? null : null))
    .filter((e): e is TimelineEvent => e !== null);
}

/**
 * Actor display names. Read on the admin client because `app_user` visibility
 * is narrower than dossier visibility — someone who can see a dossier is not
 * necessarily allowed to browse the staff directory. Tenant-scoped explicitly:
 * the service role bypasses RLS.
 */
export async function resolveActorNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const supabase = getServerSupabaseClient();
  const { data: me } = await supabase.auth.getUser();
  if (!me?.user) return out;

  const admin = getAdminSupabaseClient();
  const { data: self } = await admin
    .from("app_user")
    .select("tenant_id")
    .eq("id", me.user.id)
    .maybeSingle();
  if (!self?.tenant_id) return out;

  const { data } = await admin
    .from("app_user")
    .select("id, name")
    .eq("tenant_id", self.tenant_id)
    .in("id", unique);

  for (const row of data ?? []) {
    if (row.name) out.set(row.id, row.name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Customer portal projection
// ---------------------------------------------------------------------------

/**
 * EC-3C — one quotation's business-event history.
 *
 * Read on the ADMIN client, deliberately. `business_event_select` admits only
 * dossier events (through `can_read_file`) and configuration events; a
 * commercial event carries `dossier_id = NULL` until conversion, so RLS cannot
 * serve this timeline at all. Rather than widen a policy on a shared ledger
 * table — which would change what every other module's events are worth — this
 * follows the pattern already used by `readClientTimeline` and
 * `resolveActorNames`: service-role read, explicit tenant scope, and an
 * application gate the CALLER must have passed (`assertCommercialRead`).
 *
 * Selected by `metadata.quotation_id`, which every commercial event carries —
 * including `QUOTATION_CONVERTED_TO_DOSSIER`, whose subject is the dossier. So
 * the conversion appears on both timelines, which is exactly right: it is the
 * one event that belongs to both stories.
 */
export async function readQuotationTimeline(
  tenantId: string,
  quotationId: string,
  limit = 100,
): Promise<TimelineEvent[]> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("business_event")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("metadata->>quotation_id", quotationId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const rows = data as unknown as Row[];
  const names = await resolveActorNames(rows.map((r) => r.actor_user_id));
  return rows
    .map((r) => toTimelineEvent(r, r.actor_user_id ? names.get(r.actor_user_id) ?? null : null))
    .filter((e): e is TimelineEvent => e !== null);
}

/** Recent commercial activity across the tenant — the landing page's event strip. */
export async function readCommercialActivity(
  tenantId: string,
  limit = 12,
): Promise<TimelineEvent[]> {
  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("business_event")
    .select(SELECT)
    .eq("tenant_id", tenantId)
    .eq("event_domain", "commercial")
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  const rows = data as unknown as Row[];
  const names = await resolveActorNames(rows.map((r) => r.actor_user_id));
  return rows
    .map((r) => toTimelineEvent(r, r.actor_user_id ? names.get(r.actor_user_id) ?? null : null))
    .filter((e): e is TimelineEvent => e !== null);
}

/* WES-9K's `ClientTimelineEvent` / `readClientTimeline` were RETIRED at UT-5.
 *
 * That was the first customer projection: Decision Plane only, allow-listed,
 * unpaginated, and never wired to a surface. Its ACCESS PATTERN — portal user +
 * `getPortalFileSummary` as the isolation gate + an `IN` filter on client-safe
 * types so a non-listed type never leaves the database — was correct, and is
 * preserved verbatim in `lib/unified-timeline/unified.ts#readClientSafeTimeline`,
 * which additionally carries the Observation Plane, chronology grouping and a
 * group-safe cursor.
 *
 * It is deleted rather than left in place because two customer projections of
 * one history is exactly the duplication UT-5 exists to remove: on the day they
 * disagreed, the customer is the one who would have been told two stories.
 */
