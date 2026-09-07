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
import { evaluateStepAction } from "../step-eligibility";
import { queueForStep } from "../queues/registry";
import { EFFITRANS_PROCESS } from "../effitrans-process";
import { loadContextualStepFacts } from "./facts";
import { contextualStatus, worthShowing } from "./view";
import { sectionFor, type DossierSection } from "./sections";
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
  viewer: {
    tenantId: string;
    userId: string;
    permissions: readonly string[];
    roles: readonly string[];
  },
): Promise<ContextualCards> {
  const dossier = await loadContextualStepFacts(fileId, {
    tenantId: viewer.tenantId,
    permissions: viewer.permissions,
  });
  if (!dossier?.hasInstance) return {};

  const out: ContextualCards = {};
  for (const step of dossier.steps) {
    const section = sectionFor(step.facts.stepKey);
    if (!section) continue;

    const eligibility = evaluateStepAction(step.facts, {
      userId: viewer.userId,
      permissions: viewer.permissions,
      roles: viewer.roles,
    });
    if (!worthShowing(step.facts.state, eligibility)) continue;

    (out[section] ??= []).push({
      fileId,
      stepKey: step.facts.stepKey,
      stepNumber: step.stepNumber,
      labelFr: step.labelFr,
      totalSteps: TOTAL_STEPS,
      status: contextualStatus(step.facts.state, eligibility),
      eligibility,
      assigneeLabel: step.assigneeLabel,
      queueKey: queueForStep(step.facts.stepKey),
      anchor: step.anchor,
    });
  }

  // Lowest official step first, so a section reads in process order rather than
  // in whatever order the executions came back.
  for (const cards of Object.values(out)) {
    cards.sort((a, b) => (a.stepNumber ?? 99) - (b.stepNumber ?? 99));
  }
  return out;
}
