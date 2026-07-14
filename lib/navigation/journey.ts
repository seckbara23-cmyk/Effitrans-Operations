/**
 * "Parcours officiel Effitrans" — the compact journey summary (5.0E-1, D10). PURE.
 * ---------------------------------------------------------------------------
 * The 26-step process does NOT belong in the sidebar. A permanent 26-item list is
 * a reference document, not navigation: it is the same for every dossier and every
 * user, so it carries no information at the moment you read it.
 *
 * What a staff member actually needs, on the dossier, is four facts:
 *   • where this dossier is in the official process,
 *   • WHO holds it right now,
 *   • what the next action is,
 *   • whether the two parallel branches have converged.
 *
 * That is what this produces. The full 26-step inspector stays one click away at
 * /files/[id]/process for when someone genuinely needs to audit the chain.
 *
 * Derived entirely from the engine read model — no second source of truth.
 */
import { CLIENT_JOURNEY, PROCESS_STEP_COUNT } from "@/lib/process/effitrans-process";
import type { ProcessReadModel } from "@/lib/process/engine/read-model";
import { roleLabel } from "./roles";

export type JourneyBranch = {
  labelFr: string;
  complete: boolean;
  detail: string;
};

export type JourneySummary = {
  /** Where the client would say the dossier is. */
  stageLabel: string;
  /** How far along the OFFICIAL process, not a percentage of a guess. */
  completed: number;
  total: number;
  /** The step(s) live right now, at most three — this is a summary, not a list. */
  current: { stepNumber: number | null; labelFr: string; state: string }[];
  /** Who to chase. Never a raw role code. */
  ownerLabel: string | null;
  /** The single most useful thing to say about what happens next. */
  nextAction: string;
  branches: JourneyBranch[];
  /** True when the dossier's history was inferred from a legacy record, not observed. */
  inferred: boolean;
  /** Steps we mapped but never verified — shown so nobody mistakes them for evidence. */
  unverifiedCount: number;
};

const TOTAL_STEPS = PROCESS_STEP_COUNT;

export function summarizeJourney(model: ProcessReadModel): JourneySummary {
  const stage = CLIENT_JOURNEY.find((s) => s.key === model.clientStage);

  const current = model.activeSteps.slice(0, 3).map((s) => ({
    stepNumber: s.stepNumber,
    labelFr: s.labelFr,
    state: s.state,
  }));

  // "Who has the dossier now" — the question this whole phase exists to answer.
  // A named user beats a role; a role beats nothing. We never print a role CODE.
  const owner = model.currentOwner;
  const ownerLabel = owner?.role ? roleLabel(owner.role) : null;

  const blocked = model.blockedSteps.length;
  const corrections = model.correctionState.length;

  const nextAction = model.pendingHandoff
    ? "Transfert envoyé — en attente de réception"
    : corrections > 0
      ? `${corrections} correction(s) à reprendre`
      : blocked > 0
        ? `${blocked} étape(s) bloquée(s) — une preuve ou un prérequis manque`
        : current.length > 0
          ? current[0].labelFr
          : model.status === "CLOSED"
            ? "Dossier clôturé"
            : "Aucune étape active";

  const branches: JourneyBranch[] = [
    {
      labelFr: "Douane",
      complete: model.branches.customs.complete,
      detail: model.branches.customs.complete
        ? "Mainlevée obtenue"
        : "Dédouanement en cours",
    },
    {
      labelFr: "Transport",
      complete: model.branches.transportReadiness.complete,
      detail: model.branches.transportReadiness.complete
        ? "Véhicule et chauffeur prêts"
        : "Préparation en cours",
    },
  ];

  return {
    stageLabel: stage?.labelFr ?? "Non démarré",
    completed: model.completedSteps.length,
    total: TOTAL_STEPS,
    current,
    ownerLabel,
    nextAction,
    branches,
    // A dossier that predates the engine had its history INFERRED. Saying "12/26
    // done" about it would be a claim we cannot support, so we say so instead.
    inferred: model.compatibilitySource !== "NATIVE",
    unverifiedCount: model.unverifiedSteps.length,
  };
}
