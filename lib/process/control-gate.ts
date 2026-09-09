/**
 * Step-aware control gating (ratified 2026-08-24). PURE decision core.
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS CLOSES. Dossier controls were gated exactly once, on a
 * permission — in the panel AND in the server action — and nowhere in the
 * customs or finance control layer was there any reference to the official step,
 * its state, or its assignment. So every dossier a user could READ exposed every
 * control their permissions allowed, at any point in the lifecycle. On
 * EFT-IMP-2026-00007 that was not theoretical: a Chef de Transit created the
 * customs dossier — official step 6, owned by the Déclarant — while step 4 was
 * still the current step.
 *
 * THE RATIFIED RULE. Every dossier control requires BOTH:
 *   1. the appropriate permission (unchanged, still asserted by each action), AND
 *   2. the correct current official step / state / assignment.
 * Out-of-sequence acts are HARD-BLOCKED, never warned. Coverage for absence is a
 * future EXPLICIT AUDITED OVERRIDE, never implicit permission inheritance — so
 * nothing here silently lets a supervisor through.
 *
 * WHY A COMPATIBILITY PATH EXISTS. The process engine is not universal: it is
 * flag-gated per tenant, and dossiers created before it, or in a tenant without
 * it, have no `process_instance` at all. Hard-blocking those would make such
 * dossiers unworkable — a far larger outage than the defect being fixed. So when
 * there is NO process instance the gate defers to the permission check that has
 * always governed those dossiers. Where an instance DOES exist, the step rules
 * are absolute. This is stated rather than hidden because it is the one place a
 * caller can pass without a step, and any future audit deserves to find it here.
 */
import type { StepState } from "./engine/types";

/** Controls that belong to an official step, and which step owns each one. */
export const CONTROL_OWNING_STEP: Record<string, string> = {
  // ---- Customs (Dédouanement workspace) --------------------------------
  // C-3 — declaring evidence inapplicable is a mutation of what step 3 accepts,
  // so it is gated on step 3 exactly like the evidence itself.
  "evidence.declare_absence": "am_dossier_opening",
  "customs.create": "customs_preparation",
  "customs.update": "customs_preparation",
  // GAINDE-04 (DEC-C38) — the Déclarant records the reference GAINDE returned
  // to him after his saisie. His step, his fact. NOT Finance's step-9
  // registration, which is a different act on a different column.
  "customs.declaration_reference": "customs_preparation",
  "customs.status": "customs_preparation",
  "customs.receivability": "customs_preparation",
  "customs.attachment": "gainde_document_submission",
  "customs.gainde_registration": "gainde_registration",
  "customs.validation": "transit_validation",
  "customs.bae": "customs_field_clearance",
  "customs.release": "customs_field_clearance",
  // ---- Finance (per-dossier panel) -------------------------------------
  "finance.invoice_create": "billing_draft",
  "finance.invoice_update": "billing_draft",
  "finance.invoice_issue": "billing_dispatch",
};

/** The step states in which a control may be exercised. */
const ACTIONABLE: readonly StepState[] = ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"];

/**
 * NOT ACTIONABLE YET — as opposed to not actionable ANY MORE.
 *
 * UI-1. Both were reported as `step_closed`, so a step the workflow simply had
 * not reached yet told the operator « L'étape correspondante du processus
 * officiel est terminée ou n'est plus ouverte. » — that it was FINISHED. On the
 * UAT dossier the Déclarant read that sentence about work nobody had started,
 * and reasonably concluded the platform had lost the step.
 *
 * `step_not_started` already covers the case where no execution row exists at
 * all. This covers the case where the row exists and is waiting its turn, which
 * is the ordinary state of 25 steps out of 26 and had no words of its own.
 */
const NOT_YET_OPEN: readonly StepState[] = ["PENDING"];

export type ControlGateInput = {
  /** null when the dossier has no process instance (see compatibility path). */
  step: { state: StepState; assignedUserId: string | null } | null;
  /** true when the dossier has an instance at all. */
  hasInstance: boolean;
  userId: string;
  /**
   * UAT-WF-STEP67-01 — the live state of the PREPARER step, when the control's
   * owning step is the VALIDATOR half of a maker-checker pair. Absent (and
   * ignored) for every other control.
   *
   * WHY THIS FACT BELONGS HERE. A validator step's execution row can never be
   * open at the moment its checker is meant to act. Its prerequisite is the
   * preparer step, `prerequisitesMet` demands the preparer be DONE, and the
   * preparer only becomes COMPLETED when `approveStep` — the checker's own act
   * — lands. So `promoteSuccessors` never promotes it and the row sits PENDING
   * through the whole review, exactly as the engine intends: `approveStep`
   * deliberately asks nothing about the validator row and everything about the
   * preparer being SUBMITTED.
   *
   * The gate asked the other question. It read the validator row, found
   * PENDING, and refused every checker control with « Cette étape n'est pas
   * encore ouverte. » — permanently. On EFT-IMP-2026-00011 that stopped the
   * Chef de Transit from validating a customs dossier the Déclarant had
   * already submitted, with no other surface able to reach `approveStep`.
   *
   * A SUBMITTED preparer is therefore what makes a checker control actionable,
   * and it is a NARROWING of nothing: the control still needs its permission,
   * still needs the pair's own step, and self-validation is still refused by
   * `evaluateMakerChecker`, by the action and by the RPC.
   */
  preparerState?: StepState | null;
};

export type ControlGateResult =
  | { allowed: true; reason: "no_process_instance" | "step_open" | "review_pending" }
  | {
      allowed: false;
      reason: "step_not_started" | "step_not_open" | "step_closed" | "assigned_to_another";
    };

/**
 * May this actor exercise this control right now? PURE — no I/O, fully testable.
 *
 * Order matters and is deliberate:
 *   • no instance          -> defer to permission (compatibility path)
 *   • step row absent      -> the step has not been reached: BLOCK
 *   • step waiting its turn -> BLOCK, and say NOT YET (UI-1)
 *   • step not actionable  -> done, skipped, rejected or cancelled: BLOCK
 *   • step claimed by someone else -> BLOCK (assignment narrowing)
 */
export function evaluateControlGate(input: ControlGateInput): ControlGateResult {
  if (!input.hasInstance) return { allowed: true, reason: "no_process_instance" };
  if (!input.step) return { allowed: false, reason: "step_not_started" };

  // UAT-WF-STEP67-01 — a checker control whose maker has SUBMITTED. See
  // `preparerState` above for why the validator row is PENDING at exactly this
  // moment and can never be anything else. Only PENDING qualifies: a validator
  // row that is COMPLETED, REJECTED, SKIPPED or CANCELLED is a finished review
  // and stays `step_closed`.
  const reviewPending =
    input.preparerState === "SUBMITTED" && NOT_YET_OPEN.includes(input.step.state);

  if (!reviewPending && !ACTIONABLE.includes(input.step.state)) {
    // UI-1 — "not yet" and "no longer" are different facts and get different
    // sentences. Conflating them told operators that untouched work was done.
    return NOT_YET_OPEN.includes(input.step.state)
      ? { allowed: false, reason: "step_not_open" }
      : { allowed: false, reason: "step_closed" };
  }
  if (input.step.assignedUserId !== null && input.step.assignedUserId !== input.userId) {
    return { allowed: false, reason: "assigned_to_another" };
  }
  return { allowed: true, reason: reviewPending ? "review_pending" : "step_open" };
}

/**
 * Operator-facing refusals, in French. Never leaks another user's identity.
 *
 * ⚠ These existed from the start and were rendered NOWHERE. Every refusal
 * reached the customs panel as `step_gate_<reason>`, matched no key in its error
 * map, and fell through to « L'action a échoué. Veuillez réessayer. » — so the
 * platform knew precisely why it had refused and told the operator nothing.
 * `stepGateMessageFr` below is the accessor that ends that; surfaces resolve
 * through it rather than copying these strings.
 */
export const CONTROL_GATE_MESSAGE_FR: Record<string, string> = {
  step_not_started:
    "Cette action n'est pas encore ouverte dans le processus officiel du dossier.",
  // UI-1 — the step exists and is waiting its turn. Said in the operator's own
  // terms, without implying that anything was done or lost.
  step_not_open:
    "Cette étape n'est pas encore ouverte.",
  step_closed:
    "L'étape correspondante du processus officiel est terminée ou n'est plus ouverte.",
  assigned_to_another:
    "Cette étape est prise en charge par un autre intervenant.",
  // OPS-CUSTOMS-OWNERSHIP-01 — the step is open and unclaimed, but the work
  // belongs to another role. Names the ROLE's responsibility, never a person:
  // the reader must not learn who else could act from a refusal.
  not_owning_role:
    "Cette action relève du rôle responsable de cette étape.",
};

export function controlGateError(reason: ControlGateResult["reason"]): string {
  if (reason === "no_process_instance" || reason === "step_open" || reason === "review_pending") {
    return "forbidden";
  }
  return `step_gate_${reason}`;
}

/** The error code a refused ownership check returns, in the same vocabulary. */
export const CONTROL_OWNERSHIP_ERROR = "step_gate_not_owning_role";

/**
 * The French sentence for a `step_gate_*` error code, or null when the code is
 * not one. ONE resolver for both the disabled-control hint and the failure
 * line, so a control cannot explain itself one way before the click and another
 * way after it.
 */
export function stepGateMessageFr(code: string | null | undefined): string | null {
  if (typeof code !== "string" || !code.startsWith("step_gate_")) return null;
  return CONTROL_GATE_MESSAGE_FR[code.slice("step_gate_".length)] ?? null;
}
