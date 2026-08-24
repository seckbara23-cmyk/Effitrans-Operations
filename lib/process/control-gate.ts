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

export type ControlGateInput = {
  /** null when the dossier has no process instance (see compatibility path). */
  step: { state: StepState; assignedUserId: string | null } | null;
  /** true when the dossier has an instance at all. */
  hasInstance: boolean;
  userId: string;
};

export type ControlGateResult =
  | { allowed: true; reason: "no_process_instance" | "step_open" }
  | { allowed: false; reason: "step_not_started" | "step_closed" | "assigned_to_another" };

/**
 * May this actor exercise this control right now? PURE — no I/O, fully testable.
 *
 * Order matters and is deliberate:
 *   • no instance          -> defer to permission (compatibility path)
 *   • step row absent      -> the step has not been reached: BLOCK
 *   • step not actionable  -> done, skipped, rejected, or not yet open: BLOCK
 *   • step claimed by someone else -> BLOCK (assignment narrowing)
 */
export function evaluateControlGate(input: ControlGateInput): ControlGateResult {
  if (!input.hasInstance) return { allowed: true, reason: "no_process_instance" };
  if (!input.step) return { allowed: false, reason: "step_not_started" };
  if (!ACTIONABLE.includes(input.step.state)) return { allowed: false, reason: "step_closed" };
  if (input.step.assignedUserId !== null && input.step.assignedUserId !== input.userId) {
    return { allowed: false, reason: "assigned_to_another" };
  }
  return { allowed: true, reason: "step_open" };
}

/** Operator-facing refusals, in French. Never leaks another user's identity. */
export const CONTROL_GATE_MESSAGE_FR: Record<
  Exclude<ControlGateResult["reason"], "no_process_instance" | "step_open">,
  string
> = {
  step_not_started:
    "Cette action n'est pas encore ouverte dans le processus officiel du dossier.",
  step_closed:
    "L'étape correspondante du processus officiel est terminée ou n'est plus ouverte.",
  assigned_to_another:
    "Cette étape est prise en charge par un autre intervenant.",
};

export function controlGateError(reason: ControlGateResult["reason"]): string {
  if (reason === "no_process_instance" || reason === "step_open") return "forbidden";
  return `step_gate_${reason}`;
}
