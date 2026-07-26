/**
 * Workflow policy validation (Phase WES-7E) — PURE, no I/O. FAIL-CLOSED.
 * ---------------------------------------------------------------------------
 * A policy version is validated ONCE, before activation, against the real
 * catalogs. Anything that cannot be proven safe is REJECTED — an unvalidatable
 * version can never become active (ADR-WES-012 §E).
 *
 * The eight ratified safety boundaries, each with a rejection code:
 *   1  no RLS / tenant-isolation bypass ......... policy carries no such lever at all
 *   2  no permission outside the catalog ........ unknown_permission
 *   3  no audit disabling ....................... policy carries no such lever at all
 *   4  no maker = checker ....................... maker_checker_conflict
 *   5  no illegal transition .................... unknown_step / invalid_handoff
 *   6  no monotonicity break .................... stage ORDER is code, not policy
 *   7  no emptying mandated evidence ............ evidence_required_empty
 *   8  no non-existent seat ..................... unknown_role
 *
 * Boundaries 1, 3 and 6 are enforced STRUCTURALLY: the schema simply has no
 * field that could express them. That is stronger than validating them away, and
 * a test asserts the fields stay absent.
 *
 * Catalogs are INJECTED so this stays pure and exhaustively testable; the caller
 * (./actions) supplies the live ones.
 */
import {
  APPLICABILITY_FACTS,
  POLICY_DOCUMENT_KEYS,
  POLICY_SCHEMA_VERSION,
  SEAT_FUNCTIONS,
  SLA_UNITS,
  type WorkflowPolicyDocument,
} from "./schema";

export type PolicyValidationError = {
  /** Stable machine code. The UI resolves copy from it; tests pin it. */
  code:
    | "invalid_schema_version"
    | "unknown_key"
    | "malformed"
    | "unknown_step"
    | "unknown_department"
    | "unknown_role"
    | "unknown_permission"
    | "unknown_document_type"
    | "unknown_fact"
    | "unknown_sla_policy"
    | "invalid_sla_unit"
    | "invalid_handoff"
    | "circular_handoff"
    | "maker_checker_conflict"
    | "unsafe_supervisor_authority"
    | "evidence_required_empty"
    | "duplicate_binding";
  /** Where in the document — e.g. `handoffs[3].toStepKey`. */
  path: string;
  detail: string;
};

/** The live catalogs a policy is validated against. All injected. */
export type PolicyCatalogs = {
  stepKeys: readonly string[];
  departments: readonly string[];
  /** Tenant role codes that actually exist. */
  roles: readonly string[];
  /** `permission.code` values — the catalog policy may never step outside. */
  permissions: readonly string[];
  /**
   * Valid evidence identifiers. The platform has TWO real, coexisting spaces and
   * policy may reference either:
   *   * `document_type.code`   — the uploadable document catalogue
   *   * official document KEYS — lib/process/documents.ts, which is what the
   *     26-step registry's `requiredDocuments` already reference
   * Validating against only one would reject the platform's own default.
   */
  documentTypeCodes: readonly string[];
  slaPolicyKeys: readonly string[];
  /**
   * Steps whose evidence is mandated by ratified doctrine and may never be
   * emptied (boundary 7). Supplied by the caller; empty is acceptable.
   */
  evidenceMandatedSteps?: readonly string[];
  /** Ratified maker-checker pairs: a checker seat may never equal the preparer's. */
  makerCheckerPairs?: readonly { preparerStep: string; validatorStep: string }[];
};

export type PolicyValidationResult =
  | { ok: true; errors: [] }
  | { ok: false; errors: PolicyValidationError[] };

const err = (
  code: PolicyValidationError["code"],
  path: string,
  detail: string,
): PolicyValidationError => ({ code, path, detail });

const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/**
 * Validate a candidate document. Deterministic: the same document and catalogs
 * always produce the same ordered error list.
 */
export function validatePolicyDocument(
  candidate: unknown,
  catalogs: PolicyCatalogs,
): PolicyValidationResult {
  const errors: PolicyValidationError[] = [];

  if (typeof candidate !== "object" || candidate === null || isArray(candidate)) {
    return { ok: false, errors: [err("malformed", "", "policy document must be an object")] };
  }
  const doc = candidate as Record<string, unknown>;

  // --- schema version + unknown keys (no untyped JSON is ever accepted) -------
  if (doc.policySchemaVersion !== POLICY_SCHEMA_VERSION) {
    errors.push(
      err(
        "invalid_schema_version",
        "policySchemaVersion",
        `expected ${POLICY_SCHEMA_VERSION}, received ${String(doc.policySchemaVersion)}`,
      ),
    );
  }
  for (const key of Object.keys(doc)) {
    if (!(POLICY_DOCUMENT_KEYS as readonly string[]).includes(key)) {
      errors.push(err("unknown_key", key, `unknown top-level key "${key}"`));
    }
  }
  for (const key of POLICY_DOCUMENT_KEYS) {
    if (key === "policySchemaVersion" || key === "description") continue;
    if (!isArray(doc[key])) errors.push(err("malformed", key, `"${key}" must be an array`));
  }
  // A structurally broken document is not worth per-entry errors.
  if (errors.some((e) => e.code === "malformed" || e.code === "invalid_schema_version")) {
    return { ok: false, errors };
  }

  const p = doc as unknown as WorkflowPolicyDocument;
  const step = new Set(catalogs.stepKeys);
  const dept = new Set(catalogs.departments);
  const role = new Set(catalogs.roles);
  const docType = new Set(catalogs.documentTypeCodes);
  const slaKey = new Set(catalogs.slaPolicyKeys);
  const fact = new Set<string>(APPLICABILITY_FACTS);

  // --- 1. applicability -------------------------------------------------------
  p.applicability.forEach((r, i) => {
    if (!isStr(r?.stepKey) || !step.has(r.stepKey)) {
      errors.push(err("unknown_step", `applicability[${i}].stepKey`, `unknown step "${r?.stepKey}"`));
    }
    if (!isArray(r?.anyOf)) {
      errors.push(err("malformed", `applicability[${i}].anyOf`, "anyOf must be an array"));
      return;
    }
    r.anyOf.forEach((f, j) => {
      if (!fact.has(f)) errors.push(err("unknown_fact", `applicability[${i}].anyOf[${j}]`, `unknown fact "${f}"`));
    });
  });

  // --- 2. department responsibility -------------------------------------------
  const seenDeptBinding = new Set<string>();
  p.departments.forEach((b, i) => {
    if (!isStr(b?.stepKey) || !step.has(b.stepKey)) {
      errors.push(err("unknown_step", `departments[${i}].stepKey`, `unknown step "${b?.stepKey}"`));
    }
    if (!isStr(b?.department) || !dept.has(b.department)) {
      errors.push(err("unknown_department", `departments[${i}].department`, `unknown department "${b?.department}"`));
    }
    if (b?.stepKey) {
      if (seenDeptBinding.has(b.stepKey)) {
        errors.push(err("duplicate_binding", `departments[${i}].stepKey`, `step "${b.stepKey}" bound twice`));
      }
      seenDeptBinding.add(b.stepKey);
    }
  });

  // --- 3. seat / role bindings -------------------------------------------------
  p.seats.forEach((s, i) => {
    if (!isStr(s?.stepKey) || !step.has(s.stepKey)) {
      errors.push(err("unknown_step", `seats[${i}].stepKey`, `unknown step "${s?.stepKey}"`));
    }
    if (!(SEAT_FUNCTIONS as readonly string[]).includes(s?.seat)) {
      errors.push(err("malformed", `seats[${i}].seat`, `unknown seat function "${s?.seat}"`));
    }
    if (!isArray(s?.roles)) {
      errors.push(err("malformed", `seats[${i}].roles`, "roles must be an array"));
      return;
    }
    // BOUNDARY 8 — policy never invents a role code.
    s.roles.forEach((r, j) => {
      if (!role.has(r)) errors.push(err("unknown_role", `seats[${i}].roles[${j}]`, `unknown role "${r}"`));
    });
    // An identity-bound seat carries no role; a role-bound seat carries at least one.
    if (s.identityBound && s.roles.length > 0) {
      errors.push(err("malformed", `seats[${i}]`, "an identity-bound seat must declare no roles"));
    }
    if (!s.identityBound && s.roles.length === 0) {
      errors.push(err("malformed", `seats[${i}].roles`, "a role-bound seat must declare at least one role"));
    }
  });

  // BOUNDARY 4 — maker ≠ checker. A checker seat sharing every role with the
  // preparer's assignee seat would make self-validation reachable through policy.
  for (const pair of catalogs.makerCheckerPairs ?? []) {
    const preparer = p.seats.find((s) => s.stepKey === pair.preparerStep && s.seat === "assignee");
    const checker = p.seats.find((s) => s.stepKey === pair.validatorStep && s.seat === "checker");
    if (!preparer || !checker || checker.roles.length === 0) continue;
    const identical =
      checker.roles.length === preparer.roles.length &&
      checker.roles.every((r) => preparer.roles.includes(r));
    if (identical) {
      errors.push(
        err(
          "maker_checker_conflict",
          `seats[${pair.validatorStep}]`,
          `checker roles for "${pair.validatorStep}" are identical to the preparer's — self-validation would be reachable`,
        ),
      );
    }
  }

  // --- 4. evidence requirements -------------------------------------------------
  const mandated = new Set(catalogs.evidenceMandatedSteps ?? []);
  const evidenceByStep = new Map<string, number>();
  p.evidence.forEach((e, i) => {
    if (!isStr(e?.stepKey) || !step.has(e.stepKey)) {
      errors.push(err("unknown_step", `evidence[${i}].stepKey`, `unknown step "${e?.stepKey}"`));
    }
    if (!isArray(e?.documentTypeCodes)) {
      errors.push(err("malformed", `evidence[${i}].documentTypeCodes`, "must be an array"));
      return;
    }
    e.documentTypeCodes.forEach((c, j) => {
      if (!docType.has(c)) {
        errors.push(err("unknown_document_type", `evidence[${i}].documentTypeCodes[${j}]`, `unknown document type "${c}"`));
      }
    });
    evidenceByStep.set(e.stepKey, e.documentTypeCodes.length + (e.evidenceKeys?.length ?? 0));
  });
  // BOUNDARY 7 — a doctrine-mandated evidence set may never be emptied.
  for (const s of mandated) {
    if ((evidenceByStep.get(s) ?? 0) === 0) {
      errors.push(err("evidence_required_empty", `evidence[${s}]`, `step "${s}" requires evidence by ratified doctrine`));
    }
  }

  // --- 5. handoff routing --------------------------------------------------------
  const edges = new Map<string, string[]>();
  p.handoffs.forEach((h, i) => {
    if (!isStr(h?.fromStepKey) || !step.has(h.fromStepKey)) {
      errors.push(err("unknown_step", `handoffs[${i}].fromStepKey`, `unknown step "${h?.fromStepKey}"`));
    }
    if (!isStr(h?.toStepKey) || !step.has(h.toStepKey)) {
      errors.push(err("unknown_step", `handoffs[${i}].toStepKey`, `unknown step "${h?.toStepKey}"`));
    }
    if (h?.fromStepKey && h.fromStepKey === h.toStepKey) {
      errors.push(err("invalid_handoff", `handoffs[${i}]`, "a handoff cannot target its own source step"));
    }
    if (!isStr(h?.targetDepartment) || !dept.has(h.targetDepartment)) {
      errors.push(err("unknown_department", `handoffs[${i}].targetDepartment`, `unknown department "${h?.targetDepartment}"`));
    }
    if (h?.targetRole != null && !role.has(h.targetRole)) {
      errors.push(err("unknown_role", `handoffs[${i}].targetRole`, `unknown role "${h.targetRole}"`));
    }
    if (h?.fromStepKey && h?.toStepKey) {
      edges.set(h.fromStepKey, [...(edges.get(h.fromStepKey) ?? []), h.toStepKey]);
    }
  });

  for (const cycle of findCycles(edges)) {
    errors.push(err("circular_handoff", "handoffs", `circular routing: ${cycle.join(" → ")}`));
  }

  // --- 6. supervisor intervention -------------------------------------------------
  p.supervisors.forEach((s, i) => {
    if (!isStr(s?.department) || !dept.has(s.department)) {
      errors.push(err("unknown_department", `supervisors[${i}].department`, `unknown department "${s?.department}"`));
    }
    // Intervention without a written reason is unauditable — policy may not disable it.
    if (s?.requiresReason !== true) {
      errors.push(
        err("unsafe_supervisor_authority", `supervisors[${i}].requiresReason`, "intervention must always require a reason"),
      );
    }
  });

  // --- 7. SLA slots (stored + validated; NOT computed — WES-8) ---------------------
  p.sla.forEach((s, i) => {
    if (!isStr(s?.policyKey) || !slaKey.has(s.policyKey)) {
      errors.push(err("unknown_sla_policy", `sla[${i}].policyKey`, `unknown SLA policy "${s?.policyKey}"`));
    }
    if (!(SLA_UNITS as readonly string[]).includes(s?.unit)) {
      errors.push(err("invalid_sla_unit", `sla[${i}].unit`, `unsupported unit "${s?.unit}"`));
    }
    for (const [field, value] of [
      ["target", s?.target],
      ["warningThreshold", s?.warningThreshold],
      ["breachThreshold", s?.breachThreshold],
    ] as const) {
      if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        errors.push(err("malformed", `sla[${i}].${field}`, "must be a non-negative number or null"));
      }
    }
    (s?.escalationRoles ?? []).forEach((r, j) => {
      if (!role.has(r)) errors.push(err("unknown_role", `sla[${i}].escalationRoles[${j}]`, `unknown role "${r}"`));
    });
  });

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/** Every cycle reachable in the handoff graph. Iterative DFS — no recursion limits. */
function findCycles(edges: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();

  for (const start of edges.keys()) {
    if (seen.has(start)) continue;
    const stack: { node: string; path: string[] }[] = [{ node: start, path: [start] }];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const { node, path } = stack.pop()!;
      for (const next of edges.get(node) ?? []) {
        if (path.includes(next)) {
          cycles.push([...path.slice(path.indexOf(next)), next]);
          continue;
        }
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push({ node: next, path: [...path, next] });
      }
    }
    seen.add(start);
  }
  // De-duplicate cycles that differ only by rotation/order of discovery.
  const uniq = new Map<string, string[]>();
  for (const c of cycles) uniq.set([...c].sort().join("|"), c);
  return [...uniq.values()];
}
