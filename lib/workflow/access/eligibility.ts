/**
 * Assignment eligibility from the PINNED policy (Phase WES-3J). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * WES-3 is the first consumer of the WES-7 policy registry. Until now
 * `resolvePolicy` was a typed seam nothing read; this module is the seam being
 * used for real.
 *
 * The rule it implements: **who may be assigned which work is business policy,
 * not code.** Eligible roles come from the pinned policy's `seats` bindings for
 * the step in question; supervisor authority comes from its `supervisors`
 * bindings. No role list is hardcoded here — that was the whole point of WES-7.
 *
 * PINNED, NOT ACTIVE. A dossier is governed by the policy version pinned to its
 * process instance. Activating a new tenant policy tomorrow must not silently
 * change who may be assigned work on a dossier opened today; that is what
 * `resolvePolicy({ processInstanceId })` guarantees, and a test pins it.
 *
 * FAIL CLOSED. If the pinned policy cannot be resolved, nobody is eligible.
 * Returning "everyone" or falling back to a hardcoded list would defeat the
 * registry — and this module implements no fallback order of its own, because
 * `resolvePolicy` is the single place that ordering is expressed.
 */
import "server-only";
import { resolvePolicy } from "@/lib/workflow/policy/resolver";
import type { SeatFunction } from "@/lib/workflow/policy/schema";
import { NOT_RESOLVED, type EligibilityResult } from "./seat";

export { isEligibleForSeat, type EligibilityResult } from "./seat";

export type EligibilityContext = {
  tenantId: string;
  processInstanceId: string | null;
};

/**
 * Roles the pinned policy binds to `seat` for `stepKey`.
 *
 * When the step has no explicit binding the result is EMPTY, not permissive:
 * an unbound seat means policy has not said who may hold it, and inventing an
 * answer is how hardcoded role lists come back.
 */
export async function resolveSeatEligibility(
  ctx: EligibilityContext,
  stepKey: string,
  seat: SeatFunction,
): Promise<EligibilityResult> {
  const resolution = await resolvePolicy({
    tenantId: ctx.tenantId,
    processInstanceId: ctx.processInstanceId ?? undefined,
  });
  if (!resolution.ok) return NOT_RESOLVED;
  const policy = resolution.policy;

  const bindings = policy.document.seats.filter(
    (s) => s.stepKey === stepKey && s.seat === seat,
  );
  const identityBound = bindings.some((b) => b.identityBound === true);

  return {
    roles: Array.from(new Set(bindings.flatMap((b) => b.roles))),
    // A LEGACY_DEFAULT resolution has no stored version to pin history to; null
    // is recorded honestly rather than fabricating an id.
    policyVersionId: policy.provenance === "PINNED" ? policy.versionId : null,
    identityBound,
    resolved: true,
  };
}

/** Supervisor role codes for a department, from the pinned policy. */
export async function resolveSupervisorRoles(
  ctx: EligibilityContext,
  department: string,
): Promise<{ roles: string[]; resolved: boolean }> {
  const resolution = await resolvePolicy({
    tenantId: ctx.tenantId,
    processInstanceId: ctx.processInstanceId ?? undefined,
  });
  if (!resolution.ok) return { roles: [], resolved: false };
  const policy = resolution.policy;

  // A supervisor policy names the department and the authorities granted; the
  // ROLES that supervise it are the seat bindings for `supervisor` on the steps
  // that department owns. Policy stays the single source for both.
  const dept = policy.document.supervisors.find((s) => s.department === department);
  if (!dept) return { roles: [], resolved: true };

  const steps = new Set(
    policy.document.departments
      .filter((d) => d.department === department)
      .map((d) => d.stepKey),
  );
  const roles = policy.document.seats
    .filter((s) => s.seat === "supervisor" && steps.has(s.stepKey))
    .flatMap((s) => s.roles);

  return { roles: Array.from(new Set(roles)), resolved: true };
}
