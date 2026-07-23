/**
 * Canonical lifecycle ↔ step-key validation registry (Phase 9.0B) — PURE.
 * ---------------------------------------------------------------------------
 * Pins the approved 20-stage dossier lifecycle (docs/workflow/
 * phase-9-dossier-workflow-architecture.md §5) and the Transit source workflow
 * T1–T10 (docs/business-processes/Guide_Processus_Transit.pdf +
 * Tableau_Coordination_Transit.pdf) onto the EXISTING 26-step registry — with
 * REAL step keys, machine-validated by tests. This is a MAPPING, never a second
 * state machine: the engine's registry, transitions and gates remain the only
 * runtime truth; this file exists so a lifecycle stage can never silently point
 * at a step that does not exist, and so registry changes that would orphan a
 * canonical stage fail CI.
 *
 * Two stages are MECHANISMS, not steps: the missing-document return is the
 * engine's correction/rejection machinery (rejectsTo + correction_of_id), and
 * final closure is the closeDossier action over the closure evaluator. They map
 * to `mechanism`, with no step keys — a validation contract must not invent
 * steps the registry deliberately models otherwise.
 */
import { ALL_NODE_KEYS } from "./engine/state";
import { STEP_APPLICABILITY } from "./applicability";

export type LifecycleMechanism = "correction_return" | "closure_action";

export type LifecycleStage = {
  /** 1..20 — the approved canonical ordering. */
  stage: number;
  key: string;
  labelFr: string;
  /** Registry step keys realizing this stage (may overlap between stages). */
  stepKeys: readonly string[];
  /** Step keys that participate only in some dossiers (cotation, deposit chain…). */
  optionalStepKeys?: readonly string[];
  /** For stages realized by an engine MECHANISM rather than steps. */
  mechanism?: LifecycleMechanism;
  /** Stage only applies to dossiers with a customs leg (IMP/EXP). */
  customsLegOnly?: boolean;
};

export const CANONICAL_LIFECYCLE: readonly LifecycleStage[] = [
  { stage: 1, key: "opening", labelFr: "Ouverture du dossier par Operations", stepKeys: ["operations_intake", "am_dossier_opening"], optionalStepKeys: ["cotation"] },
  { stage: 2, key: "transfer_to_transit", labelFr: "Transmission du travail au Transit", stepKeys: ["coordinator_reception"] },
  { stage: 3, key: "transit_reception", labelFr: "Réception Transit et vérification sommaire", stepKeys: ["coordinator_reception", "transit_declarant_assignment"] },
  { stage: 4, key: "document_analysis", labelFr: "Analyse documentaire et conformité (ORBUS / GRED)", stepKeys: ["customs_preparation"], customsLegOnly: true },
  { stage: 5, key: "missing_document_return", labelFr: "Retour document manquant via Operations / Account Manager", stepKeys: [], mechanism: "correction_return" },
  { stage: 6, key: "declaration_preparation", labelFr: "Préparation de la déclaration par le Déclarant (manifeste, note de détail, saisie GAINDE)", stepKeys: ["customs_preparation"], customsLegOnly: true },
  { stage: 7, key: "chief_validation", labelFr: "Contrôle, validation et signature du Chef de Transit", stepKeys: ["transit_validation"], customsLegOnly: true },
  { stage: 8, key: "finance_registration", labelFr: "Intervention Finance — enregistrement / paiement", stepKeys: ["coordinator_to_finance", "gainde_registration"], customsLegOnly: true },
  { stage: 9, key: "attachment_verification", labelFr: "Vérification du rattachement via liens électroniques", stepKeys: ["coordinator_to_declarant"], customsLegOnly: true },
  { stage: 10, key: "declaration_filing_followup", labelFr: "Dépôt de la déclaration et suivi douanier", stepKeys: ["gainde_document_submission", "customs_followup"], customsLegOnly: true },
  { stage: 11, key: "bae_acquisition", labelFr: "Obtention du BAE (Bon à Enlever)", stepKeys: ["customs_field_clearance"], customsLegOnly: true },
  { stage: 12, key: "field_dispatch", labelFr: "Dispatch vers AIBD ou Maritime", stepKeys: ["transport_assignment"] },
  { stage: 13, key: "field_operations", labelFr: "Opérations terrain (visite, enlèvement, sortie)", stepKeys: ["pickup"], optionalStepKeys: ["bon_a_delivrer", "pre_gate", "transport_docs_transmission"] },
  { stage: 14, key: "transport_coordination", labelFr: "Coordination transport et suivi livraison", stepKeys: ["am_delivery_followup"] },
  { stage: 15, key: "evidence_recovery", labelFr: "Récupération des justificatifs (BL signé, preuves)", stepKeys: ["transport_pod_handoff"] },
  { stage: 16, key: "final_control", labelFr: "Contrôle final par le Coordinateur Operations", stepKeys: ["coordinator_completeness", "am_completeness"] },
  { stage: 17, key: "transmission_invoicing", labelFr: "Transmission à la Finance pour facturation", stepKeys: ["billing_draft"] },
  { stage: 18, key: "invoice_issuance", labelFr: "Émission et envoi de la facture", stepKeys: ["finance_invoice_validation", "billing_dispatch"] },
  { stage: 19, key: "payment_confirmation", labelFr: "Confirmation du paiement client", stepKeys: ["collections"], optionalStepKeys: ["administration_deposit_prep", "courier_deposit", "administration_proof_handoff"] },
  { stage: 20, key: "final_closure", labelFr: "Clôture finale du dossier", stepKeys: [], mechanism: "closure_action" },
] as const;

/**
 * Transit source workflow T1–T10 (Tableau de Bord — Coordination Transit),
 * terminology preserved, mapped onto registry keys. T3 (relation client en cas
 * de manque) is the correction mechanism, like lifecycle stage 5.
 */
export type TransitSourceStep = {
  key: `T${number}`;
  labelFr: string;
  stepKeys: readonly string[];
  mechanism?: LifecycleMechanism;
};

export const TRANSIT_SOURCE_MAP: readonly TransitSourceStep[] = [
  { key: "T1", labelFr: "Réception, vérification sommaire et cotation", stepKeys: ["cotation", "coordinator_reception"] },
  { key: "T2", labelFr: "Analyse, conformité documentaire, ORBUS / GRED", stepKeys: ["customs_preparation"] },
  { key: "T3", labelFr: "Relation client en cas de manque (Account Manager)", stepKeys: [], mechanism: "correction_return" },
  { key: "T4", labelFr: "Préparation et saisie (manifeste, note de détail, GAINDE)", stepKeys: ["customs_preparation"] },
  { key: "T5", labelFr: "Contrôle, validation et signature du devis", stepKeys: ["transit_validation"] },
  { key: "T6", labelFr: "Intervention Finance (enregistrement)", stepKeys: ["coordinator_to_finance", "gainde_registration"] },
  { key: "T7", labelFr: "Vérification du rattachement électronique", stepKeys: ["coordinator_to_declarant"] },
  { key: "T8", labelFr: "Dépôt, suivi des observations et obtention du BAE", stepKeys: ["gainde_document_submission", "customs_followup", "customs_field_clearance"] },
  { key: "T9", labelFr: "Dispatch terrain (Maritime / AIBD / Transport)", stepKeys: ["transport_assignment"] },
  { key: "T10", labelFr: "Exécution terrain et collecte des preuves", stepKeys: ["pickup", "transport_pod_handoff"] },
] as const;

/**
 * Closure requires EVERY registry node done or deliberately skipped — that is
 * the closure evaluator's existing rule (engine/state.ts
 * evaluateClosureReadiness), restated here as a declared contract rather than
 * an implicit behavior. Mode-conditional steps come from ONE source: the
 * applicability registry.
 */
export const CLOSURE_REQUIRED_STEP_KEYS: readonly string[] = ALL_NODE_KEYS;
export const MODE_CONDITIONAL_STEP_KEYS: readonly string[] = Object.keys(STEP_APPLICABILITY);

export type LifecycleValidationProblem = { where: string; problem: string };

/**
 * Machine validation: unknown keys, empty stages, coverage. Run by tests — a
 * registry change that orphans a canonical stage, or a mapping typo, fails CI.
 */
export function validateLifecycleMap(): LifecycleValidationProblem[] {
  const problems: LifecycleValidationProblem[] = [];
  const known = new Set(ALL_NODE_KEYS);

  const checkKeys = (where: string, keys: readonly string[]) => {
    for (const k of keys) {
      if (!known.has(k)) problems.push({ where, problem: `unknown step key "${k}"` });
    }
  };

  const seen = new Set<number>();
  for (const stage of CANONICAL_LIFECYCLE) {
    if (seen.has(stage.stage)) problems.push({ where: stage.key, problem: `duplicate stage number ${stage.stage}` });
    seen.add(stage.stage);
    checkKeys(`lifecycle:${stage.key}`, stage.stepKeys);
    checkKeys(`lifecycle:${stage.key}`, stage.optionalStepKeys ?? []);
    if (stage.stepKeys.length === 0 && !stage.mechanism) {
      problems.push({ where: stage.key, problem: "stage has neither step keys nor a mechanism" });
    }
  }

  for (const t of TRANSIT_SOURCE_MAP) {
    checkKeys(`transit:${t.key}`, t.stepKeys);
    if (t.stepKeys.length === 0 && !t.mechanism) {
      problems.push({ where: t.key, problem: "Transit step has neither step keys nor a mechanism" });
    }
  }

  // COVERAGE: every registry node must be reachable from the canonical lifecycle
  // (required or optional) — a step no stage owns is unrouted work.
  const covered = new Set<string>();
  for (const stage of CANONICAL_LIFECYCLE) {
    for (const k of stage.stepKeys) covered.add(k);
    for (const k of stage.optionalStepKeys ?? []) covered.add(k);
  }
  for (const k of ALL_NODE_KEYS) {
    if (!covered.has(k)) problems.push({ where: "coverage", problem: `registry step "${k}" is mapped to no lifecycle stage` });
  }

  for (const k of MODE_CONDITIONAL_STEP_KEYS) {
    if (!known.has(k)) problems.push({ where: "applicability", problem: `applicability declares unknown step "${k}"` });
  }

  return problems;
}
