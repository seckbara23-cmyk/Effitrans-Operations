/**
 * MAYA-P0.6-C — Search & retrieval reach.
 * ---------------------------------------------------------------------------
 * Staff should find a dossier by whatever identifier is in front of them. This
 * phase widens the ONE existing search pipeline (`FileSearchRow` +
 * `matchesSearch`) and adds no engine, no index, no schema.
 *
 * Three properties defended here:
 *
 *   1. RESTRICTED VALUES ARE ABSENT, NOT HIDDEN. `declarationNumber` is null
 *      for a viewer without `customs:read` because the reader NEVER FETCHED
 *      it — not because a filter dropped it afterwards. So it cannot match,
 *      cannot change a result count, and cannot be recovered from ordering.
 *   2. LEGACY REFERENCES ARE OPAQUE. Matched as text; never parsed, split or
 *      normalised to infer type/year/sequence — Q125 proved incompatible
 *      shapes coexist, so any parsing rule would be wrong for some of them.
 *   3. NO N+1. Child lookups (customs, containers) are batched once per call.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { matchesSearch, applyFileFilters, type FileSearchRow } from "@/lib/files/filter";
import { MAYA_TYPES, isResolvedMayaType } from "@/lib/files/taxonomy";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = "lib/files/service.ts";
const FILTER = "lib/files/filter.ts";

function listFilesBody(): string {
  const s = code(SERVICE);
  const start = s.indexOf("export async function listFiles");
  const next = s.indexOf("export async function", start + 1);
  return s.slice(start, next === -1 ? s.length : next);
}

const row = (over: Partial<FileSearchRow> = {}): FileSearchRow => ({
  id: "f1",
  fileNumber: "EFT-IMP-2026-00042",
  type: "IMP",
  status: "OPENED",
  priority: "normal",
  createdAt: "2026-01-01T00:00:00Z",
  accountManagerId: null,
  clientId: "c1",
  clientName: "Dakar Trading",
  origin: "Shanghai",
  destination: "Dakar",
  blAwbRef: "BL-4471",
  containerRef: "TESU1234567",
  transportMode: "SEA",
  eta: null,
  legacyReference: null,
  clientReference: null,
  vesselOrFlight: null,
  containerNumbers: [],
  declarationNumber: null,
  mayaLabel: null,
  ...over,
});

// ===========================================================================
describe("1–7 — the identifiers staff actually have", () => {
  it("1 — native dossier number still searches", () => {
    expect(matchesSearch(row(), "EFT-IMP-2026-00042")).toBe(true);
    expect(matchesSearch(row(), "00042")).toBe(true);
  });

  it("2 — MAYA legacy reference searches, in every historical shape", () => {
    // Q125 §11.3: at least three shapes, two coexisting in 2026. All opaque.
    for (const ref of ["EMV/2026/0039", "IMT2026/0250", "TR012062", "12-105"]) {
      expect(matchesSearch(row({ legacyReference: ref }), ref), ref).toBe(true);
      // partial, as substring search already behaves elsewhere
      expect(matchesSearch(row({ legacyReference: ref }), ref.slice(2, 6)), ref).toBe(true);
    }
  });

  it("3 — client reference searches", () => {
    expect(matchesSearch(row({ clientReference: "PO-99812" }), "99812")).toBe(true);
  });

  it("4 — client name still searches", () => {
    expect(matchesSearch(row(), "dakar trading")).toBe(true);
  });

  it("5 — vessel / flight searches", () => {
    expect(matchesSearch(row({ vesselOrFlight: "MV ATLANTIC STAR" }), "atlantic")).toBe(true);
    expect(matchesSearch(row({ vesselOrFlight: "AF718" }), "af718")).toBe(true);
  });

  it("6 — BL and LTA both search, without shared formatting assumptions", () => {
    expect(matchesSearch(row({ blAwbRef: "MAEU-577301" }), "577301")).toBe(true);
    expect(matchesSearch(row({ blAwbRef: "057-12345678" }), "057-1234")).toBe(true);
  });

  it("7 — container searches, from the dossier field AND the child rows", () => {
    expect(matchesSearch(row({ containerRef: "TESU1234567" }), "tesu1234567")).toBe(true);
    expect(matchesSearch(row({ containerRef: null, containerNumbers: ["MSKU7654321", "TGHU1112223"] }), "msku765")).toBe(true);
    expect(matchesSearch(row({ containerRef: null, containerNumbers: [] }), "msku765")).toBe(false);
  });
});

// ===========================================================================
describe("8/9/11 — customs-sensitive retrieval is gated at the query", () => {
  it("8 — a declaration number matches when the reader supplied it", () => {
    expect(matchesSearch(row({ declarationNumber: "IM4-2026-88123" }), "88123")).toBe(true);
  });

  it("9 — declaration data is not queried without customs:read", () => {
    const body = listFilesBody();
    const gate = body.indexOf("if (canReadCustoms)");
    const decl = body.indexOf("declaration_number");
    expect(gate).toBeGreaterThan(-1);
    expect(decl).toBeGreaterThan(gate); // the column is only named inside the gate
    // …and only when a search is actually running: no fetch-then-discard.
    expect(body).toMatch(/searching[\s\S]{0,140}declaration_number/);
    // The map starts empty, so an ungated viewer has no declarations at all.
    expect(body).toMatch(/const declarations = new Map<string, string>\(\);/);
  });

  it("9b — an ungated row cannot match a declaration, and its result set is unchanged", () => {
    const ungated = row({ declarationNumber: null });
    expect(matchesSearch(ungated, "88123")).toBe(false);
    // Result COUNT is identical to the pre-phase behaviour for the same term.
    const rows = [ungated, row({ id: "f2", declarationNumber: null })];
    expect(applyFileFilters(rows, { search: "88123" }, new Date())).toHaveLength(0);
  });

  it("11 — the restricted regime cannot leak through search or results", () => {
    const body = listFilesBody();
    // The regime is used ONLY to derive the name. Its single use site is the
    // argument to deriveMayaLabelFromRow — it is never a row field, so it
    // cannot be matched against or returned.
    const uses = [...body.matchAll(/regimes\.get\(/g)];
    expect(uses).toHaveLength(1);
    expect(body).toMatch(/deriveMayaLabelFromRow\(\{[\s\S]{0,200}regime: regimes\.get\(f\.id\)/);
    // The searchable projection has no regime field at all.
    expect(code(FILTER)).not.toContain("regime");
    // The returned list item carries no regime and no declaration.
    const returned = body.slice(body.indexOf("return sorted.map"));
    expect(returned).not.toContain("declarationNumber");
    expect(returned).not.toContain("regime");
  });
});

// ===========================================================================
describe("10/12 — taxonomy is reused, unresolved stays unresolved", () => {
  it("10 — MAYA-name matching uses the derived label, duplicating no rule", () => {
    for (const entry of Object.values(MAYA_TYPES)) {
      if (!isResolvedMayaType(entry)) continue;
      expect(matchesSearch(row({ mayaLabel: entry.labelFr }), entry.labelFr), entry.code).toBe(true);
    }
    // No surface hardcodes a MAYA name.
    for (const f of [FILTER, SERVICE]) {
      expect(code(f), f).not.toContain("IMPORT MARITIME");
      expect(code(f), f).not.toContain("EXPORT MARITIME");
    }
    expect(listFilesBody()).toContain("deriveMayaLabelFromRow");
  });

  it("10b — the label is derived BEFORE filtering, so it is searchable", () => {
    const body = listFilesBody();
    expect(body.indexOf("deriveMayaLabelFromRow")).toBeLessThan(body.indexOf("applyFileFilters"));
  });

  it("12 — unresolved MAYA types remain unresolved and unsearchable as types", () => {
    for (const c of ["REMISES_DOCUMENTAIRES", "AUTRES_DOSSIERS"] as const) {
      expect(isResolvedMayaType(MAYA_TYPES[c]), c).toBe(false);
    }
    // Their names can never be a derived label, so they can never match as one.
    expect(matchesSearch(row({ mayaLabel: null }), "REMISES DOCUMENTAIRES")).toBe(false);
    for (const f of [FILTER, SERVICE]) {
      expect(code(f).toLowerCase(), f).not.toContain("groupage");
    }
  });
});

// ===========================================================================
describe("2b/13/15/16 — opacity, isolation, batching, identity", () => {
  it("2b — the legacy reference is never parsed, split or normalised", () => {
    for (const f of [FILTER, SERVICE]) {
      const s = code(f);
      expect(s, f).not.toMatch(/legacyReference[^;\n]*\.(split|match|replace|slice|substring|parse)/);
      expect(s, f).not.toMatch(/legacy_reference[^;\n]*\.(split|match|replace|slice|substring)/);
    }
  });

  it("13 — every added read is tenant-scoped", () => {
    const body = listFilesBody();
    const reads = [...body.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(["operational_file", "customs_record", "ocean_container"]));
    // One tenant filter per read (the dossier read already had one).
    expect((body.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("15 — no N+1: child lookups are batched once, outside the row mapping", () => {
    const body = listFilesBody();
    expect((body.match(/from\("customs_record"\)/g) ?? []).length).toBe(2); // two literal branches, one executed
    expect((body.match(/from\("ocean_container"\)/g) ?? []).length).toBe(1);
    const mapStart = body.indexOf("listRows.map");
    expect(body.indexOf('from("ocean_container")')).toBeLessThan(mapStart);
    const mapBody = body.slice(mapStart, body.indexOf("applyFileFilters"));
    expect(mapBody).not.toMatch(/await|\.from\(|supabase/);
  });

  it("14 — pagination/limit behaviour is preserved", () => {
    expect(listFilesBody()).toContain(".limit(2000)");
  });

  it("16 — the native Effitrans identity remains the result key", () => {
    const returned = listFilesBody().slice(listFilesBody().indexOf("return sorted.map"));
    expect(returned).toContain("id: f.id");
    expect(returned).toContain("fileNumber: f.fileNumber");
    // The legacy reference is carried, but it is not the id.
    expect(returned).not.toMatch(/id:\s*f\.legacyReference/);
  });
});

// ===========================================================================
describe("17/18 — nothing else moved", () => {
  it("17 — no workflow, applicability or state-machine change", () => {
    for (const f of ["lib/process/applicability.ts", "lib/files/status.ts", "lib/files/lifecycle.ts",
                     "lib/files/closure.ts", "lib/workflow/projection.ts"]) {
      expect(code(f), f).not.toMatch(/mayaLabel|declarationNumber|legacyReference/);
    }
    expect(code("lib/files/types.ts")).toContain('export type FileType = "IMP" | "EXP" | "TRP" | "HND";');
  });

  it("18 — no migration was added; current indexes were judged sufficient", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    // DURABLE FORM. This used to pin the literal count (101), which asserted
    // "no migration exists anywhere" rather than "this phase added none" — so
    // it broke the moment a LATER phase legitimately shipped one (P0.7-A did).
    // What actually matters, and stays true forever: the declared count matches
    // the files on disk, and THIS phase's own files contain no migration.
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    expect(migrations).toHaveLength(declared);
    expect(migrations.filter((f) => /search|retrieval/i.test(f))).toEqual([]);
  });

  it("the copilot still reads one dossier through getFile — no second retrieval authority", () => {
    expect(code("lib/copilot/context.ts")).toContain("getFile");
    expect(code("lib/copilot/context.ts")).not.toContain("listFiles");
  });
});
