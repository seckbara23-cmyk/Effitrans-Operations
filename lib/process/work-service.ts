import "server-only";
/**
 * ONE load, ONE partition — the dossier's work as every surface must read it.
 * ---------------------------------------------------------------------------
 * OPS-NEXT-ACTION-01. `buildDossierWork` is the pure partition;
 * `loadContextualStepFacts` is the one loader. This joins them, and it is the
 * ONLY place the two meet, so a surface cannot obtain a work model that was
 * built from facts nobody else saw.
 *
 * WHAT IT COSTS: nothing new. It reads the snapshot the dossier page already
 * pays for, plus the two bounded lookups the contextual loader already makes.
 * The dossier page, the journey panel and the contextual cards all consume the
 * SAME call — `loadProcessSnapshotForDisplay` is request-memoised, so three
 * consumers do not mean three reads.
 *
 * WHAT IT IS NOT. Not an authority. Every button it describes is re-checked by
 * `activateStep` / `submitStep`, which refuse on permission, ownership,
 * custody, prerequisites, evidence and state regardless of what any surface
 * offered. A model that hides a button is a courtesy; the server is the control.
 */
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES, PROCESS_STEP_COUNT } from "./effitrans-process";
import { loadContextualStepFacts, type ContextualDossier } from "./contextual/facts";
import { evaluateStepAction, type StepActionViewer } from "./step-eligibility";
import { buildDossierWork, type DossierWork, type WorkNode } from "./work-model";
import type { ServiceScope } from "./service-scope";

export type DossierWorkView = {
  hasInstance: boolean;
  scope: ServiceScope;
  work: DossierWork;
  /** The underlying facts, so a caller does not have to load them twice. */
  dossier: ContextualDossier;
};

/** The three parallel activities — counted apart from the 26, always. */
const ACTIVITY_COUNT = PARALLEL_ACTIVITIES.length;

/** Registry sanity: the official count is the registry's, never a literal. */
const OFFICIAL_COUNT = EFFITRANS_PROCESS.filter((s) => typeof s.stepNumber === "number").length;

export async function getDossierWork(
  fileId: string,
  viewer: { tenantId: string } & StepActionViewer,
): Promise<DossierWorkView | null> {
  const dossier = await loadContextualStepFacts(fileId, {
    tenantId: viewer.tenantId,
    permissions: viewer.permissions,
  });
  if (!dossier) return null;

  const nodes: WorkNode[] = dossier.steps.map((s) => ({
    stepKey: s.facts.stepKey,
    stepNumber: s.stepNumber,
    labelFr: s.labelFr,
    state: s.facts.state,
    branch: s.branch,
    ownerLabelFr: s.ownerLabelFr,
    assigneeLabel: s.assigneeLabel,
    eligibility: evaluateStepAction(s.facts, {
      userId: viewer.userId,
      permissions: viewer.permissions,
      roles: viewer.roles,
    }),
  }));

  return {
    hasInstance: dossier.hasInstance,
    scope: dossier.scope,
    dossier,
    work: buildDossierWork({
      nodes,
      // PROCESS_STEP_COUNT and the registry must agree; if they ever did not,
      // the denominator on every screen would be a literal nobody maintains.
      officialTotal: OFFICIAL_COUNT === PROCESS_STEP_COUNT ? PROCESS_STEP_COUNT : OFFICIAL_COUNT,
      activitiesTotal: ACTIVITY_COUNT,
    }),
  };
}
