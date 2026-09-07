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
import {
  CLIENT_JOURNEY,
  EFFITRANS_PROCESS,
  PARALLEL_ACTIVITIES,
  PROCESS_STEP_COUNT,
} from "@/lib/process/effitrans-process";
import type { ProcessReadModel } from "@/lib/process/engine/read-model";
import type { DossierWork } from "@/lib/process/work-model";
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
  /**
   * The three parallel activities, counted APART (§11). 26 official steps + 3
   * parallel activities = 29 execution rows, and the denominator here is 26.
   * `completedSteps.length` used to feed `completed`: it counts every finished
   * node, so a dossier that finished the Bon a Delivrer and the Pre-Gate could
   * read « 28/26 etapes officielles ».
   */
  activitiesCompleted: number;
  activitiesTotal: number;
  /** Official steps out of scope or skipped. Never counted as done. */
  notApplicable: number;
  /** The step(s) live right now, at most three — this is a summary, not a list. */
  current: { stepNumber: number | null; labelFr: string; state: string }[];
  /** Who to chase. Never a raw role code. */
  ownerLabel: string | null;
  /** The single most useful thing to say about what happens next. */
  nextAction: string;
  /** Work legitimately proceeding in another branch, named as such. */
  parallelLabels: string[];
  /** The next thing that is not open yet. */
  upcomingLabel: string | null;
  branches: JourneyBranch[];
  /** True when the dossier's history was inferred from a legacy record, not observed. */
  inferred: boolean;
  /** Steps we mapped but never verified — shown so nobody mistakes them for evidence. */
  unverifiedCount: number;
};

const TOTAL_STEPS = PROCESS_STEP_COUNT;
const TOTAL_ACTIVITIES = PARALLEL_ACTIVITIES.length;
/** The 26 numbered keys, so a parallel activity can never inflate the count. */
const OFFICIAL_KEYS = new Set(
  EFFITRANS_PROCESS.filter((s) => typeof s.stepNumber === "number").map((s) => s.key),
);

/**
 * The compact summary — now DERIVED from the canonical work model.
 *
 * WHAT THIS USED TO DO, AND WHY IT WAS THE HEADLINE DEFECT. `nextAction` was
 * `model.activeSteps[0].labelFr`, and `activeSteps` is every open node in
 * whatever order the loader returned: AVAILABLE beside ACTIVE, parallel
 * activities beside numbered steps, unsorted. On EFT-IMP-2026-00011 four nodes
 * qualified — step 6 ACTIVE and assigned, step 14 AVAILABLE, the Bon à Délivrer
 * and the Pre-Gate — and the panel announced « Service Transport — affecter le
 * véhicule » while the Déclarant's own step was live. `currentOwner` compounded
 * it: the read model names an owner only when EXACTLY ONE step is open, so a
 * dossier with any parallel work reads « Personne — non attribué » however
 * firmly its current step is assigned.
 *
 * `work` answers both, and it is the same object the dossier page and the
 * contextual cards read. Optional, so callers holding only the read model keep
 * working — they get the ordered official-step count and today's sentence.
 */
export function summarizeJourney(model: ProcessReadModel, work?: DossierWork): JourneySummary {
  const stage = CLIENT_JOURNEY.find((s) => s.key === model.clientStage);

  const current = (work
    ? work.current.map((i) => ({ stepNumber: i.stepNumber, labelFr: i.labelFr, state: i.state }))
    : model.activeSteps.map((s) => ({ stepNumber: s.stepNumber, labelFr: s.labelFr, state: s.state }))
  ).slice(0, 3);

  // "Who has the dossier now" — the question this whole phase exists to answer.
  // A named user beats a role; a role beats nothing. We never print a role CODE.
  const owner = model.currentOwner;
  const ownerLabel = work?.currentOwnerFr ?? (owner?.role ? roleLabel(owner.role) : null);

  const blocked = work ? work.blocked.length : model.blockedSteps.length;
  const corrections = model.correctionState.length;

  // A pending transfer and an open correction are facts the work model does not
  // carry, and they outrank a step label because they name the act that
  // unblocks everything else. Below them the canonical sentence takes over.
  const nextAction = model.pendingHandoff
    ? "Transfert envoyé — en attente de réception"
    : corrections > 0
      ? `${corrections} correction(s) à reprendre`
      : work
        ? work.nextActionFr
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
    // OFFICIAL steps only. `model.completedSteps` counts every finished node,
    // the three parallel activities included, against a denominator of 26.
    completed: work
      ? work.progress.officialCompleted
      : model.completedSteps.filter((k) => OFFICIAL_KEYS.has(k)).length,
    total: TOTAL_STEPS,
    activitiesCompleted: work?.progress.activitiesCompleted ?? 0,
    activitiesTotal: TOTAL_ACTIVITIES,
    notApplicable: work?.progress.officialNotApplicable ?? 0,
    current,
    ownerLabel,
    nextAction,
    parallelLabels: (work?.parallel ?? []).map((i) => i.labelFr),
    upcomingLabel: work?.upcoming[0]?.labelFr ?? null,
    branches,
    // A dossier that predates the engine had its history INFERRED. Saying "12/26
    // done" about it would be a claim we cannot support, so we say so instead.
    inferred: model.compatibilitySource !== "NATIVE",
    unverifiedCount: model.unverifiedSteps.length,
  };
}
