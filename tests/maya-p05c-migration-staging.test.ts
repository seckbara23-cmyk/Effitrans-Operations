/**
 * MAYA-P0.5-C — MAYA migration staging foundation.
 * ---------------------------------------------------------------------------
 * The pipeline stages, normalises, validates and reconciles a MAYA export, and
 * then STOPS. Three properties this suite exists to defend:
 *
 *   1. NOTHING REACHES PRODUCTION. No staging path writes an operational
 *      table, mints a dossier number, starts a workflow or touches finance —
 *      and no column or FK exists that could record such an act.
 *   2. NOTHING IS LOST. The four row outcomes partition every batch:
 *      source rows = valid + warning + rejected + duplicate.
 *   3. OUR OPEN QUESTIONS ARE NOT THE DATA'S FAULT. An unknown or deliberately
 *      undecomposed MAYA type is a WARNING with the original label preserved,
 *      never a rejection — Q1/Q2/Q5 are unanswered, and rows must survive that.
 *
 * Every fixture here is SYNTHETIC. No real MAYA file is read, required or
 * committed; the tests would pass on a machine that has never seen MAYA.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalizeRecord, sourceRowHash, artifactHash } from "@/lib/maya/staging/identity";
import { normalizeRow, parseLegacyDate, parseLegacyNumber, splitContainerNumbers, type MayaColumnMap } from "@/lib/maya/staging/normalize";
import { validateRow, type ValidationContext } from "@/lib/maya/staging/validate";
import { batchOutcome, reconcileBatch } from "@/lib/maya/staging/reconcile";
import { MAYA_BATCH_STATUSES, MAYA_ISSUE_CODES, MAYA_ROW_STATUSES } from "@/lib/maya/staging/types";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260823000001_maya_migration_staging.sql";
const SUITE = "supabase/tests/maya_p05c_migration_staging_test.sql";
const ACTIONS = "lib/maya/staging/actions.ts";
const PAGE = "app/admin/maya-migration/page.tsx";

/** A synthetic MAYA register row — invented references, invented client. */
const MAPPING: MayaColumnMap = {
  dossier_reference: "N° Dossier",
  parent_reference: "Dossier mère",
  type_label: "Type de Dossier",
  opening_date: "Date",
  client_name: "Client",
  vessel_or_flight: "Navire/Vol",
  bl_awb_ref: "BL/LTA",
  quantity: "Quantité",
  quantity_unit: "Unité",
  net_weight_kg: "Poids (Kg)",
  container_numbers: "Conteneur N°",
};
const ROW = {
  "N° Dossier": "SYNTH/2026/0001",
  "Dossier mère": "",
  "Type de Dossier": "IMPORT MARITIME TC",
  "Date": "14/03/2026",
  "Client": "CLIENT SYNTHÉTIQUE SARL",
  "Navire/Vol": "MV ESSAI",
  "BL/LTA": "BL-SYNTH-1",
  "Quantité": "1 234,50",
  "Unité": "TONNE",
  "Poids (Kg)": "1234500",
  "Conteneur N°": "TESU1234567; TESU7654321",
};
const norm = (raw: Record<string, string> = ROW, table = "ORDRETRANSIT") =>
  normalizeRow({ sourceTable: table, raw, mapping: MAPPING });

const emptyCtx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  seenHashesInBatch: new Set(),
  hashesInPriorBatches: new Set(),
  migratedDossierReferences: new Set(),
  dossierReferencesInBatch: new Set(),
  matchableClientKeys: new Set(),
  ...over,
});

// ===========================================================================
describe("1 — no real MAYA artefact is required, referenced or committed", () => {
  it("no test or fixture reads a MAYA data/config format", () => {
    // This file is EXCLUDED on purpose: it is the checker, so it necessarily
    // contains the very extensions it forbids everywhere else.
    const forbidden = /\.(wx|wdd|fic|ndx|mmo|dpl|wdk)\b/i;
    for (const f of [ACTIONS, "lib/maya/staging/normalize.ts", "lib/maya/staging/identity.ts",
                     "lib/maya/staging/read.ts", "lib/maya/staging/validate.ts", PAGE]) {
      expect(code(f), f).not.toMatch(forbidden);
    }
  });

  it("the repository refuses MAYA data formats and extracts", () => {
    const ignore = read(".gitignore");
    for (const pattern of ["*.wx", "*.WDD", "*.fic", "*.FIC", "*.ndx", "*.mmo", "*.dpl", "/maya-extracts/"]) {
      expect(ignore, pattern).toContain(pattern);
    }
    // Scoped on purpose: a blanket rule would hide legitimate sources.
    expect(ignore).not.toMatch(/^\*\.csv$/m);
    expect(ignore).not.toMatch(/^\*\.json$/m);
  });

  it("no MAYA binary or export is tracked in the repository", () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p, out);
        else out.push(p);
      }
      return out;
    };
    const suspicious = walk(".").filter((f) => /\.(wx|wdd|fic|ndx|mmo|dpl|wdk|exe)$/i.test(f));
    expect(suspicious).toEqual([]);
  });
});

// ===========================================================================
describe("2/6 — deterministic source identity", () => {
  it("the same record hashes identically regardless of column order, case or padding", () => {
    const a = sourceRowHash("ORDRETRANSIT", { A: "1", B: "deux" });
    const b = sourceRowHash("ordretransit", { B: "  DEUX ", A: "1" });
    expect(a).toBe(b);
  });

  it("different content hashes differently, and the table participates", () => {
    expect(sourceRowHash("ORDRETRANSIT", { A: "1" })).not.toBe(sourceRowHash("ORDRETRANSIT", { A: "2" }));
    expect(sourceRowHash("ORDRETRANSIT", { A: "1" })).not.toBe(sourceRowHash("DOSSIERMERE", { A: "1" }));
  });

  it("absent and empty columns are the same fact", () => {
    expect(canonicalizeRecord({ A: "1", B: "" })).toBe(canonicalizeRecord({ A: "1" }));
    expect(canonicalizeRecord({ A: "1", B: null })).toBe(canonicalizeRecord({ A: "1" }));
  });

  it("concatenation cannot be forged across key/value boundaries", () => {
    // A naive join would make {AB:"C"} and {A:"BC"} collide.
    expect(sourceRowHash("T", { AB: "C" })).not.toBe(sourceRowHash("T", { A: "BC" }));
  });

  it("the artefact hash is stable and content-derived", () => {
    expect(artifactHash("x")).toBe(artifactHash("x"));
    expect(artifactHash("x")).not.toBe(artifactHash("y"));
  });
});

// ===========================================================================
describe("normalisation — legacy French text, nothing invented", () => {
  it("reads JJ/MM/AAAA and ISO; anything else is malformed, not guessed", () => {
    expect(parseLegacyDate("14/03/2026")).toBe("2026-03-14");
    expect(parseLegacyDate("2026-03-14")).toBe("2026-03-14");
    expect(parseLegacyDate("")).toBeNull();
    expect(parseLegacyDate("mars 2026")).toBeUndefined();
    expect(parseLegacyDate("14/13/2026")).toBeUndefined();
  });

  it("reads comma decimals and space thousands; anything else is malformed", () => {
    expect(parseLegacyNumber("1 234,50")).toBe(1234.5);
    expect(parseLegacyNumber("1.234,50")).toBe(1234.5);
    expect(parseLegacyNumber("250.5")).toBe(250.5);
    expect(parseLegacyNumber("")).toBeNull();
    expect(parseLegacyNumber("beaucoup")).toBeUndefined();
  });

  it("splits container numbers however the operator typed them", () => {
    expect(splitContainerNumbers("TESU1234567; TESU7654321")).toEqual(["TESU1234567", "TESU7654321"]);
  });

  it("normalises a synthetic register row onto platform candidates", () => {
    const n = norm();
    expect(n.sourceDossierReference).toBe("SYNTH/2026/0001");
    expect(n.openingDate).toBe("2026-03-14");
    expect(n.cargoQuantity).toBe(1234.5);
    expect(n.containerNumbers).toHaveLength(2);
    expect(n.malformed).toEqual([]);
  });
});

// ===========================================================================
describe("7/8/9 — taxonomy: reused, never reimplemented, never guessed", () => {
  it("a proven MAYA type resolves onto the four dimensions", () => {
    const n = norm();
    expect(n.taxonomyResolution).toBe("RESOLVED");
    expect(n.normalizedDirection).toBe("IMP");
    expect(n.normalizedMode).toBe("SEA");
    expect(n.normalizedCargoForm).toBe("CONTAINER");
  });

  it("REMISES DOCUMENTAIRES stays UNRESOLVED with its label preserved", () => {
    const n = norm({ ...ROW, "Type de Dossier": "REMISES DOCUMENTAIRES" });
    expect(n.taxonomyResolution).toBe("UNRESOLVED");
    expect(n.sourceTypeLabel).toBe("REMISES DOCUMENTAIRES");
    expect(n.normalizedDirection).toBeNull();
    const v = validateRow(n, emptyCtx());
    expect(v.status).not.toBe("REJECTED");
    expect(v.issues.map((i) => i.code)).toContain("UNRESOLVED_TAXONOMY");
  });

  it("AUTRES DOSSIERS stays UNRESOLVED with its label preserved", () => {
    const n = norm({ ...ROW, "Type de Dossier": "AUTRES DOSSIERS" });
    expect(n.taxonomyResolution).toBe("UNRESOLVED");
    expect(n.normalizedDirection).toBeNull();
    expect(validateRow(n, emptyCtx()).status).not.toBe("REJECTED");
  });

  it("an unknown MAYA label is a WARNING, never a rejection", () => {
    const n = norm({ ...ROW, "Type de Dossier": "IMPORT FLUVIAL BARGE" });
    expect(n.taxonomyResolution).toBe("UNKNOWN");
    const v = validateRow(n, emptyCtx({ matchableClientKeys: new Set(["CLIENT SYNTHÉTIQUE SARL"]) }));
    expect(v.issues.map((i) => i.code)).toContain("UNKNOWN_TAXONOMY");
    expect(v.status).toBe("WARNING");
  });

  it("the suspensive regime is read from the label, via the ratified module", () => {
    expect(norm({ ...ROW, "Type de Dossier": "IMPORT MARITIME TC SUSPENSIF" }).normalizedRegime).toBe("SUSPENSIF");
    expect(norm().normalizedRegime).toBeNull();
  });

  it("the importer does not reimplement taxonomy rules", () => {
    const n = code("lib/maya/staging/normalize.ts");
    expect(n).toContain('from "@/lib/files/taxonomy"');
    // No second copy of the MAYA type table.
    expect(n).not.toContain("IMPORT MARITIME TC");
    expect(n).not.toContain("EXPORT MARITIME");
  });
});

// ===========================================================================
describe("4/5/10/11/12 — validation rules", () => {
  it("a row without any source identity is REJECTED", () => {
    const n = norm({ ...ROW, "N° Dossier": "" });
    const v = validateRow({ ...n, sourceRecordId: null }, emptyCtx());
    expect(v.issues.map((i) => i.code)).toContain("MISSING_SOURCE_IDENTITY");
    expect(v.status).toBe("REJECTED");
  });

  it("a duplicate WITHIN the batch is DUPLICATE, not silently dropped", () => {
    const n = norm();
    const v = validateRow(n, emptyCtx({ seenHashesInBatch: new Set([n.sourceRowHash]) }));
    expect(v.status).toBe("DUPLICATE");
    expect(v.issues.map((i) => i.code)).toContain("DUPLICATE_IN_BATCH");
  });

  it("a duplicate ACROSS batches is detected", () => {
    const n = norm();
    const v = validateRow(n, emptyCtx({ hashesInPriorBatches: new Set([n.sourceRowHash]) }));
    expect(v.status).toBe("DUPLICATE");
    expect(v.issues.map((i) => i.code)).toContain("DUPLICATE_ACROSS_BATCHES");
  });

  it("a dossier already migrated is DUPLICATE", () => {
    const n = norm();
    const v = validateRow(n, emptyCtx({ migratedDossierReferences: new Set(["SYNTH/2026/0001"]) }));
    expect(v.status).toBe("DUPLICATE");
    expect(v.issues.map((i) => i.code)).toContain("ALREADY_MIGRATED");
  });

  it("a self-parent is REJECTED (P0.5-B's database refuses it too)", () => {
    const n = norm({ ...ROW, "Dossier mère": "SYNTH/2026/0001" });
    const v = validateRow(n, emptyCtx());
    expect(v.issues.map((i) => i.code)).toContain("SELF_PARENT");
    expect(v.status).toBe("REJECTED");
    expect(v.parentResolution).toBe("UNRESOLVED");
  });

  it("a parent resolves in-batch, against a migrated dossier, or not at all", () => {
    const n = norm({ ...ROW, "Dossier mère": "SYNTH/2026/0900" });
    expect(validateRow(n, emptyCtx({ dossierReferencesInBatch: new Set(["SYNTH/2026/0900"]) })).parentResolution)
      .toBe("IN_BATCH");
    expect(validateRow(n, emptyCtx({ migratedDossierReferences: new Set(["SYNTH/2026/0900"]) })).parentResolution)
      .toBe("EXISTING_DOSSIER");
    const unresolved = validateRow(n, emptyCtx());
    expect(unresolved.parentResolution).toBe("UNRESOLVED");
    expect(unresolved.status).toBe("WARNING");
    expect(unresolved.unresolved).toBe(true);
  });

  it("negative and non-integer cargo values are REJECTED", () => {
    const neg = validateRow({ ...norm(), netWeightKg: -1 }, emptyCtx());
    expect(neg.issues.map((i) => i.code)).toContain("NEGATIVE_AMOUNT");
    expect(neg.status).toBe("REJECTED");
    const frac = validateRow({ ...norm(), packageCount: 2.5 }, emptyCtx());
    expect(frac.issues.map((i) => i.code)).toContain("NON_INTEGER_COUNT");
    expect(frac.status).toBe("REJECTED");
  });

  it("an unreadable date is REJECTED, an unmatched client only a WARNING", () => {
    const bad = norm({ ...ROW, "Date": "le 14 mars" });
    expect(bad.malformed.map((m) => m.field)).toContain("opening_date");
    expect(validateRow(bad, emptyCtx()).status).toBe("REJECTED");

    const clean = validateRow(norm(), emptyCtx());
    expect(clean.issues.map((i) => i.code)).toContain("UNRESOLVED_CLIENT");
    expect(clean.status).toBe("WARNING");
  });

  it("a fully matched row is VALID", () => {
    const v = validateRow(norm(), emptyCtx({ matchableClientKeys: new Set(["CLIENT SYNTHÉTIQUE SARL"]) }));
    expect(v.status).toBe("VALID");
    expect(v.issues).toEqual([]);
  });

  it("an error outranks a duplicate, which outranks a warning", () => {
    const n = norm({ ...ROW, "N° Dossier": "" });
    const both = validateRow({ ...n, sourceRecordId: null },
      emptyCtx({ seenHashesInBatch: new Set([n.sourceRowHash]) }));
    expect(both.status).toBe("REJECTED");
  });

  it("only knowledge-gap codes are WARNINGs", () => {
    expect(MAYA_ISSUE_CODES.UNKNOWN_TAXONOMY).toBe("WARNING");
    expect(MAYA_ISSUE_CODES.UNRESOLVED_TAXONOMY).toBe("WARNING");
    expect(MAYA_ISSUE_CODES.UNRESOLVED_CLIENT).toBe("WARNING");
    expect(MAYA_ISSUE_CODES.UNRESOLVED_PARENT).toBe("WARNING");
    expect(MAYA_ISSUE_CODES.MISSING_SOURCE_IDENTITY).toBe("ERROR");
  });
});

// ===========================================================================
describe("13 — reconciliation: every source row is accounted for", () => {
  it("the four outcomes partition the batch", () => {
    const r = reconcileBatch(["VALID", "WARNING", "REJECTED", "DUPLICATE", "VALID"], 1);
    expect(r.sourceRows).toBe(5);
    expect(r.valid + r.warning + r.rejected + r.duplicate).toBe(r.sourceRows);
    expect(r.balanced).toBe(true);
  });

  it("an unvalidated batch reports itself UNBALANCED rather than tidy", () => {
    const r = reconcileBatch(["VALID", "PENDING"]);
    expect(r.balanced).toBe(false);
    expect(batchOutcome(r)).toBe("REJECTED");
  });

  it("the outcome follows the rows", () => {
    expect(batchOutcome(reconcileBatch(["VALID", "VALID"]))).toBe("READY");
    expect(batchOutcome(reconcileBatch(["VALID", "WARNING"]))).toBe("READY_WITH_WARNINGS");
    expect(batchOutcome(reconcileBatch(["VALID", "DUPLICATE"]))).toBe("READY_WITH_WARNINGS");
    expect(batchOutcome(reconcileBatch(["VALID", "REJECTED"]))).toBe("REJECTED");
  });

  it("the database enforces the same equation", () => {
    expect(sqlCode(MIGRATION)).toMatch(
      /constraint maya_batch_reconciles check \([\s\S]{0,200}row_count = valid_count \+ warning_count \+ rejected_count \+ duplicate_count/,
    );
    expect(read(SUITE)).toMatch(/an unbalanced batch cannot reach an outcome/);
  });
});

// ===========================================================================
describe("14–19 — the apply path does not exist", () => {
  const actions = code(ACTIONS);

  it("no staging action writes an operational table", () => {
    for (const table of ["operational_file", "shipment", "process_instance", "process_step_execution",
                         "invoice", "billing_charge", "expense_authorization", "finance_request",
                         "client_notification", "user_role", "customs_record", "transport_record"]) {
      expect(actions, table).not.toMatch(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,160}\\.(insert|update|upsert|delete)`));
    }
  });

  it("the only tables staging writes are its own", () => {
    const written = [...actions.matchAll(/from\("(\w+)"\)[\s\S]{0,200}?\.(insert|update|upsert|delete)\(/g)]
      .map((m) => m[1]);
    expect(new Set(written)).toEqual(new Set(["maya_import_batch", "maya_import_row", "maya_import_issue"]));
  });

  it("no staging path mints a dossier number or starts a workflow", () => {
    expect(actions).not.toContain("next_file_number");
    expect(actions).not.toMatch(/rpc\(/);
    // Word-blacklisting "process" would trip on `processing_due_date`, a
    // legitimate staged field. Name the capabilities instead.
    for (const capability of ["process_instance", "process_step_execution", "process_handoff",
                              "emitBusinessEvent", "emit_business_event", "openDossierWorkflow"]) {
      expect(actions, capability).not.toContain(capability);
    }
  });

  it("no staging path touches finance or notifications", () => {
    expect(actions).not.toMatch(/createNotification|notify|disbursement|payment/i);
  });

  it("there is no apply action, by name or by shape", () => {
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual(["cancelMayaBatch", "stageMayaBatch", "validateMayaBatch"]);
    expect(actions).not.toMatch(/apply|migrateTo|promote|commitBatch/i);
  });

  it("the state vocabularies contain no applied/migrated state", () => {
    for (const s of MAYA_BATCH_STATUSES) expect(["APPLYING", "APPLIED", "MIGRATED"]).not.toContain(s);
    for (const s of MAYA_ROW_STATUSES) expect(["APPLIED", "IMPORTED", "CREATED"]).not.toContain(s);
    expect(MAYA_BATCH_STATUSES).toEqual(["STAGED", "READY", "READY_WITH_WARNINGS", "REJECTED", "CANCELLED"]);
  });

  it("the migration proves the absence structurally", () => {
    const m = sqlCode(MIGRATION);
    expect(m).toMatch(/a staging column suggests an apply path/);
    expect(m).toMatch(/staging references an operational table/);
    // No FK from staging to any operational table.
    expect(m).not.toMatch(/references public\.(operational_file|shipment|invoice)/);
  });

  it("the console offers no production action", () => {
    const page = read(PAGE);
    for (const word of ["Importer", "Appliquer", "Migrer", "Transférer vers"]) {
      // The honesty paragraph NAMES these to say they are absent; what must not
      // exist is a control. No button/form/action element appears at all.
      expect(page, word).not.toMatch(new RegExp(`<button[^>]*>[^<]*${word}`));
    }
    expect(page).not.toContain("<form");
    expect(page).not.toMatch(/onClick|stageMayaBatch|validateMayaBatch|cancelMayaBatch/);
    expect(page).toContain("ne transfère rien");
  });
});

// ===========================================================================
describe("3/20 — isolation, authority, and what stayed untouched", () => {
  it("staging tables are registered with the tenant-scope guard", () => {
    for (const t of ["maya_import_batch", "maya_import_row", "maya_import_issue"]) {
      expect(TENANT_SCOPED_TABLES.has(t), t).toBe(true);
    }
  });

  it("every read is tenant-scoped and every write derives tenant from the session", () => {
    const reads = code("lib/maya/staging/read.ts");
    expect((reads.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(code(ACTIONS)).not.toMatch(/input\.(tenantId|tenant_id|actorId)/);
    expect(code(ACTIONS)).toMatch(/admin\.tenantId/);
  });

  it("authority is an EXISTING platform permission — no MAYA role invented", () => {
    const actions = code(ACTIONS);
    expect((actions.match(/assertPermission\("admin:config:manage"\)/g) ?? []).length).toBe(3);
    expect(read(PAGE)).toContain('hasPermission(permissions, "admin:config:manage")');
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/insert into public\.(permission|role|role_permission)/);
    expect(m).toMatch(/a MAYA-specific permission was created/); // the assertion guarding it
  });

  it("RLS is read-only for administrators; writes go through the service role", () => {
    const m = sqlCode(MIGRATION);
    expect((m.match(/for select to authenticated/g) ?? []).length).toBe(3);
    expect(m).not.toMatch(/for (insert|update|delete|all) to authenticated/);
    expect((m.match(/grant select on public\.maya_import_\w+\s+to authenticated/g) ?? []).length).toBe(3);
  });

  it("Q1/Q2/Q5-dependent modules are untouched by this phase", () => {
    for (const f of ["lib/process/applicability.ts", "lib/files/status.ts", "lib/files/lifecycle.ts",
                     "lib/workflow/projection.ts", "lib/files/closure.ts"]) {
      expect(code(f), f).not.toMatch(/maya/i);
    }
  });

  it("P0.5-B's dossier contract and numbering are untouched", () => {
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/alter table public\.(operational_file|shipment)/);
    expect(m).not.toMatch(/create or replace function public\.next_file_number/);
    expect(m).toMatch(/the P0.5-B parent guard disappeared/);
  });

  it("housekeeping: build-info, registry and CI wiring", () => {
    const b = read("lib/platform/ops/build-info.ts");
    // P0.5-C's migration remains ON DISK and in the ledger; it is no longer the
    // NEWEST, because later phases legitimately shipped their own.
    expect(readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url))))
      .toContain("20260823000001_maya_migration_staging.sql");
    const count = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql")).length;
    expect(b).toContain(`MIGRATION_COUNT = ${count}`);
    expect(read(".github/workflows/ci.yml")).toContain("-f supabase/tests/maya_p05c_migration_staging_test.sql");
  });
});
