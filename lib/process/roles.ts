/**
 * Official role → tenant role mapping (Phase 5.0A, CORRECTED in 5.0E-2B) — PURE.
 * ---------------------------------------------------------------------------
 * The role-gap matrix as data. The official process names 15 business roles.
 *
 * THIS FILE WAS STALE, and it mattered.
 *
 * The `status`/`tenantRole` fields recorded the state of the world at AUDIT TIME
 * (Phase 5.0A): seven official roles had no tenant role behind them. Phase 5.0B then
 * CREATED all seven (see 20260713000001_process_engine.sql and seed.sql) — but nobody
 * came back and updated this map, so it went on claiming `tenantRole: null` for roles
 * that had existed for two phases.
 *
 * Nothing depended on it until 5.0E-2B derived the pilot checklist from it, at which
 * point it confidently reported that 9 of the 26 steps could not be executed by a real
 * user. That was false, and a pilot run against it would have "discovered" nine
 * phantom blockers.
 *
 * The fix keeps BOTH facts, because both are true of different moments:
 *   • `auditStatus` — the Phase 5.0A finding, PRESERVED verbatim. Seven roles were
 *     missing when we looked. That conclusion stands and must not be rewritten.
 *   • `status` / `tenantRole` — the state TODAY. Seven roles now exist.
 *
 * REUSE, DO NOT RENAME. Existing roles keep their codes and their users. This module
 * records the correspondence; it does not change any role.
 */
import type { ProcessRole } from "./types";

export type RoleMappingStatus =
  /** An existing tenant role is semantically equivalent — reuse it as-is. */
  | "mapped"
  /** The role exists but holds no permissions for this work — activate it. */
  | "inert"
  /** No equivalent role exists — Phase 5.0C must create it. */
  | "missing";

export type RoleMapping = {
  officialRole: ProcessRole;
  /** Existing tenant role code, or `null` when none exists. CURRENT state. */
  tenantRole: string | null;
  /** CURRENT state of the mapping. */
  status: RoleMappingStatus;
  /**
   * The Phase 5.0A audit verdict, preserved. Seven roles were `missing` at audit
   * time; Phase 5.0B created them. This field records what we FOUND, never what is
   * true now — do not "correct" it.
   */
  auditStatus: RoleMappingStatus;
  note: string;
};

export const ROLE_MAPPINGS: RoleMapping[] = [
  {
    officialRole: "COTATION_OFFICER",
    tenantRole: "QUOTATION_MANAGER",
    status: "inert",
    auditStatus: "inert",
    note: "Role exists ('Responsable des cotations') but holds only profile:read:self and profile:update:self. The pricing module was deferred. Grant quotation:* in Phase 5.0D — do not rename.",
  },
  {
    officialRole: "OPERATIONS_MANAGER",
    tenantRole: "OPS_SUPERVISOR",
    status: "mapped",
    auditStatus: "mapped",
    note: "'Superviseur opérations', genericName MANAGER. Semantically equivalent.",
  },
  {
    officialRole: "ACCOUNT_MANAGER",
    tenantRole: "ACCOUNT_MANAGER",
    status: "mapped",
    auditStatus: "mapped",
    note: "Exact match. 'File owner, end-to-end' — remains the customer-facing dossier owner.",
  },
  {
    officialRole: "COORDINATOR",
    tenantRole: "COORDINATOR",
    status: "mapped",
    auditStatus: "mapped",
    note: "Exact match. 'Control tower' — the central orchestrator of the official process.",
  },
  {
    officialRole: "CHIEF_TRANSIT",
    tenantRole: "CHIEF_OF_TRANSIT",
    status: "mapped",
    auditStatus: "mapped",
    note: "Equivalent. Gated on the customsBroker capability. Already holds customs:release, correctly withheld from the Declarant.",
  },
  {
    officialRole: "CUSTOMS_DECLARANT",
    tenantRole: "CUSTOMS_DECLARANT",
    status: "mapped",
    auditStatus: "mapped",
    note: "Exact match. Gated on the customsBroker capability.",
  },
  {
    officialRole: "CUSTOMS_FINANCE_OFFICER",
    tenantRole: "CUSTOMS_FINANCE_OFFICER",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "Step 9 requires Finance to register the declaration in GAINDE — but FINANCE_OFFICER holds NO customs:* permission, so RBAC actively forbids it today. Either create this role or grant FINANCE_OFFICER a narrow customs:register.",
  },
  {
    officialRole: "CUSTOMS_FIELD_AGENT",
    tenantRole: "CUSTOMS_FIELD_AGENT",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "No field-agent role. Customs work splits only into CHIEF_OF_TRANSIT (validation) and CUSTOMS_DECLARANT (execution).",
  },
  {
    officialRole: "TRANSPORT_OFFICER",
    tenantRole: "TRANSPORT_OFFICER",
    status: "mapped",
    auditStatus: "mapped",
    note: "Exact match, genericName DISPATCHER. Gated on the roadTransport capability.",
  },
  {
    officialRole: "PICKUP_AGENT",
    tenantRole: "PICKUP_AGENT",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "DRIVER is NOT a pickup agent — it is a narrow mobile identity (tracking:read/write + own profile, no dossier access). The pickup agent needs dossier visibility and port-exit formality rights.",
  },
  {
    officialRole: "BILLING_OFFICER",
    tenantRole: "BILLING_OFFICER",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "MANDATORY SPLIT. No tenant billing role exists (PLATFORM_BILLING is a platform-namespace SaaS role and cannot be assigned to tenant staff). FINANCE_OFFICER currently creates AND issues the same invoice — steps 20/21 are a maker-checker pair and cannot be separated while one role does both.",
  },
  {
    officialRole: "FINANCE_OFFICER",
    tenantRole: "FINANCE_OFFICER",
    status: "mapped",
    auditStatus: "mapped",
    note: "Exists — but must LOSE invoice-creation rights (finance:create) to become a clean validator once BILLING_OFFICER exists.",
  },
  {
    officialRole: "ADMINISTRATIVE_OFFICER",
    tenantRole: "ADMINISTRATIVE_OFFICER",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "SYSTEM_ADMIN is the IT/config admin (genericName TENANT_ADMIN), not an administrative service. No generic administrative-assistant role exists.",
  },
  {
    officialRole: "COURIER",
    tenantRole: "COURIER",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "Zero occurrences of 'courier' repo-wide. Should be narrow like DRIVER: deposit + proof upload only, no financial status mutation.",
  },
  {
    officialRole: "COLLECTIONS_OFFICER",
    tenantRole: "COLLECTIONS_OFFICER",
    status: "mapped",
    // 5.0A found this role MISSING; 5.0B created it. Both facts preserved.
    auditStatus: "missing",
    note: "No AR/collections role or permission. FINANCE_OFFICER and OPS_SUPERVISOR hold all finance permissions undifferentiated.",
  },
];

/**
 * Tenant roles that exist but play no part in the official process. KEEP THEM —
 * they serve platform, portal, compliance and mobile-execution needs.
 */
export const OUT_OF_PROCESS_TENANT_ROLES = [
  "SYSTEM_ADMIN",
  "CEO",
  "DOCUMENTATION_OFFICER",
  "WAREHOUSE_COORDINATOR",
  "COMPLIANCE_HSSE",
  "CLIENT_USER",
  "PARTNER_AGENT",
  "DRIVER",
];

/**
 * Permission codes the official process needs that DO NOT EXIST in the catalog
 * today. Nothing may assume these are grantable until Phase 5.0C creates them.
 */
export const MISSING_PERMISSIONS = [
  "quotation:create",
  "quotation:send",
  "quotation:approve",
  "customs:assign",
  "customs:validate",
  "customs:register",
  "transport:request",
  "process:handoff:send",
  "process:handoff:receive",
  "process:completeness:review",
  "finance:validate",
  "admin_service:manage",
  "courier:assign",
  "courier:deposit",
  "collections:manage",
];

const BY_OFFICIAL = new Map<ProcessRole, RoleMapping>(ROLE_MAPPINGS.map((m) => [m.officialRole, m]));

export function mapRole(role: ProcessRole): RoleMapping {
  const m = BY_OFFICIAL.get(role);
  if (!m) throw new Error(`unmapped official role: ${role}`);
  return m;
}

/**
 * Official roles with no tenant role behind them TODAY.
 *
 * As of Phase 5.0B this is EMPTY: all seven roles the 5.0A audit found missing have
 * been created. Use `auditMissingRoles()` for the historical finding.
 */
export function missingRoles(): RoleMapping[] {
  return ROLE_MAPPINGS.filter((m) => m.status === "missing");
}

/**
 * The Phase 5.0A finding, preserved: the seven official roles that had no tenant role
 * when the audit was taken. Phase 5.0B created them; this list does not shrink, because
 * it is a record of what we found, not a description of the present.
 */
export function auditMissingRoles(): RoleMapping[] {
  return ROLE_MAPPINGS.filter((m) => m.auditStatus === "missing");
}

/** True when a step's role can actually be actioned by someone today. */
export function roleIsUsable(role: ProcessRole): boolean {
  return mapRole(role).status === "mapped";
}
