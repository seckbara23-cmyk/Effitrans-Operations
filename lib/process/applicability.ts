/**
 * Step applicability by dossier type (Phase 9.0B) — PURE, definition-driven.
 * ---------------------------------------------------------------------------
 * THE deterministic source for "which official steps do not apply to this
 * dossier". The registry itself is untouched (its keys are a frozen contract);
 * this module declares the exceptions, mirroring the precedent the registry
 * already set: the PICKUP_READINESS gate exempts its `customs_released`
 * requirement for TRP/HND (`appliesToFileTypes: ["IMP","EXP"]`), and the engine
 * types file documents SKIPPED as "customs for a TRP/HND dossier".
 *
 * v1 scope — the CUSTOMS LEG ONLY. A TRP (road transport) or HND (handling)
 * dossier carries no customs declaration, so every customs-specific step is
 * inapplicable. Steps that are generic Transit work (coordinator_reception,
 * step 4) apply to every dossier and are NOT listed. Team-specific skips
 * (Maritime-only vs AIBD-only field steps) and "no delivery transport
 * purchased" skips are dossier-CONDITION-driven, not type-driven — they stay
 * MANUAL skips until Phase 9.0D dispatch data makes them derivable.
 *
 * Every key here is validated against the registry by tests — an unknown key
 * fails CI, so this map cannot silently drift from the step registry.
 */
import type { ExecutionView } from "./engine/state";

/** Dossier types carrying a customs leg (operational_file.type vocabulary). */
export const CUSTOMS_LEG_FILE_TYPES = ["IMP", "EXP"] as const;

/**
 * Step keys that ONLY apply to the listed dossier types. Absent key = the step
 * applies to every type.
 */
export const STEP_APPLICABILITY: Readonly<Record<string, readonly string[]>> = {
  // The customs chain, steps 5-13: assigning a déclarant, preparing/validating
  // the declaration, GAINDE registration and deposit, customs follow-up, BAE.
  transit_declarant_assignment: CUSTOMS_LEG_FILE_TYPES,
  customs_preparation: CUSTOMS_LEG_FILE_TYPES,
  transit_validation: CUSTOMS_LEG_FILE_TYPES,
  coordinator_to_finance: CUSTOMS_LEG_FILE_TYPES,
  gainde_registration: CUSTOMS_LEG_FILE_TYPES,
  coordinator_to_declarant: CUSTOMS_LEG_FILE_TYPES,
  gainde_document_submission: CUSTOMS_LEG_FILE_TYPES,
  customs_followup: CUSTOMS_LEG_FILE_TYPES,
  customs_field_clearance: CUSTOMS_LEG_FILE_TYPES,
} as const;

/** Does this step apply to a dossier of the given type? Unknown steps apply. */
export function stepAppliesToFileType(stepKey: string, fileType: string): boolean {
  const only = STEP_APPLICABILITY[stepKey];
  return !only || only.includes(fileType);
}

/** The step keys that are definitionally inapplicable for a dossier type. */
export function inapplicableStepsFor(fileType: string): string[] {
  return Object.keys(STEP_APPLICABILITY).filter((k) => !stepAppliesToFileType(k, fileType));
}

/**
 * Which of a dossier's LIVE executions may be definition-skipped right now:
 * inapplicable by type AND still in a skippable state (PENDING/AVAILABLE —
 * exactly the states the pure transition table allows into SKIPPED). Work that
 * already started is never silently discarded by a definition rule.
 */
export function definitionSkippableSteps(fileType: string, executions: ExecutionView[]): string[] {
  const inapplicable = new Set(inapplicableStepsFor(fileType));
  return executions
    .filter((e) => inapplicable.has(e.stepKey) && (e.state === "PENDING" || e.state === "AVAILABLE"))
    .map((e) => e.stepKey);
}
