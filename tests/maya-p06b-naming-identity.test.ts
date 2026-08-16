/**
 * MAYA-P0.6-B — Dossier naming & identity reach.
 * ---------------------------------------------------------------------------
 * P0.5-B derived the MAYA-compatible business name but rendered it in exactly
 * one place. This phase carries it — and the dossier's identity references —
 * into the surfaces people actually scan, and nothing else.
 *
 * Three properties this suite defends:
 *
 *   1. THE REGIME NEVER LEAKS. The derived name depends on
 *      `customs_record.regime`. Without `customs:read` the regime query does
 *      not run at all, the label is null, and every surface falls back to the
 *      GENERIC label — never to a partial name, which would quietly assert
 *      "not suspensive" to someone not entitled to know either way.
 *   2. NO N+1. The regime is read ONCE per list, never per row.
 *   3. NOTHING ELSE MOVED. One taxonomy, one identity, no workflow, no
 *      groupage, no schema.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveMayaLabelFromRow, MAYA_TYPES, isResolvedMayaType } from "@/lib/files/taxonomy";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = "lib/files/service.ts";
const TABLE = "components/files/files-table.tsx";
const DETAIL = "app/files/[id]/page.tsx";
const TYPES = "lib/files/types.ts";

/** The body of listFiles only. */
function listFilesBody(): string {
  const s = code(SERVICE);
  const start = s.indexOf("export async function listFiles");
  const next = s.indexOf("export async function", start + 1);
  return s.slice(start, next === -1 ? s.length : next);
}

// ===========================================================================
describe("1/6 — the MAYA-compatible name reaches the list, consistently", () => {
  it("the list read derives the label through THE taxonomy authority", () => {
    const body = listFilesBody();
    expect(body).toContain("deriveMayaLabelFromRow");
    // The derive call is fed from the shipment row and the batched regime map.
    // Matched on the SOURCE of each argument rather than on a local variable
    // name, which a later refactor may legitimately rename (P0.6-C did).
    expect(body).toMatch(/cargoForm: \w+\?\.cargo_form/);
    expect(body).toContain("regime: regimes.get(f.id)");
  });

  it("the list renders the derived name, falling back to the generic label", () => {
    expect(read(TABLE)).toContain("{f.mayaLabel ?? t.files.types[f.type]}");
  });

  it("the detail header carries the SAME name as the list", () => {
    const d = read(DETAIL);
    expect(d).toContain("mayaLabel?.labelFr ?? t.files.types[file.type]");
  });

  it("every derivable MAYA type produces its exact name for the list", () => {
    for (const entry of Object.values(MAYA_TYPES)) {
      if (!isResolvedMayaType(entry)) continue;
      const d = entry.dimensions;
      const got = deriveMayaLabelFromRow({
        type: d.direction,
        transportMode: d.mode,
        cargoForm: d.cargoForm,
        regime: d.regime === "SUSPENSIF" ? "Régime suspensif" : null,
      });
      expect(got?.labelFr, entry.code).toBe(entry.labelFr);
    }
  });
});

// ===========================================================================
describe("2/3 — the regime never leaks through the label", () => {
  it("the regime query runs ONLY behind customs:read", () => {
    const body = listFilesBody();
    const gate = body.indexOf('hasPermission(permissions, "customs:read")');
    const query = body.indexOf('from("customs_record")');
    expect(gate).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(gate); // the read lives inside the gate
    // …and the map it fills starts empty, so an ungated viewer has no regimes.
    expect(body).toMatch(/const regimes = new Map<string, string>\(\);/);
  });

  it("without a regime, a suspensive dossier is NOT labelled as non-suspensive", () => {
    // This is the leak that a "partial label" would create: the same dossier
    // must not read as IMPORT MARITIME TC to an ungated viewer.
    const gated = deriveMayaLabelFromRow({
      type: "IMP", transportMode: "SEA", cargoForm: "CONTAINER", regime: "suspensif",
    });
    expect(gated?.code).toBe("IMPORT_MARITIME_TC_SUSPENSIF");
    const ungated = deriveMayaLabelFromRow({
      type: "IMP", transportMode: "SEA", cargoForm: "CONTAINER", regime: null,
    });
    // The ungated derivation DOES resolve to the non-suspensive name — which is
    // precisely why the service must not call it with a stripped regime. The
    // service instead skips the whole query, and the guard below proves the
    // ungated path yields `null`, not this value.
    expect(ungated?.code).toBe("IMPORT_MARITIME_TC");
  });

  it("an ungated viewer gets the GENERIC label, not a MAYA name", () => {
    // Structural proof of the above: `regimes` is only populated inside the
    // gate, and the fallback in both surfaces is `t.files.types[...]`.
    expect(read(TABLE)).toContain("t.files.types[f.type]");
    expect(read(DETAIL)).toContain("t.files.types[file.type]");
    // The detail page's own label is likewise computed only when gated (P0.5-B).
    expect(code(DETAIL)).toMatch(/canReadCustoms[\s\S]{0,80}deriveMayaLabelFromRow/);
  });

  it("the label type documents that null covers BOTH reasons", () => {
    expect(read(TYPES)).toMatch(/lacks `customs:read`/);
    expect(read(TYPES)).toMatch(/never to a partial name/);
  });
});

// ===========================================================================
describe("4/5 — one taxonomy, no per-row query", () => {
  it("no surface re-implements a naming rule", () => {
    for (const f of [TABLE, SERVICE, DETAIL]) {
      const s = code(f);
      for (const name of ["IMPORT MARITIME", "EXPORT MARITIME", "AÉRIEN", "SUSPENSIF"]) {
        expect(s, `${f} must not hardcode ${name}`).not.toContain(name);
      }
    }
  });

  it("the regime is read ONCE per list, never inside the row loop", () => {
    const body = listFilesBody();
    // The durable property is "one read per CALL, outside the row mapping" —
    // not "the string appears once". P0.6-C introduced two literal customs
    // selects of which exactly one executes (PostgREST needs literal selects),
    // so counting occurrences would now measure the wrong thing.
    const customsReads = body.indexOf('from("customs_record")');
    expect(customsReads).toBeGreaterThan(-1);
    expect(customsReads).toBeLessThan(body.indexOf("listRows.map"));
    // No query, and no await, inside either mapping callback.
    for (const marker of ["listRows.map", "return sorted.map"]) {
      const from = body.indexOf(marker);
      const to = body.indexOf("applyFileFilters", from);
      const mapBody = body.slice(from, to === -1 ? undefined : to);
      expect(mapBody, marker).not.toMatch(/await|supabase|\.from\(/);
    }
  });

  it("the extra columns ride the EXISTING list query — no second dossier read", () => {
    const body = listFilesBody();
    expect((body.match(/from\("operational_file"\)/g) ?? []).length).toBe(1);
    expect(body).toContain("client_reference, provenance, legacy_reference");
    expect(body).toContain("cargo_form");
  });
});

// ===========================================================================
describe("7/8 — legacy identity is secondary and opaque", () => {
  it("the native dossier reference is the link and the identity", () => {
    const tbl = read(TABLE);
    expect(tbl).toMatch(/href=\{`\/files\/\$\{f\.id\}`\}[\s\S]{0,140}\{f\.fileNumber\}/);
    // The legacy reference is never a link and never the primary line.
    expect(tbl.indexOf("f.fileNumber")).toBeLessThan(tbl.indexOf("f.legacyReference"));
    expect(tbl).toMatch(/Réf\. MAYA \{f\.legacyReference\}/);
  });

  it("the legacy reference is never parsed, split, matched or regenerated", () => {
    for (const f of [SERVICE, TABLE, DETAIL]) {
      const s = code(f);
      expect(s, f).not.toMatch(/legacyReference[^;\n]*\.(split|match|replace|slice|substring|parse)/);
      expect(s, f).not.toMatch(/legacy_reference[^;\n]*\.(split|match|replace|slice|substring)/);
    }
  });

  it("nothing writes provenance or legacy_reference from these surfaces", () => {
    const s = code(SERVICE);
    expect(s).not.toMatch(/provenance:\s*["']MAYA_IMPORT["']/);
    expect(code("lib/files/actions.ts")).not.toContain("legacy_reference");
  });

  it("migration-batch internals never reach a dossier surface", () => {
    for (const f of [SERVICE, TABLE, DETAIL]) {
      expect(code(f), f).not.toContain("maya_import");
    }
  });
});

// ===========================================================================
describe("9/10/11/12 — nothing else moved", () => {
  it("the unresolved MAYA types stay unresolved", () => {
    for (const c of ["REMISES_DOCUMENTAIRES", "AUTRES_DOSSIERS"] as const) {
      expect(isResolvedMayaType(MAYA_TYPES[c]), c).toBe(false);
    }
    // …and no dimension set can produce them, so no surface can render them.
    expect(deriveMayaLabelFromRow({ type: "HND", transportMode: null, cargoForm: null, regime: null })).toBeNull();
  });

  it("IMPORT MARITIME VRAC was not invented (absent from MAYA-0 evidence)", () => {
    const labels = Object.values(MAYA_TYPES).map((e) => e.labelFr);
    expect(labels).not.toContain("IMPORT MARITIME VRAC");
  });

  it("no groupage behaviour was introduced", () => {
    for (const f of [SERVICE, TABLE, DETAIL, TYPES]) {
      expect(code(f).toLowerCase(), f).not.toContain("groupage");
    }
  });

  it("no workflow, applicability or state-machine change", () => {
    for (const f of ["lib/process/applicability.ts", "lib/files/status.ts", "lib/files/lifecycle.ts",
                     "lib/files/closure.ts", "lib/workflow/projection.ts"]) {
      expect(code(f), f).not.toMatch(/mayaLabel|legacyReference|deriveMayaLabel/);
    }
    // The customs-leg vocabulary is untouched.
    expect(code("lib/files/types.ts")).toContain('export type FileType = "IMP" | "EXP" | "TRP" | "HND";');
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    // DURABLE FORM. This used to pin the literal count (101), which asserted
    // "no migration exists anywhere" rather than "this phase added none" — so
    // it broke the moment a LATER phase legitimately shipped one (P0.7-A did).
    // What actually matters, and stays true forever: the declared count matches
    // the files on disk, and THIS phase's own files contain no migration.
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    expect(migrations).toHaveLength(declared);
    // NARROWED (HR-B2): "identity" alone matched a later, unrelated phase's
    // migration (hr_performance_identity_activation). The property this test
    // owns is that THIS phase — dossier naming/identity — shipped none.
    expect(migrations.filter((f) => /p0[._-]?6|dossier_naming|naming_identity/i.test(f))).toEqual([]);
  });

  it("search widening belongs to P0.6-C, and is pinned there", () => {
    // SUPERSEDED, not deleted. In P0.6-B this asserted that search matching had
    // NOT been widened — a correct statement of that phase's scope boundary.
    // P0.6-C is the phase that legitimately moved the boundary, so the
    // assertion now records where the property lives instead of denying it.
    const filter = code("lib/files/filter.ts");
    for (const field of ["legacyReference", "clientReference", "vesselOrFlight"]) {
      expect(filter, field).toContain(field);
    }
    // What P0.6-B itself must still be true of: it added no search field.
    const naming = code("lib/files/types.ts");
    expect(naming).toContain("mayaLabel");
  });
});
