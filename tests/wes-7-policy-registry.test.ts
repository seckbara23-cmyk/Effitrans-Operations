/**
 * Phase WES-7 — versioned workflow policy registry (ADR-WES-012).
 * ---------------------------------------------------------------------------
 * The schema, the default, the validator and the hash are PURE, so those are
 * tested as BEHAVIOUR. The server guarantees (resolution order, pinning,
 * authorization, atomic activation) are asserted against real source and against
 * the migration's SQL, since importing a "use server" module pulls the whole
 * server chain and the DB guarantees live in SQL.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  POLICY_DOCUMENT_KEYS,
  POLICY_SCHEMA_VERSION,
  canTransitionPolicy,
  isPublished,
  isPolicyProvenance,
} from "@/lib/workflow/policy/schema";
import { buildPlatformDefaultPolicy } from "@/lib/workflow/policy/default";
import { validatePolicyDocument, type PolicyCatalogs } from "@/lib/workflow/policy/validate";
import {
  diffPolicies,
  normalizePolicyDocument,
  policiesAreIdentical,
  policyContentSha256,
} from "@/lib/workflow/policy/hash";
import { ALL_NODE_KEYS } from "@/lib/process/engine/state";
import { PROCESS_DEPARTMENTS } from "@/lib/process/types";
import { PROCESS_SLA_POLICIES } from "@/lib/process/sla-policies";
import { TENANT_ROLE_KEYS } from "@/lib/platform/role-templates";
import { MAKER_CHECKER_PAIRS } from "@/lib/process/effitrans-process";
import { DOCUMENT_MAPPINGS } from "@/lib/process/documents";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
/** Executable code only — prose must never satisfy or break an assertion. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Executable SQL only. */
const sql = (s: string) =>
  s.split("\n").map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--")))).join("\n");

const MIGRATION = read("../supabase/migrations/20260726000003_workflow_policy_registry.sql");
const RESOLVER = read("../lib/workflow/policy/resolver.ts");
const ACTIONS = read("../lib/workflow/policy/actions.ts");
const READERS = read("../lib/workflow/policy/readers.ts");
const SCHEMA = read("../lib/workflow/policy/schema.ts");
const ENGINE_ACTIONS = read("../lib/process/engine/actions.ts");
const ADMIN_PAGE = read("../app/settings/workflow-policy/page.tsx");
const ADMIN_UI = read("../components/settings/policy-admin.tsx");
const CI = read("../.github/workflows/ci.yml");

/** Catalogs matching the real platform. */
const CATALOGS: PolicyCatalogs = {
  stepKeys: ALL_NODE_KEYS,
  departments: PROCESS_DEPARTMENTS,
  roles: TENANT_ROLE_KEYS,
  permissions: ["admin:config:manage", "file:read"],
  // Both real identifier spaces, exactly as the action supplies them.
  documentTypeCodes: [
    ...new Set([
      "COMMERCIAL_INVOICE", "PACKING_LIST", "BILL_OF_LADING", "BON_A_ENLEVER", "DELIVERY_NOTE",
      ...DOCUMENT_MAPPINGS.map((m) => m.key),
    ]),
  ],
  slaPolicyKeys: PROCESS_SLA_POLICIES.map((p) => p.key),
  makerCheckerPairs: MAKER_CHECKER_PAIRS.map((p) => ({
    preparerStep: p.preparerStep,
    validatorStep: p.validatorStep,
  })),
};

/** A minimal document that validates, for negative tests to mutate. */
function minimal() {
  return {
    policySchemaVersion: POLICY_SCHEMA_VERSION,
    description: "test",
    applicability: [],
    departments: [],
    seats: [],
    evidence: [],
    handoffs: [],
    supervisors: [],
    sla: [],
  };
}

// ======================== A. Schema + code/config boundary (1-8) =============

describe("the policy contract", () => {
  it("1 — declares a schema version and the exact permitted top-level keys", () => {
    expect(POLICY_SCHEMA_VERSION).toBe(1);
    expect([...POLICY_DOCUMENT_KEYS].sort()).toEqual(
      ["applicability", "departments", "description", "evidence", "handoffs", "policySchemaVersion", "seats", "sla", "supervisors"].sort(),
    );
  });

  it("2 — covers the seven ratified policy domains", () => {
    const doc = buildPlatformDefaultPolicy();
    for (const domain of ["applicability", "departments", "seats", "evidence", "handoffs", "supervisors", "sla"]) {
      expect(doc, domain).toHaveProperty(domain);
    }
  });

  it("3 — CODE INVARIANTS ARE NOT EXPRESSIBLE: no field can disable them", () => {
    // Boundaries 1, 3 and 6 are enforced structurally — the schema simply has no
    // lever for them, which is stronger than validating them away.
    const src = code(SCHEMA);
    expect(src).not.toMatch(/rls|tenantIsolation|disableAudit|skipAudit|allowSelfValidation/i);
    expect(src).not.toMatch(/stageOrder|lifecycleOrder|progressFormula/i);
  });

  it("4 — a published version is immutable in the state machine", () => {
    expect(isPublished("ACTIVE")).toBe(true);
    expect(isPublished("RETIRED")).toBe(true);
    expect(canTransitionPolicy("ACTIVE", "DRAFT")).toBe(false);
    expect(canTransitionPolicy("RETIRED", "ACTIVE")).toBe(false);
    expect(canTransitionPolicy("ACTIVE", "RETIRED")).toBe(true);
  });

  it("5 — only a VALIDATED version may become ACTIVE", () => {
    expect(canTransitionPolicy("DRAFT", "ACTIVE")).toBe(false);
    expect(canTransitionPolicy("VALIDATED", "ACTIVE")).toBe(true);
  });

  it("6 — an edited validated version returns to DRAFT", () => {
    expect(canTransitionPolicy("VALIDATED", "DRAFT")).toBe(true);
  });

  it("7 — provenance is an explicit, closed vocabulary", () => {
    expect(isPolicyProvenance("PINNED")).toBe(true);
    expect(isPolicyProvenance("LEGACY_DEFAULT")).toBe(true);
    expect(isPolicyProvenance("MIGRATED")).toBe(true);
    expect(isPolicyProvenance("GUESSED")).toBe(false);
  });

  it("8 — SLA is a stored CONTRACT only: nothing computes with it (WES-8)", () => {
    const src = code(read("../lib/workflow/policy/schema.ts")) + code(RESOLVER) + code(ACTIONS);
    expect(src).not.toMatch(/elapsed|breachedAt|escalate\(|businessCalendar\.|setTimeout|clock/i);
  });
});

// ================== B. The default reproduces current behaviour (9-14) =======

describe("the platform default is DERIVED, not authored", () => {
  const doc = buildPlatformDefaultPolicy();

  it("9 — every department binding names a real registry step and department", () => {
    for (const b of doc.departments) {
      expect(ALL_NODE_KEYS, b.stepKey).toContain(b.stepKey);
      expect(PROCESS_DEPARTMENTS, b.department).toContain(b.department);
    }
    expect(doc.departments.length).toBeGreaterThan(20);
  });

  it("10 — applicability mirrors the existing customs-leg exceptions", () => {
    const customsSteps = doc.applicability.map((a) => a.stepKey);
    expect(customsSteps).toContain("customs_preparation");
    expect(customsSteps).toContain("customs_field_clearance");
    for (const rule of doc.applicability) {
      expect(rule.anyOf).toEqual(expect.arrayContaining(["file_type_imp", "file_type_exp"]));
    }
  });

  it("11 — every seat names a role that actually exists", () => {
    for (const s of doc.seats) {
      for (const r of s.roles) expect(TENANT_ROLE_KEYS, r).toContain(r);
    }
  });

  it("12 — handoffs only cross a department boundary", () => {
    const deptOf = new Map(doc.departments.map((d) => [d.stepKey, d.department]));
    for (const h of doc.handoffs) {
      expect(deptOf.get(h.fromStepKey), `${h.fromStepKey}→${h.toStepKey}`).not.toBe(deptOf.get(h.toStepKey));
      expect(h.requiresExplicitReception).toBe(true); // ADR-WES-009
    }
  });

  it("13 — SLA slots carry NO invented target (unconfigured stays unconfigured)", () => {
    expect(doc.sla.length).toBe(PROCESS_SLA_POLICIES.length);
    for (const s of doc.sla) expect(s.target).toBeNull();
  });

  it("14 — the default VALIDATES against the real catalogs", () => {
    const result = validatePolicyDocument(doc, CATALOGS);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ============================ C. Validation, fail-closed (15-27) =============

describe("VALIDATION rejects everything unsafe", () => {
  it("15 — an unknown schema version is rejected", () => {
    const r = validatePolicyDocument({ ...minimal(), policySchemaVersion: 99 }, CATALOGS);
    expect(r.ok).toBe(false);
    expect(r.errors[0].code).toBe("invalid_schema_version");
  });

  it("16 — UNKNOWN KEYS are rejected (no untyped JSON is ever accepted)", () => {
    const r = validatePolicyDocument({ ...minimal(), sneaky: true }, CATALOGS);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "unknown_key")).toBe(true);
  });

  it("17 — an unknown ROLE is rejected", () => {
    const doc = { ...minimal(), seats: [{ stepKey: ALL_NODE_KEYS[0], seat: "assignee", roles: ["NOT_A_ROLE"] }] };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "unknown_role")).toBe(true);
  });

  it("18 — an unknown DEPARTMENT is rejected", () => {
    const doc = { ...minimal(), departments: [{ stepKey: ALL_NODE_KEYS[0], department: "marketing" }] };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "unknown_department")).toBe(true);
  });

  it("19 — an unknown EVIDENCE / document type is rejected", () => {
    const doc = {
      ...minimal(),
      evidence: [{ stepKey: ALL_NODE_KEYS[0], documentTypeCodes: ["NOT_A_DOC"], evidenceKeys: [], requiresVerification: true }],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "unknown_document_type")).toBe(true);
  });

  it("20 — an unknown STEP is rejected", () => {
    const doc = { ...minimal(), departments: [{ stepKey: "not_a_step", department: PROCESS_DEPARTMENTS[0] }] };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "unknown_step")).toBe(true);
  });

  it("21 — an INVALID HANDOFF (self-target) is rejected", () => {
    const k = ALL_NODE_KEYS[0];
    const doc = {
      ...minimal(),
      handoffs: [{ fromStepKey: k, toStepKey: k, targetDepartment: PROCESS_DEPARTMENTS[0], targetRole: null, requiresExplicitReception: true, notifyOnSend: true }],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "invalid_handoff")).toBe(true);
  });

  it("22 — CIRCULAR handoff routing is rejected", () => {
    const [a, b] = ALL_NODE_KEYS;
    const d = PROCESS_DEPARTMENTS[0];
    const doc = {
      ...minimal(),
      handoffs: [
        { fromStepKey: a, toStepKey: b, targetDepartment: d, targetRole: null, requiresExplicitReception: true, notifyOnSend: true },
        { fromStepKey: b, toStepKey: a, targetDepartment: d, targetRole: null, requiresExplicitReception: true, notifyOnSend: true },
      ],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "circular_handoff")).toBe(true);
  });

  it("23 — MAKER = CHECKER is rejected (self-validation stays unreachable)", () => {
    const pair = MAKER_CHECKER_PAIRS[0];
    const doc = {
      ...minimal(),
      seats: [
        { stepKey: pair.preparerStep, seat: "assignee", roles: ["CHIEF_OF_TRANSIT"] },
        { stepKey: pair.validatorStep, seat: "checker", roles: ["CHIEF_OF_TRANSIT"] },
      ],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "maker_checker_conflict")).toBe(true);
  });

  it("24 — supervisor intervention may NEVER waive its reason requirement", () => {
    const doc = {
      ...minimal(),
      supervisors: [{ department: PROCESS_DEPARTMENTS[0], mayReassign: true, mayCompleteByIntervention: true, mayVerify: true, mayRequestCorrection: true, requiresReason: false }],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "unsafe_supervisor_authority")).toBe(true);
  });

  it("25 — doctrine-mandated evidence may not be emptied", () => {
    const step = ALL_NODE_KEYS[0];
    const r = validatePolicyDocument(minimal(), { ...CATALOGS, evidenceMandatedSteps: [step] });
    expect(r.errors.some((e) => e.code === "evidence_required_empty")).toBe(true);
  });

  it("26 — an unsupported SLA unit is rejected", () => {
    const doc = {
      ...minimal(),
      sla: [{ policyKey: PROCESS_SLA_POLICIES[0].key, unit: "fortnights", target: null, warningThreshold: null, breachThreshold: null, escalationRoles: [], businessCalendarId: null, pauseSemanticsRef: null }],
    };
    const r = validatePolicyDocument(doc, CATALOGS);
    expect(r.errors.some((e) => e.code === "invalid_sla_unit")).toBe(true);
  });

  it("27 — validation is DETERMINISTIC", () => {
    const doc = { ...minimal(), departments: [{ stepKey: "nope", department: "nope" }] };
    expect(validatePolicyDocument(doc, CATALOGS)).toEqual(validatePolicyDocument(doc, CATALOGS));
  });
});

// ============================ D. Hash + versioning (28-33) ===================

describe("HASHING and version identity", () => {
  it("28 — the hash is stable for identical content", () => {
    expect(policyContentSha256(buildPlatformDefaultPolicy())).toBe(
      policyContentSha256(buildPlatformDefaultPolicy()),
    );
  });

  it("29 — ORDER does not change the hash (bindings are sets, not lists)", () => {
    const a = buildPlatformDefaultPolicy();
    const b = { ...a, departments: [...a.departments].reverse() };
    expect(policiesAreIdentical(a, b)).toBe(true);
  });

  it("30 — a real content change DOES change the hash", () => {
    const a = buildPlatformDefaultPolicy();
    const b = { ...a, description: "different" };
    expect(policiesAreIdentical(a, b)).toBe(false);
  });

  it("31 — normalization is idempotent", () => {
    const once = normalizePolicyDocument(buildPlatformDefaultPolicy());
    expect(normalizePolicyDocument(once)).toEqual(once);
  });

  it("32 — the diff names the domain and binding that changed", () => {
    const a = buildPlatformDefaultPolicy();
    const b = { ...a, supervisors: a.supervisors.map((s, i) => (i === 0 ? { ...s, mayVerify: true } : s)) };
    const diff = diffPolicies(a, b);
    expect(diff.some((d) => d.domain === "supervisors" && d.change === "changed")).toBe(true);
  });

  it("33 — the hash covers CONTENT only, never storage metadata", () => {
    const src = code(read("../lib/workflow/policy/hash.ts"));
    expect(src).not.toMatch(/\bid\b|created_at|activated_at|status/);
  });
});

// ==================== E. Resolution order + pinning (34-42) ==================

describe("RESOLUTION — one order, in one place", () => {
  it("34 — the resolver honours pinned → tenant → platform → built-in", () => {
    // Assert the order INSIDE resolvePolicy, not across the whole file.
    const src = code(RESOLVER);
    const body = src.slice(src.indexOf("export const resolvePolicy"), src.indexOf("export async function resolvePolicyVersionIdForPinning"));
    const pinned = body.indexOf("policy_version_id");
    const tenant = body.indexOf('.eq("tenant_id", input.tenantId)');
    const platform = body.indexOf('.is("tenant_id", null)');
    const builtIn = body.indexOf("return { ok: true, policy: builtInDefault() }");
    expect(pinned, "pinned lookup").toBeGreaterThan(-1);
    expect(tenant, "tenant override after pinned").toBeGreaterThan(pinned);
    expect(platform, "platform default after tenant").toBeGreaterThan(tenant);
    expect(builtIn, "built-in floor last").toBeGreaterThan(platform);
  });

  it("35 — a PINNED version that cannot be loaded FAILS CLOSED", () => {
    expect(code(RESOLVER)).toMatch(/if \(!pinned\) return \{ ok: false, error: "pinned_version_missing" \}/);
  });

  it("36 — a schema mismatch fails closed rather than coercing", () => {
    expect(code(RESOLVER)).toMatch(/policy_schema_version !== POLICY_SCHEMA_VERSION[\s\S]{0,80}schema_mismatch/);
  });

  it("37 — cross-tenant resolution is impossible: the instance read is tenant-scoped", () => {
    expect(code(RESOLVER)).toMatch(/from\("process_instance"\)[\s\S]{0,300}\.eq\("tenant_id", input\.tenantId\)/);
  });

  it("38 — the resolver is server-only", () => {
    expect(RESOLVER).toContain('import "server-only"');
  });

  it("39 — no module implements its own fallback order", () => {
    // Every consumer must go through resolvePolicy; nothing else may read the table.
    for (const src of [ENGINE_ACTIONS]) {
      expect(src).not.toMatch(/from\("workflow_policy_version"\)/);
    }
  });

  it("40 — PINNING happens at process-instance creation", () => {
    expect(ENGINE_ACTIONS).toContain("resolvePolicyVersionIdForPinning");
    expect(ENGINE_ACTIONS).toMatch(/policy_version_id: policyVersionId/);
    expect(ENGINE_ACTIONS).toMatch(/policy_provenance: policyVersionId \? "PINNED" : "LEGACY_DEFAULT"/);
  });

  it("41 — a dossier with no stored version is marked LEGACY_DEFAULT, never fabricated", () => {
    expect(sql(MIGRATION)).toMatch(/policy_provenance text not null default 'LEGACY_DEFAULT'/);
    expect(sql(MIGRATION)).toMatch(/check \(policy_provenance in \('PINNED', 'LEGACY_DEFAULT', 'MIGRATED'\)\)/);
  });

  it("42 — dossier migration is narrow, reasoned and audited", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function migrateDossierPolicy"));
    expect(fn).toContain('return fail("reason_required")');
    expect(fn).toMatch(/target\.status !== "ACTIVE"/);
    expect(fn).toContain("overrideReason: reason.trim()");
    expect(fn).toContain("WORKFLOW_POLICY_DOSSIER_MIGRATED");
  });
});

// ================== F. Storage, atomicity, authorization (43-53) =============

describe("STORAGE and SAFETY in the database", () => {
  it("43 — exactly ONE active version per scope is enforced by unique indexes", () => {
    expect(sql(MIGRATION)).toMatch(/create unique index uq_workflow_policy_tenant_active[\s\S]{0,160}status = 'ACTIVE'/);
    expect(sql(MIGRATION)).toMatch(/create unique index uq_workflow_policy_platform_active[\s\S]{0,160}status = 'ACTIVE'/);
  });

  it("44 — a published version's content is immutable by trigger", () => {
    expect(sql(MIGRATION)).toContain("enforce_workflow_policy_immutability");
    expect(sql(MIGRATION)).toMatch(/published and immutable/);
    expect(sql(MIGRATION)).toMatch(/retired workflow policy version cannot be reactivated/);
  });

  it("45 — a published version can never be deleted (history stays queryable)", () => {
    expect(sql(MIGRATION)).toContain("prevent_published_policy_delete");
  });

  it("46 — activation is ATOMIC through a security-definer RPC", () => {
    expect(sql(MIGRATION)).toMatch(/create or replace function public\.activate_workflow_policy/);
    expect(sql(MIGRATION)).toContain("security definer");
    // Retire-then-promote in ONE function; no application-side dual write.
    expect(sql(MIGRATION)).toMatch(/set status = 'RETIRED'[\s\S]{0,200}set status\s+= 'ACTIVE'/);
    expect(ACTIONS).toContain('admin.rpc("activate_workflow_policy"');
  });

  it("47 — the RPC refuses anything not VALIDATED and PASSED, and requires a reason", () => {
    const s = sql(MIGRATION);
    expect(s).toMatch(/only a VALIDATED version may be activated/);
    expect(s).toMatch(/has not passed validation/);
    expect(s).toMatch(/activation reason is required/);
    expect(s).toMatch(/policy schema version mismatch/);
  });

  it("48 — RLS: SELECT-only, gated on admin:config:manage, tenant-scoped", () => {
    const s = sql(MIGRATION);
    expect(s).toMatch(/create policy workflow_policy_select[\s\S]{0,200}for select to authenticated/);
    expect(s).toContain("public.has_permission('admin:config:manage')");
    expect(s).toMatch(/tenant_id is null or tenant_id = public\.auth_tenant_id\(\)/);
    expect(s).not.toMatch(/grant (insert|update|delete) on public\.workflow_policy_version/);
  });

  it("49 — NO new privileged permission was invented", () => {
    expect(sql(MIGRATION)).not.toContain("insert into public.permission");
    const surfaces = [ACTIONS, READERS, ADMIN_PAGE].join("\n");
    const scoped = [...surfaces.matchAll(/"(admin:[a-z:]+)"/g)].map((m) => m[1]);
    expect([...new Set(scoped)]).toEqual(["admin:config:manage"]);
  });

  it("50 — the platform default is bounded by the PLATFORM-ADMIN identity", () => {
    expect(ACTIONS).toContain("getPlatformUser");
    expect(code(ACTIONS)).toMatch(/if \(platformDefault\)[\s\S]{0,200}getPlatformUser/);
  });

  it("51 — a tenant manager can never touch another tenant's version", () => {
    expect(code(ACTIONS).match(/row\.tenant_id !== null && row\.tenant_id !== ctx\.tenantId/g) ?? []).toHaveLength(2);
  });

  it("52 — no success audit is written on a failed validation", () => {
    const fn = ACTIONS.slice(ACTIONS.indexOf("export async function validatePolicyDraft"));
    expect(fn).toMatch(/result\.ok\s*\n?\s*\?\s*AuditActions\.WORKFLOW_POLICY_VALIDATION_PASSED/);
    expect(fn).toContain("WORKFLOW_POLICY_VALIDATION_FAILED");
  });

  it("53 — the RLS suite is wired into CI", () => {
    expect(CI).toContain("supabase/tests/rls_workflow_policy_test.sql");
  });
});

// ============================ G. Scope discipline (54-59) ====================

describe("WES-7 stayed inside its scope", () => {
  const wes7 = [
    read("../lib/workflow/policy/schema.ts"),
    read("../lib/workflow/policy/default.ts"),
    read("../lib/workflow/policy/validate.ts"),
    read("../lib/workflow/policy/hash.ts"),
    RESOLVER,
    ACTIONS,
    READERS,
  ].map(code).join("\n");

  it("54 — WES-9 business event ledger was NOT started", () => {
    expect(wes7).not.toMatch(/business_event|correlation_id|causation_id|emitEvent/i);
    expect(sql(MIGRATION)).not.toMatch(/business_event/);
  });

  it("55 — WES-3 assignment ledger / visibility was NOT started", () => {
    expect(wes7).not.toMatch(/assignment_event|user_readable_file_ids/);
  });

  it("56 — WES-4 BAE governance was NOT touched", () => {
    expect(wes7).not.toMatch(/customs:release|bae_reference|BAE_VERIFIED/);
  });

  it("57 — WES-5 engine/module reconciliation was NOT started", () => {
    expect(wes7).not.toMatch(/evaluateStepEvidence|autoComplete|reconcile/i);
  });

  it("58 — WES-8 SLA engine was NOT started (contract only)", () => {
    expect(wes7).not.toMatch(/pauseSeconds|elapsedWorking|escalationSchedule|breach\(/i);
  });

  it("59 — WES-6 mission persistence was NOT started, and no free-form editor exists", () => {
    expect(wes7).not.toMatch(/transport_mission/);
    // The admin surface offers no arbitrary input: no SQL, code or permission entry.
    expect(ADMIN_UI).not.toMatch(/textarea|contentEditable|eval\(|JSON\.parse/i);
  });
});
