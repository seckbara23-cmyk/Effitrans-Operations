import "server-only";
/**
 * The contextual cards for one dossier, grouped by the section they belong beside.
 * ---------------------------------------------------------------------------
 * The whole server half of the dossier's execution surface, in one place: load
 * the facts once (`loadContextualStepFacts`), decide with the shared evaluator
 * (`evaluateStepAction`), name the state (`contextualStatus`), and hand the
 * results to a client component that decides nothing.
 *
 * THE FILTER IS THE FEATURE. `worthShowing` keeps this from becoming the 26-step
 * list in a smaller font: a step that is finished, not yet open, or will never be
 * this reader's is not shown. `/process` remains the complete view and every card
 * links to it, so nothing is hidden — it is simply not repeated where it does not
 * help.
 */
import { queueForStep } from "../queues/registry";
import { EFFITRANS_PROCESS } from "../effitrans-process";
import { getDossierWork, type DossierWorkView } from "../work-service";
import { contextualStatus, worthShowing } from "./view";
import { sectionFor, type DossierSection } from "./sections";
import type { StepActionViewer } from "../step-eligibility";
import type { ContextualStepCardProps } from "@/components/process/contextual-step-card";

/** Steps that carry an official number — « Étape 6 sur 26 ». */
const TOTAL_STEPS = EFFITRANS_PROCESS.filter(
  (s) => typeof s.stepNumber === "number",
).length;

export type ContextualCards = Partial<Record<DossierSection, ContextualStepCardProps[]>>;

/**
 * Everything the dossier page needs to render step actions in place.
 *
 * Returns an empty object — never a partial one — when the dossier has no
 * process instance or the reader cannot see it. Every section then renders as
 * it did before, which is the compatibility path this whole surface keeps.
 */
export async function contextualCardsFor(
  fileId: string,
  viewer: { tenantId: string } & StepActionViewer,
): Promise<ContextualCards> {
  const view = await getDossierWork(fileId, viewer);
  return cardsFromWork(fileId, view);
}

/**
 * The same cards, from a work model the caller already built.
 *
 * The dossier page needs BOTH the primary-action card and the per-section
 * cards, and they must be the same verdicts — building them twice would
 * reintroduce, inside one page, exactly the divergence this programme removed
 * between pages.
 */
export function cardsFromWork(fileId: string, view: DossierWorkView | null): ContextualCards {
  if (!view?.hasInstance) return {};

  const out: ContextualCards = {};
  const byKey = new Map(view.dossier.steps.map((s) => [s.facts.stepKey, s]));
  const all = [
    ...view.work.current, ...view.work.parallel, ...view.work.blocked,
    ...view.work.upcoming, ...view.work.notApplicable,
  ];

  for (const item of all) {
    const step = byKey.get(item.stepKey);
    if (!step) continue;
    const section = sectionFor(item.stepKey);
    if (!section) continue;
    if (!worthShowing(item.state, item.eligibility)) continue;

    (out[section] ??= []).push({
      fileId,
      stepKey: item.stepKey,
      stepNumber: item.stepNumber,
      labelFr: item.labelFr,
      totalSteps: TOTAL_STEPS,
      status: contextualStatus(item.state, item.eligibility),
      eligibility: item.eligibility,
      assigneeLabel: item.assigneeLabel,
      queueKey: queueForStep(item.stepKey),
      anchor: step.anchor,
      kind: item.kind,
      viewer: item.viewer,
    });
  }

  // Lowest official step first, so a section reads in process order rather than
  // in whatever order the executions came back.
  for (const cards of Object.values(out)) {
    cards.sort((a, b) => (a.stepNumber ?? 99) - (b.stepNumber ?? 99));
  }
  return out;
}
