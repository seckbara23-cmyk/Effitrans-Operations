/**
 * Phase 5.0B-1 — schema, roles, permissions and flags.
 *
 * These are the invariants that must hold BEFORE the engine is built on top:
 * every permission the registry declares actually exists in the catalog, the
 * maker/checker permission split is real, and the engine is dark by default.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EFFITRANS_PROCESS, PARALLEL_ACTIVITIES } from "@/lib/process/effitrans-process";
import { MISSING_PERMISSIONS, ROLE_MAPPINGS, missingRoles } from "@/lib/process/roles";
import { TENANT_ROLE_KEYS, getTenantRoleTemplate } from "@/lib/platform/role-templates";
import { resolveProcessFlags } from "@/lib/process/flags";
import { STEP_STATES, PROCESS_STATUSES, isDone, isOpen, isStepState } from "@/lib/process/engine/types";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { AuditActions } from "@/lib/audit/events";

const seed = readFileSync(fileURLToPath(new URL("../supabase/seed.sql", import.meta.url)), "utf8");
const migration = readFileSync(
  fileURLToPath(new URL("../supabase/migrations/20260713000001_process_engine.sql", import.meta.url)),
  "utf8",
);

/**
 * Every permission code in the catalog. The catalog is assembled across ALL
 * migrations (each module migration inserts its own codes) plus seed.sql — so
 * scanning only the 5.0B migration would wrongly report pre-existing codes like
 * `file:create` as missing.
 */
function catalogCodes(): Set<string> {
  const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
  const texts = [seed, ...readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(join(dir, f), "utf8"))];
  const codes = new Set<string>();
  for (const text of texts) {
    for (const block of text.match(/insert into public\.permission[\s\S]*?on conflict \(code\) do nothing;/g) ?? []) {
      for (const m of block.matchAll(/\(\s*'([a-z_]+:[a-z_:]+)'/g)) codes.add(m[1]);
    }
  }
  return codes;
}

describe("Phase 5.0B-1 — the registry's permission surface is backed by the catalog", () => {
  const codes = catalogCodes();

  it("declares every permission the 26 steps require", () => {
    const missing: string[] = [];
    for (const s of [...EFFITRANS_PROCESS, ...PARALLEL_ACTIVITIES]) {
      for (const p of s.permissions) if (!codes.has(p)) missing.push(`${s.key} -> ${p}`);
    }
    expect(missing, `permissions referenced by the registry but absent from the catalog:\n${missing.join("\n")}`).toEqual([]);
  });

  it("creates every permission Phase 5.0A flagged as missing", () => {
    const absent = MISSING_PERMISSIONS.filter((p) => !codes.has(p));
    expect(absent).toEqual([]);
  });

  it("adds process:override to the catalog but grants it to NO role (off by default)", () => {
    expect(codes.has("process:override")).toBe(true);
    for (const key of TENANT_ROLE_KEYS) {
      expect(getTenantRoleTemplate(key)!.permissions, key).not.toContain("process:override");
    }
  });
});

describe("Phase 5.0B-1 — the seven missing roles now exist", () => {
  it("adds all seven roles Phase 5.0A identified", () => {
    for (const m of missingRoles()) {
      expect(TENANT_ROLE_KEYS, `${m.officialRole} still missing`).toContain(m.officialRole);
    }
    // 23 through Phase 5.0B + CASHIER (Phase 9.3A Caisse & Trésorerie) = 24.
    expect(TENANT_ROLE_KEYS).toHaveLength(24);
  });

  it("keeps every previously-mapped role unchanged in name (no rename)", () => {
    for (const m of ROLE_MAPPINGS) {
      if (m.status === "mapped" || m.status === "inert") {
        expect(TENANT_ROLE_KEYS).toContain(m.tenantRole!);
      }
    }
  });
});

describe("Phase 5.0B-1 — the billing/finance maker-checker split is real", () => {
  const billing = () => getTenantRoleTemplate("BILLING_OFFICER")!;
  const finance = () => getTenantRoleTemplate("FINANCE_OFFICER")!;

  it("BILLING_OFFICER is the MAKER: can create an invoice, cannot validate one", () => {
    expect(billing().permissions).toContain("finance:create");
    expect(billing().permissions).toContain("finance:issue");
    expect(billing().permissions).not.toContain("finance:validate");
  });

  it("BILLING_OFFICER can never move money", () => {
    expect(billing().permissions).not.toContain("finance:payment");
    expect(billing().permissions).not.toContain("finance:void");
  });

  it("FINANCE_OFFICER is the CHECKER: holds finance:validate", () => {
    expect(finance().permissions).toContain("finance:validate");
  });

  it("CUSTOMS_DECLARANT (the preparer) can never hold customs:validate", () => {
    const declarant = getTenantRoleTemplate("CUSTOMS_DECLARANT")!;
    expect(declarant.permissions).not.toContain("customs:validate");
    expect(getTenantRoleTemplate("CHIEF_OF_TRANSIT")!.permissions).toContain("customs:validate");
  });

  it("step 9 is finally possible: someone holds customs:register", () => {
    // Before 5.0B, FINANCE_OFFICER held no customs:* permission at all, so RBAC
    // actively forbade the official GAINDE-registration step.
    expect(getTenantRoleTemplate("CUSTOMS_FINANCE_OFFICER")!.permissions).toContain("customs:register");
  });

  it("COURIER can never mutate a financial status", () => {
    const courier = getTenantRoleTemplate("COURIER")!;
    expect(courier.permissions.some((p) => p.startsWith("finance:"))).toBe(false);
    expect(courier.permissions).toContain("courier:deposit");
  });
});

describe("Phase 5.0B-1 — feature flag is dark by default", () => {
  it("is off when nothing is set", () => {
    expect(resolveProcessFlags({})).toEqual({
      enabled: false,
      compatibility: false,
      overrideAllowed: false,
      workspaces: false,
      physicalDeposit: false,
      collections: false,
      structures: false,
      intake: false,
      transitExecution: false,
      financeExecution: false,
    });
  });

  it("turns on only with the exact string 'true'", () => {
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "1" }).enabled).toBe(false);
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" }).enabled).toBe(true);
  });

  it("keeps every sub-capability inert while the master flag is off", () => {
    const f = resolveProcessFlags({
      EFFITRANS_PROCESS_COMPATIBILITY_ENABLED: "true",
      EFFITRANS_PROCESS_OVERRIDE_ENABLED: "true",
      // Phase 5.0C — the workspaces flag is inert without the master flag too.
      EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
      // Phase 9.0B — the structures flag is inert without the master flag too.
      EFFITRANS_PROCESS_STRUCTURES_ENABLED: "true",
    });
    expect(f).toEqual({
      enabled: false,
      compatibility: false,
      overrideAllowed: false,
      workspaces: false,
      physicalDeposit: false,
      collections: false,
      structures: false,
      intake: false,
      transitExecution: false,
      financeExecution: false,
    });
  });

  it("never allows the maker-checker override by default, even with the engine on", () => {
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" }).overrideAllowed).toBe(false);
  });
});

describe("Phase 5.0B-1 — engine types and registry wiring", () => {
  it("declares the eleven step states and six process statuses", () => {
    expect(STEP_STATES).toHaveLength(11);
    expect(PROCESS_STATUSES).toHaveLength(6);
    expect(STEP_STATES).toContain("UNVERIFIED_HISTORICAL");
  });

  it("treats APPROVED/COMPLETED/SKIPPED as done and never UNVERIFIED_HISTORICAL", () => {
    expect(isDone("COMPLETED")).toBe(true);
    expect(isDone("APPROVED")).toBe(true);
    expect(isDone("SKIPPED")).toBe(true);
    // A legacy step whose evidence was never captured must NEVER count as done.
    expect(isDone("UNVERIFIED_HISTORICAL")).toBe(false);
    expect(isDone("REJECTED")).toBe(false);
  });

  it("treats work-in-progress states as open", () => {
    expect(isOpen("ACTIVE")).toBe(true);
    expect(isOpen("SUBMITTED")).toBe(true);
    expect(isOpen("BLOCKED")).toBe(true);
    expect(isOpen("COMPLETED")).toBe(false);
  });

  it("guards step-state strings", () => {
    expect(isStepState("ACTIVE")).toBe(true);
    expect(isStepState("NOPE")).toBe(false);
  });

  it("registers the three engine tables as tenant-scoped (leak guard covers them)", () => {
    expect(TENANT_SCOPED_TABLES.has("process_instance")).toBe(true);
    expect(TENANT_SCOPED_TABLES.has("process_step_execution")).toBe(true);
    expect(TENANT_SCOPED_TABLES.has("process_handoff")).toBe(true);
  });

  it("declares every audit action the engine needs", () => {
    for (const a of [
      AuditActions.PROCESS_INITIALIZED,
      AuditActions.PROCESS_STEP_SUBMITTED,
      AuditActions.PROCESS_STEP_APPROVED,
      AuditActions.PROCESS_STEP_REJECTED,
      AuditActions.PROCESS_HANDOFF_SENT,
      AuditActions.PROCESS_HANDOFF_RECEIVED,
      AuditActions.PROCESS_HANDOFF_REJECTED,
      AuditActions.PROCESS_GATE_BLOCKED,
      AuditActions.PROCESS_MAKER_CHECKER_OVERRIDE,
      AuditActions.PROCESS_COMPATIBILITY_MAPPED,
      AuditActions.PROCESS_CLOSED,
    ]) {
      expect(a).toMatch(/^process\./);
    }
  });
});

describe("Phase 5.0B-1 — RLS suite exists and is wired into CI", () => {
  const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");

  it("runs the process-engine RLS suite with ON_ERROR_STOP", () => {
    expect(ci).toContain("supabase/tests/rls_process_engine_test.sql");
    expect(ci).toContain("ON_ERROR_STOP=1");
  });

  it("never skips tests or tolerates failures", () => {
    expect(ci).not.toContain("continue-on-error");
  });
});
