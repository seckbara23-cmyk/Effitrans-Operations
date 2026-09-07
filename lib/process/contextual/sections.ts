/**
 * Which part of the dossier page each official step belongs beside. PURE.
 * ---------------------------------------------------------------------------
 * THE PRINCIPLE: proximity to the work. A Déclarant's preparation belongs in the
 * Dédouanement section he is already reading, not at the top of the page and not
 * on a second screen. The whole 26-step process stays on `/process`; this decides
 * where the one or two steps that concern a reader are SHOWN.
 *
 * IT GRANTS NOTHING. A step appearing in a section does not make it performable:
 * `evaluateStepAction` decides that, and the server actions refuse regardless. A
 * wrong entry here misplaces a card; it cannot create authority.
 *
 * EVERY registry node is placed, and a test proves it — an unplaced step would
 * simply never appear on the dossier, which looks exactly like a step that does
 * not exist.
 */

export type DossierSection =
  /** Dossier header — Operations' own work and the process entry points. */
  | "operations"
  /** Responsable client / Account Manager block. */
  | "commercial"
  /** Coordination Transit — receptions and the handoffs between departments. */
  | "coordination"
  /** Dédouanement — preparation, Chef validation, GAINDE, rattachement, BAE. */
  | "customs"
  /** Transport — assignment, enlèvement, POD. */
  | "transport"
  /** Livraison / BAD / Pre-Gate — the Account Manager's logistics coordination. */
  | "delivery"
  /** Facturation and the downstream financial chain. */
  | "finance";

/**
 * step key -> section. Exhaustive over the registry.
 *
 * The Finance customs officer's step 9 sits in CUSTOMS, not in Facturation:
 * ratified 2026-09-06, Finance's customs operation and downstream billing are
 * distinct, and the operator performing it is reading the Dédouanement section.
 */
export const STEP_SECTION: Record<string, DossierSection> = {
  // ---- Operations --------------------------------------------------------
  cotation: "operations",
  operations_intake: "operations",

  // ---- Responsable client ------------------------------------------------
  am_dossier_opening: "commercial",
  am_completeness: "commercial",

  // ---- Coordination Transit ---------------------------------------------
  coordinator_reception: "coordination",
  transit_declarant_assignment: "coordination",
  coordinator_to_finance: "coordination",
  coordinator_to_declarant: "coordination",
  customs_followup: "coordination",
  coordinator_completeness: "coordination",
  transport_docs_transmission: "coordination",

  // ---- Dédouanement ------------------------------------------------------
  customs_preparation: "customs",
  transit_validation: "customs",
  gainde_registration: "customs",
  gainde_document_submission: "customs",
  customs_field_clearance: "customs",

  // ---- Transport ---------------------------------------------------------
  transport_assignment: "transport",
  pickup: "transport",
  transport_pod_handoff: "transport",

  // ---- Livraison / BAD / Pre-Gate ---------------------------------------
  bon_a_delivrer: "delivery",
  pre_gate: "delivery",
  am_delivery_followup: "delivery",

  // ---- Facturation and downstream ---------------------------------------
  billing_draft: "finance",
  finance_invoice_validation: "finance",
  billing_dispatch: "finance",
  administration_deposit_prep: "finance",
  courier_deposit: "finance",
  administration_proof_handoff: "finance",
  collections: "finance",
};

/** Where this step is shown, or null when the registry does not place it. */
export function sectionFor(stepKey: string): DossierSection | null {
  return STEP_SECTION[stepKey] ?? null;
}
