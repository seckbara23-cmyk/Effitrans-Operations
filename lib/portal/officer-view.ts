/**
 * Customer-safe officer presentation (Phase 3.3A — Deliverable 3) — PURE.
 * ---------------------------------------------------------------------------
 * Never exposes internal role/permission codes or a generic technical identity
 * (e.g. "System Administrator"). Maps role codes to customer-safe titles and
 * detects generic/admin identities so the service can fall back to a team label.
 */
export const TEAM_FALLBACK_NAME = "Équipe Opérations Effitrans";
export const TEAM_FALLBACK_TITLE = "Service des opérations";

/**
 * Tenant-branded operations-team display name shown to customers when no specific
 * officer is exposed. Falls back to the generic default when no brand is given.
 */
export function teamFallbackName(brandName?: string | null): string {
  const b = (brandName ?? "").trim();
  return b ? `Équipe ${b}` : TEAM_FALLBACK_NAME;
}

const ROLE_LABEL: Record<string, string> = {
  ACCOUNT_MANAGER: "Chargé de compte",
  COORDINATOR: "Coordinateur",
  OPS_SUPERVISOR: "Superviseur des opérations",
  CHIEF_OF_TRANSIT: "Responsable transit",
  CUSTOMS_DECLARANT: "Déclarant en douane",
  DOCUMENTATION_OFFICER: "Agent documentation",
  TRANSPORT_OFFICER: "Agent transport",
  WAREHOUSE_COORDINATOR: "Coordinateur entrepôt",
  FINANCE_OFFICER: "Service financier",
  COMPLIANCE_HSSE: "Conformité",
  CEO: "Direction",
};

/** Customer-safe job title from a role code — never the raw code. */
export function customerSafeRoleLabel(roleCode: string | null | undefined): string {
  return (roleCode && ROLE_LABEL[roleCode]) || TEAM_FALLBACK_TITLE;
}

/**
 * True when the resolved staff member should NOT be shown to a customer — a
 * system admin, a missing/blank name, or a generic technical/support identity.
 */
export function isGenericStaffIdentity(name: string | null | undefined, isSystemAdmin: boolean): boolean {
  if (isSystemAdmin) return true;
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;
  return /system|administrator|administrateur|\badmin\b|support|no[-_ ]?reply|effitrans ops|\btest\b/.test(n);
}
