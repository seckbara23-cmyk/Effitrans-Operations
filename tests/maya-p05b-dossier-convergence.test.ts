/**
 * MAYA-P0.5-B — Dossier data & taxonomy convergence.
 * ---------------------------------------------------------------------------
 * The phase closes five workflow-independent gaps MAYA-P0.5-A proved (cargo
 * declaration, parent dossier, client reference, operational dates, migration
 * lineage) and adds ONE pure module that derives MAYA's compound dossier
 * labels from dimensions the platform already stores.
 *
 * The two properties this suite exists to defend:
 *
 *   1. THE TAXONOMY NEVER GUESSES. A combination MAYA never had produces no
 *      label; a MAYA type whose decomposition the evidence did not establish
 *      is reported as unresolved WITH its blocking question, never mapped by
 *      inference.
 *   2. NOTHING WORKFLOW-BEARING MOVED. `operational_file.type` still carries
 *      exactly the four values seven customs-gate call sites depend on, the
 *      numbering function and its trusted overload are untouched, and no new
 *      field is a prerequisite for anything.
 *
 * Behaviour that only a database can prove — cross-tenant parents, cycles,
 * lineage constraints, backward-compatible inserts — lives in
 * supabase/tests/maya_p05b_dossier_convergence_test.sql, which runs last in CI.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARGO_FORMS,
  MAYA_TYPES,
  MAYA_TYPE_CODES,
  deriveMayaLabel,
  deriveMayaLabelFromRow,
  isCargoForm,
  isResolvedMayaType,
  matchMayaLabel,
  regimeMarker,
  resolveMayaType,
  type DossierDimensions,
} from "@/lib/files/taxonomy";
import { validateFile } from "@/lib/files/validate";
import { CUSTOMS_LEG_FILE_TYPES } from "@/lib/process/applicability";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260822000001_dossier_fact_convergence.sql";
const SUITE = "supabase/tests/maya_p05b_dossier_convergence_test.sql";
const CLIENT = "b3f1c2d4-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

// ===========================================================================
describe("taxonomy — derivation from dimensions the platform already stores", () => {
  it("derives every PROVEN MAYA compound type from its dimensions", () => {
    const proven = MAYA_TYPE_CODES.map((c) => MAYA_TYPES[c]).filter(isResolvedMayaType);
    // Six of the eight observed types decompose; two are unresolved by evidence.
    expect(proven).toHaveLength(6);
    for (const entry of proven) {
      expect(deriveMayaLabel(entry.dimensions), entry.code).toEqual({
        code: entry.code,
        labelFr: entry.labelFr,
      });
    }
  });

  it.each([
    ["IMPORT MARITIME TC", { direction: "IMP", mode: "SEA", cargoForm: "CONTAINER", regime: null }],
    ["IMPORT MARITIME TC SUSPENSIF", { direction: "IMP", mode: "SEA", cargoForm: "CONTAINER", regime: "SUSPENSIF" }],
    ["IMPORT MARITIME GROUPAGE", { direction: "IMP", mode: "SEA", cargoForm: "GROUPAGE", regime: null }],
    ["EXPORT MARITIME VRAC", { direction: "EXP", mode: "SEA", cargoForm: "BULK", regime: null }],
    ["IMPORT AÉRIEN COLIS", { direction: "IMP", mode: "AIR", cargoForm: "PARCEL", regime: null }],
    ["TRANSPORT UNIQUEMENT", { direction: "TRP", mode: null, cargoForm: null, regime: null }],
  ] as [string, DossierDimensions][])("%s derives from its exact dimensions", (label, dims) => {
    expect(deriveMayaLabel(dims)?.labelFr).toBe(label);
  });

  it("the SUSPENSIVE regime is what separates the two container imports", () => {
    const base: DossierDimensions = { direction: "IMP", mode: "SEA", cargoForm: "CONTAINER", regime: null };
    expect(deriveMayaLabel(base)?.code).toBe("IMPORT_MARITIME_TC");
    expect(deriveMayaLabel({ ...base, regime: "SUSPENSIF" })?.code).toBe("IMPORT_MARITIME_TC_SUSPENSIF");
  });

  it("reads the suspensive marker out of the free-text regime, and only that", () => {
    for (const v of ["SUSPENSIF", "suspensif", "Régime suspensif TC", "IM7 suspensif"]) {
      expect(regimeMarker(v), v).toBe("SUSPENSIF");
    }
    // Anything else is NOT "normal" — it is simply not the marker, and cannot
    // produce a SUSPENSIF label.
    for (const v of [null, undefined, "", "IM4", "mise à la consommation", "SUSPENS"]) {
      expect(regimeMarker(v as string | null), String(v)).toBeNull();
    }
  });
});

// ===========================================================================
describe("taxonomy — unknown combinations are an answer, never a guess", () => {
  it.each([
    ["import by sea with no cargo form recorded yet", { direction: "IMP", mode: "SEA", cargoForm: null, regime: null }],
    ["air export of parcels — a shape MAYA never had", { direction: "EXP", mode: "AIR", cargoForm: "PARCEL", regime: null }],
    ["containerised road movement", { direction: "TRP", mode: "ROAD", cargoForm: "CONTAINER", regime: null }],
    ["multimodal import", { direction: "IMP", mode: "MULTIMODAL", cargoForm: "CONTAINER", regime: null }],
    ["handling dossier", { direction: "HND", mode: null, cargoForm: null, regime: null }],
    ["suspensive bulk export", { direction: "EXP", mode: "SEA", cargoForm: "BULK", regime: "SUSPENSIF" }],
  ] as [string, DossierDimensions][])("%s yields NO label", (_why, dims) => {
    expect(deriveMayaLabel(dims)).toBeNull();
  });

  it("the two types MAYA-0 could not decompose stay unresolved, with their blocker", () => {
    for (const code of ["REMISES_DOCUMENTAIRES", "AUTRES_DOSSIERS"] as const) {
      const entry = MAYA_TYPES[code];
      expect(isResolvedMayaType(entry), code).toBe(false);
      if (isResolvedMayaType(entry)) return;
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(["Q1", "Q5"]).toContain(entry.blockedBy);
    }
    // …and no dimension set can ever produce one of them as a label.
    const labels = new Set<string>();
    for (const d of ["IMP", "EXP", "TRP", "HND"] as const) {
      for (const m of ["SEA", "AIR", "ROAD", "MULTIMODAL", null] as const) {
        for (const f of [...CARGO_FORMS, null]) {
          for (const r of ["SUSPENSIF", null] as const) {
            const hit = deriveMayaLabel({ direction: d, mode: m, cargoForm: f, regime: r });
            if (hit) labels.add(hit.code);
          }
        }
      }
    }
    expect(labels.has("REMISES_DOCUMENTAIRES")).toBe(false);
    expect(labels.has("AUTRES_DOSSIERS")).toBe(false);
    expect(labels.size).toBe(6);
  });

  it("an unknown MAYA code or label resolves to nothing — no fallback entry", () => {
    expect(resolveMayaType("IMPORT_FLUVIAL")).toBeNull();
    expect(resolveMayaType("")).toBeNull();
    expect(matchMayaLabel("IMPORT MARITIME")).toBeNull(); // partial: not a match
    expect(matchMayaLabel("")).toBeNull();
  });

  it("legacy labels match case- and accent-insensitively but only in full", () => {
    expect(matchMayaLabel("import aerien colis")?.code).toBe("IMPORT_AERIEN_COLIS");
    expect(matchMayaLabel("  IMPORT   MARITIME TC  ")?.code).toBe("IMPORT_MARITIME_TC");
    expect(matchMayaLabel("IMPORT MARITIME TC SUSPENSIF")?.code).toBe("IMPORT_MARITIME_TC_SUSPENSIF");
  });

  it("an unrecognised stored cargo_form is treated as absent, never coerced", () => {
    expect(isCargoForm("PALETTE")).toBe(false);
    expect(
      deriveMayaLabelFromRow({ type: "IMP", transportMode: "SEA", cargoForm: "PALETTE", regime: null }),
    ).toBeNull();
  });
});

// ===========================================================================
describe("the derived label is not a second source of truth", () => {
  it("nothing stores it: no column, no write, no persistence anywhere", () => {
    const t = code("lib/files/taxonomy.ts");
    expect(t).not.toMatch(/insert|update|from\(|supabase/i);
    expect(sqlCode(MIGRATION)).not.toMatch(/maya_type|maya_label/i);
  });

  it("the taxonomy module is pure — no I/O, no server-only, no clock", () => {
    const t = code("lib/files/taxonomy.ts");
    expect(t).not.toContain("server-only");
    expect(t).not.toMatch(/Date\.now|new Date/);
  });

  it("consumers read it, they do not feed workflow with it", () => {
    // The dossier page renders the label; no gate, guard, projection or
    // process module may import the taxonomy.
    for (const f of [
      "lib/customs/gates.ts", "lib/transport/gates.ts", "lib/files/closure.ts",
      "lib/files/lifecycle.ts", "lib/workflow/projection.ts", "lib/process/applicability.ts",
    ]) {
      expect(code(f), f).not.toContain("files/taxonomy");
    }
  });
});

// ===========================================================================
describe("new dossier fields — facts, never prerequisites", () => {
  it("a dossier with NONE of the new fields is still valid", () => {
    expect(validateFile({ type: "IMP", clientId: CLIENT })).toBeNull();
    expect(validateFile({ type: "TRP", clientId: CLIENT, shipment: {} })).toBeNull();
  });

  it("accepts a full cargo declaration for a bulk/road dossier", () => {
    expect(
      validateFile({
        type: "TRP",
        clientId: CLIENT,
        shipment: {
          transportMode: "ROAD", cargoForm: "BULK", quantity: 250.5, quantityUnit: "TONNE",
          netWeightKg: 250500, grossWeightKg: 251000, volumeM3: 320.75, packageCount: 0,
          goodsDescription: "Clinker en vrac", supplierName: "Fournisseur X",
          warehouseEntryDate: "2026-08-11",
        },
        clientReference: "PO-99812", onBehalfOf: "Filiale Nord", processingDueDate: "2026-09-01",
      }),
    ).toBeNull();
  });

  it("refuses malformed values without inventing them", () => {
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { cargoForm: "PALETTE" } })).toBe("invalid_cargo_form");
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { netWeightKg: -1 } })).toBe("invalid_cargo_amount");
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { packageCount: 1.5 } })).toBe("invalid_cargo_amount");
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { quantity: Number.NaN } })).toBe("invalid_cargo_amount");
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { warehouseEntryDate: "11/08/2026" } })).toBe("invalid_date");
    expect(validateFile({ type: "IMP", clientId: CLIENT, processingDueDate: "demain" })).toBe("invalid_date");
    expect(validateFile({ type: "IMP", clientId: CLIENT, parentFileId: "not-a-uuid" })).toBe("invalid_parent");
  });

  it("zero is a recorded quantity; empty is not zero", () => {
    expect(validateFile({ type: "IMP", clientId: CLIENT, shipment: { quantity: 0 } })).toBeNull();
    const actions = code("lib/files/actions.ts");
    // The action maps absent → null, never → 0.
    expect(actions).toMatch(/v === null \|\| v === undefined \|\| !Number\.isFinite\(v\) \? null : v/);
  });

  it("the migration adds every field NULLABLE and additively", () => {
    const m = sqlCode(MIGRATION);
    for (const col of [
      "cargo_form", "quantity", "quantity_unit", "net_weight_kg", "gross_weight_kg",
      "volume_m3", "package_count", "goods_description", "supplier_name",
      "warehouse_entry_date", "parent_file_id", "client_reference", "on_behalf_of",
      "processing_due_date", "provenance", "legacy_reference",
    ]) {
      expect(m, col).toContain(`add column if not exists ${col}`);
    }
    // No column is dropped, renamed, or made NOT NULL; nothing is deleted.
    expect(m).not.toMatch(/drop column|rename column|set not null|drop table|delete from|truncate/i);
    // Exactly ONE added column is NOT NULL, and only because it defaults.
    // (Counting `not null` across the file would also count the CHECK and index
    // predicates that legitimately say `is not null` — the property is about
    // COLUMN DEFINITIONS.)
    const addedNotNull = m
      .split(String.fromCharCode(10))
      .filter((l) => l.includes("add column if not exists") && l.includes(" not null "));
    expect(addedNotNull).toHaveLength(1);
    expect(addedNotNull[0]).toContain("provenance");
    expect(m).toMatch(/provenance\s+text not null default 'PLATFORM_NATIVE'/);
  });
});

// ===========================================================================
describe("parent dossier — a link, and nothing more", () => {
  it("the guard refuses self, cross-tenant and cycles at the database", () => {
    const m = sqlCode(MIGRATION);
    expect(m).toContain("create or replace function public.enforce_file_parent()");
    expect(m).toMatch(/a dossier cannot be its own parent/);
    expect(m).toMatch(/parent dossier belongs to another tenant/);
    expect(m).toMatch(/parent dossier chain forms a cycle/);
    expect(m).toContain("create trigger trg_operational_file_parent");
  });

  it("carries NO groupage, cascade or lifecycle meaning", () => {
    const m = sqlCode(MIGRATION);
    // Assert the CAPABILITY, not the word: the honest comments in this
    // migration legitimately SAY "no cascade", so a text blacklist would trip
    // on its own promise. What must not exist is a referential action on the
    // parent FK — the column definition line is the whole surface.
    const decl = m.slice(m.indexOf("add column if not exists parent_file_id"));
    const declLine = decl.split(/\r?\n/)[0];
    expect(declLine).toContain("references public.operational_file (id)");
    expect(declLine).not.toMatch(/on delete|on update/i);
    // No status, stage or billing logic anywhere reads the parent.
    for (const f of [
      "lib/files/status.ts", "lib/files/closure.ts", "lib/files/lifecycle.ts",
      "lib/workflow/projection.ts", "lib/process/applicability.ts",
    ]) {
      expect(code(f), f).not.toContain("parentFileId");
      expect(code(f), f).not.toContain("parent_file_id");
    }
  });

  it("the DB suite proves the refusals live", () => {
    const s = read(SUITE);
    expect(s).toMatch(/cross-tenant parent refused/);
    expect(s).toMatch(/self-parent refused/);
    expect(s).toMatch(/parent cycle refused/);
    expect(s).toMatch(/same-tenant parent accepted/);
  });
});

// ===========================================================================
describe("migration lineage — durable, minimal, and not an import pipeline", () => {
  it("provenance is closed and an import must carry its origin", () => {
    const m = sqlCode(MIGRATION);
    expect(m).toMatch(/check \(provenance in \('PLATFORM_NATIVE', 'MAYA_IMPORT'\)\)/);
    expect(m).toMatch(/provenance <> 'MAYA_IMPORT' or legacy_reference is not null/);
  });

  it("a legacy dossier maps to at most one platform dossier", () => {
    expect(sqlCode(MIGRATION)).toMatch(
      /create unique index if not exists uq_operational_file_legacy_reference[\s\S]{0,160}where legacy_reference is not null/,
    );
  });

  it("MAYA identifiers stay REFERENCES — the platform keeps its own keys", () => {
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/primary key[^;]*legacy_reference/i);
    // Numbering is untouched: no new prefix, no change to the counter.
    expect(m).not.toContain("next_file_number(p_tenant");
    expect(m).not.toContain("file_counter");
  });

  it("THIS migration builds no import pipeline (that is P0.5-C's job)", () => {
    // Pinning "no MAYA staging migration exists anywhere" was a moment-in-time
    // proxy that broke the instant P0.5-C legitimately shipped one. The durable
    // property is about THIS phase's migration: it creates no table at all, so
    // it cannot have built a pipeline.
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/create table/i);
    // No action writes provenance/legacy_reference: only a future import will.
    const actions = code("lib/files/actions.ts");
    expect(actions).not.toContain("provenance:");
    expect(actions).not.toContain("legacy_reference");
  });
});

// ===========================================================================
describe("untouched — the invariants this phase promised not to move", () => {
  it("the dossier type vocabulary is still exactly the four customs-gate values", () => {
    expect(code("lib/files/types.ts")).toContain('export type FileType = "IMP" | "EXP" | "TRP" | "HND";');
    expect(code("lib/files/validate.ts")).toContain('const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];');
    expect(CUSTOMS_LEG_FILE_TYPES).toEqual(["IMP", "EXP"]);
    // The migration asserts it too, at apply time.
    expect(sqlCode(MIGRATION)).toMatch(/dossier type vocabulary was altered/);
  });

  it("the customs-leg call sites still read `type`, not the taxonomy", () => {
    for (const f of ["lib/customs/gates.ts", "lib/transport/gates.ts"]) {
      const s = code(f);
      expect(s, f).toMatch(/fileType !== "IMP" && fileType !== "EXP"/);
    }
    expect(code("lib/files/closure.ts")).toContain('new Set(["IMP", "EXP"])');
  });

  it("numbering behaviour and both overloads are untouched", () => {
    const m = sqlCode(MIGRATION);
    expect(m).not.toMatch(/create or replace function public\.next_file_number/);
    expect(m).toMatch(/a next_file_number overload disappeared/);
    expect(m).toMatch(/numbering behaviour was altered/);
    // The creating action still calls the trusted 3-arg overload.
    const actions = code("lib/files/actions.ts");
    expect(actions).toMatch(/rpc\("next_file_number", \{[\s\S]{0,120}p_actor: admin\.id/);
  });

  it("no state machine, handoff or acceptance semantics changed", () => {
    const m = sqlCode(MIGRATION);
    for (const forbidden of ["process_handoff", "process_instance", "process_step_execution",
                             "business_event", "file_state_transition", "assignment_event"]) {
      expect(m, forbidden).not.toContain(forbidden);
    }
    // The status vocabulary is untouched by this phase.
    expect(m).not.toMatch(/operational_file_status_check[^;]*check \(/);
  });

  it("no permission, role or RLS policy was added or changed", () => {
    const m = sqlCode(MIGRATION);
    for (const forbidden of ["create policy", "drop policy", "alter policy",
                             "insert into public.permission", "insert into public.role",
                             "role_permission", "enable row level security", "grant "]) {
      expect(m.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("the migration proves its own outcome at apply time", () => {
    const m = sqlCode(MIGRATION);
    expect(m).toMatch(/columns missing/);
    expect(m).toMatch(/must stay nullable/);
    expect(m).toMatch(/parent integrity trigger missing/);
  });
});

// ===========================================================================
describe("housekeeping", () => {
  it("this migration ships and is counted", () => {
    // LATEST_MIGRATION legitimately moves on with every later phase, so pinning
    // it here was a proxy. What must stay true is that THIS migration is on
    // disk and inside the count build-info reports.
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(migrations).toContain("20260822000001_dossier_fact_convergence.sql");
    expect(read("lib/platform/ops/build-info.ts")).toContain(`MIGRATION_COUNT = ${migrations.length}`);
  });

  it("the DB suite is wired into CI", () => {
    expect(read(".github/workflows/ci.yml")).toContain("-f supabase/tests/maya_p05b_dossier_convergence_test.sql");
  });

  it("the DB suite proves backward compatibility of the existing write shape", () => {
    const s = read(SUITE);
    expect(s).toMatch(/legacy-shaped insert still succeeds/);
    expect(s).toMatch(/legacy-shaped shipment insert still succeeds/);
    expect(s).toMatch(/provenance defaults to PLATFORM_NATIVE/);
    expect(s).toMatch(/numbering format unchanged/);
  });
});
