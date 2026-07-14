/**
 * Role presentation (Phase 5.0E-1, Deliverable 8). PURE.
 * ---------------------------------------------------------------------------
 * A raw role code is an implementation detail. `CUSTOMS_FINANCE_OFFICER` means
 * nothing to the person doing the job; "Chargé finance douane" does. Nothing in
 * the UI may print a role code, so every code that can reach a screen has a label
 * here and `roleLabel` never falls back to the code.
 */

/** Every tenant role code that exists in seed.sql, in French. */
const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: "Administrateur système",
  OPS_SUPERVISOR: "Superviseur des opérations",
  COORDINATOR: "Coordinateur",
  ACCOUNT_MANAGER: "Account Manager",
  QUOTATION_MANAGER: "Responsable cotation",
  CHIEF_OF_TRANSIT: "Chef de Transit",
  CUSTOMS_DECLARANT: "Déclarant en douane",
  CUSTOMS_FINANCE_OFFICER: "Chargé finance douane",
  CUSTOMS_FIELD_AGENT: "Agent de terrain douane",
  TRANSPORT_OFFICER: "Chargé transport",
  PICKUP_AGENT: "Agent d'enlèvement",
  BILLING_OFFICER: "Chargé de facturation",
  FINANCE_OFFICER: "Chargé finance",
  ADMINISTRATIVE_OFFICER: "Chargé administratif",
  COLLECTIONS_OFFICER: "Chargé de recouvrement",
  COURIER: "Coursier",
  DOCUMENTATION_OFFICER: "Chargé documentation",
  WAREHOUSE_COORDINATOR: "Coordinateur entrepôt",
  COMPLIANCE_HSSE: "Conformité / HSSE",
  PARTNER_AGENT: "Agent partenaire",
  DRIVER: "Chauffeur",
  CLIENT_USER: "Client",
};

/**
 * Which role to show when a user holds several.
 *
 * Ordered OPERATIONAL-FIRST, with the two supervisory roles last — deliberately.
 * A Coordinator who is also SYSTEM_ADMIN should read as "Coordinateur", because
 * that is the job they do all day; showing "Administrateur système" would describe
 * their privileges, not their work. The topbar exists to answer "what am I here to
 * do", not "what am I allowed to do".
 */
const DISPLAY_PRIORITY: string[] = [
  "COORDINATOR",
  "ACCOUNT_MANAGER",
  "CHIEF_OF_TRANSIT",
  "CUSTOMS_DECLARANT",
  "CUSTOMS_FINANCE_OFFICER",
  "CUSTOMS_FIELD_AGENT",
  "TRANSPORT_OFFICER",
  "PICKUP_AGENT",
  "BILLING_OFFICER",
  "COLLECTIONS_OFFICER",
  "FINANCE_OFFICER",
  "ADMINISTRATIVE_OFFICER",
  "COURIER",
  "QUOTATION_MANAGER",
  "DOCUMENTATION_OFFICER",
  "WAREHOUSE_COORDINATOR",
  "COMPLIANCE_HSSE",
  "PARTNER_AGENT",
  "DRIVER",
  "OPS_SUPERVISOR",
  "SYSTEM_ADMIN",
  "CLIENT_USER",
];

/** A single role code → its French label. `null` for an unknown code — never the code. */
export function roleLabel(code: string): string | null {
  return ROLE_LABELS[code] ?? null;
}

/** The role to display for a user holding `roleCodes`. `null` when they hold none we know. */
export function primaryRoleLabel(roleCodes: string[]): string | null {
  const held = new Set(roleCodes);
  for (const code of DISPLAY_PRIORITY) {
    if (held.has(code)) return ROLE_LABELS[code];
  }
  return null;
}

/** Test seam: every code in the priority list must have a label, and vice versa. */
export const KNOWN_ROLE_CODES = Object.keys(ROLE_LABELS);
export const ROLE_DISPLAY_PRIORITY = DISPLAY_PRIORITY;
