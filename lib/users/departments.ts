/**
 * Role → department taxonomy for the user-administration UI. PURE, client-safe.
 * ---------------------------------------------------------------------------
 * PRESENTATION ONLY. This file groups the roles that already exist into
 * headings an administrator recognises, so the create-user form can offer a
 * Department dropdown that filters a Role dropdown instead of a wall of
 * twenty-eight checkboxes.
 *
 * ===========================================================================
 * WHAT THIS IS NOT
 * ===========================================================================
 * It is NOT the canonical organization registry (lib/org, Phase 9.0A), which
 * has exactly four departments — OPERATIONS, TRANSIT, FINANCE, HUMAN_RESOURCES
 * — and from which WES-3 derives which department owns which dossier. Changing
 * THAT changes who can see what. Changing THIS changes only how a dropdown is
 * labelled.
 *
 * Ratified 2026-07-29: no new roles, no change to the canonical registry.
 * Nothing here grants, revokes, or influences any permission. A role's
 * capabilities come from lib/platform/role-templates.ts and the role_permission
 * table, and are completely unaffected by which heading it appears under.
 *
 * ===========================================================================
 * THE TAXONOMY NEVER HIDES A ROLE
 * ===========================================================================
 * A grouping that silently drops what it does not recognise would mean a role
 * added tomorrow becomes unassignable through the UI, with no error and no
 * clue. So `groupRolesByDepartment` places anything unmapped into a visible
 * OTHER bucket rather than discarding it, and a test asserts the map covers
 * every assignable role today. The UI degrades to "ungrouped", never to
 * "missing".
 *
 * CLIENT_USER is deliberately absent: it is not assignable to a staff account
 * at all (NON_ASSIGNABLE_STAFF_ROLE_CODES), so it never reaches this picker.
 */

export type DepartmentKey =
  | "EXECUTIVE"
  | "OPERATIONS"
  | "CUSTOMS"
  | "FINANCE"
  | "HR"
  | "LEGAL"
  | "ADMINISTRATION"
  | "RECOVERY"
  | "IT"
  | "PARTNERS"
  | "OTHER";

export type RoleDepartment = {
  key: DepartmentKey;
  labelFr: string;
  labelEn: string;
  /** Role codes shown under this heading, in the order they should appear. */
  roleCodes: readonly string[];
};

/**
 * The headings, in display order. Each role appears under EXACTLY ONE — a role
 * in two places would make the filtered dropdown ambiguous about which
 * department "owns" the person being created.
 *
 * Placement notes where the mapping is a judgement call rather than obvious:
 *
 *   * ACCOUNT_MANAGER / QUOTATION_MANAGER sit under Opérations because in the
 *     implemented workflow they are the front of the operational chain
 *     (cotation → ouverture du dossier), not a separate commercial function.
 *   * CHIEF_OF_TRANSIT and DOCUMENTATION_OFFICER sit under Transit & Douane,
 *     matching the canonical registry, where TRANSIT is where they work.
 *   * CASHIER sits under Administration as ratified, even though the Caisse
 *     workspace itself lives under Finance in the sidebar. This is a label,
 *     not a routing decision.
 *   * PARTNER_AGENT gets its own heading: an external partner is not a member
 *     of an internal department, and filing it under one would misrepresent
 *     the relationship.
 */
export const ROLE_DEPARTMENTS: readonly RoleDepartment[] = [
  {
    key: "EXECUTIVE",
    labelFr: "Direction générale",
    labelEn: "Executive Management",
    // PERFORMANCE_MANAGEMENT is an ACCESS role, not a job: it is held IN
    // ADDITION to whatever someone actually does. It appears under Direction
    // générale because that is where the module's audience sits and because
    // this taxonomy is presentation only — it groups the picker, it grants
    // nothing. The holder's real department still comes from their job role.
    roleCodes: ["CEO", "DGA", "DAF", "PERFORMANCE_MANAGEMENT", "PERFORMANCE_PUBLISHER"],
  },
  {
    key: "OPERATIONS",
    labelFr: "Opérations",
    labelEn: "Operations",
    roleCodes: [
      "COORDINATOR",
      "OPS_SUPERVISOR",
      "ACCOUNT_MANAGER",
      "QUOTATION_MANAGER",
      "TRANSPORT_OFFICER",
      "WAREHOUSE_COORDINATOR",
      "PICKUP_AGENT",
      "DRIVER",
      "COURIER",
    ],
  },
  {
    key: "CUSTOMS",
    labelFr: "Transit & Douane",
    labelEn: "Transit & Customs",
    roleCodes: [
      "CHIEF_OF_TRANSIT",
      "CUSTOMS_DECLARANT",
      "CUSTOMS_FIELD_AGENT",
      "DOCUMENTATION_OFFICER",
      "CUSTOMS_FINANCE_OFFICER",
    ],
  },
  {
    key: "FINANCE",
    labelFr: "Finance",
    labelEn: "Finance",
    roleCodes: ["FINANCE_OFFICER", "BILLING_OFFICER", "ACCOUNTANT", "TREASURER"],
  },
  {
    key: "HR",
    labelFr: "Ressources humaines",
    labelEn: "Human Resources",
    roleCodes: ["HR_OFFICER"],
  },
  {
    key: "LEGAL",
    labelFr: "Juridique & Conformité",
    labelEn: "Legal & Compliance",
    roleCodes: ["COMPLIANCE_HSSE"],
  },
  {
    key: "ADMINISTRATION",
    labelFr: "Administration",
    labelEn: "Administration",
    roleCodes: ["ADMINISTRATIVE_OFFICER", "CASHIER"],
  },
  {
    key: "RECOVERY",
    labelFr: "Recouvrement",
    labelEn: "Recovery",
    roleCodes: ["COLLECTIONS_OFFICER"],
  },
  {
    key: "IT",
    labelFr: "Informatique",
    labelEn: "IT",
    // MAIL_ADMIN sits here because it administers a technical subsystem's
    // identities and holds no operational, finance or HR authority. It is NOT
    // grouped with SYSTEM_ADMIN's powers — the two share a department, not a
    // permission set: SYSTEM_ADMIN is ratified OUT of correspondence access.
    roleCodes: ["SYSTEM_ADMIN", "MAIL_ADMIN"],
  },
  {
    key: "PARTNERS",
    labelFr: "Partenaires externes",
    labelEn: "External Partners",
    roleCodes: ["PARTNER_AGENT"],
  },
];

/** The bucket for a role no heading claims. Rendered only when non-empty. */
export const OTHER_DEPARTMENT: RoleDepartment = {
  key: "OTHER",
  labelFr: "Autres",
  labelEn: "Other",
  roleCodes: [],
};

const BY_ROLE: ReadonlyMap<string, DepartmentKey> = new Map(
  ROLE_DEPARTMENTS.flatMap((d) => d.roleCodes.map((c) => [c, d.key] as const)),
);

/** Which heading a role appears under, or null when the map does not claim it. */
export function departmentOfRole(roleCode: string): DepartmentKey | null {
  return BY_ROLE.get(roleCode) ?? null;
}

export function departmentLabelFr(key: DepartmentKey): string {
  if (key === "OTHER") return OTHER_DEPARTMENT.labelFr;
  return ROLE_DEPARTMENTS.find((d) => d.key === key)?.labelFr ?? key;
}

/** Minimal shape needed to group — matches AssignableRole without importing it. */
export type GroupableRole = { id: string; code: string; labelFr: string | null };

export type DepartmentGroup<R extends GroupableRole> = {
  key: DepartmentKey;
  labelFr: string;
  roles: R[];
};

/**
 * Group the roles the tenant actually has into headings.
 *
 * Empty headings are dropped — a tenant provisioned without the customs
 * capability should not be offered an empty « Transit & Douane ». Roles the map
 * does not claim land in « Autres » so they stay assignable. Within a heading,
 * roles keep the declared order; « Autres » keeps the caller's order.
 */
export function groupRolesByDepartment<R extends GroupableRole>(roles: R[]): DepartmentGroup<R>[] {
  const byCode = new Map<string, R[]>();
  for (const r of roles) {
    const list = byCode.get(r.code) ?? [];
    list.push(r);
    byCode.set(r.code, list);
  }

  const groups: DepartmentGroup<R>[] = [];
  const claimed = new Set<R>();

  for (const dept of ROLE_DEPARTMENTS) {
    const found: R[] = [];
    for (const code of dept.roleCodes) {
      for (const r of byCode.get(code) ?? []) {
        found.push(r);
        claimed.add(r);
      }
    }
    if (found.length > 0) groups.push({ key: dept.key, labelFr: dept.labelFr, roles: found });
  }

  const unclaimed = roles.filter((r) => !claimed.has(r));
  if (unclaimed.length > 0) {
    groups.push({ key: "OTHER", labelFr: OTHER_DEPARTMENT.labelFr, roles: unclaimed });
  }
  return groups;
}
