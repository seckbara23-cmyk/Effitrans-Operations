/**
 * TMS-6 — Subcontractors / External Transport.
 * ---------------------------------------------------------------------------
 * Drafted before TMS-5B/5C, parked mid-flight, and REBASED onto post-5C HEAD.
 * The behavioural proofs (exclusion invariant, approval interlock, tenant
 * boundary, historical carrier identity) run against a real Postgres in
 * supabase/tests/tms_6_subcontractor_test.sql. These pins guard what a static
 * reader can prove: that external execution is modelled as its own thing, that
 * nothing was invented, and that every boundary the earlier phases drew still
 * holds after the rebase.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROLE_CANONICAL_DEPARTMENT, CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "");
const stripTs = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "20260911000001_transport_subcontractors.sql";
const migration = read("supabase", "migrations", MIGRATION);
const migrationCode = stripSql(migration);
const actions = stripTs(read("lib", "subcontractors", "actions.ts"));
const service = stripTs(read("lib", "subcontractors", "service.ts"));
const transportActions = read("lib", "transport", "actions.ts");
const panel = read("components", "transport", "transport-panel.tsx");
const page = read("app", "transport", "sous-traitants", "page.tsx");
const transportHub = read("app", "departments", "transport", "page.tsx");

// ============================================================== the rebase ====

describe("TMS-6 — rebased onto the post-TMS-5C world", () => {
  it("renumbered past the applied 118 — the taken slot is never reused", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    const idx = migrations.indexOf("20260910000001_canonical_transport_department.sql");
    expect(idx).toBeGreaterThan(-1);
    expect(migrations[idx + 1]).toBe(MIGRATION);
    expect(migrations.some((f) => f.startsWith("20260909000001"))).toBe(false);
  });

  it("a subcontractor is EXTERNAL — never a canonical department, never a role", () => {
    // TMS-5C made TRANSPORT a department; a provider is the opposite of that.
    expect(CANONICAL_DEPARTMENTS.map((d) => d.code)).not.toContain("SUBCONTRACTOR");
    expect(CANONICAL_DEPARTMENTS.map((d) => d.code)).not.toContain("PROVIDER");
    expect(Object.keys(ROLE_CANONICAL_DEPARTMENT)).not.toContain("SUBCONTRACTOR");
    for (const src of [actions, service, migrationCode]) {
      expect(src).not.toContain("CANONICAL_DEPARTMENT");
      expect(src).not.toContain("ROLE_CANONICAL");
    }
  });

  it("the TMS-5C canonical roles are untouched by this phase", () => {
    for (const r of ["TRANSPORT_OFFICER", "PICKUP_AGENT", "DRIVER"]) {
      expect(ROLE_CANONICAL_DEPARTMENT[r], r).toBe("TRANSPORT");
    }
  });

  it("the maritime plane is NOT reused for road subcontracting", () => {
    for (const src of [actions, service]) {
      expect(src).not.toContain("ocean_carrier");
      expect(src).not.toContain("ocean_vessel");
    }
    // the migration names it only to explain why it is not reused
    expect(migrationCode).not.toContain("references public.ocean_carrier");
  });
});

// ======================================================== execution source ====

describe("TMS-6 — internal and external execution are mutually exclusive", () => {
  it("the database refuses a transport that claims BOTH", () => {
    expect(migrationCode).toContain("transport_execution_source_exclusive");
    expect(migrationCode).toContain("check (vehicle_id is null or provider_id is null)");
  });

  it("execution mode is DERIVED from which link is set — no stored column", () => {
    // No COLUMN of that name is declared. The words appear elsewhere on purpose
    // — in the `comment on column` that documents the design, and in assertion
    // 5c which exists to refuse them — so the pin reads the DECLARATIONS only.
    const declarations = [
      ...migrationCode.matchAll(/add column if not exists (\w+)/g),
      ...migrationCode.matchAll(/^\s{2}(\w+)\s+(?:uuid|text|boolean|date|numeric|int|timestamptz)/gm),
    ].map((m) => m[1]);
    expect(declarations.length).toBeGreaterThan(0);
    for (const forbidden of ["execution_mode", "is_external", "execution_type"]) {
      expect(declarations, forbidden).not.toContain(forbidden);
    }
    expect(migration).toContain("assertion 5c failed");
    expect(panel).toContain("record.providerId");
    expect(panel).toContain("Transport externe");
    expect(panel).toContain("Flotte Effitrans");
  });

  it("only an APPROVED, active provider of the same tenant may be bound", () => {
    expect(migrationCode).toContain("create or replace function public.enforce_transport_provider()");
    expect(migrationCode).toContain("transport provider tenant mismatch");
    expect(migrationCode).toContain("retiré du répertoire");
    expect(migrationCode).toContain("n''est pas agréé");
    expect(migrationCode).toContain("create trigger trg_transport_provider before insert or update on public.transport_record");
  });

  it("an UNCHANGED binding is never re-litigated", () => {
    expect(migrationCode).toContain("new.provider_id is not distinct from old.provider_id");
  });

  it("the TMS-5 fleet interlock is untouched", () => {
    const fleet = read("supabase", "migrations", "20260908000001_fleet_registry.sql");
    expect(fleet).toContain("create or replace function public.enforce_transport_vehicle()");
    expect(migrationCode).not.toContain("enforce_transport_vehicle");
  });
});

// ==================================================== historical identity ====

describe("TMS-6 — the past keeps the carrier it actually had", () => {
  it("binding a provider snapshots its NAME into the existing transport_company", () => {
    const assignSlice = transportActions.slice(
      transportActions.indexOf("export async function assignTransport"),
      transportActions.indexOf("export async function changeTransportStatus"),
    );
    expect(assignSlice).toContain('.from("transport_provider")');
    expect(assignSlice).toContain('.select("name")');
    expect(assignSlice).toContain('(patch as Record<string, unknown>).transport_company = provider.name');
  });

  it("transport_company SURVIVES — it is the snapshot AND the ad-hoc carrier lane", () => {
    expect(migrationCode).not.toContain("drop column");
    expect(migration).toContain("assertion 5d failed");
    const transportMigration = read("supabase", "migrations", "20260615000003_create_transport.sql");
    expect(transportMigration).toContain("transport_company    text");
  });

  it("provider_id is nullable — an ad-hoc haulier needs no registry row", () => {
    expect(migrationCode).toContain("add column if not exists provider_id uuid references public.transport_provider (id)");
    expect(migrationCode).not.toMatch(/provider_id uuid not null/);
  });

  it("usage history is DERIVED from transport_record — no execution log invented", () => {
    expect(service).toContain('.from("transport_record")');
    expect(service).toContain("transportCount");
    expect(migrationCode).not.toContain("provider_usage");
    expect(migrationCode).not.toContain("provider_assignment");
  });
});

// ============================================================== authority ====

describe("TMS-6 — the ratified transport authority, nothing invented", () => {
  it("registry writes ride transport:manage", () => {
    expect((actions.match(/assertPermission\("transport:manage"\)/g) ?? []).length).toBe(4);
    expect(actions).not.toContain('assertPermission("transport:read")');
  });

  it("reads ride transport:read — the same authority the RLS policy requires", () => {
    expect(service).toContain('assertPermission("transport:read")');
    expect(migrationCode).toContain("public.has_permission('transport:read')");
  });

  it("binding stays in the EXISTING assign path under transport:assign", () => {
    const patch = read("lib", "transport", "patch.ts");
    expect(patch).toContain('"providerId"');
    expect(patch).toContain('providerId: "provider_id"');
    const assignSlice = transportActions.slice(
      transportActions.indexOf("export async function assignTransport"),
      transportActions.indexOf("export async function changeTransportStatus"),
    );
    expect(assignSlice).toContain('assertPermission("transport:assign")');
  });

  it("NO permission was invented, in the migration or the templates", () => {
    const templates = read("lib", "platform", "role-templates.ts");
    for (const invented of ["subcontractor:", "provider:manage", "provider:read", "carrier:manage"]) {
      expect(templates, invented).not.toContain(invented);
    }
    const beforeAssertions = migrationCode.slice(0, migrationCode.indexOf("do $$"));
    expect(beforeAssertions).not.toContain("insert into public.permission");
    expect(beforeAssertions).not.toContain("insert into public.role_permission");
  });

  it("master-data changes are audited, not pushed into the dossier-scoped ledger", () => {
    expect(actions).toContain("AuditActions.PROVIDER_CREATED");
    expect(actions).toContain("AuditActions.PROVIDER_STATUS_CHANGED");
    expect(actions).not.toContain("emit_business_event");
  });

  it("the table is registered as tenant-scoped", () => {
    expect(read("lib", "db", "tenant-tables.ts")).toContain('"transport_provider"');
  });
});

// =========================================================== reachability ====

describe("TMS-6 — reachable from the Transport department (TMS-5B home)", () => {
  it("a first-class responsibility CARD, not merely a chip", () => {
    const start = transportHub.indexOf("the Transport department's own responsibilities");
    const end = transportHub.indexOf("Operational platform cards");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const cards = transportHub.slice(start, end);
    expect(cards).toContain("Sous-traitants");
    expect(cards).toContain('href="/transport/sous-traitants"');
  });

  it("nothing was added to the Transit hub — Transit keeps customs and international follow-up", () => {
    const transit = stripTs(read("app", "departments", "transit", "page.tsx"));
    expect(transit).not.toContain("sous-traitants");
  });

  it("viewing needs transport:read; management controls need transport:manage", () => {
    expect(page).toContain('if (!hasPermission(permissions, "transport:read"))');
    expect(page).toContain('const canManage = hasPermission(permissions, "transport:manage")');
    expect(page).toContain("Consultation seule");
  });

  it("the picker only offers providers the database would accept", () => {
    expect(service).toContain('p.isActive && p.status === "APPROVED"');
    const filePage = read("app", "files", "[id]", "page.tsx");
    expect(filePage).toContain("await listAssignableProviders()");
  });
});

// ========================================================== scope guard ====

describe("TMS-6 — lightweight: no vendor-management ERP appeared", () => {
  it("no procurement, tendering, rate, billing or contract surface", () => {
    const surfaces = [migrationCode, actions, service, page].join("\n").toLowerCase();
    for (const forbidden of [
      "procurement", "appel_offre", "tender", "rate_card", "tarif_grille",
      "carrier_billing", "facturation_transporteur", "supplier_invoice", "contract_term",
      "scoring", "telematic", "payroll",
    ]) {
      expect(surfaces, forbidden).not.toContain(forbidden);
    }
  });

  it("one table only — the registry; no join table, no second execution model", () => {
    expect((migrationCode.match(/create table/g) ?? []).length).toBe(1);
    expect(migrationCode).toContain("create table if not exists public.transport_provider");
  });

  it("the transport state machine gained no state", () => {
    const status = read("lib", "transport", "status.ts");
    for (const invented of ["SUBCONTRACTED", "EXTERNAL", "PROVIDER_ASSIGNED"]) {
      expect(status, invented).not.toContain(invented);
    }
  });

  it("the SQL suite exists with its five cases and runs LAST in CI", () => {
    const suite = read("supabase", "tests", "tms_6_subcontractor_test.sql");
    for (const c of ["TMS6-A", "TMS6-B", "TMS6-C", "TMS6-D", "TMS6-E"]) expect(suite).toContain(c);
    expect(read(".github", "workflows", "ci.yml")).toContain("-f supabase/tests/tms_6_subcontractor_test.sql");
  });

  it("build-info advanced to migration 119", () => {
    const buildInfo = read("lib", "platform", "ops", "build-info.ts");
    expect(buildInfo).toContain('LATEST_MIGRATION = "20260911000001_transport_subcontractors"');
    expect(buildInfo).toContain("MIGRATION_COUNT = 119");
  });
});
