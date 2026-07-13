/**
 * Process engine — consolidated read model (Phase 5.0B, Deliverable 11). PURE.
 * ---------------------------------------------------------------------------
 * ONE object describing where a dossier stands in the official process. Built
 * from a single bounded snapshot (see ./snapshot) — no N+1, and the pure core
 * makes every decision.
 *
 * Deliberately free of I/O so it can be exhaustively unit-tested.
 */
import { CLIENT_JOURNEY, getStep } from "../effitrans-process";
import { getSlaPolicy, SLA_UNCONFIGURED_LABEL } from "../sla-policies";
import type { ClientJourneyStage, ProcessPhase } from "../types";
import type { EvidenceSnapshot } from "./evidence";
import { evaluateBillingGate, evaluateClosureGate, evaluatePickupGate, type GateResult } from "./gates";
import {
  evaluateBranch,
  getNode,
  liveByKey,
  missingPrerequisites,
  type BranchView,
  type ExecutionView,
} from "./state";
import { isDone, isOpen, type HandoffRow, type ProcessInstanceRow, type StepExecutionRow } from "./types";

export type StepView = {
  stepKey: string;
  stepNumber: number | null;
  labelFr: string;
  state: string;
  phase: ProcessPhase | null;
  department: string | null;
  role: string | null;
  assignedUserId: string | null;
  missingPrerequisites: string[];
  /** SLA policy state. Never fabricates an overdue status for an unset policy. */
  sla: { policyKey: string; state: string; label: string };
  rejectionReason: string | null;
  correctionOfId: string | null;
  overrideUsed: boolean;
};

export type ProcessReadModel = {
  processVersion: string;
  status: string;
  compatibilitySource: string;
  compatibilityVersion: string | null;
  /** How much of this instance is real evidence vs inferred from a legacy dossier. */
  compatibilityConfidence: "native" | "mapped_with_unverified_steps" | "mapped";
  currentPhase: ProcessPhase | null;
  activeSteps: StepView[];
  completedSteps: string[];
  blockedSteps: StepView[];
  unverifiedSteps: string[];
  branches: { customs: BranchView; transportReadiness: BranchView };
  /** The single owner to chase, when there is exactly one active step. */
  currentOwner: { role: string | null; userId: string | null } | null;
  pendingHandoff: HandoffRow | null;
  /** Steps sitting in a rejection/correction loop right now. */
  correctionState: { stepKey: string; reason: string | null; correctionOfId: string | null }[];
  pickupReadiness: GateResult;
  billingReadiness: GateResult;
  closureReadiness: GateResult;
  clientStage: ClientJourneyStage | null;
};

function slaFor(stepKey: string): StepView["sla"] {
  const node = getNode(stepKey);
  const key = node?.slaPolicyKey ?? "";
  const p = getSlaPolicy(key);
  if (!p || p.state === "unconfigured") {
    return { policyKey: key, state: "unconfigured", label: SLA_UNCONFIGURED_LABEL };
  }
  return { policyKey: key, state: p.state, label: p.labelFr };
}

function toStepView(e: StepExecutionRow, executions: ExecutionView[]): StepView {
  const node = getNode(e.stepKey);
  return {
    stepKey: e.stepKey,
    stepNumber: e.stepNumber,
    labelFr: node?.labelFr ?? e.stepKey,
    state: e.state,
    phase: node?.phase ?? null,
    department: node?.department ?? null,
    role: node?.role ?? null,
    assignedUserId: e.assignedUserId,
    missingPrerequisites: missingPrerequisites(e.stepKey, executions),
    sla: slaFor(e.stepKey),
    rejectionReason: e.rejectionReason,
    correctionOfId: e.correctionOfId,
    overrideUsed: e.overrideUsed,
  };
}

export function buildReadModel(
  instance: ProcessInstanceRow,
  executions: StepExecutionRow[],
  handoffs: HandoffRow[],
  snap: EvidenceSnapshot,
): ProcessReadModel {
  const views: ExecutionView[] = executions.map((e) => ({
    stepKey: e.stepKey,
    state: e.state,
    submittedBy: e.submittedBy,
    reviewedBy: e.reviewedBy,
  }));
  const live = liveByKey(views);

  const liveExecs = executions.filter((e) => e.state !== "REJECTED" && e.state !== "CANCELLED");

  const active = liveExecs.filter((e) => isOpen(e.state) && e.state !== "BLOCKED");
  const blocked = liveExecs.filter((e) => e.state === "BLOCKED");
  const completed = liveExecs.filter((e) => isDone(e.state)).map((e) => e.stepKey);
  const unverified = liveExecs.filter((e) => e.state === "UNVERIFIED_HISTORICAL").map((e) => e.stepKey);

  // The frontier's phase: the lowest-numbered active step drives "where we are".
  const frontier = [...active].sort(
    (a, b) => (a.stepNumber ?? 99) - (b.stepNumber ?? 99),
  )[0];
  const frontierNode = frontier ? getNode(frontier.stepKey) : null;

  const activeViews = active.map((e) => toStepView(e, views));

  const currentOwner =
    active.length === 1 && frontierNode
      ? { role: frontierNode.role, userId: frontier!.assignedUserId }
      : null;

  const pendingHandoff = handoffs.find((h) => h.status === "SENT") ?? null;

  // A correction attempt is a live row that points at the rejection it corrects.
  const correctionState = liveExecs
    .filter((e) => e.correctionOfId !== null)
    .map((e) => {
      const rejected = executions.find((x) => x.id === e.correctionOfId);
      return {
        stepKey: e.stepKey,
        reason: rejected?.rejectionReason ?? null,
        correctionOfId: e.correctionOfId,
      };
    });

  const compatibilityConfidence: ProcessReadModel["compatibilityConfidence"] =
    instance.compatibilitySource === "NATIVE"
      ? "native"
      : unverified.length > 0
        ? "mapped_with_unverified_steps"
        : "mapped";

  const clientStage =
    frontierNode?.clientStage ??
    // Fall back to the last customer-visible stage we actually reached.
    [...CLIENT_JOURNEY]
      .reverse()
      .find((s) => completed.some((k) => getStep(k)?.clientStage === s.key))?.key ??
    null;

  return {
    processVersion: instance.processVersion,
    status: instance.status,
    compatibilitySource: instance.compatibilitySource,
    compatibilityVersion: instance.compatibilityVersion,
    compatibilityConfidence,
    currentPhase: frontierNode?.phase ?? null,
    activeSteps: activeViews,
    completedSteps: completed,
    blockedSteps: blocked.map((e) => toStepView(e, views)),
    unverifiedSteps: unverified,
    branches: {
      customs: evaluateBranch("customs", views),
      transportReadiness: evaluateBranch("transport_readiness", views),
    },
    currentOwner,
    pendingHandoff,
    correctionState,
    pickupReadiness: evaluatePickupGate(snap, views),
    billingReadiness: evaluateBillingGate(views, snap),
    closureReadiness: evaluateClosureGate(views, snap),
    clientStage,
  };
}
