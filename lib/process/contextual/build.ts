/**
 * ONE construction of the facts a step-execution surface decides on. PURE.
 * ---------------------------------------------------------------------------
 * `evaluateStepAction` was always pure and always shared, and the two surfaces
 * that read it still disagreed three ways — because sharing the DECISION is not
 * the same as sharing the FACTS. Each caller assembled its own from whatever it
 * had in scope, and the differences were invisible until an operator hit them.
 *
 * This is the missing half. Every surface builds facts here, so a divergence
 * has to be introduced deliberately rather than by omission, and a new fact
 * added to the evaluator has exactly one place to be supplied from.
 *
 * PURE on purpose: the queue builds facts for many dossiers from one batch read,
 * the dossier loader builds them for one dossier from its own. They cannot share
 * a query. They can — and now must — share this.
 */
import { custodyStateFor, type RouteHandoffView } from "../handoff-routes";
import { missingPrerequisites } from "../engine/state";
import { stepAppliesToScope, UNKNOWN_SCOPE, type ServiceKey, type ServiceScope } from "../service-scope";
import { blockerSentence } from "../labels";
import type { StepEvidence } from "../engine/evidence";
import type { ExecutionView } from "../engine/state";
import type { StepActionFacts, StepRequirementFact } from "../step-eligibility";

/** Only what is NOT satisfied: a surface renders outstanding work. */
export function outstandingRequirements(evidence: StepEvidence): StepRequirementFact[] {
  return evidence.items
    .filter((i) => i.status !== "satisfied")
    .map((i) => ({
      key: i.key,
      labelFr: i.labelFr,
      status: i.status as StepRequirementFact["status"],
    }));
}

export function buildStepFacts(input: {
  stepKey: string;
  state: string;
  assignedUserId: string | null;
  /** Every handoff of the instance — custody is derived here, never guessed. */
  handoffs: readonly RouteHandoffView[];
  /** Every execution of the instance, for the prerequisite test. */
  views: readonly ExecutionView[];
  evidence: StepEvidence;
  owningRole: string | null;
  /**
   * The dossier's service scope, so a prerequisite belonging to a service
   * Effitrans is NOT providing does not hold the graph shut. Defaults to
   * UNKNOWN, under which every prerequisite counts exactly as before.
   */
  scope?: ServiceScope;
  /** Set when the step's service is not contracted on this dossier. */
  notApplicable?: { service: ServiceKey; reasonFr: string } | null;
  /** A blocker that is neither evidence nor a prerequisite, already in French. */
  extraBlockerFr?: string | null;
}): StepActionFacts {
  // OPS-SERVICE-SCOPE-01 — a prerequisite that does not apply cannot be
  // outstanding. Without this the join gate at step 15 waits forever on
  // `customs_field_clearance` for a transport-only dossier: the step is
  // PENDING, PENDING is not terminal, and nothing would ever make it so.
  //
  // The step is NOT mutated to SKIPPED here. Skipping is a recorded decision
  // with an actor and a motif (`skipStep`); this is a read-time answer to « is
  // this a real prerequisite for THIS dossier », and it writes nothing.
  const scope = input.scope ?? UNKNOWN_SCOPE;
  const prereqs = missingPrerequisites(input.stepKey, [...input.views]).filter((p) =>
    stepAppliesToScope(p, scope),
  );
  return {
    stepKey: input.stepKey,
    state: input.state,
    assignedUserId: input.assignedUserId,
    // The FULL custody state. A SENT-only boolean was the second divergence:
    // it could not tell « not transmitted yet » from « transmitted, not yet
    // accepted », which are different refusals needing different acts.
    custody: custodyStateFor(input.stepKey, input.handoffs),
    owningRole: input.owningRole,
    notApplicable: input.notApplicable ?? null,
    missingPrerequisites: prereqs,
    // Evidence is handed over as ITEMS, not as a pre-rendered sentence. The
    // first divergence was one surface folding it into a blocker string and the
    // other not; a sentence cannot be re-examined, a list can.
    requirements: outstandingRequirements(input.evidence),
    blockedReason:
      input.extraBlockerFr
      ?? (prereqs.length > 0
        ? blockerSentence({ blocked: true, missingPrerequisites: prereqs, missingEvidence: [] })
        : null),
  };
}
