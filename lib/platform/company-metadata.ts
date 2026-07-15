/**
 * Company (tenant) metadata model (Phase 4.0B-3). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * The platform-level lifecycle/profile vocabulary carried on `organization`.
 *
 * PUBLIC-SECTOR SAFEGUARD: `GOVERNMENT_AGENCY` is a TENANT PROFILE ONLY. It grants
 * NO cross-tenant access, NO shared customs data, and NO monitoring of other
 * tenants — it is a label on that tenant's own organization, nothing more. Any
 * future public-sector access to another tenant's data would require legal
 * authority + an explicit agreement + per-tenant configuration + audit + dedicated
 * permissions, and is explicitly out of scope here.
 */

export const LIFECYCLE_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export const PRODUCT_PROFILES = [
  "LOGISTICS_COMPANY",
  "ENTERPRISE_SHIPPER",
  "GOVERNMENT_AGENCY",
  "PLATFORM_OPERATOR",
] as const;
export type ProductProfile = (typeof PRODUCT_PROFILES)[number];

export const ONBOARDING_STATUSES = ["pending", "in_progress", "complete"] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export function isLifecycleStatus(v: string): v is LifecycleStatus {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(v);
}
export function isProductProfile(v: string): v is ProductProfile {
  return (PRODUCT_PROFILES as readonly string[]).includes(v);
}
export function isOnboardingStatus(v: string): v is OnboardingStatus {
  return (ONBOARDING_STATUSES as readonly string[]).includes(v);
}

/** A tenant can be logged into / operated only while ACTIVE or on TRIAL. */
export function isTenantOperable(status: LifecycleStatus): boolean {
  return status === "ACTIVE" || status === "TRIAL";
}

/**
 * Why a tenant is blocked, or null when access is allowed (Phase 6.0D). This is THE
 * lifecycle predicate the single enforcement point (getCurrentUser) calls.
 *
 * Two reasons, both derived — no cron, no manual step:
 *   - the lifecycle status is SUSPENDED or ARCHIVED (an explicit platform decision);
 *   - the status is TRIAL and the trial window has ended (the "Trial → expired →
 *     blocked" flow, computed at read time from the trial end date already on the row).
 *
 * `now` is injected so the whole thing is deterministic and unit-testable.
 */
export type TenantBlockReason = "SUSPENDED" | "ARCHIVED" | "TRIAL_EXPIRED";

export function tenantBlockReason(
  status: LifecycleStatus,
  trialEndsAt: string | null,
  now: number,
): TenantBlockReason | null {
  if (status === "SUSPENDED") return "SUSPENDED";
  if (status === "ARCHIVED") return "ARCHIVED";
  if (status === "TRIAL" && trialEndsAt && new Date(trialEndsAt).getTime() < now) {
    return "TRIAL_EXPIRED";
  }
  return null;
}

/** Access is allowed exactly when there is no block reason. */
export function isTenantAccessAllowed(
  status: LifecycleStatus,
  trialEndsAt: string | null,
  now: number,
): boolean {
  return tenantBlockReason(status, trialEndsAt, now) === null;
}

/**
 * The lifecycle transitions the platform may perform (Phase 6.0D). A small, explicit
 * state machine — never an arbitrary status write. ARCHIVED is terminal ("no hard
 * delete, permanently read-only"): nothing transitions out of it.
 */
export const LIFECYCLE_TRANSITIONS: Record<"suspend" | "reactivate" | "archive", {
  from: readonly LifecycleStatus[];
  to: LifecycleStatus;
}> = {
  suspend: { from: ["ACTIVE", "TRIAL"], to: "SUSPENDED" },
  reactivate: { from: ["SUSPENDED"], to: "ACTIVE" },
  archive: { from: ["ACTIVE", "TRIAL", "SUSPENDED"], to: "ARCHIVED" },
};

export type LifecycleAction = keyof typeof LIFECYCLE_TRANSITIONS;

/** Whether `action` is valid from the current status. Drives both the guard and the UI. */
export function canTransition(action: LifecycleAction, from: LifecycleStatus): boolean {
  return LIFECYCLE_TRANSITIONS[action].from.includes(from);
}

/**
 * A product profile NEVER implies access to another tenant. This is a constant
 * assertion of the safeguard above, referenced by tests so the invariant is
 * explicit and cannot be quietly changed.
 */
export function profileGrantsCrossTenantAccess(_profile: ProductProfile): false {
  return false;
}
