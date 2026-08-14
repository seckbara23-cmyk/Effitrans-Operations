/**
 * EFFITRANS-HR-1A — governance reconciliation: the findings that must not decay.
 * ---------------------------------------------------------------------------
 * Effitrans answered the seat questions, and the audit found the answers cannot
 * be expressed by grants alone: the parked permissions are TENANT-WIDE, the
 * manager relationship lives on employee_assignment, and nothing reads it as an
 * authorization scope yet. These guards hold the audit's premises still while
 * HR-B1/B2/B3 are designed — and they are the mutation targets for those phases:
 * each one that starts failing marks the exact spot where the corresponding
 * phase changed behaviour deliberately.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

function templateBlock(roleKey: string): string {
  const s = read("lib/platform/role-templates.ts");
  const i = s.indexOf(`key: "${roleKey}"`);
  expect(i, `${roleKey} must exist as a role template`).toBeGreaterThan(-1);
  const j = s.indexOf('key: "', i + 6);
  return s.slice(i, j === -1 ? undefined : j);
}

describe("the seats: leave approval landed on Direction (HR-B1); the rest stay parked", () => {
  it("hr:leave:approve sits on DGA and DAF alone; the other two authorities stay ungranted", () => {
    // HR-B1 moved this pin: the leave seat is live on the Direction roles.
    const s = read("lib/platform/role-templates.ts");
    for (const r of ["DGA", "DAF"]) {
      expect(templateBlock(r), r).toContain('"hr:leave:approve"');
    }
    expect(s).not.toContain('"hr:performance:finalize"');
    expect(s).not.toContain('"hr:sensitive:read"');
  });

  it("CEO remains ungranted — the HR-1A question (a) boundary, not an oversight", () => {
    for (const r of ["CEO", "DGA", "DAF"]) templateBlock(r);
    // Six broad accounts hold CEO in production; its grant is a decision.
    expect(templateBlock("CEO")).not.toMatch(/"hr:/);
    // HR_OFFICER never decides what it can request (SoD).
    expect(templateBlock("HR_OFFICER")).not.toContain('"hr:leave:approve"');
  });

  it("no DEPARTMENT_MANAGER role was invented", () => {
    // The HR-native manager concept is employee_assignment.manager_employee_id,
    // per placement, with history. A role would duplicate it without the scope.
    expect(read("lib/platform/role-templates.ts")).not.toMatch(/DEPARTMENT_MANAGER|DEPT_MANAGER/);
  });
});

describe("the premises HR-B1/B2 are designed against", () => {
  it("HR-B1 landed: the decision authority lives in the RPC, both lanes", () => {
    // The pin moved with the manager lane, exactly as designed: the action no
    // longer gates on the flat permission (that would BLOCK the manager lane);
    // it resolves identity and the DATABASE decides — manager relationship or
    // assert_actor_authority('hr:leave:approve').
    const s = code("lib/hr/leave-actions.ts");
    const fn = s.slice(s.indexOf("export async function decideLeaveRequest"));
    expect(fn.slice(0, 1200)).not.toContain('assertPermission("hr:leave:approve")');
    expect(fn.slice(0, 1200)).toContain('rpc("hr_decide_leave_request"');
    const m = code("supabase/migrations/20260830000001_hr_leave_approval_activation.sql");
    expect(m).toContain("manager_employee_id = v_actor_emp");
    expect(m).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:leave:approve', 'SERVICE')");
  });

  it("the manager relationship the scoped lane will read already exists", () => {
    expect(code("lib/hr/assignment-core.ts") + code("lib/hr/actions.ts")).toContain("manager");
    expect(read("supabase/migrations/20260724000002_hr_employee_registry.sql")
      + read("supabase/migrations/20260801000001_hr_organization_foundation.sql")).toContain("manager_employee_id");
  });

  it("HR616 stands: the finalizer must differ from the reviewing manager", () => {
    // The structural rule the ratified answer must live with. Repealing it is
    // an Effitrans decision, never a side effect of a grant phase.
    const m = code("supabase/migrations/20260803000001_hr_performance.sql");
    // SQL doubles the apostrophe (l''évaluateur); match a fragment clear of it.
    expect(m).toContain("le finalisateur doit différer de l");
    expect(m).toContain("HR616");
  });
});

describe("the import pipeline: authorized, four-eyed, and deliberately unfinished", () => {
  it("the four-eyes visa is enforced on identity", () => {
    const s = code("lib/hr/organization-actions.ts");
    const fn = s.slice(s.indexOf("export async function approveHrImport"));
    expect(fn.slice(0, 800)).toContain("batch.submitted_by === admin.id");
    expect(fn.slice(0, 800)).toContain('"same_actor"');
  });

  it("HR-B3 landed: the apply stage exists, and only after the visa", () => {
    // HR-B3 shipped the apply stage. It enters only from a visa'd batch (or
    // the failed remainder of one) and creates exclusively via createEmployee.
    const s = code("lib/hr/organization-actions.ts");
    const apply = s.slice(s.indexOf("export async function applyHrImport"));
    expect(s).toContain("export async function applyHrImport");
    expect(apply).toContain('.in("status", ["READY", "APPLIED_WITH_ERRORS"])');
    expect(apply).toContain("createEmployee(");
  });

  it("the audit is on the record with both flags for Effitrans", () => {
    const doc = read("docs/hr/hr-1a-governance-reconciliation.md");
    expect(doc).toContain("6 members in production");   // CEO breadth flag
    expect(doc).toContain("HR616");                      // finalizer separation flag
    expect(doc).toContain("THE PIPELINE STOPS AT");
  });
});
