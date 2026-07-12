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
 * A product profile NEVER implies access to another tenant. This is a constant
 * assertion of the safeguard above, referenced by tests so the invariant is
 * explicit and cannot be quietly changed.
 */
export function profileGrantsCrossTenantAccess(_profile: ProductProfile): false {
  return false;
}
