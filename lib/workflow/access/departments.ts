/**
 * Lifecycle-department ↔ organization-department bridge (Phase WES-3). PURE.
 * ---------------------------------------------------------------------------
 * The audit found THREE department vocabularies already in the platform, each
 * legitimately serving a different purpose. WES-3 adds NO fourth one; it states
 * the mapping between the two it needs.
 *
 *   1. `Department` (WES-2 lifecycle)     opening · documentation · customs ·
 *                                          transport · finance · archive
 *      — WHERE THE DOSSIER IS. Produced by the canonical projection's
 *        `responsibleDepartment`. This is the authority on responsibility, and
 *        WES-3 reads it rather than recomputing it.
 *
 *   2. `CanonicalDepartmentCode` (9.0A)   OPERATIONS · TRANSIT · FINANCE ·
 *                                          HUMAN_RESOURCES
 *      — WHICH DEPARTMENT A PERSON BELONGS TO, derived from their roles via
 *        ROLE_CANONICAL_DEPARTMENT. Never stored as a column.
 *
 *   3. `ProcessDepartment` (5.0B)          15 workflow QUEUE codes
 *      — which queue a step's work sits in. Bound by WES-7 policy.
 *
 * ---------------------------------------------------------------------------
 * THE 9.0A CONSTRAINT, AND HOW WES-3 HONOURS IT
 *
 * `lib/organization/departments.ts` states plainly: "THIS REGISTRY IS
 * ORGANIZATIONAL METADATA, NEVER AUTHORIZATION … nothing here may be used to
 * grant or deny anything. Roles and permissions remain the only access-control
 * source."
 *
 * WES-3C requires department-scoped visibility, which reads like a direct
 * conflict. It is not, because of HOW department membership is established:
 * a user's department is DERIVED FROM THEIR ROLES. "Members of the responsible
 * department may see the dossier" is therefore exactly "holders of the roles
 * this department is composed of may see the dossier" — still role-based
 * authorization, with department as the grouping notation.
 *
 * Two rules keep that honest, and both are enforced:
 *   * no department column is added to any user or dossier table — membership
 *     stays derived, so there is no second source of truth to drift;
 *   * ELIGIBILITY to act (assignment, completion, intervention) is resolved
 *     from the PINNED WES-7 POLICY's seat bindings, never from this map. This
 *     file decides who may LOOK; policy decides who may ACT.
 */

import {
  QUEUE_DEPARTMENT_TO_CANONICAL,
  ROLE_CANONICAL_DEPARTMENT,
  type CanonicalDepartmentCode,
} from "@/lib/organization/departments";
import type { Department } from "@/lib/files/lifecycle";

/**
 * Which real department carries each lifecycle stage's work.
 *
 * Consistent with `QUEUE_DEPARTMENT_TO_CANONICAL`: customs is TRANSIT's work;
 * physical transport is TRANSPORT's (TMS-5C); opening, documentation and
 * archiving are OPERATIONS; billing and collection are FINANCE.
 * HUMAN_RESOURCES never appears — it processes no dossiers.
 */
export const LIFECYCLE_DEPARTMENT_TO_CANONICAL: Readonly<
  Record<Department, CanonicalDepartmentCode>
> = {
  opening: "OPERATIONS",
  documentation: "OPERATIONS",
  customs: "TRANSIT",
  // TMS-5C — the transport stage follows the Transport department. This MUST
  // move together with ROLE_CANONICAL_DEPARTMENT: remapping the roles alone
  // would have taken the transport stage out of the transport team's own queue.
  transport: "TRANSPORT",
  finance: "FINANCE",
  archive: "OPERATIONS",
} as const;

export function canonicalDepartmentForLifecycle(
  department: Department,
): CanonicalDepartmentCode {
  return LIFECYCLE_DEPARTMENT_TO_CANONICAL[department];
}

/**
 * Roles that sit inside a department for ORG-CHART purposes but carry NO
 * dossier visibility. Found during WES-3 implementation: `DRIVER` maps to a
 * real department (TRANSPORT since TMS-5C), so deriving visibility from
 * department membership alone would have
 * given every driver read access to every customs and transport dossier —
 * exactly what WES-3C forbids ("Driver: no dossier visibility from WES-3").
 *
 * A driver's access is MISSION-scoped and stays on the WES-1 transport bridge
 * until WES-6 settles the Mission entity. This list is narrow and explicit
 * rather than a general opt-out mechanism: each entry is a real identity whose
 * scope is deliberately narrower than its department.
 */
export const NON_DOSSIER_ROLES: readonly string[] = ["DRIVER"];

/**
 * The canonical departments a user belongs to, derived from their role codes.
 * A user may hold roles across departments (a coordinator who also bills); all
 * are returned, because visibility follows any of them.
 *
 * Mission-scoped roles contribute nothing — see NON_DOSSIER_ROLES.
 */
export function canonicalDepartmentsForRoles(
  roleCodes: readonly string[],
): CanonicalDepartmentCode[] {
  const out = new Set<CanonicalDepartmentCode>();
  for (const code of roleCodes) {
    if (NON_DOSSIER_ROLES.includes(code)) continue;
    const dept = ROLE_CANONICAL_DEPARTMENT[code];
    if (dept) out.add(dept);
  }
  return Array.from(out);
}

/** Does this user's role set place them in the department carrying `department`? */
export function belongsToLifecycleDepartment(
  roleCodes: readonly string[],
  department: Department,
): boolean {
  const target = canonicalDepartmentForLifecycle(department);
  return canonicalDepartmentsForRoles(roleCodes).includes(target);
}

/**
 * The canonical department a WES-7 policy `departments` binding refers to.
 * Reuses the existing 15-queue bridge rather than restating it — the policy
 * binds `ProcessDepartment` codes, which is vocabulary 3.
 */
export function canonicalDepartmentForQueue(
  queueDepartment: string,
): CanonicalDepartmentCode | null {
  return QUEUE_DEPARTMENT_TO_CANONICAL[queueDepartment] ?? null;
}

/** Structural self-check used by the tests: every lifecycle department maps. */
export function bridgeIsTotal(departments: readonly Department[]): boolean {
  return departments.every((d) => Boolean(LIFECYCLE_DEPARTMENT_TO_CANONICAL[d]));
}
