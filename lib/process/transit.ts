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
import { custodyRefusal, routeTo, type RouteHandoffView } from "./handoff-routes";

// ============================================================ T1–T10 stages ====

/** Per-stage rollup status, derived purely from the live step executions. */
/**
 * UAT-WF-HANDOFF-01B added the two custody answers. « En cours » used to be
 * shown for any OPEN step, and AVAILABLE is open — so a step that Operations
 * had not yet transmitted, or that Transit had not yet accepted, read as work
 * in progress on the same page that said the transfer must be received first.
 * Reachable is not the same as held, and held is not the same as started.
 */
export type TransitStageStatus =
  | "pending"
  /** A governed route targets this stage and nothing has been transmitted. */
  | "awaiting_transmission"
  /** Transmitted; the receiving department has not accepted it yet. */
  | "awaiting_reception"
  /** Custody held (or never required) and the work is open but unclaimed. */
  | "available"
  /** Somebody has started it. */
  | "active"
  | "blocked"
  | "done";

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
    // H-7 — « cotation » left this label: the commercial devis is Operations'
    // (DEC-C32), and no Transit clearance-estimate act exists in the platform
    // to justify the word. What T1 actually maps is `coordinator_reception`.
    labelFr: "Réception et vérification sommaire",
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
    // ⚠ RATIFIED 2026-09-06 (DEC-C40). T7 is the DÉCLARANT's act, so it names
    // step 11 `gainde_document_submission`. It previously named ONLY step 10
    // `coordinator_to_declarant` — the Coordinator's return handoff, which is
    // what OPENS the rattachement and is not a verification. Step 10 stays
    // listed for that reason; what changed is that the verification is no
    // longer claimed to happen there.
    //
    // The platform held two live answers to this: `lifecycle-map.ts`, this file
    // and `phase-9.0d` said step 10, while migration 20260828000001 and
    // `reconcile/satisfaction.ts` had already put the rattachement FACT on step
    // 11. The divergence is preserved in the documents rather than deleted.
    key: "T7",
    labelFr: "Exécution et vérification du rattachement électronique",
    responsibleFr: "Déclarant en douane",
    stepKeys: ["coordinator_to_declarant", "gainde_document_submission"],
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
  /**
   * UAT-STEP10-HANDOFF-01 — WHICH transfer this stage is waiting on, in the
   * route's own words (« Retour de la Finance douane à la Coordination »,
   * « Transmission des Opérations au Transit », …). Null unless the status is
   * a custody one.
   *
   * The panel used to render a single hardcoded sentence, « À transmettre au
   * Transit », for every `awaiting_transmission`. Three of the four governed
   * routes have nothing to do with the Transit — T7 spans steps 10 and 11,
   * whose custody runs Finance → Coordination → Déclarant — so on
   * EFT-IMP-2026-00011 the projection announced a Transit transfer that no part
   * of the workflow was waiting for.
   */
  custodyRouteLabelFr: string | null;
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
export function deriveTransitStages(
  executions: TransitExecutionView[],
  /**
   * The dossier's handoff rows. Optional so existing callers keep working, but
   * without them a stage whose step awaits a custody transfer cannot be
   * distinguished from one being worked — which is the defect this closes.
   */
  handoffs: readonly RouteHandoffView[] = [],
): TransitStageView[] {
  const byKey = new Map<string, StepState>();
  for (const e of executions) byKey.set(e.stepKey, e.state);

  return TRANSIT_STAGES.map((stage) => {
    if (stage.stepKeys.length === 0) {
      return { ...stage, status: "pending" as TransitStageStatus, custodyRouteLabelFr: null };
    }

    const states = stage.stepKeys.map((k) => byKey.get(k)).filter((s): s is StepState => Boolean(s));
    if (states.length === 0) {
      return { ...stage, status: "pending" as TransitStageStatus, custodyRouteLabelFr: null };
    }

    let status: TransitStageStatus;
    let custodyRouteLabelFr: string | null = null;
    if (states.every((s) => isDone(s))) status = "done";
    else if (states.some((s) => s === "BLOCKED")) status = "blocked";
    else if (states.some((s) => s === "ACTIVE" || s === "SUBMITTED")) status = "active";
    else if (states.some((s) => isOpen(s))) {
      // Open but unstarted. If a governed custody route STOPS one of these
      // steps, say where the transfer stands instead of calling it progress.
      //
      // UAT-STEP10-HANDOFF-01 — asks `custodyRefusal`, not the raw state. An
      // `awaiting_transmission` on a route that does not require reception
      // stops nothing, and reporting it made T7 announce a transfer the
      // workflow was not waiting for while step 10 was perfectly startable.
      const open = stage.stepKeys.filter((k) => {
        const st = byKey.get(k);
        return st !== undefined && isOpen(st) && !isDone(st);
      });
      const stopped = open
        .map((k) => ({ key: k, refusal: custodyRefusal(k, handoffs) }))
        .filter((x) => x.refusal !== null);
      const notSent = stopped.find((x) => x.refusal === "handoff_not_sent");
      const notReceived = stopped.find((x) => x.refusal === "handoff_reception_required");
      const waiting = notSent ?? notReceived ?? null;
      if (waiting) {
        status = notSent ? "awaiting_transmission" : "awaiting_reception";
        custodyRouteLabelFr = routeTo(waiting.key)?.labelFr ?? null;
      } else status = "available";
    } else status = "pending";
    return { ...stage, status, custodyRouteLabelFr };
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
