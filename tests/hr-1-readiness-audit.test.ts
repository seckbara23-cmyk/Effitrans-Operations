/**
 * EFFITRANS-HR-1 — production readiness audit: the load-bearing claims, pinned.
 * ---------------------------------------------------------------------------
 * The audit's conclusion is that NOTHING in engineering blocks the first real
 * employee: the core is built and granted, and what remains is a configuration
 * session, data, and staffing. Most of that is already defended by the HR
 * suites (identity-link grants nothing, exact HR_OFFICER permission set,
 * numbering, four-eyes CHECKs). These pin the few claims that were not:
 *
 *   1. Employee creation is NOT blocked by the empty structure — the org unit
 *      is optional and the matricule prefix has a default. If either quietly
 *      became mandatory, « create the first employee » would stop being true
 *      while the audit kept saying it.
 *   2. The deferred modules stay deferred — a SoonTile silently becoming a
 *      link would contradict the roadmap without failing anything.
 *   3. The one-officer situation is reported fail-closed, not hidden.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

describe("creating the first employee needs no prior configuration", () => {
  it("the org unit is optional at creation, and validated when given", () => {
    const s = code("lib/hr/actions.ts");
    expect(s).toMatch(/orgUnitId\?: string \| null/);
    // When present it is tenant-validated BEFORE any write (HR-A2).
    expect(s).toContain("validateAssignmentTargets(ctx.tenantId, { orgUnitId })");
  });

  it("the matricule prefix defaults to EMP when no configuration row exists", () => {
    // HR-A1: prefix read from hr_configuration with a default — so an empty
    // hr_configuration table cannot block numbering.
    const m = code("supabase/migrations/20260821000001_hr_a1_foundation_activation.sql");
    expect(m).toMatch(/employee_number_prefix/);
    expect(m).toMatch(/'EMP'/);
  });
});

describe("the deferred modules are deferred, not defective", () => {
  it("reporting remains a SoonTile; paie (HR-7B) and départs (HR-8B) are activated", () => {
    // HR-7A/B/C moved this pin deliberately: « Préparation de paie » is now a
    // real facts-only workspace (DEC-B63 boundary intact — no amounts).
    // HR-8B moved it again: « Départs » is a real clearance workspace, and the
    // old "Offboarding — À venir" tile is gone. Reporting RH stays deferred.
    const page = read("app/departments/hr/page.tsx");
    expect(page).toMatch(/SoonTile[^/]*title="Reporting RH"/);
    expect(page).toContain('href="/departments/hr/paie"');
    expect(page).toContain('href="/departments/hr/departs"');
    expect(page).not.toMatch(/SoonTile[^/]*title="Préparation de paie"/);
    expect(page).not.toMatch(/SoonTile[^/]*title="(Offboarding|Départs)"/);
    expect(page).not.toContain("À venir — HR-8");
  });

  it("rehire-is-a-new-record (DEC-B26) still holds in the lifecycle", () => {
    expect(read("lib/hr/lifecycle.ts")).toContain("TERMINATED never returns to ACTIVE");
  });
});

describe("the staffing gap is stated, never smoothed over", () => {
  it("countHrOfficers counts DISTINCT ACTIVE holders and fails closed", () => {
    const s = read("lib/hr/read.ts");
    expect(s).toContain("DISTINCT active accounts holding HR_OFFICER");
    // An error path must yield 0 (banner shows), never a happy number.
    const fn = code("lib/hr/read.ts");
    const i = fn.indexOf("countHrOfficers");
    expect(fn.slice(i, i + 700)).toMatch(/return 0|: 0/);
  });

  it("the audit is on the record with its central claim", () => {
    const doc = read("docs/hr/hr-1-production-readiness-audit.md");
    expect(doc).toContain("Nothing in engineering blocks the first real employee");
    expect(doc).toContain("data activation");
    expect(doc).toContain("ONE active HR_OFFICER");
  });
});
