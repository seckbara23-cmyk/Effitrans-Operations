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

describe("the seats stay parked until the grant phase — nothing leaked early", () => {
  it("no role template holds hr:leave:approve or hr:performance:finalize", () => {
    const s = read("lib/platform/role-templates.ts");
    expect(s).not.toContain('"hr:leave:approve"');
    expect(s).not.toContain('"hr:performance:finalize"');
    expect(s).not.toContain('"hr:sensitive:read"');
  });

  it("the Direction roles exist for the future grant — CEO, DGA, DAF", () => {
    for (const r of ["CEO", "DGA", "DAF"]) templateBlock(r);
    // …and none of them holds any hr:* today.
    for (const r of ["CEO", "DGA", "DAF"]) {
      expect(templateBlock(r), r).not.toMatch(/"hr:/);
    }
  });

  it("no DEPARTMENT_MANAGER role was invented", () => {
    // The HR-native manager concept is employee_assignment.manager_employee_id,
    // per placement, with history. A role would duplicate it without the scope.
    expect(read("lib/platform/role-templates.ts")).not.toMatch(/DEPARTMENT_MANAGER|DEPT_MANAGER/);
  });
});

describe("the premises HR-B1/B2 are designed against", () => {
  it("leave decision is gated flat — permission plus maker-checker, no scope", () => {
    // THE HR-B1 MUTATION TARGET: when the manager lane lands in the RPC, this
    // pin moves with it. Until then, a scope check appearing only here (the
    // action) or nowhere would both be wrong.
    const s = code("lib/hr/leave-actions.ts");
    const fn = s.slice(s.indexOf("export async function decideLeaveRequest"));
    expect(fn.slice(0, 900)).toContain('assertPermission("hr:leave:approve")');
    expect(fn.slice(0, 900)).toContain('rpc("hr_decide_leave_request"');
    expect(fn.slice(0, 900)).not.toMatch(/manager_employee_id|managerEmployeeId/);
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

  it("the pipeline still stops at READY — HR-B3 is where the apply stage lands", () => {
    // HRQ-A4 is YES, but activation is CODE, not a flag. When HR-B3 ships its
    // apply action this pin moves; until then an apply appearing anywhere else
    // would be a parallel employee-creation path.
    const s = read("lib/hr/organization-actions.ts");
    expect(s).toContain("THE PIPELINE STOPS AT READY");
    expect(code("lib/hr/organization-actions.ts")).not.toMatch(/applyHrImport|applyBatch|import_apply/);
  });

  it("the audit is on the record with both flags for Effitrans", () => {
    const doc = read("docs/hr/hr-1a-governance-reconciliation.md");
    expect(doc).toContain("6 members in production");   // CEO breadth flag
    expect(doc).toContain("HR616");                      // finalizer separation flag
    expect(doc).toContain("THE PIPELINE STOPS AT");
  });
});
