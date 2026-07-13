/**
 * Process engine — persisted types (Phase 5.0B). PURE.
 * ---------------------------------------------------------------------------
 * The row shapes of the three engine tables. Everything the official process
 * MEANS (labels, prerequisites, permissions, required documents, parallel groups,
 * join gates) lives in the Phase 5.0A registry and is NEVER stored here — a row
 * carries a `step_key` and nothing more about that step's definition.
 */

/** process_instance.status — the OFFICIAL PROCESS truth for a dossier. */
export const PROCESS_STATUSES = [
  "ACTIVE",
  "COMPLETED_OPERATIONALLY",
  "UNDER_BILLING",
  "UNDER_COLLECTION",
  "CLOSED",
  "CANCELLED",
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

/**
 * process_step_execution.state.
 *
 *   PENDING               prerequisites not met
 *   AVAILABLE             prerequisites met, nobody has picked it up
 *   ACTIVE               someone is working it
 *   BLOCKED              a gate or missing evidence stops it
 *   SUBMITTED            maker finished; awaiting an independent checker
 *   APPROVED             checker approved (maker-checker steps only)
 *   REJECTED             checker rejected — terminal for THIS attempt; a
 *                        correction attempt is a NEW row (correction_of_id)
 *   COMPLETED            done
 *   SKIPPED              not applicable to this dossier (e.g. cotation for a
 *                        contract client; customs for a TRP/HND dossier)
 *   CANCELLED            the instance was cancelled
 *   UNVERIFIED_HISTORICAL  a legacy dossier passed this point, but the platform
 *                        never captured the evidence. NEVER treat as completed.
 */
export const STEP_STATES = [
  "PENDING",
  "AVAILABLE",
  "ACTIVE",
  "BLOCKED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "COMPLETED",
  "SKIPPED",
  "CANCELLED",
  "UNVERIFIED_HISTORICAL",
] as const;
export type StepState = (typeof STEP_STATES)[number];

/** States that count as "this step is finished and its successors may open". */
export const TERMINAL_DONE_STATES: readonly StepState[] = ["COMPLETED", "APPROVED", "SKIPPED"];

/** States a step can be in while it still occupies someone's queue. */
export const OPEN_STATES: readonly StepState[] = ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"];

export const HANDOFF_STATUSES = ["SENT", "RECEIVED", "REJECTED", "CANCELLED"] as const;
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export type CompatibilitySource = "NATIVE" | "COMPATIBILITY_MAPPED";

export type ProcessInstanceRow = {
  id: string;
  tenantId: string;
  fileId: string;
  processVersion: string;
  status: ProcessStatus;
  compatibilitySource: CompatibilitySource;
  compatibilityVersion: string | null;
  startedAt: string;
  completedAt: string | null;
  closedAt: string | null;
};

export type StepExecutionRow = {
  id: string;
  processInstanceId: string;
  stepKey: string;
  stepNumber: number | null;
  state: StepState;
  assignedUserId: string | null;
  assignedRoleCode: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  receivedFromUserId: string | null;
  receivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  correctionOfId: string | null;
  overrideUsed: boolean;
  overrideReason: string | null;
  evidenceSummary: unknown;
};

export type HandoffRow = {
  id: string;
  processInstanceId: string;
  fromStepKey: string;
  toStepKey: string;
  sentBy: string;
  sentAt: string;
  receivedBy: string | null;
  receivedAt: string | null;
  status: HandoffStatus;
  rejectionReason: string | null;
  returnedToStepKey: string | null;
  dedupKey: string;
};

export function isStepState(v: string): v is StepState {
  return (STEP_STATES as readonly string[]).includes(v);
}

export function isProcessStatus(v: string): v is ProcessStatus {
  return (PROCESS_STATUSES as readonly string[]).includes(v);
}

export function isDone(state: StepState): boolean {
  return TERMINAL_DONE_STATES.includes(state);
}

export function isOpen(state: StepState): boolean {
  return OPEN_STATES.includes(state);
}

/** The uniform result shape every engine mutation returns. */
export type EngineResult<T = { id: string }> =
  | ({ ok: true } & T)
  | { ok: false; error: EngineError };

export type EngineError =
  | "engine_disabled"
  | "forbidden"
  | "not_found"
  | "unknown_step"
  | "invalid_state"
  | "prerequisites_unmet"
  | "evidence_missing"
  | "gate_blocked"
  | "self_validation_forbidden"
  | "override_not_allowed"
  | "reason_required"
  | "handoff_not_open"
  | "already_initialized"
  | "cross_tenant";
