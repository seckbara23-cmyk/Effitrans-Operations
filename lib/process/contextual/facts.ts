import "server-only";
/**
 * THE loader. One bounded read of a dossier, turned into the facts every
 * step-execution surface needs.
 * ---------------------------------------------------------------------------
 * WHY IT EXISTS. `evaluateStepAction` has always been pure and shared, and the
 * two surfaces that read it still disagreed three provable ways — because there
 * was no loader. Each caller assembled the facts itself, from whatever it
 * happened to have in scope: the queue folded evidence into its blocker and the
 * process page did not, `awaitingReception` was a hand-rolled SENT-only boolean
 * on both, and neither knew the owning role at all. Adding a third surface on
 * top of that would have inherited every one of those.
 *
 * So the fix is not another evaluator. It is the missing half of the one that
 * exists: this module produces the facts, `evaluateStepAction` decides, and no
 * surface derives authority of its own.
 *
 * WHAT IT COSTS. Two bounded queries on top of the snapshot the caller already
 * pays for — `app_user` names and `process_step_owning_role` — both batched over
 * the whole dossier, never per step. No N+1 by construction: nothing in here
 * runs inside a loop over steps.
 *
 * WHAT IT MUST NOT DO, and the reason is a defect that already happened once:
 * it must never read `snap.documents` / `customs` / `transport` / `invoices`
 * directly. Those arrays are PERMISSION-FILTERED, so a BILLING_OFFICER (who
 * holds no `document:read`) sees an empty documents array and every evidence
 * item would read « missing » rather than « you cannot see this ». Evidence goes
 * through `evaluateStepEvidence`, which reports `unauthorized` honestly — that
 * is what `gate-authority.ts` was written to protect and what this respects.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { scopedFrom } from "@/lib/db/tenant-scope";
import { toViews } from "../engine/snapshot";
import { evaluateStepEvidence } from "../engine/evidence";
import { getNode } from "../engine/state";
import { assigneeLabelMap, resolveAssigneeLabel, type AssigneeRow } from "../assignee-label";
import { buildStepFacts } from "./build";
import { owningRoleByStepKey } from "./owning-roles";
import { scopeFromRow, stepApplicability, type ServiceScope } from "../service-scope";
import { roleLabel } from "@/lib/navigation/roles";
import type { ParallelGroup } from "../types";
import type { StepActionFacts } from "../step-eligibility";
import { loadProcessSnapshotForDisplay } from "../engine/snapshot-cache";

type Row = Record<string, unknown>;

/** One step of a dossier, with everything a surface needs and nothing it does not. */
export type ContextualStep = {
  facts: StepActionFacts;
  stepNumber: number | null;
  labelFr: string;
  department: string | null;
  /** Which branch of the graph — main, customs, transport_readiness. */
  branch: ParallelGroup;
  /** The owning role in French. Never a role CODE on a screen. */
  ownerLabelFr: string | null;
  /** Who holds it, ready to render. Null when nothing is claimed. */
  assigneeLabel: string | null;
  /** Deep link target on the official-process page. */
  anchor: string;
};

export type ContextualDossier = {
  fileId: string;
  /** false when the dossier has no process instance — every surface degrades. */
  hasInstance: boolean;
  /**
   * Which services Effitrans is providing here (OPS-SERVICE-SCOPE-01). Derived
   * from the dossier type today — no production row carries an explicit choice
   * yet — and UNKNOWN never removes a step.
   */
  scope: ServiceScope;
  steps: ContextualStep[];
  /** The claimant lookup FAILED, as distinct from returning no row. */
  assigneeLookupFailed: boolean;
};

/** Display labels for the users who hold steps. ONE read for the whole dossier. */
async function assigneeLabels(
  tenantId: string,
  userIds: readonly string[],
): Promise<{ names: Map<string, string>; failed: boolean }> {
  if (userIds.length === 0) return { names: new Map(), failed: false };
  const admin = getAdminSupabaseClient();
  const res = await scopedFrom(admin, "app_user", tenantId)
    .select("id, name, email")
    .in("id", [...userIds]);
  // A failed lookup and an absent row are different facts, and saying « une
  // autre personne » for the first asserts something we have not established.
  if (res.error) return { names: new Map(), failed: true };
  return { names: assigneeLabelMap((res.data ?? []) as unknown as AssigneeRow[]), failed: false };
}

/**
 * Load every fact the step surfaces need for one dossier.
 *
 * `permissions` must be the CALLER's, not a widened set: the evidence snapshot
 * is built from them and `evaluateStepEvidence` turns an unreadable module into
 * `unauthorized`, which is information the operator is entitled to.
 */
export async function loadContextualStepFacts(
  fileId: string,
  viewer: { tenantId: string; permissions: readonly string[] },
): Promise<ContextualDossier | null> {
  const snap = await loadProcessSnapshotForDisplay(viewer.tenantId, fileId, viewer.permissions);
  if (!snap) return null;
  const scope = scopeFromRow({
    type: snap.evidence.fileType,
    services: snap.evidence.services,
  });
  if (!snap.instance) {
    return { fileId, hasInstance: false, scope, steps: [], assigneeLookupFailed: false };
  }

  const views = toViews(snap.executions);
  const stepKeys = snap.executions.map((e) => e.stepKey);
  const assignedIds = [
    ...new Set(snap.executions.map((e) => e.assignedUserId).filter((v): v is string => !!v)),
  ];

  const [ownerByStep, { names, failed }] = await Promise.all([
    owningRoleByStepKey(stepKeys),
    assigneeLabels(viewer.tenantId, assignedIds),
  ]);

  const steps: ContextualStep[] = snap.executions.map((e) => {
    const node = getNode(e.stepKey);
    // APPLICABILITY FIRST. Asked before evidence and before timing, so a step
    // belonging to a service Effitrans is not providing never reaches the
    // evaluator as « missing ».
    const applicability = stepApplicability(e.stepKey, scope);
    return {
      // ONE construction, shared with the queue — see contextual/build.ts. The
      // queue reads many dossiers from its own batch and this reads one from
      // the snapshot, so they cannot share a query; they share this instead.
      facts: buildStepFacts({
        stepKey: e.stepKey,
        state: e.state,
        assignedUserId: e.assignedUserId ?? null,
        handoffs: snap.handoffs,
        views,
        evidence: evaluateStepEvidence(e.stepKey, snap.evidence),
        owningRole: ownerByStep.get(e.stepKey) ?? null,
        scope,
        notApplicable: applicability.applicable
          ? null
          : { service: applicability.service, reasonFr: applicability.reasonFr },
      }),
      stepNumber: node?.stepNumber ?? null,
      labelFr: node?.labelFr ?? e.stepKey,
      department: node?.department ?? null,
      branch: node?.parallelGroup ?? "main",
      ownerLabelFr: node?.role ? roleLabel(node.role) : null,
      assigneeLabel: resolveAssigneeLabel({
        assignedUserId: e.assignedUserId ?? null,
        names,
        lookupFailed: failed,
      }),
      anchor: `/files/${fileId}/process#step-${e.stepKey}`,
    };
  });

  return { fileId, hasInstance: true, scope, steps, assigneeLookupFailed: failed };
}
