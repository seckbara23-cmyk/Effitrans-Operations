/**
 * Tenant provisioning CONTRACT (Phase 4.0B-2). PURE types — no execution.
 * ---------------------------------------------------------------------------
 * Finalizes the shape of a tenant-provisioning request/result so the onboarding
 * wizard (Phase 4.0C) and the transactional provisioning service can be built
 * against a stable contract. This phase does NOT execute provisioning and does
 * NOT create a second tenant.
 *
 * Password handling (contract-level guarantee): `temporaryPassword` is OPTIONAL
 * and one-time only. It must never be persisted, logged, or placed in an audit
 * payload — see redactProvisionResult() + the tests that enforce it.
 */
import type { BusinessProfileKey } from "../role-templates";
import type { TenantModuleSelection, TenantPlanKey } from "../entitlements";

export type CompanyProfileInput = {
  legalName: string;
  tradeName?: string;
  slug: string;
  country: string;
  currency: string;
  timezone: string;
  language: string;
  email?: string;
  phone?: string;
  /** Senegalese business id (optional; not all tenants are SN) */
  ninea?: string;
  /** trade register number (optional) */
  rccm?: string;
};

export type AdministratorInput = {
  fullName: string;
  email: string;
  phone?: string;
};

export type BusinessProfileInput = Record<BusinessProfileKey, boolean>;

export type ProvisionTenantInput = {
  company: CompanyProfileInput;
  administrator: AdministratorInput;
  businessProfile: BusinessProfileInput;
  modules: TenantModuleSelection;
  plan: TenantPlanKey;
  /** dedupe key so a retried request provisions at most once (already_exists) */
  idempotencyKey: string;
};

export type ProvisionTenantResult = {
  organizationId: string;
  /** tenantId === organizationId (the organization IS the tenant root) */
  tenantId: string;
  administratorUserId: string;
  administratorLogin: string;
  /** returned ONCE for display; never persisted/logged/audited */
  temporaryPassword?: string;
  createdRoles: string[];
  createdDepartments: string[];
  enabledModules: string[];
  status: "provisioned" | "already_exists";
};

/** A ProvisionTenantResult with the one-time secret removed — safe for logs/audit. */
export type RedactedProvisionResult = Omit<ProvisionTenantResult, "temporaryPassword">;

/**
 * Strip the one-time temporary password from a result before it can reach any
 * log or audit payload. The ONLY sanctioned way to serialize a result for
 * persistence. Enforced by tests.
 */
export function redactProvisionResult(result: ProvisionTenantResult): RedactedProvisionResult {
  const { temporaryPassword: _omit, ...safe } = result;
  return safe;
}
