/**
 * EFFITRANS-HR-7A/7B/7C — facts-only payroll preparation foundation.
 * ---------------------------------------------------------------------------
 * The governing spec is docs/hr/hr-7-payroll-preparation-audit.md and its
 * PERMANENT boundary (DEC-B63): preparation + eventual export — never a
 * payroll engine. This suite pins the boundary structurally:
 *
 *   * NO MONEY, anywhere: no monetary column in the schema (also asserted by
 *     the migration and the SQL suite at apply time), no monetary word in the
 *     domain/UI layer, no calculation;
 *   * the snapshot COPIES (FIN-AGING idiom) — reproducibility is proven live
 *     in supabase/tests/hr_7_payroll_preparation_test.sql (cases A–H);
 *   * hr:payroll:read / hr:payroll:approve are catalogued and PARKED (Q7/Q8),
 *     hr:sensitive:read untouched, CEO/HR_OFFICER/SYSTEM_ADMIN hold nothing;
 *   * the adjustment vocabulary ships EMPTY — Effitrans names its own words;
 *   * exceptions are surfaced in French, never normalized.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PAYROLL_STATUS_FR, PAYROLL_EXCEPTION_FR, canReadPayrollFacts } from "@/lib/hr/payroll/model";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const MIG = "supabase/migrations/20260901000001_hr_payroll_preparation.sql";
const SUITE = "supabase/tests/hr_7_payroll_preparation_test.sql";
const NEW_FILES = [
  "lib/hr/payroll.ts", "lib/hr/payroll-actions.ts",
  "components/hr/payroll-studio.tsx", "app/departments/hr/paie/page.tsx",
];

// ===========================================================================
describe("THE PERMANENT BOUNDARY — no payroll engine, no money (Q1/DEC-B63)", () => {
  it("no monetary-looking column exists in the payroll schema, and the migration ASSERTS it", () => {
    const m = sql(MIG);
    // The apply-time guard: drift cannot answer Q1.
    expect(read(MIG)).toMatch(/amount\|salar\|montant\|wage\|rate\|price\|gross\|net_\|tax\|cotis/);
    expect(read(MIG)).toMatch(/raise exception 'HR-7A: a monetary-looking column/);
    // And the shipped DDL genuinely has none — matched INSIDE column names
    // too (base_salary_amount must not slip past a word boundary).
    expect(m).not.toMatch(/^\s+\w*(amount|salar|montant|wage|gross|net_pay|tax_|cotis)\w*\s+(int|bigint|numeric|text)/im);
  });

  it("no monetary vocabulary or calculation enters the domain/UI layer", () => {
    for (const f of NEW_FILES) {
      const s = code(f);
      // The UI legitimately STATES the boundary in French; the ban covers
      // computation vocabulary. The lib layer additionally bans the word.
      expect(s, f).not.toMatch(/salaire|salary|gross|net_pay|bulletin|payslip|cotisation|ipres|\bcss\b/i);
    }
    for (const f of ["lib/hr/payroll.ts", "lib/hr/payroll-actions.ts"]) {
      expect(code(f), f).not.toMatch(/montant|amount/i);
    }
    // The UI states the boundary in French instead of hiding it.
    expect(read("app/departments/hr/paie/page.tsx")).toContain("Aucun montant");
    expect(read("components/hr/payroll-studio.tsx")).toContain("jamais de montants");
  });

  it("no export exists yet — Q5/Q6/Q7 gate it, and the UI says so", () => {
    for (const f of NEW_FILES) {
      expect(code(f), f).not.toMatch(/buildXlsx|toCsv|text\/csv|Content-Disposition/);
    }
    expect(read("components/hr/payroll-studio.tsx")).toContain("ratifié le format et les destinataires");
  });
});

// ===========================================================================
describe("authority — parked where the audit parked it", () => {
  it("both payroll permissions are catalogued and granted to NOBODY, asserted at apply time", () => {
    const m = read(MIG);
    expect(m).toContain("'hr:payroll:read'");
    expect(m).toContain("'hr:payroll:approve'");
    expect(m).not.toMatch(/insert into public\.role_permission/i);
    expect(m).toMatch(/payroll authorities must stay parked/);
    expect(m).toMatch(/hr:sensitive:read must not be granted/);
  });

  it("no role template holds any payroll authority — CEO and HR_OFFICER included", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.permissions.filter((p) => p.startsWith("hr:payroll:")), t.key).toEqual([]);
    }
  });

  it("every RPC verifies its actor and asserts authority in the database", () => {
    const m = sql(MIG);
    const fns = [...m.matchAll(/create or replace function public\.(hr_\w+)\(/g)].map((x) => x[1])
      .filter((f) => !f.includes("guard") && !f.includes("freeze"));
    expect(fns.length).toBe(9);
    for (const f of fns) {
      const i = m.indexOf(`create or replace function public.${f}(`);
      const j = m.indexOf("create or replace function public.", i + 1);
      const body = m.slice(i, j === -1 ? undefined : j);
      expect(body, f).toContain("HR630");
      expect(body, f).toContain("assert_actor_authority");
    }
  });

  it("approval and lock assert the PARKED seat; four-eyes is a CHECK and an errcode", () => {
    const m = sql(MIG);
    expect(m).toContain("assert_actor_authority(p_actor, p_tenant, 'hr:payroll:approve', 'SERVICE')");
    expect(m).toContain("payroll_period_approver_differs");
    expect(m).toContain("HR707");
    expect(m).toContain("payroll_adjustment_decider_differs");
    expect(m).toContain("HR711");
  });

  it("the facts tier is the preparing desk or the parked read seat — never hr:sensitive:read", () => {
    expect(canReadPayrollFacts(["hr:manage"])).toBe(true);
    expect(canReadPayrollFacts(["hr:payroll:read"])).toBe(true);
    expect(canReadPayrollFacts(["hr:read"])).toBe(false);
    // THE MUTATION TARGET: hr:sensitive:read must never open this door.
    expect(canReadPayrollFacts(["hr:sensitive:read"])).toBe(false);
    expect(code("lib/hr/payroll.ts")).not.toContain("hr:sensitive:read");
    expect(code("lib/hr/payroll/model.ts")).not.toContain("hr:sensitive:read");
    // BOTH fact readers (lines AND adjustments) return NOTHING without the tier.
    const reads = code("lib/hr/payroll.ts");
    expect(reads.split("if (!canReadFacts) return []").length - 1).toBe(2);
  });
});

// ===========================================================================
describe("the snapshot copies — reproducibility by construction", () => {
  const m = sql(MIG);

  it("lines carry COPIED labels and quantities, with employee_id as provenance only", () => {
    const i = m.indexOf("create table if not exists public.hr_payroll_period_line");
    const body = m.slice(i, m.indexOf(";", i));
    for (const col of ["employee_number", "first_name", "org_unit_label", "position_label",
                       "contract_kind", "employment_status", "attendance_days", "worked_minutes",
                       "leave_breakdown", "leave_tenths_total", "exceptions"]) {
      expect(body, col).toContain(col);
    }
  });

  it("lines freeze at VERIFIED; APPROVED freezes the period; LOCKED/CANCELLED are terminal", () => {
    // Pin the FREEZE FUNCTION's own predicate (the prepare RPC shares the
    // string, so a global match would survive a weakened freeze).
    const fi = m.indexOf("create or replace function public.hr_payroll_line_freeze");
    const freeze = m.slice(fi, m.indexOf("create or replace", fi + 10));
    expect(freeze).toMatch(/not in \('DRAFT','PREPARED'\)/);
    expect(m).toContain("HR705");
    expect(m).toMatch(/old\.status in \('LOCKED','CANCELLED'\)[\s\S]{0,120}HR701/);
    // The governed reopen exists: VERIFIED → PREPARED.
    expect(m).toContain("(old.status = 'VERIFIED' and new.status = 'PREPARED')");
  });

  it("corrections are versions: same code re-created after LOCK supersedes, an active duplicate refuses", () => {
    expect(m).toContain("unique (tenant_id, code, version)");
    expect(m).toContain("HR703");
    expect(m).toMatch(/v_prior_status not in \('LOCKED','CANCELLED'\)/);
  });

  it("the collector emits exceptions instead of inventing values", () => {
    for (const exc of Object.keys(PAYROLL_EXCEPTION_FR)) {
      expect(m, exc).toContain(`'${exc}'`);
    }
    // No pro-rating anywhere: boundary-crossing leave is stored at face value.
    expect(m).not.toMatch(/prorat|\* *\(.*days.*\)/i);
  });

  it("the live suite proves the decisive cases by name (A–H)", () => {
    const s = read(SUITE);
    for (const t of ["must NOT follow a later attendance edit",
                     "an explicit re-collection must refresh the copy",
                     "the DRAFT employee must be excluded AND counted",
                     "an EXCEPTION, not silently prorated",
                     "the LOCKED snapshot must be permanently reproducible",
                     "an amendment must SUPERSEDE, never delete",
                     "monetary-looking column",
                     "expected HR630 cross-tenant", "expected EFA15"]) {
      expect(s, t).toContain(t);
    }
    expect(s).toContain("select set_config('request.jwt.claims', '', true)");
  });
});

// ===========================================================================
describe("vocabulary and configuration — Effitrans's words, not ours", () => {
  it("the adjustment vocabulary ships EMPTY and the migration refuses a seeded one", () => {
    expect(read(MIG)).toMatch(/no adjustment vocabulary may be seeded/);
    expect(sql(MIG)).not.toMatch(/insert into public\.hr_payroll_adjustment_kind/i);
  });

  it("units are quantities only", () => {
    expect(sql(MIG)).toContain("check (unit in ('HOURS','DAYS','OCCURRENCES','UNITS'))");
  });

  it("kind management is tenant configuration behind hr:config:manage", () => {
    const a = code("lib/hr/payroll-actions.ts");
    const i = a.indexOf("export async function upsertAdjustmentKind");
    expect(a.slice(i, i + 600)).toContain('assertPermission("hr:config:manage")');
  });
});

// ===========================================================================
describe("the French surface", () => {
  it("the hub tile is a real workspace now; reporting stays deferred", () => {
    // HR-8B activated « Départs » — this twin of the SoonTile pin moves with it.
    const hub = read("app/departments/hr/page.tsx");
    expect(hub).toContain('href="/departments/hr/paie"');
    expect(hub).not.toMatch(/SoonTile[^/]*title="Préparation de paie"/);
    expect(hub).toMatch(/SoonTile[^/]*title="Reporting RH"/);
  });

  it("statuses and exceptions render as French sentences, never codes", () => {
    expect(Object.values(PAYROLL_STATUS_FR).every((v) => /^[A-ZÀ-Ü]/.test(v))).toBe(true);
    for (const v of Object.values(PAYROLL_EXCEPTION_FR)) {
      expect(v).toMatch(/[a-zà-ü]/);
    }
    const studio = read("components/hr/payroll-studio.tsx");
    for (const t of ["Collecter les faits", "Vérifier", "Approuver (Direction)", "Verrouiller",
                     "À vérifier", "Prêt", "Quatre yeux"]) {
      expect(studio, t).toContain(t);
    }
    expect(studio).not.toMatch(/EFA\d|HR7\d\d[^0-9]/);
  });

  it("READY vs NEEDS ATTENTION is the exceptions' presence — no policy judgment", () => {
    const studio = read("components/hr/payroll-studio.tsx");
    expect(studio).toContain('l.exceptions.length === 0');
  });
});

// ===========================================================================
describe("audit trail and scope discipline", () => {
  it("every lifecycle act is audited with safe metadata; adjustments hit the employee ledger", () => {
    const a = code("lib/hr/payroll-actions.ts");
    for (const ev of ["hr.payroll.period_created", "hr.payroll.facts_collected",
                      "hr.payroll.period_verified", "hr.payroll.period_approved",
                      "hr.payroll.period_locked", "hr.payroll.period_cancelled",
                      "hr.payroll.adjustment_proposed"]) {
      expect(a, ev).toContain(ev);
    }
    const m = sql(MIG);
    for (const ev of ["payroll_adjustment_proposed", "payroll_adjustment_approved", "payroll_adjustment_rejected"]) {
      expect(m, ev).toContain(`'${ev}'`);
    }
  });

  it("migration 110 exists, the ledger is consistent, the suite runs in CI", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(migrations).toContain("20260901000001_hr_payroll_preparation.sql");
    expect(migrations).toHaveLength(
      Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]),
    );
    expect(read(".github/workflows/ci.yml")).toContain(`-f ${SUITE}`);
  });

  it("nothing beyond HR-7A/B/C was started: no export route, no HR-7E, no offboarding", () => {
    expect(() => read("app/departments/hr/paie/export/route.ts")).toThrow();
    // Scanned on STATEMENTS: the header prose names what the boundary refuses.
    expect(sql(MIG)).not.toMatch(/hr_payroll_export|payslip|offboarding/i);
  });
});
