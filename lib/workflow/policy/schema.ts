/**
 * Workflow policy — the typed contract (Phase WES-7A). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * ADR-WES-012: the engine is reusable software, business policy is versioned
 * configuration. This module declares WHAT policy is. It declares nothing about
 * how it is stored, resolved or validated — those are ./resolver and ./validate.
 *
 * THE BOUNDARY (restated so it cannot be eroded by a later edit):
 *
 *   CODE, never configurable — tenant isolation · RLS · the permission catalog ·
 *   legal state-machine transitions · CAS and idempotency · maker-checker
 *   IDENTITY separation · the monotonic lifecycle · audit requirements ·
 *   append-only ledgers · the evidence-evaluation FRAMEWORK · the canonical
 *   projection and its single progress formula.
 *
 *   CONFIGURATION — the seven domains below. Each one is a decision the business
 *   is expected to vary by tenant, shipment type, transport mode or procedure.
 *
 * Everything here is a stable IDENTIFIER, never a display label: policy that
 * carried French copy as its identity would break the moment someone edited a
 * translation.
 */

/**
 * Bumped only when the SHAPE changes incompatibly. A stored version declaring an
 * unknown schema version is rejected at validation — never coerced.
 */
export const POLICY_SCHEMA_VERSION = 1;

// ============================================================ domain 1: applicability ==

/**
 * Facts a dossier can be judged against. Deliberately a CLOSED vocabulary: an
 * open-ended condition language would be an expression evaluator, which
 * ADR-WES-012 rejects (it cannot be validated fail-closed).
 */
export const APPLICABILITY_FACTS = [
  "file_type_imp",
  "file_type_exp",
  "file_type_trp",
  "file_type_hnd",
  "mode_sea",
  "mode_air",
  "mode_road",
  "mode_multimodal",
  "has_customs_leg",
  "requires_finance",
  "requires_delivery",
] as const;
export type ApplicabilityFact = (typeof APPLICABILITY_FACTS)[number];

/**
 * A stage/step applies when ANY listed fact holds. An empty list (or an absent
 * entry) means "always applies" — the same default the existing
 * STEP_APPLICABILITY registry uses.
 */
export type ApplicabilityRule = {
  /** Registry step key this rule governs. */
  stepKey: string;
  /** Applies when any of these facts is true. Empty ⇒ always applicable. */
  anyOf: ApplicabilityFact[];
};

// ==================================================== domain 2: department responsibility ==

/** Which workflow department owns a step. Never spelled in a UI component. */
export type DepartmentBinding = {
  stepKey: string;
  /** A `ProcessDepartment` code. Validated against the registry. */
  department: string;
};

// ========================================================= domain 3: seat / role bindings ==

/** The business functions a policy may bind roles to. */
export const SEAT_FUNCTIONS = [
  "uploader",
  "verifier",
  "checker",
  "assignee",
  "supervisor",
  "handoff_recipient",
] as const;
export type SeatFunction = (typeof SEAT_FUNCTIONS)[number];

/**
 * Which tenant roles may perform a function at a step. Roles must already exist
 * in the canonical role registry — policy never invents a role code, and never
 * grants a capability outside the permission catalog.
 */
export type SeatBinding = {
  stepKey: string;
  seat: SeatFunction;
  /** Tenant role codes. Validated against the role registry. */
  roles: string[];
  /**
   * Identity-bound seats (e.g. "the document's own requester") carry no role.
   * `true` means the seat is satisfied by identity, and `roles` must be empty.
   */
  identityBound?: boolean;
};

// ========================================================== domain 4: evidence requirements ==

/** Evidence a step requires before it may complete. */
export type EvidenceRequirement = {
  stepKey: string;
  /** `document_type.code` values. Validated against the document catalog. */
  documentTypeCodes: string[];
  /** Non-document evidence keys the engine already understands. */
  evidenceKeys: string[];
  /** Every listed document must be VERIFIED, not merely uploaded. */
  requiresVerification: boolean;
};

// ================================================================ domain 5: handoff routing ==

export type HandoffBinding = {
  /** Registry step key the work leaves from. */
  fromStepKey: string;
  /** Registry step key the work arrives at. */
  toStepKey: string;
  /** Receiving department code. */
  targetDepartment: string;
  /** Receiving seat — a tenant role code, or null when routed by department. */
  targetRole: string | null;
  /** The receiver must explicitly accept before the target step opens (ADR-WES-009). */
  requiresExplicitReception: boolean;
  /** Notify the target seat on send. The notification MECHANISM stays code. */
  notifyOnSend: boolean;
};

// ================================================== domain 6: supervisor intervention ==

/**
 * What a department supervisor may do inside their department. Every `true`
 * here still passes through the code-level audit + reason requirements: policy
 * may narrow authority, never widen it past an invariant.
 */
export type SupervisorPolicy = {
  department: string;
  mayReassign: boolean;
  mayCompleteByIntervention: boolean;
  mayVerify: boolean;
  mayRequestCorrection: boolean;
  /** Intervention requires a written reason. Cannot be disabled (validated). */
  requiresReason: true;
};

// =========================================================== domain 7: SLA slots (WES-8) ==

/**
 * The versioned CONTRACT for SLA targets. WES-7 stores and validates these;
 * NOTHING computes with them. The engine, the clocks, the calendars and the
 * escalation processing are WES-8.
 */
export const SLA_UNITS = ["hours", "days"] as const;
export type SlaUnit = (typeof SLA_UNITS)[number];

export type SlaTarget = {
  /** Key into the existing SLA policy registry (lib/process/sla-policies.ts). */
  policyKey: string;
  unit: SlaUnit;
  /** Null ⇒ deliberately unconfigured. An unconfigured target NEVER breaches. */
  target: number | null;
  warningThreshold: number | null;
  breachThreshold: number | null;
  /** Tenant role codes notified on escalation. */
  escalationRoles: string[];
  /** Business calendar identifier. Resolved by WES-8; opaque here. */
  businessCalendarId: string | null;
  /** Reference to the pause semantics WES-8 will implement. Opaque here. */
  pauseSemanticsRef: string | null;
};

// ================================================================== the policy document ==

/**
 * ONE document per version, covering every domain. A single document means a
 * dossier pins ONE identifier and its rules are internally consistent — two
 * independently-versioned domains could pin to a combination nobody validated.
 */
export type WorkflowPolicyDocument = {
  policySchemaVersion: number;
  /** Free-text operator note. Never load-bearing. */
  description: string;
  applicability: ApplicabilityRule[];
  departments: DepartmentBinding[];
  seats: SeatBinding[];
  evidence: EvidenceRequirement[];
  handoffs: HandoffBinding[];
  supervisors: SupervisorPolicy[];
  sla: SlaTarget[];
};

/** The exact top-level keys a document may carry. Unknown keys are REJECTED. */
export const POLICY_DOCUMENT_KEYS: readonly (keyof WorkflowPolicyDocument)[] = [
  "policySchemaVersion",
  "description",
  "applicability",
  "departments",
  "seats",
  "evidence",
  "handoffs",
  "supervisors",
  "sla",
] as const;

// ===================================================================== version lifecycle ==

export const POLICY_STATUSES = ["DRAFT", "VALIDATED", "ACTIVE", "RETIRED"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/**
 * Legal status transitions. A published (ACTIVE/RETIRED) version is immutable —
 * editing one creates a NEW draft, it never mutates in place.
 */
const POLICY_TRANSITIONS: Record<PolicyStatus, PolicyStatus[]> = {
  DRAFT: ["VALIDATED"],
  VALIDATED: ["ACTIVE", "DRAFT"], // back to DRAFT when edited after validation
  ACTIVE: ["RETIRED"],
  RETIRED: [],
};

export function canTransitionPolicy(from: PolicyStatus, to: PolicyStatus): boolean {
  return POLICY_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Published versions may never be edited in place. */
export function isPublished(status: PolicyStatus): boolean {
  return status === "ACTIVE" || status === "RETIRED";
}

export function isPolicyStatus(v: string): v is PolicyStatus {
  return (POLICY_STATUSES as readonly string[]).includes(v);
}

/**
 * How a dossier came to be governed by its policy version. `LEGACY_DEFAULT` is
 * the honest marker for a dossier that predates the registry: its history was
 * never governed by a recorded version and the platform does not pretend
 * otherwise (WES-7C — no fabricated provenance).
 */
export const POLICY_PROVENANCES = ["PINNED", "LEGACY_DEFAULT", "MIGRATED"] as const;
export type PolicyProvenance = (typeof POLICY_PROVENANCES)[number];

export function isPolicyProvenance(v: string): v is PolicyProvenance {
  return (POLICY_PROVENANCES as readonly string[]).includes(v);
}

/** A resolved version, as every consumer sees it. */
export type ResolvedPolicy = {
  versionId: string;
  /** null ⇒ the platform default. */
  tenantId: string | null;
  version: number;
  contentSha256: string;
  provenance: PolicyProvenance;
  document: WorkflowPolicyDocument;
};
