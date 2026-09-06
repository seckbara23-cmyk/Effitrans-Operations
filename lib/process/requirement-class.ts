/**
 * Governance class of a requirement — the leniency doctrine, made expressible.
 * PURE and client-safe.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-09-06. Effitrans must not block operations merely because
 * something is missing. Governance without unnecessary friction. Every
 * requirement is therefore classified by WHEN and WHY it is required, not
 * merely by whether it is present:
 *
 *   HARD_GATE            the process cannot legitimately continue past this
 *                        control point — a legal or customs prerequisite,
 *                        maker/checker, mandatory role validation, a payment
 *                        control, BAE/release, security or ownership authority.
 *   SOFT_GATE            it should exist, and legitimate work continues while
 *                        it is obtained. Warn, name when it becomes mandatory,
 *                        keep it visible.
 *   CONTROLLED_EXCEPTION normally required here, but an authorized person may
 *                        continue with a motif, an actor, a timestamp and an
 *                        audit trail — never over maker/checker, authority,
 *                        tenant security, Chef validation, Finance payment
 *                        authority or BAE/release.
 *   INFORMATIONAL        never blocks; feeds completeness and quality.
 *   FLAG_FOR_RULING      the existing evidence does not establish which of the
 *                        above it is.
 *
 * THE RULE THAT SHAPES THIS FILE. « Defaulting every unknown requirement to a
 * blocker is NOT acceptable. » So an unclassified requirement is reported as
 * FLAG_FOR_RULING and is NEVER silently presented as a ratified hard gate.
 *
 * AND THE RULE THAT SHAPES ITS USE, which is the other half and is easy to get
 * wrong. Classifying is not the same act as changing behaviour. Every gate the
 * engine enforces today was ratified at some point; turning one off because it
 * has not yet been re-classified would be an unratified LOOSENING of a live
 * control, made silently, on production dossiers. So in this slice the class
 * changes what an operator is TOLD and what the governance matrix REPORTS — it
 * does not change what the engine refuses. `blocksToday` is computed from the
 * engine's actual behaviour, and `ratified` says whether Effitrans has ruled on
 * it yet. Where those two disagree the operator is told the truth: this is
 * required today, and its classification is pending.
 *
 * Populating CLASSIFIED is a governance act, not a coding one: each entry needs
 * a first-party citation, and the audit that produces them flags anything the
 * evidence does not settle rather than guessing.
 */

export type RequirementClass =
  | "HARD_GATE"
  | "SOFT_GATE"
  | "CONTROLLED_EXCEPTION"
  | "INFORMATIONAL"
  | "FLAG_FOR_RULING";

export type RequirementGovernance = {
  /** The ratified class, or FLAG_FOR_RULING while the evidence is inconclusive. */
  klass: RequirementClass;
  /** Has Effitrans actually ruled on this one? */
  ratified: boolean;
  /**
   * Where an unresolved SOFT item becomes mandatory. Null when it never does,
   * or when nothing establishes it.
   */
  mandatoryAtFr: string | null;
  /** The first-party source of the ruling. Empty while unratified. */
  source: string;
};

/**
 * Ratified classifications, keyed `"<stepKey>::<requirementKey>"`.
 *
 * EMPTY BY CONSTRUCTION until the classification matrix is ratified. An entry
 * added here changes what operators are told, so it needs its citation in
 * `source` — a decision-register row, a Quality Manual control, or a ratified
 * migration header. « The code already does it » is not a source.
 */
export const CLASSIFIED: Record<string, RequirementGovernance> = {};

/** What we say about a requirement Effitrans has not classified yet. */
const UNRULED: RequirementGovernance = {
  klass: "FLAG_FOR_RULING",
  ratified: false,
  mandatoryAtFr: null,
  source: "",
};

export function governanceFor(stepKey: string, requirementKey: string): RequirementGovernance {
  return CLASSIFIED[`${stepKey}::${requirementKey}`] ?? UNRULED;
}

/**
 * Does this requirement stop the step from completing?
 *
 * TWO INPUTS, DELIBERATELY. `enforcedToday` is what the engine will actually
 * do — the only thing that keeps a surface honest, because a button offered
 * against an engine that refuses is the defect this whole programme exists to
 * end. The class refines it only in the direction Effitrans has RATIFIED:
 * a ratified SOFT_GATE or INFORMATIONAL stops blocking; anything else keeps
 * today's behaviour, including FLAG_FOR_RULING.
 */
export function blocksCompletion(
  governance: RequirementGovernance,
  enforcedToday: boolean,
): boolean {
  if (!governance.ratified) return enforcedToday;
  if (governance.klass === "SOFT_GATE" || governance.klass === "INFORMATIONAL") return false;
  return enforcedToday;
}

/**
 * The French an operator reads about ONE outstanding requirement.
 *
 * Two registers, as ratified: « action requise » for something that genuinely
 * stops the process here, « information à compléter » for something that should
 * exist and does not stop today's work. An unruled requirement that blocks says
 * both things honestly rather than dressing itself as a settled rule.
 */
export function requirementMessageFr(input: {
  labelFr: string;
  governance: RequirementGovernance;
  blocks: boolean;
}): string {
  const { labelFr, governance, blocks } = input;
  if (!blocks) {
    const when = governance.mandatoryAtFr
      ? ` Ce document sera obligatoire ${governance.mandatoryAtFr}.`
      : "";
    return `Information à compléter : ${labelFr}. Vous pouvez poursuivre la préparation du dossier.${when}`;
  }
  if (!governance.ratified) {
    // Honest about both facts: it is required now, and nobody has ruled on
    // whether it should be. Hiding the second would present an unexamined
    // blocker as a settled rule.
    return `Action requise : ${labelFr}. Cette exigence est bloquante aujourd'hui ; sa classification est en attente de ratification.`;
  }
  return `Action requise : ${labelFr}.`;
}
