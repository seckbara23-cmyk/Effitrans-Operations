/**
 * OPS-GAINDE-04-COMPAT-01 — the application must run on the schema that is
 * actually deployed.
 * ---------------------------------------------------------------------------
 * THE INCIDENT, verbatim from production:
 *
 *   Error: [customs] read failed: column customs_record.gainde_declaration_reference
 *   does not exist
 *     route /files/[id].rsc · 3 occurrences · deployment dpl_BggcniZ5GB9PzeSGWVpKFZDwFh4U
 *
 * `92aa2c3` shipped the application half of OPS-CUSTOMS-GAINDE-04 while
 * production deliberately stayed at schema 138, and `RECORD_COLS` asked
 * PostgREST for a column migration 20261001000001 introduces. PostgREST fails
 * the WHOLE select on an unknown column — there is no partial result — so one
 * unapplied column took the entire dossier route to the error boundary.
 *
 * THE LESSON THIS FILE HOLDS. Writing application code for an unapplied
 * migration is a deployment mistake, and the codebase had no test that could
 * catch it: every existing assertion reads the repository, where the column
 * exists in a `.sql` file nobody has run. What follows checks the two shapes
 * separately — what the code asks of schema 138, and what it asks of 139 — so
 * the next slice that ships ahead of its schema fails here rather than in front
 * of an operator.
 *
 * WHY A PROBE AND NOT A TRY/CATCH. Wrapping the read would swallow real
 * failures — a broken policy, a connection fault — behind « the column is not
 * there yet ». The probe asks ONE narrow question about ONE column and
 * re-throws everything else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PROBE = "lib/customs/schema-139.ts";
const SERVICE = "lib/customs/service.ts";
const ACTIONS = "lib/customs/actions.ts";
const PANEL = "components/customs/customs-panel.tsx";
const RECONCILE = "lib/process/reconcile/service.ts";

/** Everything migration 20261001000001 introduces, and nothing else. */
const MIGRATION_139_OBJECTS = [
  "gainde_declaration_reference",
  "gainde_declaration_recorded_by",
  "gainde_declaration_recorded_at",
  "gainde_tax_payment",
  "gainde_tax_payment_line",
  "record_declaration_reference",
  "void_gainde_tax_payment",
];

// ===========================================================================
// A. SCHEMA-138 COMPATIBILITY — the read path that broke
// ===========================================================================

describe("A — nothing a schema-138 database lacks reaches a live query", () => {
  it("01 — the base projection names no #139 column", () => {
    // The regression itself. `RECORD_COLS` is one string handed to PostgREST,
    // and one unknown name in it fails the whole select.
    const svc = code(SERVICE);
    const base = svc.slice(svc.indexOf("const RECORD_COLS_BASE"), svc.indexOf("const recordCols"));
    expect(base.length).toBeGreaterThan(200);
    for (const object of MIGRATION_139_OBJECTS) {
      expect(base, object).not.toContain(object);
    }
  });

  it("02 — the #139 column is added ONLY when #139 is there", () => {
    const svc = code(SERVICE);
    expect(svc).toContain("const recordCols = (gaindeLedger: boolean) =>");
    expect(svc).toContain("gaindeLedger ? `${RECORD_COLS_BASE}, gainde_declaration_reference` : RECORD_COLS_BASE");
    expect(svc).toContain("await gaindeLedgerAvailable()");
    expect(svc).toContain("recordCols(gaindeLedger)");
  });

  it("03 — and the record read still throws on a GENUINE failure", () => {
    // The compatibility patch must not become a blanket catch. A broken policy
    // or a dead connection has to stay loud; only a not-yet-applied migration
    // stopped being one.
    expect(code(SERVICE)).toContain("throw new Error(`[customs] read failed: ${error.message}`)");
  });

  it("04 — the probe is narrow: one column, one SQLSTATE, everything else re-thrown", () => {
    const probe = code(PROBE);
    expect(probe).toContain('const UNDEFINED_COLUMN = "42703"');
    expect(probe).toContain("if (error.code === UNDEFINED_COLUMN) return false;");
    expect(probe).toContain("throw new Error(`[customs] schema probe failed:");
    // No try/catch anywhere: it reads a returned error code, it does not
    // swallow exceptions.
    expect(probe).not.toContain("try {");
    expect(probe).not.toContain("catch");
  });

  it("05 — the probe reads ZERO rows, so it crosses no tenant boundary", () => {
    // Caught by the tenant-scope guard during the fix: an unscoped read of a
    // tenant-scoped table. `.limit(0)` answers the schema question without
    // fetching anything at all.
    expect(code(PROBE)).toContain(".limit(0)");
    expect(code(PROBE)).not.toContain(".limit(1)");
    expect(read("tests/tenant-scope.test.ts")).toContain('"lib/customs/schema-139.ts::customs_record"');
  });

  it("06 — it is memoized per REQUEST, never per process", () => {
    // A module-level memo would be worse than none: a warm instance that
    // answered `false` before the migration would keep answering `false`
    // afterwards, and the reference would read as absent on a database that
    // has it. `cache()` self-heals the moment #139 lands.
    const probe = code(PROBE);
    expect(probe).toContain('import { cache } from "react"');
    expect(probe).toContain("cache(async (): Promise<boolean>");
    expect(probe).not.toMatch(/^let\s+\w+\s*(:|=)/m);
  });
});

// ===========================================================================
// B. SCHEMA-139 COMPATIBILITY — the designed behaviour still arrives
// ===========================================================================

describe("B — with #139 applied, the slice behaves as designed", () => {
  it("07 — the reference is projected and surfaced", () => {
    const svc = code(SERVICE);
    expect(svc).toContain("gainde_declaration_reference");
    expect(svc).toContain("gaindeLedger ? (r.gainde_declaration_reference ?? null) : null");
  });

  it("08 — the 7-argument registration is used when the ledger exists", () => {
    const a = code(ACTIONS);
    expect(a).toContain("const { error } = gaindeLedger");
    expect(a).toContain("p_quittance: quittance,");
    expect(a).toContain("p_lines: lines,");
  });

  it("09 — and the breakdown is still demanded there", () => {
    const a = code(ACTIONS);
    const slice = a.slice(a.indexOf("export async function recordGaindeRegistration"));
    for (const refusal of ["quittance_required", "paid_at_required", "tax_lines_required"]) {
      expect(slice.slice(0, 3500), refusal).toContain(refusal);
    }
  });
});

// ===========================================================================
// C + D. THE DOSSIER ROUTE AND THE CUSTOMS PANEL UNDER SCHEMA 138
// ===========================================================================

describe("C/D — the dossier route and the customs panel survive schema 138", () => {
  it("10 — no server module queries a #139 table or RPC unconditionally", () => {
    // The exhaustive form of the incident: any unguarded reference to something
    // #139 introduces is another dossier route waiting to fail.
    const GUARDED = new Set([RECONCILE, ACTIONS, SERVICE, PROBE]);
    for (const mod of ["lib/customs/service.ts", "lib/customs/actions.ts",
                       "lib/process/reconcile/service.ts", "lib/customs/intelligence/persistence.ts"]) {
      const src = code(mod);
      for (const object of MIGRATION_139_OBJECTS) {
        if (!src.includes(object)) continue;
        expect(GUARDED.has(mod), `${mod} touches ${object} and must guard it`).toBe(true);
        expect(src, `${mod}: ${object} is reached without a capability check`)
          .toContain("gaindeLedgerAvailable");
      }
    }
  });

  it("11 — the panel hides the control the database cannot honour", () => {
    const panel = code(PANEL);
    expect(panel).toContain('{record.gaindeLedgerAvailable && canUpdate && owns("customs.declaration_reference") && (');
  });

  it("12 — and Finance keeps the registration it had before the slice", () => {
    // Hiding the tax form without restoring the previous control would have
    // taken a working capability away from Finance to fix a rendering bug.
    const panel = code(PANEL);
    expect(panel).toContain("record.gaindeLedgerAvailable ? (");
    expect(panel).toContain("recordGaindeRegistration(record.id, ref.trim())");
    const a = code(ACTIONS);
    expect(a).toContain("await supabase.rpc(\"record_gainde_registration\", {");
    // …through the 3-argument signature that schema 138 actually has.
    expect(a).toMatch(/p_customs_id: id,\s*p_reference: ref,\s*p_actor: user\.id,\s*\}\);/);
  });

  it("13 — a breakdown is never silently discarded", () => {
    // The operator typed those figures. Refusing is honest; storing the
    // reference and dropping the taxes would not be.
    const a = code(ACTIONS);
    expect(a).toContain("if (!gaindeLedger && payment) {");
    expect(a).toContain('return { ok: false, error: "gainde_ledger_unavailable" };');
  });

  it("14 — and the refusal has its own French, not the generic sentence", () => {
    const i18n = read("lib/i18n.ts");
    expect(i18n).toContain("gainde_ledger_unavailable:");
    const at = i18n.indexOf("gainde_ledger_unavailable:");
    expect(i18n.slice(at, at + 260)).toContain("pas encore");
  });
});

// ===========================================================================
// E. ABSENCE OF #139 NEVER READS AS COMPLETE
// ===========================================================================

describe("E — a missing migration is NOT YET AVAILABLE, never « done »", () => {
  it("15 — the tax fact stays NOT KNOWABLE before the ledger exists", () => {
    // Preserved from slice 10: `null` means the question cannot be answered,
    // and the satisfaction rule reads exactly as it did.
    const rec = code(RECONCILE);
    expect(rec).toContain("let gaindeTaxPaid: boolean | null = null;");
    expect(rec).toContain("await gaindeLedgerAvailable()");
    expect(code("lib/process/reconcile/satisfaction.ts"))
      .toContain("f.customs?.gaindeTaxPaid !== false");
  });

  it("16 — and the table is not even queried until it exists", () => {
    // Stronger than failing open: the query that would error is not sent.
    const rec = code(RECONCILE);
    const at = rec.indexOf('from("gainde_tax_payment"');
    expect(at).toBeGreaterThan(-1);
    const before = rec.slice(Math.max(0, at - 400), at);
    expect(before).toContain("gaindeLedgerAvailable()");
  });

  it("17 — an absent reference reads as null, and the UI is told WHY", () => {
    // `null` alone cannot distinguish « not captured » from « no column to
    // capture into ». The flag is what keeps the surface honest.
    const svc = code(SERVICE);
    expect(svc).toContain("gaindeLedgerAvailable: gaindeLedger,");
    expect(code("lib/customs/types.ts")).toContain("gaindeLedgerAvailable: boolean;");
  });

  it("18 — the read-only view omits the row entirely rather than showing « — »", () => {
    // « — » means « not captured ». On schema 138 that would be a claim the
    // platform cannot support.
    const panel = code(PANEL);
    expect(panel).toContain("...(record.gaindeLedgerAvailable");
  });

  it("19 — the declaration-reference write is refused, not attempted", () => {
    const a = code(ACTIONS);
    const slice = a.slice(a.indexOf("export async function recordDeclarationReference"));
    const body = slice.slice(0, 3000);
    expect(body).toContain("if (!(await gaindeLedgerAvailable())) {");
    // …and the refusal precedes the RPC that does not exist, so the operator
    // never sees a generic `record_failed` for a known cause.
    expect(body.indexOf("gaindeLedgerAvailable")).toBeLessThan(body.indexOf("record_declaration_reference"));
  });

  it("20 — the shim is scoped, dated and marked for deletion", () => {
    // A compatibility shim that outlives its window becomes a place where a
    // real schema drift can hide.
    const probe = read(PROBE);
    expect(probe).toContain("20261001000001");
    expect(probe).toContain("DELETE THIS FILE");
  });
});
