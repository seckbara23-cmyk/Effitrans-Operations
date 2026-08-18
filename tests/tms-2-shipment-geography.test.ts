/**
 * TMS-2 — shipment ↔ geography structural foundation.
 * ---------------------------------------------------------------------------
 * The break: shipment.origin/destination were free text with no reference to
 * ocean_port / air_airport, so the spine could never identify the geographic
 * entities the tracking planes are keyed on. TMS-2 adds FOUR nullable anchor
 * columns + one tenant-boundary trigger — and rides everything that already
 * existed (reference tables, transport:manage CRUD, studio UI, RLS,
 * buildShipmentMapProjection's endpoint inputs).
 *
 * Scope guard (frozen TMS-0): no vehicle management, maintenance, fuel,
 * telematics, fleet accounting, route optimization, driver payroll, carrier
 * billing; no competing tracking model; portal untouched (TMS-3 question).
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const MIGRATION = "20260907000001_shipment_geography.sql";
const migration = read("supabase", "migrations", MIGRATION);
const migrationCode = migration.replace(/--[^\n]*/g, ""); // comments stripped (MAYA-P1.1 lesson)
const actions = read("lib", "files", "actions.ts");
const service = read("lib", "files", "service.ts");
const dbTypes = read("lib", "db", "types.ts");
const form = read("components", "files", "file-form.tsx");
const oceanService = read("lib", "shipping", "intelligence", "service.ts");
const airService = read("lib", "air", "intelligence", "service.ts");
const ci = read(".github", "workflows", "ci.yml");

const GEO_COLUMNS = [
  "origin_port_id",
  "destination_port_id",
  "origin_airport_id",
  "destination_airport_id",
] as const;

// ========================================================== the migration ====

describe("TMS-2 migration — four nullable anchors, one boundary, nothing else", () => {
  it("adds exactly the four nullable FK columns to shipment, referencing the EXISTING reference tables", () => {
    expect(migrationCode).toContain(
      "add column if not exists origin_port_id         uuid references public.ocean_port (id)",
    );
    expect(migrationCode).toContain(
      "add column if not exists destination_port_id    uuid references public.ocean_port (id)",
    );
    expect(migrationCode).toContain(
      "add column if not exists origin_airport_id      uuid references public.air_airport (id)",
    );
    expect(migrationCode).toContain(
      "add column if not exists destination_airport_id uuid references public.air_airport (id)",
    );
    expect((migrationCode.match(/add column if not exists/g) ?? []).length).toBe(4);
    // the alter statement itself carries no NOT NULL — nothing became mandatory
    const alter = migrationCode.slice(
      migrationCode.indexOf("alter table public.shipment"),
      migrationCode.indexOf("comment on column"),
    );
    expect(alter.toLowerCase()).not.toContain(" not null");
  });

  it("arms the tenant-boundary trigger — the FK alone cannot express it", () => {
    expect(migrationCode).toContain("create or replace function public.enforce_shipment_geo_tenant()");
    expect(migrationCode).toContain("shipment geo tenant mismatch");
    expect(migrationCode).toContain(
      "create trigger trg_shipment_geo_tenant before insert or update on public.shipment",
    );
    // every one of the four anchors is independently checked
    for (const col of GEO_COLUMNS) expect(migrationCode).toContain(`if new.${col} is not null then`);
  });

  it("self-asserts: 4 nullable columns, trigger armed, zero cross-tenant rows, no invented permission", () => {
    expect(migration).toContain("TMS-2 assertion 3a failed");
    expect(migration).toContain("TMS-2 assertion 3b failed");
    expect(migration).toContain("TMS-2 assertion 3c failed");
    expect(migration).toContain("TMS-2 assertion 3d failed");
  });

  it("creates NO table, NO policy, NO permission, NO seed rows — reuse, not a competing model", () => {
    expect(migrationCode).not.toContain("create table");
    expect(migrationCode).not.toContain("create policy");
    expect(migrationCode).not.toContain("insert into public.permission");
    expect(migrationCode).not.toContain("insert into public.role_permission");
    expect(migrationCode).not.toContain("insert into public.ocean_port");
    expect(migrationCode).not.toContain("insert into public.air_airport");
  });

  it("scope guard: no generic-TMS vocabulary anywhere in the executable SQL", () => {
    for (const word of ["vehicle", "fleet", "fuel", "maintenance", "telematic", "route_optim", "payroll"]) {
      expect(migrationCode.toLowerCase()).not.toContain(word);
    }
  });

  it("stable pair: migration 116 follows TMS-1's 115", () => {
    const migrations = fs
      .readdirSync(path.join(root, "supabase", "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const idx = migrations.indexOf("20260906000001_commercial_owner_assignment.sql");
    expect(idx).toBeGreaterThan(-1);
    expect(migrations[idx + 1]).toBe(MIGRATION);
  });
});

// ======================================================= the write path ====

describe("TMS-2 write path — validated before any write, label text preserved", () => {
  it("shipmentRow passes the four anchors through; free-text origin/destination remain", () => {
    const slice = actions.slice(actions.indexOf("function shipmentRow"), actions.indexOf("function fileFacts"));
    expect(slice).toContain("origin: s?.origin?.trim() || null");
    expect(slice).toContain("destination: s?.destination?.trim() || null");
    expect(slice).toContain("origin_port_id: s?.originPortId || null");
    expect(slice).toContain("destination_port_id: s?.destinationPortId || null");
    expect(slice).toContain("origin_airport_id: s?.originAirportId || null");
    expect(slice).toContain("destination_airport_id: s?.destinationAirportId || null");
  });

  it("validateShipmentGeography: mode rules — ports ⇔ SEA/MULTIMODAL, airports ⇔ AIR/MULTIMODAL", () => {
    const v = actions.slice(
      actions.indexOf("async function validateShipmentGeography"),
      actions.indexOf("function fileFacts"),
    );
    expect(v).toContain('if (portIds.length > 0 && mode !== "SEA" && mode !== "MULTIMODAL") return "geo_mode_mismatch"');
    expect(v).toContain('if (airportIds.length > 0 && mode !== "AIR" && mode !== "MULTIMODAL") return "geo_mode_mismatch"');
  });

  it("validateShipmentGeography: every referenced entity must exist in the caller's OWN tenant", () => {
    const v = actions.slice(
      actions.indexOf("async function validateShipmentGeography"),
      actions.indexOf("function fileFacts"),
    );
    expect(v).toContain('.from("ocean_port")');
    expect(v).toContain('.from("air_airport")');
    expect((v.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length).toBe(2);
    expect(v).toContain('return "geo_invalid_reference"');
  });

  it("createFile refuses BEFORE the dossier exists and BEFORE a number is allocated", () => {
    const create = actions.slice(
      actions.indexOf("export async function createFile"),
      actions.indexOf("export async function updateFile"),
    );
    const geo = create.indexOf("validateShipmentGeography(supabase, admin.tenantId, input.shipment)");
    const numbering = create.indexOf('supabase.rpc("next_file_number"');
    expect(geo).toBeGreaterThan(-1);
    expect(numbering).toBeGreaterThan(-1);
    expect(geo).toBeLessThan(numbering);
  });

  it("updateFile validates the same way before its writes", () => {
    const update = actions.slice(
      actions.indexOf("export async function updateFile"),
      actions.indexOf("export async function cancelFile"),
    );
    const geo = update.indexOf("validateShipmentGeography(supabase, admin.tenantId, input.shipment)");
    const write = update.indexOf('.from("operational_file")\n    .update(');
    expect(geo).toBeGreaterThan(-1);
    expect(geo).toBeLessThan(write);
  });

  it("both refusal codes speak French", () => {
    const i18n = read("lib", "i18n.ts");
    expect(i18n).toContain("geo_mode_mismatch:");
    expect(i18n).toContain("geo_invalid_reference:");
    expect(i18n).toContain("Un port s'associe à un transport maritime ou multimodal");
    expect(i18n).toContain("Le port ou l'aéroport sélectionné n'existe pas dans votre organisation.");
  });
});

// ========================================================== the options ====

describe("TMS-2 options read — the SAME authority the reference RLS grants", () => {
  const slice = service.slice(
    service.indexOf("export async function listGeographyOptions"),
    service.indexOf("export async function listAssignableStaff"),
  );

  it("gated by transport:read (EC-3C: an admin read must not show more than the direct read would)", () => {
    expect(slice).toContain('await assertPermission("transport:read")');
  });

  it("active entries of the caller's tenant only — id, name and controlled code, nothing more", () => {
    expect((slice.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBe(2);
    expect((slice.match(/\.eq\("active", true\)/g) ?? []).length).toBe(2);
    expect(slice).toContain('select("id, name, unlocode")');
    expect(slice).toContain('select("id, name, iata")');
  });

  it("pages load options only for transport:read holders", () => {
    const newPage = read("app", "files", "new", "page.tsx");
    const editPage = read("app", "files", "[id]", "page.tsx");
    expect(newPage).toContain('hasPermission(permissions, "transport:read")');
    expect(newPage).toContain("await listGeographyOptions()");
    expect(editPage).toContain('canUpdate && hasPermission(permissions, "transport:read")');
  });
});

// ============================================================= the form ====

describe("TMS-2 form — optional anchors that follow the declared mode", () => {
  it("pickers appear only for the matching mode and only when options exist", () => {
    expect(form).toContain(
      'const showPorts = (transportMode === "SEA" || transportMode === "MULTIMODAL") && ports.length > 0;',
    );
    expect(form).toContain(
      'const showAirports = (transportMode === "AIR" || transportMode === "MULTIMODAL") && airports.length > 0;',
    );
    expect(form).toContain("Port d'origine (référentiel)");
    expect(form).toContain("Aéroport d'origine (référentiel)");
    expect(form).toContain("— Non associé —");
  });

  it("switching away from a mode drops the anchors that no longer apply", () => {
    expect(form).toContain("originPortId: showPorts ? originPortId || null : null");
    expect(form).toContain("originAirportId: showAirports ? originAirportId || null : null");
  });

  it("the free-text origin/destination fields remain — the label is never replaced", () => {
    expect(form).toContain("<Field label={t.files.form.origin}>");
    expect(form).toContain("<Field label={t.files.form.destination}>");
  });
});

// ========================================================= the resolvers ====

describe("TMS-2 resolution — anchors feed the EXISTING projection, never a new model", () => {
  it("SEA: shipment anchors first, route legs as fallback, coordinates never invented", () => {
    const r = oceanService.slice(
      oceanService.indexOf("async function readShipmentPortAnchors"),
      oceanService.indexOf("export async function getOceanShipmentDetail"),
    );
    expect(r).toContain('select("origin_port_id, destination_port_id")');
    expect(r).toContain("originId = originId ?? legs[0].origin_port_id");
    expect(r).toContain("destinationId = destinationId ?? legs[legs.length - 1].destination_port_id");
    expect(r).toContain("p.latitude != null && p.longitude != null");
    expect(oceanService).toContain(
      "buildShipmentMapProjection({ origin: endpoints.origin, destination: endpoints.destination, current: position, milestoneMarkers })",
    );
  });

  it("AIR: the actual flight stays primary — the dossier anchors are only the fallback", () => {
    expect(airService).toContain("origin: flight?.origin ?? anchors.origin");
    expect(airService).toContain("destination: flight?.destination ?? anchors.destination");
    const r = airService.slice(
      airService.indexOf("async function readShipmentAirportAnchors"),
      airService.indexOf("async function readFlightMap"),
    );
    expect(r).toContain("origin:origin_airport_id(name, latitude, longitude)");
    expect(r).toContain("a.latitude != null && a.longitude != null");
  });

  it("ROAD and the portal are untouched (TMS-3 questions, ratified Q7)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf-8");
          if (src.includes("origin_port_id") || src.includes("readShipmentPortAnchors")) hits.push(full);
        }
      }
    };
    walk(path.join(root, "lib", "portal"));
    walk(path.join(root, "app", "portal"));
    walk(path.join(root, "lib", "tracking"));
    expect(hits).toEqual([]);
  });
});

// ============================================================ the wiring ====

describe("TMS-2 wiring & registry discipline", () => {
  it("db types carry the four columns in Row, Insert and Update of the SHIPMENT block", () => {
    const start = dbTypes.indexOf("      shipment: {");
    const end = dbTypes.indexOf("      Relationships: [", start);
    const block = dbTypes.slice(start, end);
    for (const col of GEO_COLUMNS) {
      expect(block).toContain(`${col}: string | null;`); // Row
      expect((block.match(new RegExp(`${col}\\?: string \\| null;`, "g")) ?? []).length).toBe(2); // Insert + Update
    }
  });

  it("the SQL suite exists with its five cases and runs in CI", () => {
    const suite = read("supabase", "tests", "tms_2_shipment_geography_test.sql");
    for (const c of ["TMS2-A", "TMS2-B", "TMS2-C", "TMS2-D", "TMS2-E"]) expect(suite).toContain(c);
    expect(suite).toContain("shipment geo tenant mismatch");
    expect(ci).toContain("-f supabase/tests/tms_2_shipment_geography_test.sql");
  });

  it("no migration ever ships generic-TMS tables (frozen TMS-0 exclusions)", () => {
    const files = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.some((f) => /vehicle|fleet|fuel|maintenance|telematic/i.test(f))).toBe(false);
  });

  it("build-info advanced to migration 116", () => {
    const buildInfo = read("lib", "platform", "ops", "build-info.ts");
    expect(buildInfo).toContain('LATEST_MIGRATION = "20260907000001_shipment_geography"');
    expect(buildInfo).toContain("MIGRATION_COUNT = 116");
  });
});
