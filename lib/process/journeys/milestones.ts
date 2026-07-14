/**
 * The compact internal journey (Phase 5.0E-3, Deliverable 5). PURE.
 * ---------------------------------------------------------------------------
 * Fifteen milestones over the twenty-six official steps.
 *
 * THIS IS NOT A SECOND PROCESS DEFINITION. It is a GROUPING: each milestone owns a
 * list of official step KEYS, and every key is validated against the canonical
 * registry at module load. A step cannot belong to two milestones and cannot belong
 * to none — `tests/journeys.test.ts` asserts the partition covers all 26 exactly once.
 * If someone amends the official process, this file fails loudly rather than quietly
 * describing a process that no longer exists.
 *
 * It exists because twenty-six rows is a document, not a visualization. Nobody scans
 * a dossier list and reads twenty-six states; they want to know "customs or transport,
 * and is it stuck". Fifteen is the granularity a Coordinator actually thinks in.
 *
 * The milestone STATE is derived from the step executions underneath it, never stored.
 */
import { EFFITRANS_PROCESS, getStep } from "../effitrans-process";

export type MilestoneState =
  /** Every step under it is done. */
  | "completed"
  /** At least one step is live (ACTIVE / AVAILABLE / SUBMITTED). */
  | "active"
  /** Live, but a prerequisite or a piece of evidence is missing. */
  | "blocked"
  /** A step here was rejected and is being corrected. */
  | "rejected"
  /** Not reached yet. */
  | "pending";

export type Milestone = {
  key: string;
  labelFr: string;
  /** Official step keys, in order. The ONLY link to the canonical registry. */
  stepKeys: string[];
  /** Which parallel branch this milestone sits on, if any. */
  branch: "customs" | "transport" | null;
};

export const JOURNEY_MILESTONES: Milestone[] = [
  { key: "cotation", labelFr: "Cotation", stepKeys: ["cotation"], branch: null },
  {
    key: "ouverture",
    labelFr: "Ouverture du dossier",
    stepKeys: ["operations_intake", "am_dossier_opening", "coordinator_reception"],
    branch: null,
  },
  {
    key: "prep_douane",
    labelFr: "Préparation Douane",
    stepKeys: ["transit_declarant_assignment", "customs_preparation"],
    branch: "customs",
  },
  {
    key: "validation_transit",
    labelFr: "Validation Transit",
    stepKeys: ["transit_validation"],
    branch: "customs",
  },
  {
    key: "gainde",
    labelFr: "GAINDE",
    stepKeys: [
      "coordinator_to_finance",
      "gainde_registration",
      "coordinator_to_declarant",
      "gainde_document_submission",
    ],
    branch: "customs",
  },
  {
    key: "terrain_douane",
    labelFr: "Terrain Douane",
    stepKeys: ["customs_followup", "customs_field_clearance"],
    branch: "customs",
  },
  {
    key: "prep_transport",
    labelFr: "Préparation Transport",
    stepKeys: ["transport_assignment"],
    branch: "transport",
  },
  { key: "enlevement", labelFr: "Enlèvement", stepKeys: ["pickup"], branch: null },
  {
    key: "livraison",
    labelFr: "Livraison",
    stepKeys: ["am_delivery_followup", "transport_pod_handoff"],
    branch: null,
  },
  {
    key: "completude",
    labelFr: "Complétude",
    stepKeys: ["coordinator_completeness", "am_completeness"],
    branch: null,
  },
  { key: "facturation", labelFr: "Facturation", stepKeys: ["billing_draft"], branch: null },
  {
    key: "validation_finance",
    labelFr: "Validation Finance",
    stepKeys: ["finance_invoice_validation", "billing_dispatch"],
    branch: null,
  },
  {
    key: "depot_physique",
    labelFr: "Dépôt physique",
    stepKeys: ["administration_deposit_prep", "courier_deposit", "administration_proof_handoff"],
    branch: null,
  },
  { key: "recouvrement", labelFr: "Recouvrement", stepKeys: ["collections"], branch: null },
  // Closure is NOT step 26. Recovery completing does not close a dossier — only an
  // explicit process:close act by a Supervisor does. It has no steps beneath it,
  // deliberately: it is a state of the INSTANCE, not of any step.
  { key: "cloture", labelFr: "Clôture", stepKeys: [], branch: null },
];

// --- integrity, enforced at module load -------------------------------------
// A grouping that silently stopped covering the process would be worse than no
// grouping: it would show a confident, incomplete picture.
{
  const owned = JOURNEY_MILESTONES.flatMap((m) => m.stepKeys);
  const seen = new Set<string>();
  for (const k of owned) {
    if (!getStep(k)) throw new Error(`journey milestone references unknown step: ${k}`);
    if (seen.has(k)) throw new Error(`step ${k} belongs to two milestones`);
    seen.add(k);
  }
  for (const s of EFFITRANS_PROCESS) {
    if (!seen.has(s.key)) throw new Error(`step ${s.key} belongs to no milestone`);
  }
}

const MILESTONE_OF = new Map<string, string>();
for (const m of JOURNEY_MILESTONES) {
  for (const k of m.stepKeys) MILESTONE_OF.set(k, m.key);
}

/** Which milestone an official step rolls up to. */
export function milestoneForStep(stepKey: string): string | null {
  return MILESTONE_OF.get(stepKey) ?? null;
}

export type StepStateLite = { stepKey: string; state: string };

const DONE = new Set(["COMPLETED", "APPROVED"]);
const LIVE = new Set(["ACTIVE", "AVAILABLE", "SUBMITTED"]);

/**
 * Roll the step executions up into the fifteen milestone states.
 *
 * `blockedSteps` are step keys the caller has already determined to be blocked (a
 * prerequisite or an evidence gap) — we do not re-derive that here, because the
 * engine's evaluation is the authority and a second one would eventually disagree
 * with it.
 */
export function milestoneStates(
  executions: StepStateLite[],
  blockedSteps: string[] = [],
): { key: string; labelFr: string; state: MilestoneState; branch: Milestone["branch"] }[] {
  const byStep = new Map<string, string[]>();
  for (const e of executions) {
    byStep.set(e.stepKey, [...(byStep.get(e.stepKey) ?? []), e.state]);
  }
  const blocked = new Set(blockedSteps);

  return JOURNEY_MILESTONES.map((m) => {
    // Clôture has no steps: it reflects the instance, and the caller supplies it.
    if (m.stepKeys.length === 0) {
      return { key: m.key, labelFr: m.labelFr, state: "pending" as MilestoneState, branch: m.branch };
    }

    const states = m.stepKeys.flatMap((k) => byStep.get(k) ?? []);

    let state: MilestoneState;
    if (states.length === 0) {
      state = "pending";
    } else if (states.some((s) => s === "REJECTED")) {
      // A rejection outranks everything: someone is redoing work, and that is the
      // single most useful thing to know about this milestone.
      state = "rejected";
    } else if (m.stepKeys.some((k) => blocked.has(k))) {
      state = "blocked";
    } else if (states.some((s) => LIVE.has(s))) {
      state = "active";
    } else if (m.stepKeys.every((k) => (byStep.get(k) ?? []).some((s) => DONE.has(s)))) {
      state = "completed";
    } else {
      state = "active";
    }

    return { key: m.key, labelFr: m.labelFr, state, branch: m.branch };
  });
}
