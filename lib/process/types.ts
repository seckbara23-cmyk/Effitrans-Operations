/**
 * Official Effitrans process — types (Phase 5.0A) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Shape of the canonical 26-step registry defined in `effitrans-process.ts`.
 * This is a DESCRIPTION of the official business process, not an engine: nothing
 * here reads or writes state. Phase 5.0B derives a live process instance per
 * dossier from existing records (operational_file, document, customs_record,
 * transport_record, invoice, payment, task) against this registry.
 *
 * `implementation` carries the Phase 5.0A audit verdict per step so the
 * traceability matrix stays machine-checkable instead of rotting in a markdown
 * table. See docs/phase-5.0a-workflow-traceability.md.
 */

/** The nine phases of the official process. */
export type ProcessPhase =
  | "cotation"
  | "intake"
  | "preparation"
  | "customs"
  | "transport_readiness"
  | "delivery"
  | "completeness"
  | "billing"
  | "deposit"
  | "collections";

/**
 * Responsible department — one per official queue (Deliverable 5).
 * NOTE: no `department` table exists in the schema; departments are a routing
 * concept. The five legacy UI department keys (documentation/customs/transport/
 * finance/management) are a DIFFERENT, coarser taxonomy — see `LEGACY_DEPT` in
 * effitrans-process.ts for the bridge.
 */
export type ProcessDepartment =
  | "cotation"
  | "operations"
  | "account_management"
  | "coordination"
  | "transit"
  | "customs_declaration"
  | "finance_customs"
  | "customs_field"
  | "transport"
  | "pickup"
  | "billing"
  | "finance"
  | "administration"
  | "courier"
  | "collections";

/** The 15 official business roles. Mapped to real tenant roles in `roles.ts`. */
export type ProcessRole =
  | "COTATION_OFFICER"
  | "OPERATIONS_MANAGER"
  | "ACCOUNT_MANAGER"
  | "COORDINATOR"
  | "CHIEF_TRANSIT"
  | "CUSTOMS_DECLARANT"
  | "CUSTOMS_FINANCE_OFFICER"
  | "CUSTOMS_FIELD_AGENT"
  | "TRANSPORT_OFFICER"
  | "PICKUP_AGENT"
  | "BILLING_OFFICER"
  | "FINANCE_OFFICER"
  | "ADMINISTRATIVE_OFFICER"
  | "COURIER"
  | "COLLECTIONS_OFFICER";

/**
 * Parallel execution group. Steps in different groups may progress independently;
 * steps in `main` are strictly sequential. The two branches converge at the
 * pickup join gate (step 15) — see `PICKUP_READINESS` in effitrans-process.ts.
 */
export type ParallelGroup = "main" | "customs" | "transport_readiness";

/** Customer-safe journey stage (Deliverable 11). `null` = internal-only step. */
export type ClientJourneyStage =
  | "request_received"
  | "documentation_in_preparation"
  | "customs_processing"
  | "customs_released"
  | "transport_preparation"
  | "pickup_completed"
  | "in_transit"
  | "delivered"
  | "invoice_issued"
  | "payment_closure";

/** Phase 5.0A audit verdict. `implemented` means usable as-is, no new work. */
export type ImplementationVerdict = "implemented" | "partial" | "missing";

export type StepImplementation = {
  verdict: ImplementationVerdict;
  /** Existing tables/columns/functions that already serve this step, if any. */
  existing: string[];
  /** What the official process requires that the platform does not do today. */
  gaps: string[];
};

export type ProcessStep = {
  /** 1..26, contiguous and unique. The official numbering — never renumber. */
  stepNumber: number;
  /** Stable key. Safe to persist and to reference from tests. Never rename. */
  key: string;
  labelFr: string;
  /** Internal (staff-facing) label. May name departments, validations, blockers. */
  internalLabel: string;
  /**
   * Customer-safe stage this step rolls up to, or `null` when the step must never
   * be visible to the client (internal validation loops, spending authorisations,
   * collection notes, customs internals).
   */
  clientStage: ClientJourneyStage | null;
  phase: ProcessPhase;
  department: ProcessDepartment;
  role: ProcessRole;
  description: string;
  /** Step keys that must be complete before this step may start. */
  prerequisites: string[];
  /** Official document keys (see `documents.ts`) this step consumes or produces. */
  requiredDocuments: string[];
  /** Non-document evidence the step must record (reference, date, actor, ...). */
  requiredEvidence: string[];
  /** Stable code for the completion predicate the 5.0B engine will implement. */
  completionRule: string;
  /** Where rejected/corrected work returns to. `null` = no rejection path. */
  rejectsTo: string | null;
  /** Step keys reachable once this step completes. */
  nextSteps: string[];
  parallelGroup: ParallelGroup;
  /** Key into PROCESS_SLA_POLICIES. All values are unconfigured in 5.0A. */
  slaPolicyKey: string;
  /**
   * Permission required to action this step. Codes that do not exist yet are
   * listed in `MISSING_PERMISSIONS` — do NOT assume these are grantable today.
   */
  permissions: string[];
  implementation: StepImplementation;
};

/**
 * A parallel-branch activity. The official document lists these under the
 * Account Manager's parallel branch WITHOUT step numbers, so they are not part
 * of the 26 — but they are hard prerequisites of the pickup join gate.
 */
export type ProcessActivity = Omit<ProcessStep, "stepNumber" | "rejectsTo"> & {
  stepNumber: null;
};

/** A maker-checker pair: `preparer` drafts, `validator` independently approves. */
export type MakerCheckerPair = {
  key: string;
  preparerStep: string;
  validatorStep: string;
  /** Rejection returns the work here. */
  correctionStep: string;
  /** When false, the preparer may never also be the validator (no self-approval). */
  selfApprovalAllowed: false;
  reasonRequired: true;
};

/** One requirement of a join gate. */
export type GateRequirement = {
  key: string;
  labelFr: string;
  /** Only enforced for these dossier types. Empty = all types. */
  appliesToFileTypes: string[];
  /** Which parallel branch satisfies this requirement. */
  branch: ParallelGroup;
};
