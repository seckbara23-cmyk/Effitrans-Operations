/**
 * EFFITRANS-HR-9 — Reporting RH.
 * ---------------------------------------------------------------------------
 * The governing spec is docs/hr/hr-9-reporting-audit.md and the ratifications
 * of RQ-9.1…RQ-9.4 recorded in it. This suite pins them structurally:
 *
 *   RQ-9.1  hr:reports:read exists, reaches HR_OFFICER and CEO, and NOBODY
 *           else — and HR reporting never rides the analytics:read route;
 *   RQ-9.2  the floor masks small-group BREAKDOWNS for a reader without row
 *           access, and never suppresses totals for the HR desk;
 *   RQ-9.3  no turnover rate exists anywhere;
 *   RQ-9.4  no historical reconstruction, no stored aggregate;
 *   RQ-8.1  the free-text departure motive is never grouped.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  K_ANONYMITY_FLOOR, applyPrivacyFloor, maskedCount, reportViewerTier,
  resolvePeriod, isIsoDate, HR9_DEFERRED_INDICATORS, MASKED_LABEL_FR,
} from "@/lib/hr/reporting/model";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260905000001_hr_reports_activation.sql";
const READER = "lib/hr/reporting.ts";
const MODEL = "lib/hr/reporting/model.ts";
const PAGE = "app/departments/hr/rapports/page.tsx";
const STUDIO = "components/hr/reporting-studio.tsx";
const EXPORT = "app/departments/hr/rapports/export/route.ts";

// ===========================================================================
describe("RQ-9.2 — the privacy floor, as ratified", () => {
  const rows = [{ label: "TRANSIT", count: 12 }, { label: "FINANCE", count: 4 }, { label: "RH", count: 1 }];

  it("the HR desk (row access) sees ACTUAL totals, however small the group", () => {
    const out = applyPrivacyFloor(rows, "ROW_HOLDER");
    expect(out.map((r) => r.count)).toEqual([12, 4, 1]);
    expect(out.every((r) => !r.masked)).toBe(true);
    expect(maskedCount(rows, "ROW_HOLDER")).toBe(0);
  });

  it("a reader without row access has small groups masked — named, never dropped", () => {
    const out = applyPrivacyFloor(rows, "AGGREGATE_ONLY");
    expect(out).toHaveLength(3); // the group's EXISTENCE is not a secret
    expect(out[0]).toEqual({ label: "TRANSIT", count: 12, masked: false });
    expect(out[1]).toEqual({ label: "FINANCE", count: null, masked: true });
    expect(out[2]).toEqual({ label: "RH", count: null, masked: true });
    expect(maskedCount(rows, "AGGREGATE_ONLY")).toBe(2);
  });

  it("the floor is the ratified 5, and the boundary is inclusive", () => {
    expect(K_ANONYMITY_FLOOR).toBe(5);
    expect(applyPrivacyFloor([{ label: "x", count: 5 }], "AGGREGATE_ONLY")[0].masked).toBe(false);
    expect(applyPrivacyFloor([{ label: "x", count: 4 }], "AGGREGATE_ONLY")[0].masked).toBe(true);
  });

  it("the tier is decided by ROW ACCESS, not by seniority", () => {
    expect(reportViewerTier(["hr:reports:read", "hr:read"])).toBe("ROW_HOLDER");
    expect(reportViewerTier(["hr:reports:read"])).toBe("AGGREGATE_ONLY");
    // Executive breadth does not buy row access.
    expect(reportViewerTier(["hr:reports:read", "analytics:read", "executive:dashboard:read"]))
      .toBe("AGGREGATE_ONLY");
  });

  it("headline totals are never masked — the floor applies to breakdowns only", () => {
    const s = code(STUDIO);
    // Figures render their value directly; only Breakdown consults the floor.
    expect(s).toMatch(/function Breakdown[\s\S]{0,400}applyPrivacyFloor\(rows, tier\)/);
    expect(s).not.toMatch(/function Figure[\s\S]{0,300}applyPrivacyFloor/);
  });

  it("the export obeys the same floor — a download is a disclosure", () => {
    const e = code(EXPORT);
    expect(e).toMatch(/applyPrivacyFloor\(breakdown, tier\)/);
    expect(e).toContain("MASKED_LABEL_FR");
    expect(MASKED_LABEL_FR).toBe("masqué");
  });

  it("HR-9D F-1 — the file speaks the screen's French, never a raw status code", () => {
    // The UAT export printed « TERMINATED » where the workspace shows « Départ ».
    const e = code(EXPORT);
    expect(e).toMatch(/\["Par statut", report\.byStatus, EMPLOYEE_STATUS_FR\]/);
    expect(e).toMatch(/translate\?\.\[r\.label\] \?\? r\.label/);
  });
});

describe("RQ-9.1 — one authority, two seats, and not the analytics door", () => {
  it("the permission is catalogued once and granted to exactly HR_OFFICER and CEO", () => {
    const m = sql(MIG);
    expect(m).toMatch(/insert into public\.permission[\s\S]{0,300}'hr:reports:read'/);
    // Bind to the GRANT statement: the assertions below quote the same clause,
    // so a file-wide match would let a widened grant pass on the assertion's
    // text (the recurring shared-string trap).
    expect(m).toMatch(
      /join public\.permission p on p\.code = 'hr:reports:read'\s+where r\.code in \('HR_OFFICER', 'CEO'\)\s+on conflict do nothing;/,
    );
    // Apply-time refusal if any other role ever holds it.
    expect(read(MIG)).toMatch(/assertion 3c failed: hr:reports:read is held by unratified role/);
  });

  it("the three sources agree — migration, seed and templates", () => {
    expect(read("supabase/seed.sql")).toMatch(/p\.code = 'hr:reports:read'[\s\S]{0,200}r\.code = 'CEO'/);
    expect(read("supabase/seed.sql")).toMatch(/'hr:config:manage', 'hr:reports:read'/);
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => t.permissions.includes("hr:reports:read"))
      .map((t) => t.key).sort();
    expect(holders).toEqual(["CEO", "HR_OFFICER"]);
  });

  it("SYSTEM_ADMIN gains nothing, and CEO gains ONLY reporting", () => {
    const admin = TENANT_ROLE_TEMPLATES.find((t) => t.key === "SYSTEM_ADMIN");
    expect(admin?.permissions.filter((p) => p.startsWith("hr:"))).toEqual([]);
    const ceo = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CEO");
    expect(ceo?.permissions.filter((p) => p.startsWith("hr:"))).toEqual(["hr:reports:read"]);
  });

  it("HR reporting never travels through the analytics:read route", () => {
    // The workspace and its export gate on hr:reports:read...
    for (const f of [PAGE, EXPORT]) {
      expect(code(f), f).toMatch(/hasPermission\(permissions, "hr:reports:read"\)/);
      expect(code(f), f).not.toMatch(/analytics:read/);
    }
    // ...and the general report route never learned about HR.
    const general = code("app/api/reports/export/route.ts");
    expect(general).not.toMatch(/\bhr[_:]/i);
  });
});

describe("RQ-9.3 / RQ-9.4 — what was deliberately NOT built", () => {
  it("no turnover rate exists anywhere in the phase", () => {
    // Naming what is deferred is the opposite of building it, so the deferral
    // list and the French notice that states it are excluded from the ban.
    const withoutDeferrals = (f: string) =>
      code(f)
        .replace(/HR9_DEFERRED_INDICATORS[\s\S]*?\] as const;/, "")
        .replace(/Aucun taux[^<]*/g, "");
    for (const f of [READER, MODEL, STUDIO, EXPORT, PAGE]) {
      expect(withoutDeferrals(f), f).not.toMatch(/turnover|rotation|attrition/i);
    }
    // The deferral is stated, not hidden.
    expect([...HR9_DEFERRED_INDICATORS]).toContain("taux de rotation");
    expect(read(STUDIO)).toContain("Aucun taux n&apos;est calculé");
  });

  it("no absence rate — no schedule model exists to divide by", () => {
    for (const f of [READER, MODEL, STUDIO]) {
      expect(code(f), f).not.toMatch(/absent(eisme|eeism)|taux de présence/i);
    }
  });

  it("no monetary figure enters a report (DEC-B63)", () => {
    for (const f of [READER, MODEL, STUDIO, EXPORT]) {
      expect(code(f), f).not.toMatch(/salaire|salary|montant|amount|masse salariale/i);
    }
  });

  it("RQ-8.1 — the free-text departure motive is never grouped or charted", () => {
    for (const f of [READER, STUDIO, EXPORT]) {
      expect(code(f), f).not.toMatch(/termination_reason/);
    }
    expect(read(STUDIO)).toContain("Les motifs de départ ne sont pas");
  });

  it("nothing is stored: no reporting table, no snapshot, no migration object", () => {
    const m = sql(MIG);
    expect(m).not.toMatch(/create table|create materialized view|create view/i);
    expect(read(MIG)).toMatch(/assertion 3d failed: a reporting\/snapshot object exists/);
    // The reader only reads.
    expect(code(READER)).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("v1 is current state + period movement — no as-of reconstruction", () => {
    const r = code(READER);
    // Movements come from stamped dates, compared against the period.
    expect(r).toMatch(/inPeriod\(r\.hire_date\)/);
    expect(r).toMatch(/inPeriod\(r\.termination_date\)/);
    // No replay of the event ledger to rebuild a past org chart.
    expect(r).not.toMatch(/hr_employee_event/);
  });
});

describe("composition — no parallel read model", () => {
  it("the reader composes the existing HR services rather than restating them", () => {
    const r = code(READER);
    for (const fn of ["employeeStats", "leaveCounts", "hrOperationsCounts", "offboardingCounts", "getHrCenterData"]) {
      expect(r, fn).toContain(fn);
    }
  });

  it("every direct read is tenant-filtered", () => {
    const r = code(READER);
    const froms = [...r.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    expect((r.match(/eq\("tenant_id", tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(froms.length);
  });

  it("the pure model carries no server-only import (the client renders it)", () => {
    expect(read(MODEL)).not.toMatch(/^import "server-only";/m);
    expect(read(READER)).toMatch(/^import "server-only";/m);
    expect(read(STUDIO)).toContain('from "@/lib/hr/reporting/model"');
  });

  it("the export reuses the platform CSV builder, not a second one", () => {
    const e = code(EXPORT);
    expect(e).toMatch(/import \{ toCsv \} from "@\/lib\/bi\/aggregate"/);
    expect(e).not.toMatch(/join\(","\)|\\r\\n/);
    expect(e).toMatch(/writeAudit\(\{[\s\S]{0,120}"hr\.report\.export"/);
  });
});

describe("the surface a person actually uses", () => {
  it("the tile is activated, gated, and the last SoonTile is gone", () => {
    const hub = read("app/departments/hr/page.tsx");
    expect(hub).toMatch(/WorkspaceTile href="\/departments\/hr\/rapports" title="Reporting RH"/);
    expect(hub).toMatch(/GatedTile title="Reporting RH" gate="hr:reports:read"/);
    expect(hub).not.toMatch(/<SoonTile/);
  });

  it("period and department are filters, in French, with sane defaults", () => {
    expect(resolvePeriod(undefined, undefined, "2026-08-17")).toEqual({ from: "2026-08-01", to: "2026-08-17" });
    expect(resolvePeriod("2026-03-31", "2026-03-01", "2026-08-17")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(isIsoDate("2026-13-99")).toBe(true); // shape only — the DB validates meaning
    expect(isIsoDate("hier")).toBe(false);
    const s = read(STUDIO);
    expect(s).toContain("Tous les départements");
    expect(s).toContain("Exporter (CSV)");
  });

  it("no technical code reaches the screen", () => {
    for (const f of [STUDIO, PAGE]) {
      const rendered = code(f).replace(/hasPermission\(permissions, "[^"]+"\)/g, "");
      expect(rendered, f).not.toMatch(/hr:reports:read|hr:read\b|HR\d{3}/);
    }
  });

  it("the workspace route exists and the export sits beneath it", () => {
    expect(existsSync(fileURLToPath(new URL(`../${PAGE}`, import.meta.url)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL(`../${EXPORT}`, import.meta.url)))).toBe(true);
  });
});
