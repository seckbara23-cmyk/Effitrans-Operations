/**
 * Transit execution read-model (Phase 9.0D) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * THE mapping of the source-approved Transit workflow T1–T10
 * (docs/business-processes/Guide_Processus_Transit.pdf +
 * Tableau_Coordination_Transit.pdf) onto the EXISTING frozen 26-step registry,
 * plus the pure rules the Transit UI/actions need: per-stage status derivation,
 * deterministic field-team dispatch by transport mode, and the internal →
 * customer-safe stage vocabulary.
 *
 * This is a READ-MODEL and a set of PURE RULES, never a second state machine:
 * the engine's registry, transitions and gates stay the only runtime truth
 * (lib/process/engine/*). Nothing here persists anything, invents a step key,
 * or duplicates the lifecycle map — it reuses TRANSIT_SOURCE_MAP's terminology
 * and the registry's real keys so a stage can never point at a step that does
 * not exist (tests validate every key against the registry).
 */
import { isDone, isOpen, type StepState } from "./engine/types";

// ============================================================ T1–T10 stages ====

/** Per-stage rollup status, derived purely from the live step executions. */
export type TransitStageStatus = "pending" | "active" | "blocked" | "done";

/**
 * The seven customer-safe stages the business names (Workflow PDF §customer
 * view). Display vocabulary only — actual customer pings reuse the existing
 * notification events, and the portal timeline is unchanged. NOT a persistent
 * store, so nothing here can leak an internal step key or a UUID to a customer.
 */
export type CustomerSafeStage =
  | "documents_verification"
  | "customer_action_required"
  | "declaration_preparation"
  | "declaration_filed"
  | "customs_formalities"
  | "authorization_obtained"
  | "pickup_preparation";

export const CUSTOMER_SAFE_STAGE_LABELS: Readonly<Record<CustomerSafeStage, string>> = {
  documents_verification: "Documents en vérification",
  customer_action_required: "Action client requise",
  declaration_preparation: "Déclaration en préparation",
  declaration_filed: "Déclaration déposée",
  customs_formalities: "Formalités douanières en cours",
  authorization_obtained: "Autorisation obtenue",
  pickup_preparation: "Enlèvement en préparation",
};

export type TransitStage = {
  /** Stage identity — the source T-number, terminology preserved. */
  key: `T${number}`;
  labelFr: string;
  /** Who owns this stage (business responsibility, French). */
  responsibleFr: string;
  /** Registry step keys realizing this stage (empty = an engine MECHANISM). */
  stepKeys: readonly string[];
  /** True when this stage is the correction/return mechanism, not steps. */
  mechanism?: boolean;
  /** Customer-safe stage this rolls up to, or null (internal-only). */
  customerStage: CustomerSafeStage | null;
};

/**
 * The Transit execution sequence. stepKeys reuse TRANSIT_SOURCE_MAP + the
 * frozen registry EXACTLY; the customerStage column reuses the display
 * vocabulary above. Validated against the registry by tests.
 */
export const TRANSIT_STAGES: readonly TransitStage[] = [
  {
    key: "T1",
    labelFr: "Réception, vérification sommaire et cotation",
    responsibleFr: "Chef de Transit",
    stepKeys: ["coordinator_reception"],
    customerStage: "documents_verification",
  },
  {
    key: "T2",
    labelFr: "Analyse, conformité documentaire, ORBUS / GRED",
    responsibleFr: "Déclarant en douane",
    stepKeys: ["transit_declarant_assignment", "customs_preparation"],
    customerStage: "documents_verification",
  },
  {
    key: "T3",
    labelFr: "Relation client en cas de manque (Account Manager)",
    responsibleFr: "Account Manager / Opérations",
    stepKeys: [],
    mechanism: true,
    customerStage: "customer_action_required",
  },
  {
    key: "T4",
    labelFr: "Préparation et saisie (manifeste, note de détail, GAINDE)",
    responsibleFr: "Déclarant en douane",
    stepKeys: ["customs_preparation"],
    customerStage: "declaration_preparation",
  },
  {
    key: "T5",
    labelFr: "Contrôle, validation et signature (Chef de Transit)",
    responsibleFr: "Chef de Transit",
    stepKeys: ["transit_validation"],
    customerStage: "declaration_preparation",
  },
  {
    key: "T6",
    labelFr: "Intervention Finance (enregistrement)",
    responsibleFr: "Finance / Coordinateur",
    stepKeys: ["coordinator_to_finance", "gainde_registration"],
    customerStage: "declaration_filed",
  },
  {
    key: "T7",
    labelFr: "Vérification du rattachement électronique",
    responsibleFr: "Déclarant en douane",
    stepKeys: ["coordinator_to_declarant"],
    customerStage: "customs_formalities",
  },
  {
    key: "T8",
    labelFr: "Dépôt, suivi des observations et obtention du BAE",
    responsibleFr: "Déclarant / Coordinateur Transit",
    stepKeys: ["gainde_document_submission", "customs_followup", "customs_field_clearance"],
    customerStage: "customs_formalities",
  },
  {
    key: "T9",
    labelFr: "Dispatch terrain (Maritime / AIBD / Transport)",
    responsibleFr: "Coordinateur Transit",
    stepKeys: ["transport_assignment"],
    customerStage: "pickup_preparation",
  },
  {
    key: "T10",
    labelFr: "Exécution terrain et collecte des preuves",
    responsibleFr: "Coordinateur Transit",
    stepKeys: ["pickup", "transport_pod_handoff"],
    customerStage: "pickup_preparation",
  },
] as const;

/** Every registry step key any Transit stage owns (for coverage validation). */
export const TRANSIT_STAGE_STEP_KEYS: readonly string[] = Array.from(
  new Set(TRANSIT_STAGES.flatMap((s) => s.stepKeys)),
);

/** The live step-state a Transit stage rollup needs. */
export type TransitExecutionView = { stepKey: string; state: StepState };

export type TransitStageView = TransitStage & {
  status: TransitStageStatus;
  /** True once the BAE authorization stage (T8 customs_field_clearance) is done. */
};

/**
 * Derive each Transit stage's rollup status from the live executions. PURE.
 *
 *   done    — every mapped step is done (COMPLETED / APPROVED / SKIPPED)
 *   blocked — a mapped step is BLOCKED
 *   active  — a mapped step is open (AVAILABLE / ACTIVE / SUBMITTED)
 *   pending — mapped steps exist but none are open and not all are done
 *
 * The T3 correction MECHANISM has no steps; its status is supplied separately
 * (an open correction blocker) by the caller, so here it stays "pending".
 */
export function deriveTransitStages(executions: TransitExecutionView[]): TransitStageView[] {
  const byKey = new Map<string, StepState>();
  for (const e of executions) byKey.set(e.stepKey, e.state);

  return TRANSIT_STAGES.map((stage) => {
    if (stage.stepKeys.length === 0) return { ...stage, status: "pending" as TransitStageStatus };

    const states = stage.stepKeys.map((k) => byKey.get(k)).filter((s): s is StepState => Boolean(s));
    if (states.length === 0) return { ...stage, status: "pending" as TransitStageStatus };

    let status: TransitStageStatus;
    if (states.every((s) => isDone(s))) status = "done";
    else if (states.some((s) => s === "BLOCKED")) status = "blocked";
    else if (states.some((s) => isOpen(s))) status = "active";
    else status = "pending";
    return { ...stage, status };
  });
}

// ============================================================ field dispatch ====

export type TransitTeamCode = "AIBD" | "MARITIME";

/**
 * The field team a dossier dispatches to, deterministic from transport mode:
 * air → AIBD, sea → Maritime. Road, handling-only and multimodal are
 * deliberately AMBIGUOUS — they return null so the caller must choose
 * explicitly (an authorized manual override), never a forced guess.
 */
export function dispatchTeamForMode(
  transportMode: string | null | undefined,
  fileType: string | null | undefined,
): TransitTeamCode | null {
  // A handling-only dossier never has a customs field leg to dispatch.
  if (fileType === "HND") return null;
  switch ((transportMode ?? "").toUpperCase()) {
    case "AIR":
      return "AIBD";
    case "SEA":
    case "OCEAN":
      return "MARITIME";
    default:
      return null; // ROAD / MULTIMODAL / unknown — explicit choice required
  }
}

/** Whether a mode determines the team on its own (no manual choice needed). */
export function dispatchIsDeterministic(
  transportMode: string | null | undefined,
  fileType: string | null | undefined,
): boolean {
  return dispatchTeamForMode(transportMode, fileType) !== null;
}

// ======================================================= assignee eligibility ====

/**
 * Canonical department a Transit assignee must belong to. Assignment
 * eligibility is checked server-side against the ORGANIZATION registry
 * (roleCanonicalDepartment === "TRANSIT") — this constant names the department,
 * it never grants anything (roles/permissions stay the only authorization).
 */
export const TRANSIT_ASSIGNEE_DEPARTMENT = "TRANSIT" as const;

/** Blocker categories that represent a customer-facing "action required". */
export const CUSTOMER_ACTION_BLOCKER_CATEGORIES = [
  "MISSING_DOCUMENT",
  "CUSTOMER_RESPONSE_REQUIRED",
] as const;

/** Blocker categories a Customs observation opens. */
export const CUSTOMS_OBSERVATION_CATEGORY = "CUSTOMS_OBSERVATION" as const;
