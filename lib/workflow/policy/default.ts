/**
 * The PLATFORM DEFAULT workflow policy (Phase WES-7). PURE, no I/O.
 * ---------------------------------------------------------------------------
 * WES-7G is explicit: *"the registry must initially reproduce current ratified
 * behaviour exactly"*. So this default is not authored — it is DERIVED from the
 * registries that already govern the platform:
 *
 *   department bindings   ← EFFITRANS_PROCESS[].department
 *   evidence requirements ← EFFITRANS_PROCESS[].requiredDocuments / requiredEvidence
 *   seat bindings         ← EFFITRANS_PROCESS[].role, mapped through lib/process/roles
 *   applicability         ← STEP_APPLICABILITY (the customs-leg exceptions)
 *   handoffs              ← EFFITRANS_PROCESS[].nextSteps across a department edge
 *   SLA slots             ← PROCESS_SLA_POLICIES, values preserved verbatim
 *
 * Deriving rather than transcribing means the default cannot silently disagree
 * with the code it is meant to mirror, and the day a registry entry changes the
 * default changes with it — until a tenant pins a version, which is the whole
 * point of the registry.
 *
 * NOTHING NEW IS DECIDED HERE. No seat is invented, no threshold is set, no
 * routing is added. Where the registry is silent, the default is silent too.
 */
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { STEP_APPLICABILITY, CUSTOMS_LEG_FILE_TYPES } from "@/lib/process/applicability";
import { PROCESS_SLA_POLICIES } from "@/lib/process/sla-policies";
import { mapRole } from "@/lib/process/roles";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import {
  POLICY_SCHEMA_VERSION,
  type ApplicabilityFact,
  type ApplicabilityRule,
  type DepartmentBinding,
  type EvidenceRequirement,
  type HandoffBinding,
  type SeatBinding,
  type SlaTarget,
  type SupervisorPolicy,
  type WorkflowPolicyDocument,
} from "./schema";

const ALL_NODES = [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES];

/** operational_file.type → the applicability fact that names it. */
const FILE_TYPE_FACT: Record<string, ApplicabilityFact> = {
  IMP: "file_type_imp",
  EXP: "file_type_exp",
  TRP: "file_type_trp",
  HND: "file_type_hnd",
};

/**
 * The customs-leg exceptions, exactly as STEP_APPLICABILITY declares them. A step
 * absent from that registry applies always and therefore carries no rule.
 */
function defaultApplicability(): ApplicabilityRule[] {
  return Object.entries(STEP_APPLICABILITY).map(([stepKey, types]) => ({
    stepKey,
    anyOf: (types as readonly string[])
      .map((t) => FILE_TYPE_FACT[t])
      .filter((f): f is ApplicabilityFact => Boolean(f)),
  }));
}

function defaultDepartments(): DepartmentBinding[] {
  return ALL_NODES.filter((n) => n.department).map((n) => ({
    stepKey: n.key,
    department: n.department,
  }));
}

/**
 * Roles the ratified role-templates already grant `document:approve` — the
 * permission that governed document verification BEFORE WES-4H existed.
 *
 * Derived, never transcribed, and keyed on `key` rather than `genericName`:
 * `key` is the code a tenant's `role` row actually carries, and the two differ
 * for real roles (MANAGER/OPS_SUPERVISOR, COMPLIANCE/COMPLIANCE_HSSE). Binding
 * the wrong vocabulary would produce a seat that silently matches nobody —
 * from the operator's chair, indistinguishable from the bug this replaces.
 */
function documentApproverRoles(): string[] {
  return TENANT_ROLE_TEMPLATES.filter((t) =>
    t.permissions.includes("document:approve"),
  ).map((t) => t.key);
}

/**
 * Seats. The registry names ONE official role per step; that role is the
 * assignee-eligible seat, and — for the three ratified maker-checker pairs — the
 * validator step's role is also the checker. Nothing beyond what the registry
 * already states is asserted here.
 *
 * VERIFIER (DEFECT-UAT15b). `defaultSeats` once emitted `assignee` bindings and
 * nothing else, so `resolveSeatEligibility(..., "verifier")` returned an empty
 * binding for every step of every dossier. An empty binding is refused by
 * design, so document verification was structurally impossible: production
 * carried 0 rows in `document_review` from the day WES-4H shipped.
 *
 * The default therefore binds the verifier seat to the roles that already hold
 * `document:approve` — precisely the authority that governed verification
 * before the seat check existed. That RESTORES ratified behaviour rather than
 * deciding a new business rule, which is this module's whole contract. The
 * permission check still runs first, maker-checker still forbids
 * self-verification, and a tenant that pins a policy with narrower verifier
 * seats overrides this completely.
 *
 * RQ-15b (ratified 2026-08-19) — this binding is the COMPATIBILITY rule, not
 * the target. It was ratified so existing dossiers can operate; it is expressly
 * NOT a ratification that all five holders may verify every document at every
 * step. The target is step-specific verifier seats aligned to the responsible
 * function, reached by ACTIVATING A POLICY VERSION — not by editing this
 * default again. SYSTEM_ADMIN appears here only because it holds the
 * permission; it is technical/break-glass authority, and the target
 * configuration should not treat it as an operating verifier.
 */
function defaultSeats(): SeatBinding[] {
  const out: SeatBinding[] = [];
  const verifiers = documentApproverRoles();
  for (const node of ALL_NODES) {
    // Step-independent, because the permission it restores was: holding
    // `document:approve` never depended on where the dossier had reached.
    out.push({ stepKey: node.key, seat: "verifier", roles: [...verifiers] });
    if (!node.role) continue;
    // An official role with no tenant role behind it TODAY (mapping status
    // "missing") binds no seat — the default never invents a role code.
    const tenantRole = mapRole(node.role).tenantRole;
    if (!tenantRole) continue;
    out.push({ stepKey: node.key, seat: "assignee", roles: [tenantRole] });
  }
  return out;
}

function defaultEvidence(): EvidenceRequirement[] {
  return ALL_NODES.filter(
    (n) => (n.requiredDocuments?.length ?? 0) > 0 || (n.requiredEvidence?.length ?? 0) > 0,
  ).map((n) => ({
    stepKey: n.key,
    documentTypeCodes: [...(n.requiredDocuments ?? [])],
    evidenceKeys: [...(n.requiredEvidence ?? [])],
    // The engine's evidence checker already requires APPROVED documents; the
    // default states that rule rather than relaxing it.
    requiresVerification: true,
  }));
}

/**
 * Handoffs = the registry's own `nextSteps` edges that CROSS a department
 * boundary. An edge inside one department is not a handoff, it is sequencing.
 * Explicit reception mirrors the engine's existing behaviour: every
 * cross-department transfer must be received (ADR-WES-009).
 */
function defaultHandoffs(): HandoffBinding[] {
  const deptOf = new Map(ALL_NODES.map((n) => [n.key, n.department]));
  const roleOf = new Map(ALL_NODES.map((n) => [n.key, n.role]));
  const out: HandoffBinding[] = [];

  for (const node of ALL_NODES) {
    for (const next of node.nextSteps ?? []) {
      const from = deptOf.get(node.key);
      const to = deptOf.get(next);
      if (!from || !to || from === to) continue;
      const targetRole = roleOf.get(next);
      out.push({
        fromStepKey: node.key,
        toStepKey: next,
        targetDepartment: to,
        targetRole: targetRole ? (mapRole(targetRole).tenantRole ?? null) : null,
        requiresExplicitReception: true,
        notifyOnSend: true,
      });
    }
  }
  return out;
}

/**
 * Supervisor authority. The platform default is the CONSERVATIVE reading of the
 * frozen architecture: a supervisor may reassign and request correction inside
 * their department, and may intervene — always with a reason, which policy
 * cannot switch off. Verification is NOT granted by default: a supervisor
 * verifies only where `document:approve` already put them in the verifier seat
 * (see `documentApproverRoles`), never by virtue of supervising.
 */
function defaultSupervisors(): SupervisorPolicy[] {
  const departments = [...new Set(ALL_NODES.map((n) => n.department).filter(Boolean))];
  return departments.map((department) => ({
    department,
    mayReassign: true,
    mayCompleteByIntervention: true,
    mayVerify: false,
    mayRequestCorrection: true,
    requiresReason: true as const,
  }));
}

/**
 * SLA slots, carried verbatim from the existing registry — including the
 * `unconfigured` ones, whose targets stay NULL. WES-7 stores these; it computes
 * nothing with them, and it does not ratify the four live-but-unratified
 * thresholds in lib/sla/config.ts (that is WES-8's explicit job).
 */
function defaultSla(): SlaTarget[] {
  return PROCESS_SLA_POLICIES.map((p) => ({
    policyKey: p.key,
    unit: "hours" as const,
    target: null,
    warningThreshold: p.warningHours,
    breachThreshold: p.criticalHours,
    escalationRoles: [],
    businessCalendarId: null,
    pauseSemanticsRef: null,
  }));
}

/** The platform default document. Deterministic: same registries ⇒ same bytes. */
export function buildPlatformDefaultPolicy(): WorkflowPolicyDocument {
  return {
    policySchemaVersion: POLICY_SCHEMA_VERSION,
    description:
      "Politique par défaut de la plateforme — dérivée du registre officiel des 26 étapes. " +
      "Reproduit le comportement ratifié existant, sans nouvelle règle métier.",
    applicability: defaultApplicability(),
    departments: defaultDepartments(),
    seats: defaultSeats(),
    evidence: defaultEvidence(),
    handoffs: defaultHandoffs(),
    supervisors: defaultSupervisors(),
    sla: defaultSla(),
  };
}

/** The customs-leg file types, re-exported so validators need one source. */
export { CUSTOMS_LEG_FILE_TYPES };
