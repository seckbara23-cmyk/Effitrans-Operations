/**
 * Customs Reference Library — reclaim abandoned direct-upload staging bytes.
 * CUSTOMS-REF-01A / REF-2 finding F-2. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS. The direct-to-storage upload puts bytes in the private
 * bucket BEFORE the application decides a document exists. When the second step
 * never comes — the tab closed, the network dropped, `/finalize` was refused
 * before it could clean up — the bytes stay. `dropStaging()` in `/finalize` is
 * the fast path and handles every case it can see; this is the backstop for the
 * cases it never gets to run for.
 *
 * WHERE IT RUNS, AND WHY THERE. From `/upload-url`, after the
 * `customs:reference:publish` check. There is no scheduler in this system to
 * hang it on — pg_cron, pg_net, pgmq and http are all absent from production,
 * `vercel.json` declares no crons, and no workflow has a `schedule:` trigger —
 * and every way of adding one costs a standing credential or a scheduled
 * production surface. The door needs neither: it runs only when a publisher is
 * already authenticated, already authorized, and already uploading.
 *
 * THE DESIGN DOES NOT DEPEND ON THE SIGNED-URL LIFETIME, which is decided
 * server-side and which the published sources disagree about. An object is aged
 * from its own `created_at` — the moment its bytes finished landing — not from
 * when its ticket was minted, so the token's lifetime never enters the safety
 * argument. An upload still in flight has no object row at all, so it cannot be
 * listed, let alone removed. 24 hours is margin, not measurement.
 * See docs/customs-ref-uat/f2-staging-sweeper-design.md.
 *
 * SAFETY, in the order it is enforced:
 *   1. the prefix is built from the SESSION's tenant, which the caller cannot
 *      influence, and nothing here ever lists the bucket;
 *   2. only a name of the exact shape `buildStagingPath` writes is considered,
 *      so anything else under that prefix is left alone rather than guessed at;
 *   3. the path to remove is REBUILT by `buildStagingPath` — the listing's own
 *      name is never used as a path, so no returned string can address anything
 *      outside this tenant's staging prefix;
 *   4. an object whose age cannot be established is never removed;
 *   5. the work is bounded: one page, one batch, no pagination inside a request;
 *   6. every failure is swallowed. A janitorial sweep must never be the reason
 *      an authorized publisher cannot upload.
 *
 * IT WRITES NO AUDIT EVENT, deliberately. A staging object is not a document:
 * no `customs_reference_document` row ever referenced it, so there is no entity
 * to attach an event to and no history it belongs to — and `writeAudit` needs a
 * UUID entity id. REF-2's test 38 already forbids `writeAudit` in the ticket
 * route, and WES-9 aborts an action whose mandatory audit fails, which would let
 * a failed audit write block a legitimate upload. Counts are logged instead.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/observability/report";
import { buildStagingPath } from "@/lib/customs/reference/validate";

const BUCKET = "customs-reference";

/** Grouping label for anything this module reports. */
const EVENT = "customs.reference.staging_sweep";

/**
 * How long an unfinalised staging object is left alone.
 *
 * Generous on purpose. The real exposure window is one client round trip
 * between the bytes landing and `/finalize` being called; a day of margin costs
 * nothing, because the objects it keeps are ones nobody is looking at.
 */
export const DEFAULT_STAGING_TTL_HOURS = 24;

/** Most objects one request will remove. A latency bound, not a cap on debris. */
export const MAX_SWEEP_DELETIONS = 50;

/** One page, oldest first. Never paginated inside a request. */
export const SWEEP_LIST_LIMIT = 100;

/**
 * The one variable this module reads. The index signature is what keeps
 * `process.env` (NodeJS.ProcessEnv) assignable while a test can pass a bare
 * object — the same reason `lib/ai/config.ts` declares `AIEnv` that way.
 */
export type SweepEnv = {
  [key: string]: string | undefined;
  CUSTOMS_STAGING_TTL_HOURS?: string;
};

/** Exactly what `buildStagingPath` writes: a v4-shaped uuid and `.pdf`. */
const STAGING_OBJECT_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields of a storage listing this module reads. Nothing else is touched. */
export type StagingEntry = {
  name?: string | null;
  created_at?: string | null;
};

export type SweepOutcome = {
  /** Objects the listing returned, whether or not they were candidates. */
  scanned: number;
  /** Objects actually removed. */
  removed: number;
  /** `created_at` of the oldest object removed, for the operational line. */
  oldest: string | null;
  /** Which call failed, when one did. The sweep still returns normally. */
  failedAt: "list" | "remove" | null;
};

const CLEAN: SweepOutcome = { scanned: 0, removed: 0, oldest: null, failedAt: null };

/** The prefix this tenant's staging objects live under. */
export function stagingPrefix(tenantId: string): string {
  return `${tenantId}/_staging`;
}

/**
 * The retention threshold, in hours.
 *
 * `CUSTOMS_STAGING_TTL_HOURS` exists so CI can set `0` and watch an object
 * disappear. It is NOT set in production: `0` is safe for correctness — it can
 * only ever reach the caller's own staging prefix, and a concurrent finalise
 * then answers a clean `upload_not_found` — but it would delete a colleague's
 * upload seconds before they finalised it.
 *
 * Anything absent, blank, non-numeric, fractional or negative falls back to the
 * default. A typo must not be able to shorten the window.
 */
export function stagingTtlHours(env: SweepEnv = process.env): number {
  const raw = env.CUSTOMS_STAGING_TTL_HOURS;
  if (typeof raw !== "string" || raw.trim().length === 0) return DEFAULT_STAGING_TTL_HOURS;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return DEFAULT_STAGING_TTL_HOURS;
  }
  return value;
}

/**
 * Is this listing entry an abandoned staging object?
 *
 * Pure, so the rule can be tested at its boundaries without a storage service.
 * Every uncertainty answers NO: an unrecognised name, a missing timestamp, an
 * unparseable one, or one in the future. Unknown age is not evidence of
 * abandonment, and the cost of keeping a file is a file.
 */
export function isAbandonedStagingObject(
  entry: StagingEntry,
  nowMs: number,
  ttlHours: number,
): boolean {
  const name = entry.name ?? "";
  // Also what rejects `..`, a nested path, or anything this code did not write.
  if (!STAGING_OBJECT_NAME.test(name)) return false;

  const raw = entry.created_at;
  if (typeof raw !== "string" || raw.trim().length === 0) return false;
  const created = Date.parse(raw);
  if (!Number.isFinite(created)) return false;

  const ageMs = nowMs - created;
  // A timestamp in the future means a clock disagreement, not an old file.
  if (ageMs < 0) return false;

  return ageMs >= ttlHours * 3_600_000;
}

/**
 * Remove this tenant's abandoned staging objects. Best-effort by contract:
 * resolves with what it managed to do and never throws.
 *
 * The ticket being minted by the caller has no object yet, so this cannot touch
 * it. A finalised document lives at `${tenant}/<id>.pdf`, one level above the
 * prefix listed here, so it is not reachable either — note that both basenames
 * are `<uuid>.pdf`, which is exactly why the prefix, and not the name, is what
 * protects a document.
 */
export async function sweepAbandonedStaging(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { nowMs?: number; ttlHours?: number } = {},
): Promise<SweepOutcome> {
  // The caller passes a session tenant, so this should never fire. It is here so
  // that "a sweep is confined to one tenant" is a property of this function
  // rather than a property of its call sites.
  if (!TENANT_ID.test(tenantId)) return { ...CLEAN };

  const nowMs = opts.nowMs ?? Date.now();
  const ttlHours = opts.ttlHours ?? stagingTtlHours();
  const prefix = stagingPrefix(tenantId);

  let entries: StagingEntry[];
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: SWEEP_LIST_LIMIT,
      // Oldest first, so one page always makes progress against a backlog.
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) throw error;
    entries = (data ?? []) as StagingEntry[];
  } catch (error) {
    reportError(error, { scope: "route", event: EVENT, extra: { tenantId, stage: "list" } });
    return { ...CLEAN, failedAt: "list" };
  }

  const scanned = entries.length;
  const doomed: string[] = [];
  let oldest: number | null = null;
  let oldestIso: string | null = null;

  for (const entry of entries) {
    if (!isAbandonedStagingObject(entry, nowMs, ttlHours)) continue;

    // THE PATH IS REBUILT BY THE FUNCTION THAT WROTE IT. The listing's `name`
    // is data, not a path: it decides WHICH uploadId, never WHERE.
    const uploadId = (entry.name as string).slice(0, -".pdf".length);
    doomed.push(buildStagingPath(tenantId, uploadId));

    // Computed rather than assumed from the ordering: `sortBy` is a request, and
    // the oldest timestamp reported should be true even if it were ignored.
    const created = Date.parse(entry.created_at as string);
    if (oldest === null || created < oldest) {
      oldest = created;
      oldestIso = entry.created_at as string;
    }

    if (doomed.length >= MAX_SWEEP_DELETIONS) break;
  }

  if (doomed.length === 0) return { ...CLEAN, scanned };

  try {
    const { error } = await supabase.storage.from(BUCKET).remove(doomed);
    if (error) throw error;
  } catch (error) {
    reportError(error, {
      scope: "route",
      event: EVENT,
      // Counts and the tenant only. Never a name, an uploadId or a path.
      extra: { tenantId, stage: "remove", candidates: doomed.length },
    });
    return { ...CLEAN, scanned, failedAt: "remove" };
  }

  // Logged only when something was actually reclaimed: a clean prefix is not an
  // operational event, and a line on every ticket request would bury the ones
  // that matter. Counts and timestamps only — no name, no id, no token, no URL.
  console.info(
    `[customs-ref] staging sweep tenant=${tenantId} scanned=${scanned} `
      + `removed=${doomed.length} oldest=${oldestIso ?? "-"}`,
  );

  return { scanned, removed: doomed.length, oldest: oldestIso, failedAt: null };
}
