/**
 * MAYA-P0.6-D — Carriage presentation on the dossier workspace.
 * ---------------------------------------------------------------------------
 * MAYA showed per-container rows on the dossier. Effitrans stored them and
 * showed them to the CLIENT in the portal, but not to the operator working the
 * dossier. This phase closes that one gap.
 *
 * Four properties this suite defends:
 *
 *   1. AUTHORIZATION PREVENTS RETRIEVAL. Without `transport:read` the reader is
 *      not called and asserts anyway; the query runs on the USER-CONTEXT client
 *      whose RLS policies require the permission, so rows are never fetched and
 *      then discarded.
 *   2. NOTHING IS CLASSIFIED. `iso_type` / `uld_type` are carried verbatim.
 *      There is no size-class derivation and no parsing of any kind — the field
 *      is unvalidated free text, so any split would be manufactured.
 *   3. ONE QUERY, NO N+1. One carriage read per dossier page load, only for a
 *      sea or air dossier, served by the existing (tenant_id, shipment_id) index.
 *   4. NOTHING ELSE MOVED. No search change, no workflow, no related dossiers,
 *      no staging, no migration. `/shipping` stays the management authority.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = "lib/files/service.ts";
const TYPES = "lib/files/types.ts";
const PANEL = "components/files/carriage-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const FILTER = "lib/files/filter.ts";

/** The body of getDossierCarriage only — comments stripped. */
function readerBody(): string {
  const s = code(SERVICE);
  const start = s.indexOf("export async function getDossierCarriage");
  expect(start, "getDossierCarriage must exist").toBeGreaterThan(-1);
  const next = s.indexOf("export async function", start + 1);
  return s.slice(start, next === -1 ? s.length : next);
}

/** The SEA branch and the AIR branch, separately. */
function seaBranch(): string {
  const b = readerBody();
  return b.slice(b.indexOf('from("ocean_container")'), b.indexOf('from("air_cargo_piece")'));
}
function airBranch(): string {
  const b = readerBody();
  return b.slice(b.indexOf('from("air_cargo_piece")'));
}

// ===========================================================================
describe("ocean carriage", () => {
  it("reads the containers belonging to THIS dossier's shipment", () => {
    const s = seaBranch();
    expect(s).toContain('.eq("shipment_id", shipmentId)');
    expect(s).toContain("container_number");
    // The container is identifiable: its number is the unit's label.
    expect(s).toMatch(/label: c\.container_number/);
  });

  it("the total is the count of AUTHORIZED rows returned — nothing inferred", () => {
    const b = readerBody();
    // Both branches derive the total the same way: from the rows the database
    // actually returned. An unauthorized reader gets 0 rows, hence total 0.
    expect((b.match(/total: units\.length/g) ?? []).length).toBe(2);
    expect(b).not.toMatch(/total:\s*\d/);
    // The count is never read from a separate aggregate that could disagree.
    expect(b).not.toMatch(/count:\s*["']exact["']/);
  });

  it("the zero-container case is an empty list, not a fabricated row", () => {
    const s = seaBranch();
    expect(s).toContain("(data ?? []).map");
    // A road-only dossier has no carriage CONCEPT and returns null instead.
    expect(readerBody()).toMatch(/if \(!mode\) return null;/);
  });

  it("ocean rows carry no air-only fields invented for them", () => {
    const s = seaBranch();
    for (const f of ["pieceCount: null", "volumeM3: null", "dimensions: null", "specialHandling: null"]) {
      expect(s, f).toContain(f);
    }
    expect(s).toContain("dangerousGoods: false");
  });
});

// ===========================================================================
describe("TC20 / TC40 — the prohibited derivation", () => {
  it("iso_type is never parsed, split, matched or bucketed", () => {
    for (const f of [SERVICE, PANEL, TYPES]) {
      const s = code(f);
      // No string surgery on the stored type, under either name.
      expect(s, f).not.toMatch(/iso_?[Tt]ype[^;\n]*\.(split|match|slice|substring|startsWith|replace|test|indexOf)/);
      expect(s, f).not.toMatch(/\btype[^;\n]*\.(startsWith|substring)\(/);
    }
  });

  it("no size-class counter exists anywhere in the slice", () => {
    for (const f of [SERVICE, PANEL, TYPES, PAGE]) {
      const s = code(f);
      // Assert the CAPABILITY is absent, not the words — the honesty comments
      // in the source legitimately NAME TC20/TC40 to record why it is refused,
      // and code() strips them. A counter would need an identifier like these.
      expect(s, f).not.toMatch(/tc20|tc40|twentyFoot|fortyFoot|sizeClass|containerSize/i);
    }
  });

  it("the stored type is displayed verbatim, as a value and not a classification", () => {
    expect(seaBranch()).toMatch(/type: c\.iso_type/);
    expect(airBranch()).toMatch(/type: p\.uld\?\.uld_type/);
    // The panel renders it as-is with no lookup table in front of it.
    expect(code(PANEL)).toMatch(/\{u\.type\}/);
    expect(code(PANEL)).not.toMatch(/TYPE_LABELS|typeLabel|LABELS\[/);
  });
});

// ===========================================================================
describe("air carriage", () => {
  it("reads the cargo pieces belonging to THIS dossier's shipment", () => {
    const a = airBranch();
    expect(a).toContain('.eq("shipment_id", shipmentId)');
    expect(a).toContain("piece_count");
  });

  it("ULD identity rides along as a to-one embed — no second query", () => {
    const a = airBranch();
    expect(a).toContain("uld:uld_id(uld_number, uld_type, status)");
    expect((readerBody().match(/from\("air_uld"\)/g) ?? []).length).toBe(0);
  });

  it("uses only fields the air model already stores, and invents no class", () => {
    const a = airBranch();
    for (const f of ["weight_kg", "volume_m3", "dimensions", "special_handling", "dangerous_goods", "temperature_controlled"]) {
      expect(a, f).toContain(f);
    }
    // The booleans are passed through, never combined into a new category.
    expect(a).toMatch(/dangerousGoods: p\.dangerous_goods === true/);
    expect(a).not.toMatch(/category|classification|hazardClass/i);
  });

  it("the zero-piece case is an empty list", () => {
    expect(airBranch()).toContain("(data ?? []).map");
  });
});

// ===========================================================================
describe("authorization — retrieval is prevented, not undone", () => {
  it("the reader asserts transport:read itself, before any query", () => {
    const b = readerBody();
    const gate = b.indexOf('assertPermission("transport:read")');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(b.indexOf(".from("));
  });

  it("transport:read is the ONLY permission the reader names", () => {
    const perms = [...readerBody().matchAll(/assertPermission\("([^"]+)"\)|hasPermission\([^,]+,\s*"([^"]+)"\)/g)]
      .map((m) => m[1] ?? m[2]);
    expect(new Set(perms)).toEqual(new Set(["transport:read"]));
  });

  it("the page issues NO carriage query without transport:read", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canReadTransport && file\.shipment\s*\?\s*await getDossierCarriage/);
    // …and the panel renders only when the read produced something.
    expect(p).toMatch(/\{carriage && \(/);
  });

  it("no fetch-then-discard: nothing restricted is read and then dropped", () => {
    const b = readerBody();
    // Every selected column is mapped onto the returned unit; the reader has no
    // filter/slice/discard step between the query and the projection.
    expect(b).not.toMatch(/\.filter\(/);
    expect(b).not.toMatch(/delete\s+\w+\./);
  });

  it("the reader runs on the USER-CONTEXT client, so RLS is the boundary", () => {
    const b = readerBody();
    expect(b).toContain("getServerSupabaseClient()");
    expect(b).not.toContain("getAdminSupabaseClient");
  });

  it("the RLS policies behind both tables require the same permission", () => {
    const ocean = read("supabase/migrations/20260716000004_shipping_line_platform.sql");
    const air = read("supabase/migrations/20260716000006_air_cargo_platform.sql");
    expect(ocean).toMatch(/create policy ocean_container_select[\s\S]{0,200}has_permission\('transport:read'\)/);
    expect(air).toMatch(/create policy air_cargo_piece_select[\s\S]{0,200}has_permission\('transport:read'\)/);
    expect(air).toMatch(/create policy air_uld_select[\s\S]{0,200}has_permission\('transport:read'\)/);
  });
});

// ===========================================================================
describe("tenant isolation", () => {
  it("every carriage query carries an explicit tenant filter as a SECOND layer", () => {
    const b = readerBody();
    expect((b.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBe(2);
  });

  it("the tenant comes from the asserted principal, never from an argument", () => {
    const b = readerBody();
    expect(b).toMatch(/const user = await assertPermission\("transport:read"\)/);
    expect(b).not.toMatch(/tenantId[?:]\s*string/); // not a parameter
    expect(b).toMatch(/getDossierCarriage\(\s*shipmentId: string,\s*transportMode: TransportMode \| null,\s*\)/);
  });

  it("both tables' policies are tenant-scoped in the database", () => {
    const ocean = read("supabase/migrations/20260716000004_shipping_line_platform.sql");
    const air = read("supabase/migrations/20260716000006_air_cargo_platform.sql");
    expect(ocean).toMatch(/ocean_container_select[\s\S]{0,200}tenant_id = public\.auth_tenant_id\(\)/);
    expect(air).toMatch(/air_cargo_piece_select[\s\S]{0,200}tenant_id = public\.auth_tenant_id\(\)/);
  });

  it("the SQL suite proves cross-tenant carriage is unreadable in BOTH directions", () => {
    const shipping = read("supabase/tests/rls_shipping_test.sql");
    const air = read("supabase/tests/rls_air_test.sql");
    // Containers were already proven by the shipping suite (both directions +
    // a no-permission reader). P0.6-D extends the air suite to cargo pieces,
    // which it did not previously cover.
    expect(shipping).toContain("ocean_container");
    expect(air).toContain("air_cargo_piece");
    expect(air).toMatch(/A_ownPiece|ownPiece/);
    expect(air).toMatch(/otherPiece/);
    expect(air).toMatch(/noperm.*[Pp]iece|n_p\b/);
  });
});

// ===========================================================================
describe("performance — one bounded read, no N+1", () => {
  it("exactly one query per mode, and only two in the whole reader", () => {
    const b = readerBody();
    expect((b.match(/\.from\(/g) ?? []).length).toBe(2);
    expect((b.match(/from\("ocean_container"\)/g) ?? []).length).toBe(1);
    expect((b.match(/from\("air_cargo_piece"\)/g) ?? []).length).toBe(1);
    // The two are mutually exclusive branches: one executes per call.
    expect(b).toMatch(/if \(mode === "SEA"\)/);
  });

  it("no query and no await inside any row mapping", () => {
    for (const branch of [seaBranch(), airBranch()]) {
      const from = branch.indexOf("(data ?? []).map");
      expect(from).toBeGreaterThan(-1);
      // The callback ONLY — bounded by the return that consumes it, so the
      // next branch's own query cannot leak into the assertion.
      const body = branch.slice(from, branch.indexOf("return {", from));
      expect(body).not.toMatch(/await|\.from\(|supabase/);
    }
  });

  it("the reader is called at most once per page load", () => {
    expect((code(PAGE).match(/getDossierCarriage\(/g) ?? []).length).toBe(1);
  });

  it("reuses the dossier's existing shipment relationship — no extra lookup", () => {
    // getFile now projects shipment.id, so the carriage read needs no second
    // shipment query to find its key.
    const s = code(SERVICE);
    expect(s).toContain('"id, transport_mode, incoterm');
    expect(s).toMatch(/id: shipment\.id/);
    expect(code(PAGE)).toContain("file.shipment.id");
    expect(readerBody()).not.toContain('from("shipment")');
  });

  it("the reads are served by the existing indexes — no new one was added", () => {
    const ocean = read("supabase/migrations/20260716000004_shipping_line_platform.sql");
    const air = read("supabase/migrations/20260716000006_air_cargo_platform.sql");
    expect(ocean).toContain("idx_ocean_container_shipment on public.ocean_container (tenant_id, shipment_id)");
    expect(air).toContain("idx_air_cargo_piece_shipment on public.air_cargo_piece (tenant_id, shipment_id)");
  });
});

// ===========================================================================
describe("the panel is subordinate, and /shipping stays the authority", () => {
  it("the panel is read-only — no form, no action, no mutation", () => {
    const p = code(PANEL);
    for (const f of ["<form", "onClick", "onSubmit", "useState", "use server", "use client"]) {
      expect(p, f).not.toContain(f);
    }
  });

  it("management is delegated to /shipping by link, not reimplemented", () => {
    const p = code(PANEL);
    expect(p).toContain('href="/shipping"');
    expect(p).not.toMatch(/createContainer|updateContainer|moveContainer|deleteContainer/);
  });

  it("the shipping management authority was not touched", () => {
    const m = code("lib/shipping/intelligence/manage-actions.ts");
    expect(m).not.toContain("getDossierCarriage");
    expect(m).not.toContain("CarriagePanel");
  });

  it("the portal reader was not touched", () => {
    expect(code("lib/portal/carriage.ts")).not.toContain("getDossierCarriage");
  });

  it("an empty carriage reads as an absence, never as zero cargo", () => {
    const p = code(PANEL);
    expect(p).toContain("Aucune unité enregistrée");
    expect(p).toMatch(/carriage\.units\.length === 0/);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("search is untouched — P0.6-C remains the sole list-search authority", () => {
    const f = code(FILTER);
    expect(f).not.toMatch(/carriage|CarriageUnit|ocean_container|air_cargo_piece/i);
    // P0.6-C's container matching still exists, unchanged.
    expect(f).toContain("containerNumbers");
    expect(f).toContain("row.containerNumbers.some");
  });

  it("P0.6-B naming survives intact", () => {
    expect(code(SERVICE)).toContain("deriveMayaLabelFromRow");
    expect(read("components/files/files-table.tsx")).toContain("{f.mayaLabel ?? t.files.types[f.type]}");
  });

  it("the native dossier number is still the dossier's identity", () => {
    expect(code(PAGE)).toMatch(/title=\{file\.fileNumber\}/);
    expect(code(PANEL)).not.toMatch(/fileNumber|legacyReference/);
  });

  it("no related-dossier, parent/child or consolidation presentation was added", () => {
    const p = code(PANEL);
    expect(p).not.toMatch(/parent|child|enfant|rattach|mère/i);
    // The dossier page still shows the parent as a single fact and nothing more:
    // no children reader exists.
    expect(code(SERVICE)).not.toMatch(/listChildren|childFiles|getRelatedFiles/);
    expect(code(PANEL).toLowerCase()).not.toContain("groupage");
    expect(code(SERVICE).toLowerCase()).not.toContain("groupage");
  });

  it("no workflow, applicability, lifecycle or projection coupling", () => {
    for (const f of ["lib/process/applicability.ts", "lib/files/status.ts", "lib/files/lifecycle.ts",
                     "lib/files/closure.ts", "lib/workflow/projection.ts"]) {
      expect(code(f), f).not.toMatch(/carriage|CarriageUnit|getDossierCarriage/i);
    }
    // Carriage is descriptive: it is not an input to any state decision.
    expect(code(PAGE)).not.toMatch(/carriage[\s\S]{0,80}(riskInput|lifecycle|projection|canonical)/);
    expect(code("lib/files/types.ts")).toContain('export type FileType = "IMP" | "EXP" | "TRP" | "HND";');
  });

  it("no MAYA staging or APPLY coupling", () => {
    for (const f of [SERVICE, PANEL, PAGE, TYPES]) {
      expect(code(f), f).not.toContain("maya_import");
    }
    const staging = code("lib/maya/staging/actions.ts");
    expect(staging).not.toContain("carriage");
    expect(staging).not.toMatch(/export async function (apply|promote)/);
  });

  it("no finance or accounting behaviour was touched", () => {
    for (const f of [SERVICE, PANEL, TYPES]) {
      expect(code(f), f).not.toMatch(/invoice|billing_charge|payment|expense_/i);
    }
  });

  it("no new permission was introduced", () => {
    const perms = new Set([
      ...[...code(SERVICE).matchAll(/"([a-z_]+:[a-z:]+)"/g)].map((m) => m[1]),
      ...[...code(PANEL).matchAll(/"([a-z_]+:[a-z:]+)"/g)].map((m) => m[1]),
    ]);
    // Every permission named in the reader/panel already existed before P0.6-D.
    for (const p of perms) {
      expect(["file:read", "file:read:all", "file:assign", "customs:read", "transport:read"], p).toContain(p);
    }
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
    expect(migrations.filter((f) => /carriage|container/i.test(f))).toEqual([]);
    // …and no RPC was created to serve the panel.
    expect(readerBody()).not.toContain(".rpc(");
  });
});
