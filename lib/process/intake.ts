/**
 * Operations intake validation (Phase 9.0C) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * THE typed contract for "is this dossier complete enough to open the official
 * workflow". Distinguishes BLOCKING errors (opening refused) from WARNINGS
 * (opening allowed, information recommended) — deliberately, because BL/AWB,
 * ETA and complete documents often do not exist at intake for a real freight
 * dossier, and a validation that demands them would push staff back to working
 * outside the system.
 *
 * The intake LIFECYCLE reuses existing state — no second enum:
 *   DRAFT              operational_file.status = 'DRAFT' (createFile's default)
 *   READY_FOR_OPENING  derived: DRAFT + validateIntake().blocking is empty
 *   OPEN               process_instance exists + canonical owner assigned
 *                      (+ operational_file transitioned DRAFT → OPENED)
 *   HANDED_TO_TRANSIT  an open/received process_handoff into coordinator_reception
 */

import { getStep } from "./effitrans-process";
import { isDone, type StepState } from "./engine/types";

export type IntakeIssueCode =
  | "client_missing"
  | "type_missing"
  | "mode_missing"
  | "owner_missing"
  | "origin_missing"
  | "destination_missing"
  | "reference_missing"
  | "eta_missing"
  | "mode_recommended";

export type IntakeIssue = { code: IntakeIssueCode; labelFr: string };

export type IntakeInput = {
  clientId: string | null;
  /** operational_file.type — IMP / EXP / TRP / HND. */
  fileType: string | null;
  /** shipment.transport_mode — SEA / AIR / ROAD / MULTIMODAL. */
  transportMode: string | null;
  origin: string | null;
  destination: string | null;
  /** Any useful reference: BL/AWB, booking, container, client reference. */
  reference: string | null;
  eta: string | null;
  /** The canonical Operations owner selected for opening. */
  ownerUserId: string | null;
};

export type IntakeValidation = {
  blocking: IntakeIssue[];
  warnings: IntakeIssue[];
  /** True when nothing blocks opening. */
  ready: boolean;
};

const LABELS: Record<IntakeIssueCode, string> = {
  client_missing: "Client obligatoire.",
  type_missing: "Type de dossier obligatoire (IMP / EXP / TRP / HND).",
  mode_missing: "Mode de transport obligatoire pour ce type de dossier.",
  owner_missing: "Un responsable opérationnel (Opérations) doit être sélectionné.",
  origin_missing: "Origine / lieu de départ recommandé.",
  destination_missing: "Destination / lieu d'arrivée recommandé.",
  reference_missing: "Aucune référence utile (BL, AWB, booking, référence client).",
  eta_missing: "ETA non renseignée.",
  mode_recommended: "Mode de transport recommandé.",
};

const issue = (code: IntakeIssueCode): IntakeIssue => ({ code, labelFr: LABELS[code] });

const blank = (v: string | null | undefined): boolean => !v || v.trim().length === 0;

/**
 * Validate minimum intake information.
 *
 * BLOCKING — customer, dossier type, transport mode (for IMP/EXP/TRP — an HND
 * handling dossier may legitimately have none yet), and the Operations owner.
 * WARNING — origin/destination, a useful reference, ETA. BL/AWB/containers/
 * documents are NEVER universally mandatory at intake.
 */
export function validateIntake(input: IntakeInput): IntakeValidation {
  const blocking: IntakeIssue[] = [];
  const warnings: IntakeIssue[] = [];

  if (blank(input.clientId)) blocking.push(issue("client_missing"));
  if (blank(input.fileType)) blocking.push(issue("type_missing"));
  if (blank(input.ownerUserId)) blocking.push(issue("owner_missing"));

  if (blank(input.transportMode)) {
    if (input.fileType === "HND") warnings.push(issue("mode_recommended"));
    else blocking.push(issue("mode_missing"));
  }

  if (blank(input.origin)) warnings.push(issue("origin_missing"));
  if (blank(input.destination)) warnings.push(issue("destination_missing"));
  if (blank(input.reference)) warnings.push(issue("reference_missing"));
  if (blank(input.eta)) warnings.push(issue("eta_missing"));

  return { blocking, warnings, ready: blocking.length === 0 };
}

/**
 * Intake blocker categories that PREVENT the Transit handoff (Phase 9.0C rule:
 * a dossier flagged incomplete does not travel). Other categories — e.g. a
 * payment or supplier issue — do not gate this particular transmission.
 */
export const HANDOFF_BLOCKING_CATEGORIES = ["MISSING_DOCUMENT", "CUSTOMER_RESPONSE_REQUIRED"] as const;

/** One unmet prerequisite, already in the operator's language. */
export type HandoffPrerequisite = { code: string; labelFr: string };

/** A step named from the registry — number and label are never hand-written. */
export type ActionableStep = { stepNumber: number; stepKey: string; labelFr: string };

export type TransitHandoffReadiness = {
  /** Every prerequisite currently unmet, not merely the first one. */
  unmet: HandoffPrerequisite[];
  /**
   * The step that must be completed FIRST, derived from the official process
   * dependency graph. Null whenever it cannot be derived with certainty — an
   * operator is never sent to a step we are guessing at.
   */
  firstActionable: ActionableStep | null;
  ready: boolean;
};

export type TransitHandoffInput = {
  hasInstance: boolean;
  hasOwner: boolean;
  openBlockers: { title: string; category: string }[];
  /** D-2: whether official step 3 (am_dossier_opening) is terminal-done. */
  amOpeningDone?: boolean;
  /**
   * Live step states, used ONLY to name the first actionable predecessor. The
   * refusal itself still rests on `amOpeningDone`, exactly as the server
   * enforces it — this input can add guidance, never remove a prerequisite.
   */
  steps?: { stepKey: string; state: string }[];
};

/** The handoff's own from-step. The registry graph is walked back from here. */
export const TRANSIT_HANDOFF_FROM_STEP = "am_dossier_opening";

/**
 * THE step an operator should complete first, from the official dependency
 * graph — never a hard-coded step for a particular dossier.
 *
 * Walks the transitive `prerequisites` closure of the handoff's from-step and
 * returns the LOWEST-NUMBERED step that is (a) not terminal-done and (b) has
 * every one of its own prerequisites done — i.e. the only work that can legally
 * start right now. Returns null when no state is known or nothing qualifies,
 * because a wrong instruction is worse than none.
 */
export function firstActionableStepFor(
  fromStepKey: string,
  steps: { stepKey: string; state: string }[],
): ActionableStep | null {
  if (steps.length === 0) return null;
  const stateOf = new Map(steps.map((e) => [e.stepKey, e.state]));
  const done = (key: string): boolean => {
    const st = stateOf.get(key);
    return st !== undefined && isDone(st as StepState);
  };

  // Transitive prerequisite closure, from-step included.
  const closure = new Set<string>();
  const walk = (key: string) => {
    if (closure.has(key)) return;
    closure.add(key);
    for (const p of getStep(key)?.prerequisites ?? []) walk(p);
  };
  walk(fromStepKey);

  const candidates: ActionableStep[] = [];
  for (const key of closure) {
    if (done(key)) continue;
    const node = getStep(key);
    if (!node) continue;
    // Actionable = nothing it depends on is still outstanding.
    if (!(node.prerequisites ?? []).every(done)) continue;
    candidates.push({ stepNumber: node.stepNumber, stepKey: key, labelFr: node.labelFr });
  }
  candidates.sort((a, b) => a.stepNumber - b.stepNumber);
  return candidates[0] ?? null;
}

/**
 * THE authoritative readiness evaluation for « Transmettre au Transit ».
 *
 * PURE, and the single source both surfaces and the server action read, so the
 * UI can never be more permissive than the action nor invent a blocker the
 * server does not hold:
 *   • the process instance must exist AND have an owner (the dossier is "opened");
 *   • official step 3 (the handoff's own from-step, D-2) must be terminal-done;
 *   • no OPEN/ACKNOWLEDGED blocker in HANDOFF_BLOCKING_CATEGORIES.
 * Every unmet prerequisite is returned, not merely the first: an operator fixing
 * one only to meet the next is how a UAT gets spent.
 */
export function evaluateTransitHandoffReadiness(input: TransitHandoffInput): TransitHandoffReadiness {
  const unmet: HandoffPrerequisite[] = [];
  if (!input.hasInstance) {
    unmet.push({ code: "workflow_not_opened", labelFr: "Le dossier n'a pas encore été ouvert dans le processus officiel." });
  } else if (!input.hasOwner) {
    unmet.push({ code: "owner_missing", labelFr: "Aucun responsable d'ouverture (Opérations) n'est assigné." });
  }
  // D-2 — the handoff's own from-step. Named explicitly so the operator reads a
  // prerequisite instead of discovering a refusal after pressing the button.
  if (input.amOpeningDone === false) {
    const node = getStep(TRANSIT_HANDOFF_FROM_STEP);
    unmet.push({
      code: "am_opening_incomplete",
      // Guillemets, not another dash: registry labels already contain an em dash
      // (« Account Manager — ouverture… ») and stacking a third is unreadable.
      labelFr: node
        ? `Étape ${node.stepNumber} « ${node.labelFr} » : non terminée.`
        : "L'étape d'ouverture et de préparation du dossier n'est pas terminée.",
    });
  }
  for (const b of input.openBlockers) {
    if ((HANDOFF_BLOCKING_CATEGORIES as readonly string[]).includes(b.category)) {
      unmet.push({ code: `blocker:${b.category}`, labelFr: `Point bloquant ouvert : ${b.title}` });
    }
  }

  // Guidance, computed only when something is actually unmet and only from the
  // registry graph. A satisfied dossier is never told to go and do something.
  const firstActionable =
    unmet.length > 0 && input.steps && input.steps.length > 0
      ? firstActionableStepFor(TRANSIT_HANDOFF_FROM_STEP, input.steps)
      : null;

  return { unmet, firstActionable, ready: unmet.length === 0 };
}

/**
 * The unmet prerequisites alone. Kept as the historical entry point so there is
 * exactly ONE rule implementation behind both names.
 */
export function unmetTransitHandoffPrerequisites(input: TransitHandoffInput): HandoffPrerequisite[] {
  return evaluateTransitHandoffReadiness(input).unmet;
}
