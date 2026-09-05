/**
 * THE governed handoff routes — who may hand what to whom, and what a target
 * step needs before anyone may work it. PURE.
 * ---------------------------------------------------------------------------
 * UAT-WF-HANDOFF-01 found two things about the Operations → Transit transfer.
 *
 * FIRST, a step reachable by promotion was executable without the transfer ever
 * having happened. `am_dossier_opening` completing promotes `coordinator_reception`
 * to AVAILABLE — correct, that is C-1 — and the engine refused work only while a
 * handoff was still SENT. With NO handoff at all there was nothing to refuse, so
 * Transit could begin on a dossier Operations had never handed over. Custody was
 * never asserted, so nothing enforced it.
 *
 * SECOND, `process:handoff:send` is a GENERIC capability held by fourteen roles
 * because they each need it for their own route — Coordination sends to Finance,
 * Billing to Administration, Administration to Collections. Holding it said
 * nothing about being entitled to perform THIS custody transfer, so a Finance
 * officer or a Déclarant could formally transmit a dossier from Operations to
 * Transit.
 *
 * Both are route facts, so they live together here rather than as conditions
 * scattered across call sites. `sendHandoff` and the two execution doors read
 * this module, which means no call site can opt out and a new route is declared
 * in one place.
 *
 * WHAT THIS IS NOT. It is not a second dependency graph: the 26-step registry
 * still decides what a step waits for (`prerequisites`), and nothing here
 * changes it. A route adds a CUSTODY requirement on top — a step may be
 * reachable and still not be yours to start.
 */

export type HandoffRoute = {
  fromStepKey: string;
  toStepKey: string;
  /**
   * Roles entitled to perform this transfer, beyond holding
   * `process:handoff:send`. NULL means "any holder", which is the status quo for
   * every route Effitrans has not yet ruled on — tightening one is a business
   * decision, not a tidy-up.
   */
  senderRoles: readonly string[] | null;
  /**
   * When true, the target step may not be started or submitted until this
   * route's handoff has been RECEIVED. Reception UNLOCKS the step; it never
   * starts or completes it.
   *
   * Only the Operations → Transit route carries this today. The other three
   * governed routes keep today's weaker rule (refused only while SENT), because
   * turning it on for them would strand any in-flight dossier that reached its
   * target by promotion — a separate ratification with its own UAT.
   */
  requiresReception: boolean;
  labelFr: string;
};

/**
 * The four routes with a sender in the product. Seventeen other cross-department
 * transitions are reached by prerequisite promotion alone (C-4 R-1); they are
 * deliberately absent, and absence here means "no custody requirement", exactly
 * as before.
 */
export const HANDOFF_ROUTES: readonly HandoffRoute[] = [
  {
    fromStepKey: "am_dossier_opening",
    toStepKey: "coordinator_reception",
    // RATIFIED 2026-09-04 (UAT-WF-HANDOFF-01B). Operations hands the dossier to
    // Transit; SYSTEM_ADMIN is break-glass, kept because it is the platform's
    // existing recovery seat. The Account Manager prepares the dossier and the
    // Chef de Transit receives it — neither performs this transfer.
    senderRoles: ["OPS_SUPERVISOR", "SYSTEM_ADMIN"],
    requiresReception: true,
    labelFr: "Transmission des Opérations au Transit",
  },
  {
    fromStepKey: "gainde_registration",
    toStepKey: "coordinator_to_declarant",
    senderRoles: null,
    requiresReception: false,
    labelFr: "Retour de la Finance douane au Déclarant",
  },
  {
    fromStepKey: "billing_dispatch",
    toStepKey: "administration_deposit_prep",
    senderRoles: null,
    requiresReception: false,
    labelFr: "Remise de la Facturation à l'Administration",
  },
  {
    fromStepKey: "administration_proof_handoff",
    toStepKey: "collections",
    senderRoles: null,
    requiresReception: false,
    labelFr: "Remise de l'Administration au Recouvrement",
  },
] as const;

/** The route that targets this step, if any. */
export function routeTo(toStepKey: string): HandoffRoute | null {
  return HANDOFF_ROUTES.find((r) => r.toStepKey === toStepKey) ?? null;
}

/** The route for an exact from→to pair, if it is a governed one. */
export function routeFor(fromStepKey: string, toStepKey: string): HandoffRoute | null {
  return HANDOFF_ROUTES.find((r) => r.fromStepKey === fromStepKey && r.toStepKey === toStepKey) ?? null;
}

/**
 * May this caller perform THIS transfer? The permission is checked by the
 * engine's own guard; this answers the narrower question of entitlement to the
 * route. An unruled route answers yes, preserving today's behaviour exactly.
 */
export function maySendRoute(route: HandoffRoute | null, roleCodes: readonly string[]): boolean {
  if (!route || route.senderRoles === null) return true;
  return route.senderRoles.some((r) => roleCodes.includes(r));
}

/** Handoff rows as the engine snapshot carries them. */
export type RouteHandoffView = { toStepKey: string; status: string };

export type CustodyState =
  /** No route targets this step — custody is not a concept for it. */
  | "not_applicable"
  /** A route targets it and nothing has been sent yet. */
  | "awaiting_transmission"
  /** Sent, not yet accepted by the receiving department. */
  | "awaiting_reception"
  /** Accepted. The step is unlocked. */
  | "received";

/**
 * Where this step stands in its custody transfer, from the handoff rows alone.
 * Deliberately independent of the step's own state: a step can be AVAILABLE and
 * still not be yours, which is the distinction the audit found missing.
 */
export function custodyStateFor(
  toStepKey: string,
  handoffs: readonly RouteHandoffView[],
): CustodyState {
  const route = routeTo(toStepKey);
  if (!route) return "not_applicable";
  const mine = handoffs.filter((h) => h.toStepKey === toStepKey);
  if (mine.some((h) => h.status === "SENT")) return "awaiting_reception";
  if (mine.some((h) => h.status === "RECEIVED")) return "received";
  return "awaiting_transmission";
}

/**
 * May work begin on this step, as far as CUSTODY is concerned? Returns the
 * engine error to fail with, or null when custody is satisfied.
 *
 * A route that does not require reception keeps the historical rule: refused
 * only while a transfer is outstanding.
 */
export function custodyRefusal(
  toStepKey: string,
  handoffs: readonly RouteHandoffView[],
): "handoff_reception_required" | "handoff_not_sent" | null {
  const route = routeTo(toStepKey);
  if (!route) return null;
  const custody = custodyStateFor(toStepKey, handoffs);
  if (custody === "awaiting_reception") return "handoff_reception_required";
  if (custody === "awaiting_transmission" && route.requiresReception) return "handoff_not_sent";
  return null;
}

// ============================================================ Transit custody ====

/**
 * Steps whose ASSIGNMENT is a supervisory act reserved to named roles.
 *
 * TRANSIT-CUSTODY-03. `customs:assign` is held by the Chef de Transit, the
 * Coordinator, Operations and platform administration — and the Coordinator
 * genuinely needs it for step 12, where it assigns the field agent. So the
 * capability cannot be narrowed without breaking a documented Coordination
 * responsibility. The STEP is narrowed instead: naming the Déclarant is the
 * Chef de Transit's act, and every other assignable step keeps today's rule.
 */
export const ASSIGNMENT_AUTHORITY: Readonly<Record<string, readonly string[]>> = {
  transit_declarant_assignment: ["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"],
};

export function mayAssignStep(stepKey: string, roleCodes: readonly string[]): boolean {
  const allowed = ASSIGNMENT_AUTHORITY[stepKey];
  if (!allowed) return true;
  return allowed.some((r) => roleCodes.includes(r));
}

/**
 * Does Transit actually hold this dossier? The Operations → Transit transfer
 * must be RECEIVED **and** its reception step finished. Reception opens step 4;
 * completing step 4 is what says Transit has taken the dossier on, and only then
 * may Transit's own supervisory acts — naming a Déclarant, dispatching a field
 * team — begin.
 *
 * Returns the engine refusal, or null when custody is held. `notApplicable`
 * short-circuits: a dossier with no customs leg has no Transit custody to hold.
 */
export function transitCustodyRefusal(input: {
  handoffs: readonly RouteHandoffView[];
  /** State of `coordinator_reception`, or null when the step does not exist. */
  receptionState: string | null;
}): "transit_custody_required" | null {
  const custody = custodyStateFor("coordinator_reception", input.handoffs);
  if (custody !== "received") return "transit_custody_required";
  const done = input.receptionState === "COMPLETED" || input.receptionState === "APPROVED";
  return done ? null : "transit_custody_required";
}

/**
 * Roles that may deliver the Chef de Transit's final verification of the
 * mainlevée before a dossier is released to the Transport leg.
 *
 * TRANSIT-CUSTODY-05. `customs:validate` is the right capability — it is held by
 * neither the Déclarant nor the field agent, so it already excludes the people
 * whose work is being checked. But it is ALSO held by Operations and by platform
 * administration, and the ruling is explicit that possessing the capability must
 * not silently make them the everyday approvers. So the role is named here and
 * checked in addition to the permission: the Chef de Transit is the approver,
 * and no one else. Operations and platform administration keep the capability
 * for the acts that genuinely need it and are refused here. No break-glass path
 * is opened in this slice; if a Chef is unavailable the answer is to seat one,
 * which is a governance act with its own audit trail, not a quiet exception.
 */
export const RELEASE_APPROVAL_ROLES: readonly string[] = ["CHIEF_OF_TRANSIT"];

export function mayApproveRelease(roleCodes: readonly string[]): boolean {
  return RELEASE_APPROVAL_ROLES.some((r) => roleCodes.includes(r));
}

/**
 * Steps whose work belongs to its assignee once one is named.
 *
 * These are exactly the steps Transit assigns (`ASSIGNABLE_STEP_KEYS`): the
 * customs execution chain. Elsewhere a step is claimed by whoever starts it,
 * which is a different idea and stays as it is.
 */
export const ASSIGNMENT_OWNED_STEPS: ReadonlySet<string> = new Set([
  "transit_declarant_assignment",
  "customs_preparation",
  "gainde_document_submission",
  "customs_followup",
  "customs_field_clearance",
]);

