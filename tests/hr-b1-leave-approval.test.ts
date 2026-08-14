/**
 * EFFITRANS-HR-B1 — leave approval as ORGANIZATIONAL authority.
 * ---------------------------------------------------------------------------
 * The ratified answer — Department Managers + Direction + CEO approve leave —
 * lands as two lanes decided by the DATABASE, never as permission spraying:
 *
 *   1. Manager lane (identity): the actor's linked ACTIVE employee is the
 *      requester's manager on the open PRIMARY assignment. Cross-department
 *      approval is impossible by construction.
 *   2. Org-wide lane (grant): hr:leave:approve on the Direction seats DGA/DAF
 *      — deliberately NOT on CEO (six broad accounts hold that role; HR-1A
 *      question (a) is the exact governance boundary this phase stops at).
 *
 * The RUNTIME proofs (manager approves in scope, out-of-scope refused,
 * self-approval refused, double-decide refused, balance moves exactly once,
 * refusal consumes nothing, SELF cancel rules, cross-tenant refusal) live in
 * supabase/tests/hr_b1_leave_scope_test.sql against the real functions. This
 * suite pins the structure: sources of the grant, the shape of both lanes,
 * the self-service identity scoping, and the French surface.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
/** SQL with `--` comments stripped — prosrc-style scanning (the P1.1 lesson). */
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260830000001_hr_leave_approval_activation.sql";
const ACTIONS = "lib/hr/leave-actions.ts";

function action(name: string): string {
  const s = code(ACTIONS);
  const i = s.indexOf(`export async function ${name}`);
  expect(i, name).toBeGreaterThan(-1);
  const j = s.indexOf("export async function", i + 1);
  return s.slice(i, j === -1 ? undefined : j);
}

// ===========================================================================
describe("the org-wide seat exists in all three sources — and ONLY on Direction", () => {
  it("migration 108 grants hr:leave:approve to DGA and DAF, idempotently", () => {
    const m = sql(MIG);
    expect(m).toMatch(/p\.code = 'hr:leave:approve'[\s\S]{0,80}r\.code in \('DGA', 'DAF'\)/);
    expect(m).toContain("on conflict do nothing");
  });

  it("seed.sql mirrors the grant — DAF/DGA, never CEO", () => {
    const blocks = read("supabase/seed.sql")
      .match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    const leave = blocks.filter((b) => b.includes("'hr:leave:approve'"));
    expect(leave.length).toBe(1);
    expect(leave[0]).toContain("'DAF', 'DGA'");
    expect(leave[0]).not.toContain("CEO");
  });

  it("the role templates mirror the grant on DGA/DAF alone", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      const holds = t.permissions.includes("hr:leave:approve");
      expect(holds, `${t.key} hr:leave:approve`).toBe(t.key === "DGA" || t.key === "DAF");
    }
  });

  it("THE GOVERNANCE BOUNDARY: the migration ASSERTS that CEO stays ungranted", () => {
    // Six broad multi-role accounts hold CEO in production. Its grant is a
    // decision (HR-1A question a) — the migration refuses to complete if the
    // boundary drifts.
    expect(read(MIG)).toMatch(/r\.code = 'CEO' and p\.code = 'hr:leave:approve'[\s\S]{0,220}raise exception/);
    // …and HR_OFFICER never decides what it requests.
    expect(read(MIG)).toMatch(/r\.code = 'HR_OFFICER' and p\.code = 'hr:leave:approve'[\s\S]{0,220}raise exception/);
  });
});

// ===========================================================================
describe("the two lanes live in the RPC — the database is the boundary", () => {
  const m = sql(MIG);

  it("manager lane: linked ACTIVE employee × open PRIMARY assignment", () => {
    // THE MUTATION TARGET (scope). Weakening any predicate widens who may
    // approve: drop PRIMARY/effective_to and CLOSED history rows grant power;
    // drop the tenant filter and scope crosses organizations.
    const decide = m.slice(m.indexOf("create or replace function public.hr_decide_leave_request"));
    expect(decide).toContain("linked_app_user_id = p_actor");
    expect(decide).toContain("manager_employee_id = v_actor_emp");
    expect(decide).toContain("a.assignment_kind = 'PRIMARY' and a.effective_to is null");
    expect(decide).toContain("a.tenant_id = p_tenant");
    expect(decide).toContain("e.status = 'ACTIVE'");
  });

  it("everyone else needs assert_actor_authority with hr:leave:approve (INV-7)", () => {
    expect(m).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:leave:approve', 'SERVICE')");
    // …and the actor-integrity check guards the identity lane itself.
    expect(m).toMatch(/u\.id = p_actor and u\.tenant_id = p_tenant and u\.status = 'active'/);
  });

  it("the self-guard (HR527) fires on BOTH lanes, before either resolves", () => {
    const decide = m.slice(m.indexOf("create or replace function public.hr_decide_leave_request"));
    expect(decide).toContain("HR527");
    expect(decide.indexOf("HR527")).toBeLessThan(decide.indexOf("v_is_manager :="));
  });

  it("what HR-5 guaranteed is untouched: HR523, HR524, single movement, ledger event", () => {
    for (const frag of ["HR523", "HR524", "taken_tenths + v_tenths", "leave_approved"]) {
      expect(m, frag).toContain(frag);
    }
  });

  it("cancel: the 4-arg signature is dropped; SELF is own+undecided; ADMIN asserts hr:manage", () => {
    expect(m).toContain("drop function if exists public.hr_cancel_leave_request(uuid, uuid, uuid, text)");
    const cancel = m.slice(m.indexOf("create or replace function public.hr_cancel_leave_request"));
    expect(cancel).toContain("p_mode = 'SELF'");
    expect(cancel).toContain("HR529");
    expect(cancel).toMatch(/p_mode = 'SELF'[\s\S]*?not in \('DRAFT','SUBMITTED'\)/);
    expect(cancel).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE')");
  });

  it("both RPCs stay service_role transport — asserted at apply time", () => {
    expect(read(MIG)).toContain("has_function_privilege('anon'");
    expect(read(MIG)).toContain("grant execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) to service_role");
  });
});

// ===========================================================================
describe("the actions: identity resolution here, authority there", () => {
  it("decideLeaveRequest resolves the caller and lets the RPC decide", () => {
    const b = action("decideLeaveRequest");
    expect(b).toContain("getCurrentUser()");
    expect(b).not.toContain("assertPermission(");
    expect(b).toContain('rpc("hr_decide_leave_request"');
    // A refusal must tell the employee why.
    expect(b).toContain('"refusal_note_required"');
  });

  it("self-service is scoped to the caller's LINKED ACTIVE employee — always", () => {
    // THE MUTATION TARGET (identity). resolveOwnEmployee is the single gate.
    const s = code(ACTIONS);
    expect(s).toContain('.eq("linked_app_user_id", user.id)');
    expect(s).toContain('"no_employee_link"');
    expect(s).toContain('"employee_not_active"');
    for (const fn of ["createMyLeaveRequest", "submitMyLeaveRequest", "cancelMyLeaveRequest"]) {
      expect(action(fn), fn).toContain("resolveOwnEmployee()");
    }
    // Submit updates ONLY own DRAFT rows — the filter is the authorization.
    const submit = action("submitMyLeaveRequest");
    expect(submit).toContain('.eq("employee_id", me.employeeId)');
    expect(submit).toContain('.eq("status", "DRAFT")');
    // Retraction goes through the RPC's SELF mode, never ADMIN.
    expect(action("cancelMyLeaveRequest")).toContain('p_mode: "SELF"');
  });

  it("self-service creates no account and grants nothing", () => {
    const s = code(ACTIONS);
    expect(s).not.toMatch(/auth\.admin|createUser|user_role|role_permission|linkEmployeeAccount/);
  });

  it("every leave act is audited with its actor", () => {
    const s = code(ACTIONS);
    for (const a of ["hr.leave.requested", "hr.leave.submitted", "hr.leave.cancelled"]) {
      expect(s).toContain(a);
    }
    expect(s).toContain("hr.leave.${input.decision.toLowerCase()}");
  });

  it("the HR desk keeps its own gates: create/submit/entitlements on hr:manage", () => {
    for (const fn of ["createLeaveRequest", "submitLeaveRequest", "upsertEntitlement"]) {
      expect(action(fn), fn).toContain('assertPermission("hr:manage")');
    }
  });
});

// ===========================================================================
describe("the French surface", () => {
  it("« Mes congés » exists, ungated like the dashboard, and in the sidebar", () => {
    const page = read("app/conges/page.tsx");
    expect(page).toContain("Mes congés");
    expect(page).not.toContain("notFound()");
    expect(read("lib/nav.ts")).toContain('href: "/conges"');
  });

  it("the studio speaks French statuses and sentences — no codes leak", () => {
    const s = read("components/hr/my-leave-studio.tsx");
    for (const label of ["Brouillon", "Soumise", "Approuvée", "Refusée", "Annulée"]) {
      expect(s).toContain(label);
    }
    for (const sentence of [
      "Demandes de mon équipe",
      "Nouvelle demande de congé",
      "responsable hiérarchique",
      "Demi-journée",
    ]) {
      expect(s).toContain(sentence);
    }
    // Every mapped error is a sentence, not a code.
    expect(s).toContain("n'est pas encore lié à votre dossier employé");
  });

  it("the manager card shows employee, unit, dates, type, duration and balance context", () => {
    const s = read("components/hr/my-leave-studio.tsx");
    for (const frag of ["employeeName", "departmentFr", "categoryFr", "solde restant", "Approuver", "Refuser"]) {
      expect(s).toContain(frag);
    }
  });

  it("HR oversight never silently impersonates the manager lane", () => {
    expect(read("components/hr/leave-studio.tsx")).toContain("silently impersonates the manager lane");
  });
});

// ===========================================================================
describe("integration decisions and the ledger", () => {
  it("Mon Travail was deliberately NOT widened — the reasoning is on the record", () => {
    const s = read("lib/hr/my-leave.ts");
    expect(s).toContain("NOT « Mon Travail »");
    expect(s).toContain("competing abstraction");
    // The workbench itself is untouched by this phase.
    expect(read("lib/navigation/workbench.ts")).not.toMatch(/leave|congé/i);
  });

  it("the manager queue reads ONLY open PRIMARY assignments of the caller", () => {
    const s = code("lib/hr/my-leave.ts");
    expect(s).toContain('.eq("manager_employee_id", employee.id)');
    expect(s).toContain('.eq("assignment_kind", "PRIMARY")');
    expect(s).toContain('.is("effective_to", null)');
  });

  it("migration 108 exists and the ledger is consistent", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(migrations).toContain("20260830000001_hr_leave_approval_activation.sql");
    expect(migrations).toHaveLength(
      Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]),
    );
  });

  it("the scope suite runs in CI, last", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("-f supabase/tests/hr_b1_leave_scope_test.sql");
  });
});
