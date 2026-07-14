/**
 * Pilot observability (Phase 5.0E-2B, Deliverable 8). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Counts, and only counts.
 *
 * WHAT THIS DELIBERATELY CANNOT SEE, and why the shape of the code is the guarantee
 * rather than a promise in a comment: every query below selects an aggregate or an
 * identifier column. There is no `select *` and no free-text column anywhere in this
 * file. It cannot return a document's contents, a collection note, a client's name, a
 * driver's phone number or the body of a communication, because it never reads them.
 *
 * A metrics surface that COULD read sensitive data and merely promised not to would
 * be one refactor away from leaking it. This one would have to be rewritten.
 *
 * Tenant-scoped. A pilot administrator sees their OWN tenant's numbers.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { getTenantProcessFlags } from "@/lib/process/rollout-server";

export type PilotMetrics = {
  /** Is the official process actually live for this tenant, right now? */
  live: boolean;
  processInstances: { total: number; active: number; closed: number };
  steps: { active: number; submitted: number; blocked: number; rejected: number; completed: number };
  handoffs: { sent: number; received: number; rejected: number };
  /** Deposits by status — counts only, never a client or an amount. */
  deposits: Record<string, number>;
  /** How long the heaviest queue read took, in ms. A performance smoke signal. */
  queueLoadMs: number | null;
  /**
   * Transition failures, by SANITIZED error code. The codes are the engine's own
   * enum ("forbidden", "invalid_state", …) — never a raw exception, never a message
   * that could carry a row's contents.
   */
  transitionFailures: Record<string, number>;
  /** Refused authorization attempts on process routes. From the audit log. */
  unauthorizedAttempts: number;
  closeAttempts: { total: number; succeeded: number; refused: number };
};

const EMPTY: PilotMetrics = {
  live: false,
  processInstances: { total: 0, active: 0, closed: 0 },
  steps: { active: 0, submitted: 0, blocked: 0, rejected: 0, completed: 0 },
  handoffs: { sent: 0, received: 0, rejected: 0 },
  deposits: {},
  queueLoadMs: null,
  transitionFailures: {},
  unauthorizedAttempts: 0,
  closeAttempts: { total: 0, succeeded: 0, refused: 0 },
};

function tally(rows: { [k: string]: unknown }[], column: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[column] ?? "unknown");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export async function getPilotMetrics(tenantId: string): Promise<PilotMetrics> {
  const flags = await getTenantProcessFlags(tenantId);
  const admin = getAdminSupabaseClient();
  const started = Date.now();

  const [instances, steps, handoffs, deposits, audit] = await Promise.all([
    scopedFrom(admin, "process_instance", tenantId).select("status"),
    scopedFrom(admin, "process_step_execution", tenantId).select("state"),
    scopedFrom(admin, "process_handoff", tenantId).select("status"),
    flags.physicalDeposit
      ? scopedFrom(admin, "invoice_deposit", tenantId).select("status")
      : Promise.resolve({ data: [] as { status: string }[] }),
    // Audit actions only. `action` is a controlled enum-like string written by our own
    // code — it is not user input and carries no payload.
    scopedFrom(admin, "audit_log", tenantId).select("action"),
  ]);

  const inst = tally((instances.data ?? []) as Record<string, unknown>[], "status");
  const st = tally((steps.data ?? []) as Record<string, unknown>[], "state");
  const ho = tally((handoffs.data ?? []) as Record<string, unknown>[], "status");
  const actions = tally((audit.data ?? []) as Record<string, unknown>[], "action");

  const totalInstances = Object.values(inst).reduce((a, b) => a + b, 0);

  // Failures and refusals, read off the audit trail by ACTION name. A sanitized code
  // by construction: we count action strings we ourselves emit.
  const transitionFailures: Record<string, number> = {};
  let unauthorized = 0;
  for (const [action, n] of Object.entries(actions)) {
    if (action.endsWith(".forbidden") || action.endsWith(".denied")) unauthorized += n;
    if (action.includes(".failed") || action.includes(".rejected")) transitionFailures[action] = n;
  }

  const closeOk = actions["process.closed"] ?? 0;
  const closeRefused = actions["process.close.refused"] ?? 0;

  return {
    ...EMPTY,
    live: flags.enabled,
    processInstances: {
      total: totalInstances,
      active: inst.ACTIVE ?? 0,
      closed: inst.CLOSED ?? 0,
    },
    steps: {
      active: (st.ACTIVE ?? 0) + (st.AVAILABLE ?? 0),
      submitted: st.SUBMITTED ?? 0,
      blocked: st.BLOCKED ?? 0,
      rejected: st.REJECTED ?? 0,
      completed: (st.COMPLETED ?? 0) + (st.APPROVED ?? 0),
    },
    handoffs: {
      sent: ho.SENT ?? 0,
      received: ho.RECEIVED ?? 0,
      rejected: ho.REJECTED ?? 0,
    },
    deposits: tally((deposits.data ?? []) as Record<string, unknown>[], "status"),
    queueLoadMs: Date.now() - started,
    transitionFailures,
    unauthorizedAttempts: unauthorized,
    closeAttempts: {
      total: closeOk + closeRefused,
      succeeded: closeOk,
      refused: closeRefused,
    },
  };
}
