import "server-only";
/**
 * Authoritative gate evaluation — SERVER-ONLY, deliberately NOT "use server".
 * ---------------------------------------------------------------------------
 * RATIFIED INVARIANT:
 *
 *   A workflow gate evaluates facts about the DOSSIER from authoritative
 *   platform state, not from the requesting actor's visibility-filtered view.
 *   Actor permissions decide whether the actor may PERFORM the action. They
 *   must never change whether the dossier SATISFIES the gate.
 *
 * THE DEFECT THIS CLOSES. `loadProcessSnapshot` populates its evidence arrays
 * conditionally on the caller's permissions — `access.documents ? select(...) :
 * []`. Gate evaluators then read those arrays DIRECTLY: `podReceived(snap)` asks
 * `snap.documents.some(...)`, with no access check at all. Unlike
 * `checkEvidence`, which at least reports `unauthorized`, a gate received
 * SILENCE and read it as `false`. An absent permission was indistinguishable
 * from an absent POD.
 *
 * It was not theoretical. BILLING_OFFICER holds no `document:read`, so
 * `podReceived` was always false for it, `evaluateBillingGate` never reported
 * ready, and `prepareInvoiceDraft` refused with `dossier_not_billing_ready` on a
 * dossier that genuinely was ready. The role that OWNS step 20 could never open
 * its own gate, and steps 20→26 plus closure were reachable only by a
 * supervisor holding `file:read:all`.
 *
 * WHY A VERDICT-ONLY API. The fix must confer ZERO new read authority, so these
 * functions return gate VERDICTS and nothing else. The privileged snapshot is
 * created here, consumed here, and never handed back: there is no signature in
 * this module through which a caller could receive a document row, a customs
 * record or an invoice. A verdict is a derived boolean about the dossier — the
 * Billing Officer learns "the gate is satisfied" without learning what the POD
 * says, and the Pickup Agent learns "customs released" without gaining
 * `customs:read`.
 *
 * WHAT THIS IS NOT. It is not execution authority. `guard()` still decides
 * whether the caller may act, and still runs FIRST at every call site. The
 * order is, and remains:
 *
 *      authorization  →  authoritative gate evaluation  →  mutation
 *
 * DISPLAY IS UNCHANGED. `loadProcessSnapshot` keeps producing permission-
 * filtered snapshots for UI consumers rendering RECORDS. Only gate evaluation
 * moved, because only a gate claims to state a fact about the dossier.
 */
import { loadProcessSnapshot, toViews } from "./snapshot";
import { evaluateBillingGate, evaluateClosureGate, evaluatePickupGate, type GateResult } from "./gates";

/**
 * The read set a gate evaluates under. Every domain a gate can consult, so no
 * requirement resolves to `unauthorized` or to a silently empty array.
 *
 * This is the platform's own view, not any user's. It is never used to build a
 * snapshot that leaves this module.
 */
export const GATE_FULL_READ: readonly string[] = [
  "document:read",
  "customs:read",
  "transport:read",
  "finance:read",
];

/** All three gate verdicts for a dossier, from authoritative state. */
export type AuthoritativeGates = {
  pickup: GateResult;
  billing: GateResult;
  closure: GateResult;
};

/**
 * Evaluate every gate for a dossier from platform state.
 *
 * Returns null when the dossier has no process instance — the caller then has
 * no gate to consult, which is different from a gate that is not satisfied.
 */
export async function authoritativeGates(
  tenantId: string,
  fileId: string,
): Promise<AuthoritativeGates | null> {
  const snap = await loadProcessSnapshot(tenantId, fileId, [...GATE_FULL_READ]);
  if (!snap?.instance) return null;
  const views = toViews(snap.executions);
  return {
    pickup: evaluatePickupGate(snap.evidence, views),
    billing: evaluateBillingGate(views, snap.evidence),
    closure: evaluateClosureGate(views, snap.evidence),
  };
}

/** The pickup readiness verdict, from authoritative state. */
export async function authoritativePickupGate(
  tenantId: string,
  fileId: string,
): Promise<GateResult | null> {
  return (await authoritativeGates(tenantId, fileId))?.pickup ?? null;
}

/**
 * Is this dossier billing-ready? From authoritative state.
 *
 * A bare boolean on purpose: the billing lane needs the verdict and has no use
 * for the requirement detail, so it is not given any.
 */
export async function authoritativeBillingReady(tenantId: string, fileId: string): Promise<boolean> {
  return (await authoritativeGates(tenantId, fileId))?.billing.ready ?? false;
}
