/**
 * THE canonical Effitrans organization registry (Phase 9.0A). PURE — no I/O,
 * client + server safe.
 * ---------------------------------------------------------------------------
 * Effitrans has FOUR real departments, confirmed by the business (see
 * docs/business-processes/Workflow_Complet_Effitrans_FR.pdf §1-2):
 *
 *   OPERATIONS ─┬─ owns every dossier from opening to operational completion
 *               └── TRANSIT — a REAL department, operationally under Operations
 *   FINANCE    ──  payments, invoicing, financial closure
 *   HUMAN_RESOURCES — organizational support; does not process dossiers
 *
 * Everything the platform previously PRESENTED as a department is something
 * else, and stays what it is (see docs/workflow/phase-9.0a-organization-audit.md
 * for the full classification): the 15 ProcessDepartment codes are WORKFLOW
 * QUEUES; the 5 CONTACT_DEPARTMENTS are customer SERVICE-ROUTING categories;
 * the sidebar's « Départements » section lists operational MODULE pages;
 * "Documentation" is an Operations function; "Transport & Logistique" is the
 * logistics command-center module; Maritime and AIBD are TEAMS under Transit.
 *
 * THIS REGISTRY IS ORGANIZATIONAL METADATA, NEVER AUTHORIZATION. Roles and
 * permissions (lib/rbac, role_permission) remain the only access-control
 * source; nothing here may be used to grant or deny anything. Department is
 * DERIVED from a user's roles via ROLE_CANONICAL_DEPARTMENT — deliberately not
 * stored as a column, so there is no second source of truth to drift and no
 * production data to migrate.
 */

export type CanonicalDepartmentCode = "OPERATIONS" | "TRANSIT" | "FINANCE" | "HUMAN_RESOURCES";

export type CanonicalDepartment = {
  code: CanonicalDepartmentCode;
  labelFr: string;
  labelEn: string;
  /** Organizational reporting parent — TRANSIT reports under OPERATIONS. */
  parent: CanonicalDepartmentCode | null;
  /** HR is a support department, outside the normal dossier flow (business decision). */
  processesDossiers: boolean;
};

/**
 * Exactly four. TRANSIT is independently selectable everywhere (staff
 * assignment, tasks, queues, reports, dashboards, messaging routing) — the
 * parent link is for ORG-CHART ROLLUP only, never a merge.
 */
export const CANONICAL_DEPARTMENTS: readonly CanonicalDepartment[] = [
  { code: "OPERATIONS", labelFr: "Opérations", labelEn: "Operations", parent: null, processesDossiers: true },
  { code: "TRANSIT", labelFr: "Transit", labelEn: "Transit", parent: "OPERATIONS", processesDossiers: true },
  { code: "FINANCE", labelFr: "Finance", labelEn: "Finance", parent: null, processesDossiers: true },
  { code: "HUMAN_RESOURCES", labelFr: "Ressources humaines", labelEn: "Human Resources", parent: null, processesDossiers: false },
] as const;

export function getCanonicalDepartment(code: string): CanonicalDepartment | undefined {
  return CANONICAL_DEPARTMENTS.find((d) => d.code === code);
}

export function isCanonicalDepartment(code: string): code is CanonicalDepartmentCode {
  return CANONICAL_DEPARTMENTS.some((d) => d.code === code);
}

export function departmentLabelFr(code: CanonicalDepartmentCode): string {
  return getCanonicalDepartment(code)!.labelFr;
}

/**
 * Operational TEAMS under Transit (Tableau_Coordination_Transit.pdf:
 * « Répartition de l'équipe » — AIBD 2 agents, Maritime 4 agents). Teams, NOT
 * departments — they never appear in CANONICAL_DEPARTMENTS. Per-person team
 * membership is deliberately NOT modeled in 9.0A (open decision; see the
 * architecture document §23).
 */
export type TransitTeamCode = "AIBD" | "MARITIME";
export const TRANSIT_TEAMS: readonly { code: TransitTeamCode; labelFr: string; department: "TRANSIT" }[] = [
  { code: "AIBD", labelFr: "AIBD", department: "TRANSIT" },
  { code: "MARITIME", labelFr: "Maritime", department: "TRANSIT" },
] as const;

// ============================================================ role mapping ====

/**
 * Every tenant role code → its canonical department, or null for identities
 * that belong to no single department: governance (CEO — « Direction » is
 * governance, not one of the four departments; COMPLIANCE_HSSE), cross-cutting
 * IT (SYSTEM_ADMIN), and external identities (CLIENT_USER, PARTNER_AGENT).
 *
 * TOTAL over the 23 seeded role codes — parity with lib/platform/role-templates
 * is test-enforced (tests/organization.test.ts), so a new role cannot be added
 * without deciding its department here.
 *
 * Mappings marked PROVISIONAL follow the best current reading of the business
 * documents but await explicit confirmation — listed as open decisions in
 * docs/workflow/phase-9-dossier-workflow-architecture.md §23. None of this is
 * authorization; role codes and permissions are unchanged.
 */
export const ROLE_CANONICAL_DEPARTMENT: Readonly<Record<string, CanonicalDepartmentCode | null>> = {
  // ---- Operations — owns the dossier end to end -----------------------------
  COORDINATOR: "OPERATIONS", // Coordinateur des opérations
  OPS_SUPERVISOR: "OPERATIONS", // Superviseur opérations
  ACCOUNT_MANAGER: "OPERATIONS", // client relationship + missing-document returns (T3)
  DOCUMENTATION_OFFICER: "OPERATIONS", // business decision 4: Documentation belongs to Operations
  WAREHOUSE_COORDINATOR: "OPERATIONS", // PROVISIONAL — site/handling function under Operations

  // ---- Transit — real department, operationally under Operations ------------
  CHIEF_OF_TRANSIT: "TRANSIT",
  CUSTOMS_DECLARANT: "TRANSIT", // Déclarant en douane — prepares/submits in GAINDE
  CUSTOMS_FIELD_AGENT: "TRANSIT", // Agent de terrain douane (BAE, sorties)
  TRANSPORT_OFFICER: "TRANSIT", // business decision 5: transport coordination belongs to Transit
  PICKUP_AGENT: "TRANSIT", // enlèvement / sortie port
  DRIVER: "TRANSIT", // transport execution (narrow mobile identity, unchanged)
  QUOTATION_MANAGER: "TRANSIT", // PROVISIONAL — cotation is Chef de Transit's step T1 in the Guide

  // ---- Finance — payments, invoicing, financial closure ---------------------
  FINANCE_OFFICER: "FINANCE",
  BILLING_OFFICER: "FINANCE", // Facturation
  COLLECTIONS_OFFICER: "FINANCE", // Recouvrement
  CUSTOMS_FINANCE_OFFICER: "FINANCE", // Guide étape 5 « Enregistrement — Finance »
  ADMINISTRATIVE_OFFICER: "FINANCE", // PROVISIONAL — invoice-deposit preparation (steps 23/25)
  COURIER: "FINANCE", // PROVISIONAL — physical invoice deposit (step 24)

  // ---- No single department --------------------------------------------------
  SYSTEM_ADMIN: null, // cross-cutting IT/config administration
  CEO: null, // Direction = governance, not a department
  COMPLIANCE_HSSE: null, // cross-company audit/compliance
  CLIENT_USER: null, // external portal label — never staff
  PARTNER_AGENT: null, // external partner
} as const;

/** A role's canonical department, or null (unknown code → null, never a guess). */
export function roleCanonicalDepartment(roleCode: string): CanonicalDepartmentCode | null {
  return ROLE_CANONICAL_DEPARTMENT[roleCode] ?? null;
}

/**
 * The department to DISPLAY for a user holding several roles: resolved from
 * their primary displayed role (the same lib/navigation/roles DISPLAY_PRIORITY
 * everywhere else uses), so a user's shown role and shown department can never
 * disagree. Callers pass the already-chosen primary role code.
 */
export function departmentDisplayLabelFr(primaryRoleCode: string | null): string | null {
  if (!primaryRoleCode) return null;
  const dept = roleCanonicalDepartment(primaryRoleCode);
  return dept ? departmentLabelFr(dept) : null;
}

// ======================================================= legacy resolution ====

/**
 * Customer/messaging SERVICE-ROUTING categories (lib/portal/self-service.ts
 * CONTACT_DEPARTMENTS, reused by Messaging Center DB CHECK constraints) → the
 * canonical department that ANSWERS them. The routing vocabulary itself is
 * PRESERVED — it is a customer-facing service menu and a database contract, not
 * an org chart — this alias only lets reports/dashboards roll conversations up
 * to real departments.
 */
export const CONTACT_DEPARTMENT_TO_CANONICAL: Readonly<Record<string, CanonicalDepartmentCode>> = {
  documentation: "OPERATIONS",
  customs: "TRANSIT",
  transport: "TRANSIT",
  finance: "FINANCE",
  general: "OPERATIONS", // general customer service = Operations / Account Management
} as const;

/**
 * The 15 workflow-queue codes (lib/process/types.ts ProcessDepartment — the
 * process engine's routing vocabulary, PRESERVED as-is) → canonical department.
 * Lets « Mon Travail », queue dashboards and reports roll up by real
 * department without touching the engine.
 */
export const QUEUE_DEPARTMENT_TO_CANONICAL: Readonly<Record<string, CanonicalDepartmentCode>> = {
  cotation: "TRANSIT", // PROVISIONAL — Guide T1: cotation by Chef de Transit
  operations: "OPERATIONS",
  account_management: "OPERATIONS",
  coordination: "OPERATIONS",
  transit: "TRANSIT",
  customs_declaration: "TRANSIT",
  finance_customs: "FINANCE", // Guide étape 5: Enregistrement — Finance
  customs_field: "TRANSIT",
  transport: "TRANSIT",
  pickup: "TRANSIT",
  billing: "FINANCE",
  finance: "FINANCE",
  administration: "FINANCE", // PROVISIONAL — invoice-deposit chain
  courier: "FINANCE", // PROVISIONAL
  collections: "FINANCE",
} as const;

/**
 * Legacy DISPLAY labels seen in the current UI → the canonical department they
 * actually denote (or null when the label names governance/a module category,
 * not a department). For safe display migration only — routes, permission
 * codes, and stored values are all preserved (see the compatibility matrix in
 * docs/workflow/phase-9.0a-organization-audit.md).
 */
export const LEGACY_DEPARTMENT_LABEL_TO_CANONICAL: Readonly<Record<string, CanonicalDepartmentCode | null>> = {
  "Transport & Logistique": "TRANSIT",
  Transport: "TRANSIT",
  Douane: "TRANSIT",
  "Dédouanement": "TRANSIT",
  Documentation: "OPERATIONS",
  Finance: "FINANCE",
  "Général": "OPERATIONS",
  Direction: null, // governance, not a department
  Management: null,
  Archivage: "FINANCE", // deposit/archive chain (PROVISIONAL, mirrors administration/courier)
  "Ouverture / Devis": "OPERATIONS",
} as const;

export function resolveLegacyDepartmentLabel(label: string): CanonicalDepartmentCode | null {
  return LEGACY_DEPARTMENT_LABEL_TO_CANONICAL[label] ?? null;
}
