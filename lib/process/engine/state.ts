/**
 * Process engine — PURE state core (Phase 5.0B). No I/O. Fully unit-tested.
 * ---------------------------------------------------------------------------
 * Everything the engine DECIDES lives here: which steps are available, which are
 * blocked, whether a transition is legal, whether a maker may be their own
 * checker. The server layer (./actions) does authentication, permissions and
 * persistence, then delegates every decision to these functions.
 *
 * The registry (lib/process/effitrans-process.ts) is the only source of step
 * meaning. Nothing here hardcodes a step name except the three maker-checker
 * pairs, which the registry itself declares.
 */
import {
  EFFITRANS_PROCESS,
  MAKER_CHECKER_PAIRS,
  PARALLEL_ACTIVITIES,
  getActivity,
  getStep,
} from "../effitrans-process";
import type { ProcessStep, ProcessActivity } from "../types";
import { isDone, type StepState } from "./types";

/** Every registry node the engine materializes: 26 steps + 3 parallel activities. */
export const ALL_NODES: (ProcessStep | ProcessActivity)[] = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];

export const ALL_NODE_KEYS: string[] = ALL_NODES.map((n) => n.key);

export function getNode(key: string): ProcessStep | ProcessActivity | null {
  return getStep(key) ?? getActivity(key);
}

export function isKnownStep(key: string): boolean {
  return getNode(key) !== null;
}

// ------------------------------------------------------- step state machine ----

/**
 * Legal step-state transitions.
 *
 * REJECTED is TERMINAL for an attempt: a correction is a NEW execution row
 * (correction_of_id), never a mutation of the rejected one. That is what makes
 * "no overwrite of prior review" structural rather than a convention.
 */
const ALLOWED_STEP_TRANSITIONS: Record<StepState, StepState[]> = {
  PENDING: ["AVAILABLE", "SKIPPED", "CANCELLED", "UNVERIFIED_HISTORICAL"],
  AVAILABLE: ["ACTIVE", "BLOCKED", "PENDING", "SKIPPED", "CANCELLED"],
  ACTIVE: ["SUBMITTED", "COMPLETED", "BLOCKED", "CANCELLED"],
  BLOCKED: ["ACTIVE", "AVAILABLE", "CANCELLED"],
  SUBMITTED: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["COMPLETED"],
  REJECTED: [],
  COMPLETED: [],
  SKIPPED: [],
  CANCELLED: [],
  UNVERIFIED_HISTORICAL: [],
};

export function canTransitionStep(from: StepState, to: StepState): boolean {
  return ALLOWED_STEP_TRANSITIONS[from].includes(to);
}

export function nextStepStates(from: StepState): StepState[] {
  return [...ALLOWED_STEP_TRANSITIONS[from]];
}

// ----------------------------------------------------------- prerequisites ----

/** The minimal execution shape the pure core needs. */
export type ExecutionView = {
  stepKey: string;
  state: StepState;
  submittedBy?: string | null;
  reviewedBy?: string | null;
};

/** Index executions by step key, keeping the LIVE attempt (not a rejected one). */
export function liveByKey(executions: ExecutionView[]): Map<string, ExecutionView> {
  const m = new Map<string, ExecutionView>();
  for (const e of executions) {
    if (e.state === "REJECTED" || e.state === "CANCELLED") continue;
    m.set(e.stepKey, e);
  }
  return m;
}

/** A step's prerequisites are met when every prerequisite step is DONE. */
export function prerequisitesMet(stepKey: string, executions: ExecutionView[]): boolean {
  const node = getNode(stepKey);
  if (!node) return false;
  const live = liveByKey(executions);
  return node.prerequisites.every((p) => {
    const e = live.get(p);
    return !!e && isDone(e.state);
  });
}

/** Which prerequisite steps are NOT yet done. Drives the "blocked by" display. */
export function missingPrerequisites(stepKey: string, executions: ExecutionView[]): string[] {
  const node = getNode(stepKey);
  if (!node) return [];
  const live = liveByKey(executions);
  return node.prerequisites.filter((p) => {
    const e = live.get(p);
    return !e || !isDone(e.state);
  });
}

/**
 * Steps whose prerequisites are now met but which are still PENDING — i.e. the
 * work that should open up. Deliberately does NOT consider gates: a step can be
 * available and still be gate-blocked (pickup), which the caller reports
 * separately so the two reasons never get conflated.
 */
export function evaluateAvailableSteps(executions: ExecutionView[]): string[] {
  const live = liveByKey(executions);
  const out: string[] = [];
  for (const node of ALL_NODES) {
    const e = live.get(node.key);
    if (!e || e.state !== "PENDING") continue;
    if (prerequisitesMet(node.key, executions)) out.push(node.key);
  }
  return out;
}

// ------------------------------------------------------------ maker-checker ----

export type MakerCheckerDecision =
  | { allowed: true }
  | { allowed: false; reason: "self_validation_forbidden" | "override_not_allowed" | "reason_required" };

export type OverrideContext = {
  /** EFFITRANS_PROCESS_OVERRIDE_ENABLED — off by default. */
  overrideFlagOn: boolean;
  /** The actor holds `process:override`. Granted to NO role by default. */
  hasOverridePermission: boolean;
  /** Mandatory justification when overriding. */
  overrideReason?: string | null;
};

/**
 * May `checkerId` approve/reject work submitted by `makerId`?
 *
 * The default is a hard NO on self-validation. The override seam requires ALL of:
 * the flag on, the `process:override` permission (granted to no role by default),
 * and a non-empty justification. Any one missing => refused. Self-validation is
 * therefore impossible to reach by accident.
 */
export function evaluateMakerChecker(
  makerId: string | null | undefined,
  checkerId: string,
  ctx: OverrideContext,
): MakerCheckerDecision {
  if (!makerId || makerId !== checkerId) return { allowed: true };

  // From here on the checker IS the maker.
  if (!ctx.overrideFlagOn || !ctx.hasOverridePermission) {
    return { allowed: false, reason: ctx.overrideFlagOn ? "override_not_allowed" : "self_validation_forbidden" };
  }
  if (!ctx.overrideReason || ctx.overrideReason.trim().length === 0) {
    return { allowed: false, reason: "reason_required" };
  }
  return { allowed: true };
}

/** The registry's three independent-review pairs, indexed by the VALIDATOR step. */
const PAIR_BY_VALIDATOR = new Map(MAKER_CHECKER_PAIRS.map((p) => [p.validatorStep, p]));
/** ...and by the PREPARER step. */
const PAIR_BY_PREPARER = new Map(MAKER_CHECKER_PAIRS.map((p) => [p.preparerStep, p]));

/** True when this step's work must be independently reviewed before it completes. */
export function requiresIndependentReview(stepKey: string): boolean {
  return PAIR_BY_PREPARER.has(stepKey);
}

/** True when this step IS the review of another step. */
export function isValidationStep(stepKey: string): boolean {
  return PAIR_BY_VALIDATOR.has(stepKey);
}

/** The preparer step this validation step reviews, if any. */
export function preparerStepFor(validatorStepKey: string): string | null {
  return PAIR_BY_VALIDATOR.get(validatorStepKey)?.preparerStep ?? null;
}

/** Where a rejection at this validation step sends the work back to. */
export function correctionStepFor(validatorStepKey: string): string | null {
  return PAIR_BY_VALIDATOR.get(validatorStepKey)?.correctionStep ?? null;
}

// ---------------------------------------------------------------- branches ----

export type BranchView = {
  group: "customs" | "transport_readiness";
  /** Steps currently open in this branch. */
  active: string[];
  completed: string[];
  blocked: string[];
  /** True when every step in the branch is done. */
  complete: boolean;
};

/**
 * Branch state. The two branches are SIBLINGS, never parent/child: neither is
 * represented as a status of the other, and each is summarized independently so
 * one can be finished while the other is still running.
 */
export function evaluateBranch(
  group: "customs" | "transport_readiness",
  executions: ExecutionView[],
): BranchView {
  const live = liveByKey(executions);
  const nodes = ALL_NODES.filter((n) => n.parallelGroup === group);

  const active: string[] = [];
  const completed: string[] = [];
  const blocked: string[] = [];

  for (const n of nodes) {
    const e = live.get(n.key);
    if (!e) continue;
    if (isDone(e.state)) completed.push(n.key);
    else if (e.state === "BLOCKED") blocked.push(n.key);
    else if (e.state === "ACTIVE" || e.state === "SUBMITTED" || e.state === "AVAILABLE") active.push(n.key);
  }

  return { group, active, completed, blocked, complete: completed.length === nodes.length };
}

// ------------------------------------------------------- closure readiness ----

export type ClosureInput = {
  executions: ExecutionView[];
  /** From the evidence checker: is the dossier fully paid? */
  fullyPaid: boolean;
  /** POD received (an APPROVED delivery note exists). */
  podReceived: boolean;
};

export type ClosureReadiness = {
  ready: boolean;
  /** Human-readable reason codes. Empty when ready. */
  missing: string[];
};

/**
 * DELIVERED != CLOSED. A dossier may only close when it is fully paid AND
 * operationally complete. This is the rule the legacy canCloseFile() never had:
 * it checked customs release only, so an unbilled, unpaid dossier could be closed.
 */
export function evaluateClosureReadiness(input: ClosureInput): ClosureReadiness {
  const missing: string[] = [];
  const live = liveByKey(input.executions);

  if (!input.podReceived) missing.push("pod_not_received");
  if (!input.fullyPaid) missing.push("not_fully_paid");

  // Every step that is neither done nor deliberately skipped must be finished.
  // UNVERIFIED_HISTORICAL does NOT count as done — a legacy dossier cannot be
  // closed by the engine on the strength of evidence nobody ever captured.
  for (const node of ALL_NODES) {
    const e = live.get(node.key);
    if (!e) {
      missing.push(`step_missing:${node.key}`);
      continue;
    }
    if (e.state === "UNVERIFIED_HISTORICAL") {
      missing.push(`step_unverified:${node.key}`);
      continue;
    }
    if (!isDone(e.state)) missing.push(`step_incomplete:${node.key}`);
  }

  return { ready: missing.length === 0, missing };
}
