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
 * Seats. The registry names ONE official role per step; that role is the
 * assignee-eligible seat, and — for the three ratified maker-checker pairs — the
 * validator step's role is also the checker. Nothing beyond what the registry
 * already states is asserted here.
 */
function defaultSeats(): SeatBinding[] {
  const out: SeatBinding[] = [];
  for (const node of ALL_NODES) {
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
 * cannot switch off. Verification is NOT granted by default: WES-4 decides
 * verifier seats, and granting one here would pre-empt it.
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
