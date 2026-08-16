/**
 * HR-A2 — Employee Registry activation. Structural pins for the §15 matrix.
 * ---------------------------------------------------------------------------
 * The phase ACTIVATES the existing workflow — one registry, one numbering
 * engine, one placement model — and hardens exactly what the audit found
 * missing: server-side assignment-target validation (tenant + active),
 * optional initial placement at creation, a warning-first duplicate guard,
 * and the honest second-officer fact.
 *
 * Behavioral halves live in SQL, in the same CI job:
 *   * EMP-0001 → EMP-0002, refusal-consumes-no-number, forged-actor refusal,
 *     prefix behavior         → hr_a1_foundation_activation_test.sql
 *   * placement grants NOTHING (live get_user_permissions before/after),
 *     cross-tenant link refused, one-account-two-employees refused,
 *     one-open-PRIMARY invariant → hr_a2_registry_activation_test.sql
 *   * tenant visibility & SYSTEM_ADMIN zero-rows → rls_hr_employee_test.sql
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/hr/actions.ts";
const CORE = "lib/hr/assignment-core.ts";
const ASSIGN = "lib/hr/assignment-actions.ts";
const FORM = "components/hr/employee-create-form.tsx";
const READS = "lib/hr/read.ts";
const REGISTRE = "app/departments/hr/registre/page.tsx";
const CENTER = "app/departments/hr/page.tsx";
const SUITE = "supabase/tests/hr_a2_registry_activation_test.sql";

// ---------------------------------------------------------------------------
describe("numbering — the trusted path only (§4)", () => {
  const a = code(ACTIONS);

  it("the browser can never nominate the matricule", () => {
    // Not an input field; and EVERY occurrence in the module references the
    // trusted RPC's return (row insert + event payload + audit) — never input.
    expect(read(ACTIONS)).not.toMatch(/employeeNumber\??:/);
    const occurrences = a.match(/employee_number: (\w+)/g) ?? [];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const o of occurrences) expect(o).toBe("employee_number: numData");
  });

  it("every refusal path runs BEFORE allocation — a rejected creation consumes no number", () => {
    const alloc = a.indexOf('rpc("next_employee_number"');
    expect(alloc).toBeGreaterThan(-1);
    // validation, manager check, duplicate guard and unit validation all precede it.
    for (const marker of ["validateEmployeeInput", "duplicate_name", "validateAssignmentTargets"]) {
      const at = a.indexOf(marker);
      expect(at, `${marker} must run before allocation`).toBeGreaterThan(-1);
      expect(at, `${marker} must run before allocation`).toBeLessThan(alloc);
    }
  });

  it("allocation uses the trusted overload with session-derived actor/tenant", () => {
    expect(a).toContain("p_tenant: ctx.tenantId");
    expect(a).toContain("p_actor: ctx.userId");
  });

  it("the DB suites prove EMP-0001→0002, forged-actor and immutability — still wired", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("-f supabase/tests/hr_a1_foundation_activation_test.sql");
    const a1 = read("supabase/tests/hr_a1_foundation_activation_test.sql");
    expect(a1).toContain("'EMP-0001'");
    expect(a1).toContain("'EMP-0002'");
    expect(a1).toMatch(/refusal burned no number/);
    expect(a1).toContain("trg_employee_number_immutable");
  });
});

// ---------------------------------------------------------------------------
describe("assignment targets — tenant-matched and active (§5, §12)", () => {
  const c = code(CORE);

  it("the validator checks tenant + active for unit, position, location; tenant for manager", () => {
    for (const table of ['"hr_org_unit"', '"hr_position"', '"hr_work_location"', '"employee"']) {
      expect(c).toContain(`from(${table})`);
    }
    // Every read is (tenant_id, id)-scoped — no cross-tenant existence oracle.
    expect((c.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBe(4);
    for (const err of ["invalid_unit", "inactive_unit", "invalid_position", "inactive_position", "invalid_location", "inactive_location", "invalid_manager"]) {
      expect(c).toContain(`"${err}"`);
    }
  });

  it("BOTH writers validate before any insert", () => {
    const assign = code(ASSIGN);
    expect(assign.indexOf("validateAssignmentTargets")).toBeGreaterThan(-1);
    expect(assign.indexOf("validateAssignmentTargets")).toBeLessThan(assign.indexOf('.insert({'));
    const actions = code(ACTIONS);
    expect(actions.indexOf("validateAssignmentTargets")).toBeGreaterThan(-1);
    expect(actions.indexOf("validateAssignmentTargets")).toBeLessThan(actions.indexOf('from("employee").insert'));
  });

  it("initial placement is compensable: assignment inserted BEFORE the created event, unwound on failure", () => {
    const a = code(ACTIONS);
    const assignInsert = a.indexOf('from("employee_assignment")');
    const createdEmit = a.indexOf('kind: "created"');
    expect(assignInsert).toBeGreaterThan(-1);
    expect(assignInsert).toBeLessThan(createdEmit);
    // Emission failure deletes the assignment then the employee — nothing may
    // fail after the append-only ledger row is written.
    expect(a).toMatch(/from\("employee_assignment"\)\.delete\(\)\.eq\("id", assignmentId\)/);
  });

  it("the created payload and audit carry the placement (safe reference only)", () => {
    const a = code(ACTIONS);
    // Row insert + event payload + audit — all three from the validated server
    // variable, never from raw input.
    expect((a.match(/org_unit_id: orgUnitId/g) ?? []).length).toBe(3);
    expect(a).not.toMatch(/org_unit_id: input\./);
  });

  it("placement is NOT editable through updateEmployee (the engine owns changes)", () => {
    expect(read(ACTIONS)).toContain('Omit<CreateEmployeeInput, "orgUnitId" | "allowDuplicateName">');
  });
});

// ---------------------------------------------------------------------------
describe("duplicate guard — warning-first, never destructive (§11)", () => {
  const a = code(ACTIONS);

  it("exact case-insensitive name match on non-terminal statuses, refused ONCE", () => {
    expect(a).toContain('ilike("first_name"');
    expect(a).toContain('ilike("last_name"');
    expect(a).toContain('"(TERMINATED,ARCHIVED)"');
    expect(a).toContain('"duplicate_name"');
    // ilike wildcards are escaped — a name containing % or _ cannot widen the match.
    expect(a).toMatch(/replace\(\/\[%_\\\\\]\/g/);
  });

  it("the operator can confirm explicitly; no unique constraint on names exists", () => {
    expect(a).toContain("allowDuplicateName");
    const m57 = read("supabase/migrations/20260724000002_hr_employee_registry.sql");
    expect(m57).not.toMatch(/unique.*first_name|unique.*last_name/i);
  });

  it("the form surfaces the warning with an explicit confirm resubmit", () => {
    const f = read(FORM);
    expect(f).toContain('res.error === "duplicate_name"');
    expect(f).toContain("allowDuplicateName: true");
    expect(f).toContain("Créer quand même");
    // Double-submit guard: the submit button is disabled while pending.
    expect(f).toMatch(/disabled=\{pending\}/);
  });
});

// ---------------------------------------------------------------------------
describe("identity & account link — one registry, links grant nothing (§2, §7)", () => {
  it("no HR module ever writes user_role (linking/placement grant nothing, app layer)", () => {
    for (const p of [ACTIONS, ASSIGN, CORE, READS]) {
      expect(code(p), p).not.toMatch(/from\("user_role"\)[\s\S]{0,200}\.(insert|update|upsert|delete)/);
    }
  });

  it("the DB suite proves it live, and proves the link backstops", () => {
    const s = read(SUITE);
    expect(s).toContain("get_user_permissions");
    expect(s).toMatch(/grants ZERO permissions/);
    expect(s).toMatch(/cross-tenant account link refused/);
    expect(s).toMatch(/one account cannot link to two employees/);
    expect(s).toMatch(/second open PRIMARY assignment refused/);
  });

  it("an employee cannot link to two accounts BY SHAPE (one nullable column)", () => {
    const m57 = read("supabase/migrations/20260724000002_hr_employee_registry.sql");
    expect((m57.match(/linked_app_user_id\s+uuid/g) ?? []).length).toBe(1);
    expect(m57).toContain("uq_employee_linked_user");
  });

  it("account-less employees are first-class; no competing person table exists", () => {
    const m57 = read("supabase/migrations/20260724000002_hr_employee_registry.sql");
    expect(m57).toMatch(/linked_app_user_id\s+uuid references public\.app_user \(id\) on delete set null/);
    // No duplicate identity system anywhere in the schema.
    const fs = require("node:fs") as typeof import("node:fs");
    const migrations = fs.readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
    for (const f of migrations) {
      const src = read(`supabase/migrations/${f}`);
      expect(src, f).not.toMatch(/create table (if not exists )?public\.(user_profiles|employee_profile|staff_profile|personnel)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("registry & operations center surfaces (§8, §9)", () => {
  it("the list shows placement (authoritative), hire date, status and account", () => {
    const r = code(READS);
    expect(r).toContain('eq("assignment_kind", "PRIMARY")');
    expect(r).toContain('is("effective_to", null)');
    const page = read(REGISTRE);
    for (const col of ["Matricule", "Nom", "Unité", "Département", "Fonction", "Embauche", "Statut", "Compte"]) {
      expect(page).toContain(col);
    }
  });

  it("the create form offers ONLY active units and is honest when none exist", () => {
    expect(read(REGISTRE)).toMatch(/filter\(\(u\) => u\.is_active\)/);
    const f = read(FORM);
    expect(f).toContain("Aucune unité configurée");
    expect(f).toContain("Sans affectation");
  });

  it("the officer count is counted fail-closed and surfaced with the operator action", () => {
    const r = code(READS);
    expect(r).toMatch(/countHrOfficers/);
    // Any read failure reports 0 — never "probably enough".
    expect(r).toMatch(/if \(rolesErr \|\| !roles \|\| roles\.length === 0\) return 0/);
    expect(r).toMatch(/if \(holdersErr \|\| !holders\) return 0/);
    const center = read(CENTER);
    expect(center).toContain("hrOfficers < 2");
    expect(center).toContain("deux personnes distinctes");
    // The surface never assigns the role — Administration does.
    expect(code(CENTER)).not.toMatch(/from\("user_role"\)/);
  });
});

// ---------------------------------------------------------------------------
describe("boundaries unchanged (§12, §14, §16)", () => {
  it("HR-B3 landed: apply exists, creates only via createEmployee, states widened by 107", () => {
    const o = code("lib/hr/organization-actions.ts");
    expect(o).toContain("applyHrImport");
    expect(o).not.toMatch(/from\("employee"\)\s*\.insert/);
    // The apply states arrived in migration 107, not by editing history.
    const m73 = read("supabase/migrations/20260801000001_hr_organization_foundation.sql");
    expect(m73).not.toMatch(/'APPLIED'/);
    expect(read("supabase/migrations/20260829000001_hr_import_apply.sql")).toContain("'APPLIED_WITH_ERRORS'");
  });

  it("HR-A2 ships NO migration", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const migrations = fs.readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)));
    expect(migrations.filter((f) => /hr[_-]?a2|registry[_-]?activation/i.test(f))).toEqual([]);
  });

  it("parked authorities and SYSTEM_ADMIN exclusion are still CI-proven on every run", () => {
    const a1 = read("supabase/tests/hr_a1_foundation_activation_test.sql");
    // HR-B1 and HR-B2 activated two of the three parked authorities onto the
    // Direction seats; the suite still proves the remaining one is granted to
    // NOBODY, and that the activated pair lands nowhere else.
    expect(a1).toMatch(/hr:sensitive:read is still granted to NOBODY/);
    expect(a1).toMatch(/lands ONLY on the Direction seats/);
    expect(a1).toMatch(/SYSTEM_ADMIN holds NO hr:/);
  });

  it("C3 stays fail-closed (the HR-A1 guard fix is intact)", () => {
    const fa = code("lib/hr/employee-file-actions.ts");
    expect(fa).toMatch(/from\("hr_document_type"\)[\s\S]*?\.eq\("tenant_id", admin\.tenantId\)/);
    expect(fa).toMatch(/if \(!type\) return \{ ok: false/);
  });
});

// ---------------------------------------------------------------------------
describe("the DB suite is wired into CI", () => {
  it("suite exists and CI runs it", () => {
    expect(read(SUITE).length).toBeGreaterThan(0);
    expect(read(".github/workflows/ci.yml")).toContain("-f supabase/tests/hr_a2_registry_activation_test.sql");
  });
});
