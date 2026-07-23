/**
 * Workflow decision policy (Phase 9.0B) — PURE, configurable. No I/O.
 * ---------------------------------------------------------------------------
 * Which decision types exist, which outcomes each allows, and what finalizing
 * one requires. Manager-approval rules for these decisions are an UNRESOLVED
 * business decision (confirmed rule 16) — so the policy is DATA, not scattered
 * conditionals: when the business decides, the ruling lands here (a permission
 * tightened, an approvalRequired flipped) without touching the action code.
 */

export const DECISION_TYPES = ["CONTINUE_BEFORE_PAYMENT"] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const DECISION_OUTCOMES: Readonly<Record<DecisionType, readonly string[]>> = {
  // The three recorded outcomes the business document names (Workflow PDF §8.1):
  // « Bloquer jusqu'au paiement; Continuer provisoirement; Continuer avec
  // approbation manager. »
  CONTINUE_BEFORE_PAYMENT: ["BLOCK_UNTIL_PAYMENT", "CONTINUE_PROVISIONALLY", "CONTINUE_WITH_APPROVAL"],
} as const;

export type DecisionPolicy = {
  /** Finalization always requires an explicit decider action, never a default. */
  approvalRequired: boolean;
  /**
   * Permission the DECIDER must hold (on top of process:decision:approve, which
   * the action's guard checks). Kept identical for now — a placeholder the
   * unresolved manager-approval ruling can tighten per type.
   */
  requiredPermission: string | null;
};

export const DECISION_POLICIES: Readonly<Record<DecisionType, DecisionPolicy>> = {
  CONTINUE_BEFORE_PAYMENT: {
    approvalRequired: true,
    requiredPermission: "process:decision:approve",
  },
} as const;

export function isDecisionType(v: string): v is DecisionType {
  return (DECISION_TYPES as readonly string[]).includes(v);
}

export function isDecisionOutcome(type: DecisionType, outcome: string): boolean {
  return DECISION_OUTCOMES[type]?.includes(outcome) ?? false;
}
