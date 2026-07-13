/**
 * Process engine — instance materialization + historical compatibility.
 * PURE (no I/O). Phase 5.0B, Deliverable 10.
 * ---------------------------------------------------------------------------
 * Two ways an instance comes into existence:
 *
 *   NATIVE               a dossier opened under the engine. All 29 registry nodes
 *                        start PENDING; step 1 becomes AVAILABLE.
 *
 *   COMPATIBILITY_MAPPED a LEGACY dossier, mapped by the 5.0A compatibility
 *                        mapper. Steps BEFORE the mapped position are NOT marked
 *                        completed — the platform never captured that evidence.
 *                        They are UNVERIFIED_HISTORICAL, which:
 *                          * never satisfies a prerequisite,
 *                          * never satisfies a gate,
 *                          * never allows closure.
 *                        No approval, document, or payment is ever invented.
 */
import { ALL_NODES } from "./state";
import { mapDossierToOfficialStep, type CompatibilityInput } from "../compatibility";
import type { StepState } from "./types";

export const PROCESS_VERSION = "effitrans-v1";
export const COMPATIBILITY_VERSION = "compat-v1";

export type ExecutionInsert = {
  tenant_id: string;
  process_instance_id: string;
  step_key: string;
  step_number: number | null;
  state: StepState;
  assigned_role_code: string | null;
};

function baseRow(tenantId: string, instanceId: string, key: string): ExecutionInsert {
  const node = ALL_NODES.find((n) => n.key === key)!;
  return {
    tenant_id: tenantId,
    process_instance_id: instanceId,
    step_key: key,
    step_number: node.stepNumber,
    state: "PENDING",
    assigned_role_code: node.role,
  };
}

/** A brand-new dossier: everything PENDING except step 1, which is open. */
export function buildInitialExecutions(tenantId: string, instanceId: string): ExecutionInsert[] {
  return ALL_NODES.map((n) => {
    const row = baseRow(tenantId, instanceId, n.key);
    if (n.stepNumber === 1) row.state = "AVAILABLE";
    return row;
  });
}

export type CompatibilityPlan = {
  stepNumber: number | null;
  stepKey: string | null;
  confidence: string;
  notes: string[];
  executions: ExecutionInsert[];
  /** Counts, for the dry-run report. */
  summary: { unverified: number; active: number; pending: number };
};

/**
 * Plan (do not apply) the compatibility initialization for a legacy dossier.
 *
 * The caller decides whether to persist. This is what powers the admin-only
 * DRY-RUN report: no production backfill runs until the live status distribution
 * has been reviewed.
 */
export function planCompatibilityInit(
  tenantId: string,
  instanceId: string,
  input: CompatibilityInput,
): CompatibilityPlan {
  const mapping = mapDossierToOfficialStep(input);

  const executions = ALL_NODES.map((n) => {
    const row = baseRow(tenantId, instanceId, n.key);

    if (mapping.stepNumber === null) {
      row.state = "CANCELLED";
      return row;
    }

    const num = n.stepNumber;

    // Parallel activities have no number: they belong to the transport-readiness
    // branch and were never tracked, so they are unverified iff we are past the
    // point where they would have happened (pickup, step 15).
    if (num === null) {
      row.state = mapping.stepNumber > 15 ? "UNVERIFIED_HISTORICAL" : "PENDING";
      return row;
    }

    if (num < mapping.stepNumber) {
      // NEVER "COMPLETED". The dossier passed this point, but no evidence of the
      // official step was ever captured — so it is unverified, not done.
      row.state = "UNVERIFIED_HISTORICAL";
    } else if (num === mapping.stepNumber) {
      row.state = "ACTIVE";
    } else {
      row.state = "PENDING";
    }
    return row;
  });

  const count = (s: StepState) => executions.filter((e) => e.state === s).length;

  return {
    stepNumber: mapping.stepNumber,
    stepKey: mapping.stepKey,
    confidence: mapping.confidence,
    notes: mapping.notes,
    executions,
    summary: {
      unverified: count("UNVERIFIED_HISTORICAL"),
      active: count("ACTIVE"),
      pending: count("PENDING"),
    },
  };
}
