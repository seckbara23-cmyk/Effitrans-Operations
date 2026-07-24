/**
 * Executive KPI Engine — windowed event readers (Phase 10.0D-2). SERVER-ONLY,
 * read-only.
 * ---------------------------------------------------------------------------
 * The small tenant-scoped, date-bounded COUNT queries the 10.0D-0 audit
 * anticipated (§18): head-only counts over ONE authoritative event timestamp
 * each (§7 timestamp catalog — ratified; `updated_at` is FORBIDDEN as a proxy).
 *
 *   dossiers créés        operational_file.created_at          (instant)
 *   dossiers clôturés     file_state_transition.occurred_at,
 *                         to_status = 'CLOSED'                 (instant — the
 *                         ONLY closure event source: operational_file has no
 *                         closed_at column)
 *   mainlevées (BAE)      customs_record.release_date          (DATE-grain —
 *                         a whole-tenant-day fact, never time-of-day)
 *   demandes finance      finance_request.requested_at         (instant)
 *   approbations finance  finance_request.reviewed_at, status
 *                         ∈ {APPROVED, DISBURSED}              (instant; a
 *                         request approved then cancelled the same day is
 *                         missed — documented undercount, never an overcount)
 *   décaissements         finance_request.disbursed_at         (DATE-grain)
 *   conversations         conversation.created_at              (instant)
 *
 * WINDOW LOGIC LIVES IN ./windows ONLY — this module converts nothing itself
 * (structural-test-enforced: no Intl, no Date arithmetic). Bounds are
 * [start, end) — start inclusive, end exclusive (DEC-B38), resolved in the
 * tenant timezone (DEC-B39).
 *
 * Every count is tenant-filtered explicitly (`eq("tenant_id", …)` — the
 * registry-equivalent idiom the tenant-scope guard accepts). `conversation`
 * carries tenant_id but is not yet in TENANT_SCOPED_TABLES (pre-existing
 * registry gap — messaging reads use the RLS client); the explicit filter
 * here is therefore mandatory, not stylistic.
 *
 * A reader returns null when its table is absent (migration not applied) or
 * the query fails — Missing ≠ Negative; the engine renders "unavailable",
 * never a confident zero.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { windowInstantBounds } from "./windows";
import type { KpiWindow } from "./types";

/** Minimal head-count builder view (mirrors the tenant-scope.ts typing note —
 *  the full generic PostgREST builder makes tsc expand every table). */
type CountQuery = PromiseLike<{ count: number | null; error: { message: string } | null }> & {
  eq(column: string, value: unknown): CountQuery;
  in(column: string, values: readonly unknown[]): CountQuery;
  is(column: string, value: unknown): CountQuery;
  gte(column: string, value: unknown): CountQuery;
  lt(column: string, value: unknown): CountQuery;
};

function headCount(table: string): CountQuery {
  const admin = getAdminSupabaseClient() as unknown as {
    from(t: string): { select(c: string, o: { count: "exact"; head: true }): CountQuery };
  };
  return admin.from(table).select("id", { count: "exact", head: true });
}

/**
 * Count events on ONE authoritative timestamp within [start, end).
 * grain "instant": timestamptz column, bounds converted to UTC instants by
 * ./windows. grain "date": DATE column compared against tenant calendar dates
 * directly (never routed through a UTC instant — that would shift the day).
 */
async function countEvents(opts: {
  tenantId: string;
  table: string;
  column: string;
  grain: "instant" | "date";
  window: KpiWindow;
  refine?: (q: CountQuery) => CountQuery;
}): Promise<number | null> {
  let start: string;
  let end: string;
  if (opts.grain === "instant") {
    const bounds = windowInstantBounds(opts.window);
    if (!bounds) return null; // a flow count needs a bounded window — never an all-time scan
    start = bounds.startUtc;
    end = bounds.endUtc;
  } else {
    if (!opts.window.start || !opts.window.end) return null;
    start = opts.window.start;
    end = opts.window.end;
  }
  let q = headCount(opts.table)
    .eq("tenant_id", opts.tenantId)
    .gte(opts.column, start)
    .lt(opts.column, end);
  if (opts.refine) q = opts.refine(q);
  try {
    const { count, error } = await q;
    if (error) return null; // table absent (migration not applied) — degrade, never fabricate
    return count ?? 0;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- operational ----

/** Dossiers créés dans la fenêtre — operational_file.created_at (the creation instant). */
export function dossiersCreatedInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({ tenantId, table: "operational_file", column: "created_at", grain: "instant", window });
}

/**
 * Dossiers clôturés dans la fenêtre — file_state_transition.occurred_at with
 * to_status='CLOSED' (§7: the append-only transition log is THE closure event;
 * live since 2026-06-14, not backfilled — earlier closures are invisible to
 * this flow, which is honest, not a bug). CLOSED is terminal and unreachable
 * twice, so transition rows = dossiers.
 */
export function dossiersClosedInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({
    tenantId,
    table: "file_state_transition",
    column: "occurred_at",
    grain: "instant",
    window,
    refine: (q) => q.eq("to_status", "CLOSED"),
  });
}

// ---------------------------------------------------------------- customs ----

/** Mainlevées (BAE) dans la fenêtre — customs_record.release_date (DATE-grain, soft-delete aware). */
export function customsReleasesInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({
    tenantId,
    table: "customs_record",
    column: "release_date",
    grain: "date",
    window,
    refine: (q) => q.is("deleted_at", null),
  });
}

// ---------------------------------------------------------------- finance requests ----

/** Demandes finance déposées dans la fenêtre — finance_request.requested_at. */
export function financeRequestsInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({ tenantId, table: "finance_request", column: "requested_at", grain: "instant", window });
}

/**
 * Approbations dans la fenêtre — finance_request.reviewed_at where the request
 * is (still) APPROVED or has since been DISBURSED. Rejections/returns share
 * reviewed_at, hence the status refinement; approved-then-cancelled the same
 * day undercounts (documented — never an overcount).
 */
export function financeApprovalsInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({
    tenantId,
    table: "finance_request",
    column: "reviewed_at",
    grain: "instant",
    window,
    refine: (q) => q.in("status", ["APPROVED", "DISBURSED"]),
  });
}

/** Décaissements dans la fenêtre — finance_request.disbursed_at (DATE-grain, §7-authoritative). */
export function financeDisbursementsInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({ tenantId, table: "finance_request", column: "disbursed_at", grain: "date", window });
}

// ---------------------------------------------------------------- transport ----

/**
 * Livraisons terminées dans la fenêtre — transport_record.delivery_actual, the
 * real completion INSTANT (§7). NOT transport status (a status-only "DELIVERED"
 * has no time and would double-count re-openings). Soft-delete aware.
 */
export function deliveriesCompletedInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({
    tenantId,
    table: "transport_record",
    column: "delivery_actual",
    grain: "instant",
    window,
    refine: (q) => q.is("deleted_at", null),
  });
}

// ---------------------------------------------------------------- messaging ----

/** Conversations ouvertes dans la fenêtre — conversation.created_at (counts only, no content). */
export function conversationsStartedInWindow(tenantId: string, window: KpiWindow): Promise<number | null> {
  return countEvents({ tenantId, table: "conversation", column: "created_at", grain: "instant", window });
}
