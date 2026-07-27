/**
 * THE canonical dossier access resolver (Phase WES-3D). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * ONE contract answering, for one user and one dossier:
 *
 *     who owns it · who is responsible now · who is assigned the work ·
 *     who may see it · who may complete it · who may reassign it
 *
 * Pages, queues, actions and RLS-adjacent server code all consume THIS. Nothing
 * reproduces visibility logic independently — the audit found the old rules
 * scattered across `user_readable_file_ids`, `getFile`, portal readers and each
 * queue's own filter, which is exactly how "reassign a task and the dossier
 * vanishes" became possible.
 *
 * It is PURE so every rule in the WES-3C matrix is testable without a database,
 * and EXPLAINABLE so every granted capability can be attributed to a reason.
 *
 * ---------------------------------------------------------------------------
 * THE DOCTRINE IT ENFORCES
 *
 *   Departments own dossiers.  People own tasks.  Drivers own missions.
 *
 * Consequences encoded here, each of which the old model got wrong:
 *   * Visibility follows DEPARTMENT RESPONSIBILITY, never task assignment. A
 *     task moving between two people cannot remove the dossier from either.
 *   * Being able to SEE is not being able to ACT. Every capability is separate.
 *   * A previous department keeps BOUNDED history, not ongoing detail.
 *   * A future department gets SUMMARY ONLY until responsibility arrives.
 *   * `SYSTEM_ADMIN` is a governance identity, not an operator: it inspects and
 *     may reassign under audit, but never silently completes someone's work.
 */

import type { Department } from "@/lib/files/lifecycle";
import type { CanonicalStageKey } from "@/lib/workflow/stages";
import { CANONICAL_STAGES } from "@/lib/workflow/stages";
import { belongsToLifecycleDepartment, canonicalDepartmentForLifecycle } from "./departments";

/** Why a capability was granted. Every `true` below traces to one of these. */
export const ACCESS_REASONS = [
  "platform_governance",
  "commercial_owner",
  "operational_owner",
  "responsible_department",
  "task_assignee",
  "step_assignee",
  "department_supervisor",
  "previous_department",
  "future_department",
  "explicit_permission",
  "none",
] as const;
export type AccessReason = (typeof ACCESS_REASONS)[number];

export type DossierAccessInput = {
  userId: string;
  /** Tenant role codes held by the user. Department membership derives from these. */
  roleCodes: readonly string[];
  /** Permission codes held by the user. */
  permissions: readonly string[];

  /** Ownership, read from the dossier and its process instance. */
  commercialOwnerId: string | null;
  operationalOwnerId: string | null;

  /** From the WES-2 canonical projection. NOT recomputed here. */
  responsibleDepartment: Department | null;
  currentStage: CanonicalStageKey;

  /** Current work assignment. */
  currentTaskAssigneeId: string | null;
  currentStepAssigneeId: string | null;

  /**
   * Seats the PINNED WES-7 policy binds for the current step, by role code.
   * Supplied by the caller — this module never resolves policy itself.
   */
  supervisorRoles?: readonly string[];

  /**
   * True when the user has verifiably contributed to this dossier from a
   * department that is no longer responsible. Established from the assignment
   * ledger and the business-event ledger, never guessed.
   */
  contributedFromDepartments?: readonly Department[];
};

export type DossierAccess = {
  canViewSummary: boolean;
  canViewCurrentDepartmentDetail: boolean;
  canViewHistoricalDepartmentDetail: boolean;
  canViewDocuments: boolean;
  canActOnCurrentStep: boolean;
  canCompleteAssignedTask: boolean;
  canReassignWithinDepartment: boolean;
  canIntervene: boolean;
  /** The strongest reason any capability was granted. */
  visibilityReason: AccessReason;
  /** Every reason that applied, for explanation surfaces. */
  reasons: AccessReason[];
};

const DENIED: DossierAccess = {
  canViewSummary: false,
  canViewCurrentDepartmentDetail: false,
  canViewHistoricalDepartmentDetail: false,
  canViewDocuments: false,
  canActOnCurrentStep: false,
  canCompleteAssignedTask: false,
  canReassignWithinDepartment: false,
  canIntervene: false,
  visibilityReason: "none",
  reasons: [],
};

function stageOrdinalOf(key: CanonicalStageKey): number {
  return CANONICAL_STAGES.find((s) => s.key === key)?.ordinal ?? 0;
}

/** The first stage a department owns — how "past vs future" is decided. */
function departmentOrdinal(department: Department): number {
  const match = CANONICAL_STAGES.find((s) => s.department === department);
  return match ? match.ordinal : Number.MAX_SAFE_INTEGER;
}

/**
 * Where this user's own department sits relative to the dossier's responsible
 * department: is it the one working now, one that already handed off, or one
 * the dossier has not reached?
 */
export type DepartmentRelation = "current" | "previous" | "future" | "unrelated";

export function departmentRelation(
  roleCodes: readonly string[],
  responsibleDepartment: Department | null,
): DepartmentRelation {
  if (!responsibleDepartment) return "unrelated";
  if (belongsToLifecycleDepartment(roleCodes, responsibleDepartment)) return "current";

  const responsibleOrdinal = departmentOrdinal(responsibleDepartment);
  const responsibleCanonical = canonicalDepartmentForLifecycle(responsibleDepartment);

  // Compare by the ladder: a department whose stages all sit before the
  // responsible one has already had its turn; one that sits after has not.
  let sawEarlier = false;
  let sawLater = false;
  for (const stage of CANONICAL_STAGES) {
    if (canonicalDepartmentForLifecycle(stage.department) === responsibleCanonical) continue;
    if (!belongsToLifecycleDepartment(roleCodes, stage.department)) continue;
    if (stage.ordinal < responsibleOrdinal) sawEarlier = true;
    else if (stage.ordinal > responsibleOrdinal) sawLater = true;
  }

  if (sawEarlier) return "previous";
  if (sawLater) return "future";
  return "unrelated";
}

/**
 * Resolve every capability. Deliberately written as independent grants that are
 * OR-ed, so adding a reason can never silently remove a capability, and so each
 * `true` is attributable.
 */
export function resolveDossierAccess(input: DossierAccessInput): DossierAccess {
  const perms = new Set(input.permissions);
  const reasons: AccessReason[] = [];

  // --- who this user is, relative to this dossier ---------------------------
  const isPlatformGovernance = perms.has("admin:config:manage") || perms.has("file:read:all");
  const isCommercialOwner = !!input.commercialOwnerId && input.commercialOwnerId === input.userId;
  const isOperationalOwner = !!input.operationalOwnerId && input.operationalOwnerId === input.userId;
  const isTaskAssignee =
    !!input.currentTaskAssigneeId && input.currentTaskAssigneeId === input.userId;
  const isStepAssignee =
    !!input.currentStepAssigneeId && input.currentStepAssigneeId === input.userId;

  const relation = departmentRelation(input.roleCodes, input.responsibleDepartment);
  const isSupervisor =
    relation === "current" &&
    (input.supervisorRoles ?? []).some((r) => input.roleCodes.includes(r));

  // A previous-department claim requires VERIFIED contribution, not merely
  // holding a role that once could have touched it. "I am in Documentation" is
  // not "I worked on this dossier".
  const contributed = new Set(input.contributedFromDepartments ?? []);
  const hasVerifiedHistory = Array.from(contributed).some((d) =>
    belongsToLifecycleDepartment(input.roleCodes, d),
  );

  if (isPlatformGovernance) reasons.push("platform_governance");
  if (isCommercialOwner) reasons.push("commercial_owner");
  if (isOperationalOwner) reasons.push("operational_owner");
  if (relation === "current") reasons.push("responsible_department");
  if (isTaskAssignee) reasons.push("task_assignee");
  if (isStepAssignee) reasons.push("step_assignee");
  if (isSupervisor) reasons.push("department_supervisor");
  if (relation === "previous" && hasVerifiedHistory) reasons.push("previous_department");
  if (relation === "future") reasons.push("future_department");

  // --- SUMMARY -------------------------------------------------------------
  // The widest tier. A future department may see arrival information; that is
  // the only thing it may see.
  const canViewSummary =
    isPlatformGovernance ||
    isCommercialOwner ||
    isOperationalOwner ||
    relation === "current" ||
    relation === "future" ||
    (relation === "previous" && hasVerifiedHistory) ||
    isTaskAssignee ||
    isStepAssignee;

  if (!canViewSummary) return DENIED;

  // --- CURRENT DETAIL ------------------------------------------------------
  // NOTE the absence of `isTaskAssignee` as a *department* grant: an assignee
  // gets detail because they are assigned, which is listed separately. A
  // previous or future department never gets current detail.
  const canViewCurrentDepartmentDetail =
    isPlatformGovernance ||
    isOperationalOwner ||
    relation === "current" ||
    isTaskAssignee ||
    isStepAssignee;

  // --- HISTORICAL DETAIL ---------------------------------------------------
  // Bounded: a previous department sees what IT did, which is why this is a
  // separate capability from current detail rather than a weaker version of it.
  const canViewHistoricalDepartmentDetail =
    isPlatformGovernance ||
    isOperationalOwner ||
    relation === "current" ||
    (relation === "previous" && hasVerifiedHistory);

  const canViewDocuments =
    canViewCurrentDepartmentDetail || (relation === "previous" && hasVerifiedHistory);

  // --- ACTING --------------------------------------------------------------
  // Seeing is not acting. Only the person the work is assigned to acts on it.
  const canActOnCurrentStep = isStepAssignee || isTaskAssignee;
  const canCompleteAssignedTask = isTaskAssignee || isStepAssignee;

  // Reassignment stays inside the responsible department; the operational owner
  // may also redirect work they are accountable for.
  const canReassignWithinDepartment = isSupervisor || isOperationalOwner || isPlatformGovernance;

  // Intervention — completing or overriding someone else's work — is the
  // narrowest capability and always requires a reason at the call site.
  // Platform governance is deliberately EXCLUDED: SYSTEM_ADMIN may reassign
  // under audit, but is not an ordinary operator and does not complete work.
  const canIntervene = isSupervisor || isOperationalOwner;

  return {
    canViewSummary,
    canViewCurrentDepartmentDetail,
    canViewHistoricalDepartmentDetail,
    canViewDocuments,
    canActOnCurrentStep,
    canCompleteAssignedTask,
    canReassignWithinDepartment,
    canIntervene,
    visibilityReason: reasons[0] ?? "none",
    reasons,
  };
}

/** French explanations for the UI. Never exposes permission codes. */
export const ACCESS_REASON_LABELS_FR: Readonly<Record<AccessReason, string>> = {
  platform_governance: "Administration de la plateforme",
  commercial_owner: "Responsable commercial du client",
  operational_owner: "Responsable opérationnel du dossier",
  responsible_department: "Département actuellement responsable",
  task_assignee: "Tâche qui vous est affectée",
  step_assignee: "Étape qui vous est affectée",
  department_supervisor: "Encadrement du département",
  previous_department: "Département précédemment intervenu",
  future_department: "Département destinataire (résumé seulement)",
  explicit_permission: "Autorisation explicite",
  none: "Aucun accès",
};

export function explainAccessFr(access: DossierAccess): string[] {
  return access.reasons.map((r) => ACCESS_REASON_LABELS_FR[r]);
}

/** Guard for the pure completion rule, used by actions and tests alike. */
export function mayCompleteWork(
  access: DossierAccess,
  opts: { intervening: boolean; reason?: string | null },
): { ok: true } | { ok: false; error: "not_assigned" | "reason_required" | "forbidden" } {
  if (access.canCompleteAssignedTask && !opts.intervening) return { ok: true };
  if (!opts.intervening) return { ok: false, error: "not_assigned" };
  if (!access.canIntervene) return { ok: false, error: "forbidden" };
  if (!opts.reason || opts.reason.trim().length === 0) {
    return { ok: false, error: "reason_required" };
  }
  return { ok: true };
}
