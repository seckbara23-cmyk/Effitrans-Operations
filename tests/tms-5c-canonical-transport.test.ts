/**
 * TMS-5C — Canonical Transport Department Realignment.
 * ---------------------------------------------------------------------------
 * TMS-5B made Transport a department in NAVIGATION and deliberately left the
 * canonical registry diverged. TMS-5C closes that divergence: TRANSPORT is a
 * canonical department, and TRANSPORT_OFFICER / PICKUP_AGENT / DRIVER derive to
 * it — superseding "business decision 5".
 *
 * The audit that authorized this established three facts, and these pins keep
 * every one of them true:
 *   1. the registry is METADATA, never authorization — `can_read_file` does not
 *      consult a department, so no read access moved;
 *   2. no department value is stored anywhere — so no migration, no backfill;
 *   3. the lifecycle/queue maps had to move WITH the roles, or the transport
 *      team would have lost its own stage from its own queue.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CANONICAL_DEPARTMENTS,
  ROLE_CANONICAL_DEPARTMENT,
  QUEUE_DEPARTMENT_TO_CANONICAL,
  isCanonicalDepartment,
  departmentLabelFr,
  resolveLegacyDepartmentLabel,
} from "@/lib/organization/departments";
import {
  LIFECYCLE_DEPARTMENT_TO_CANONICAL,
  NON_DOSSIER_ROLES,
  canonicalDepartmentsForRoles,
  belongsToLifecycleDepartment,
} from "@/lib/workflow/access/departments";
import { navSections } from "@/lib/nav";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const TRANSPORT_ROLES = ["TRANSPORT_OFFICER", "PICKUP_AGENT", "DRIVER"] as const;
// QUOTATION_MANAGER was here until H-7 (2026-09-03) re-homed cotation to
// OPERATIONS. What TMS-5C guarantees is unchanged: moving TRANSPORT out of
// TRANSIT did not move the CUSTOMS roles, which are the three below.
const TRANSIT_ROLES = ["CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "CUSTOMS_FIELD_AGENT"] as const;

// ====================================================== the realignment ====

describe("TMS-5C — TRANSPORT is a canonical department", () => {
  it("exists, is selectable, and is labelled in French", () => {
    expect(isCanonicalDepartment("TRANSPORT")).toBe(true);
    expect(departmentLabelFr("TRANSPORT")).toBe("Transport");
    expect(CANONICAL_DEPARTMENTS.map((d) => d.code)).toContain("TRANSPORT");
  });

  it("processes dossiers and reports under OPERATIONS, exactly as Transit does", () => {
    const t = CANONICAL_DEPARTMENTS.find((d) => d.code === "TRANSPORT")!;
    expect(t.processesDossiers).toBe(true);
    expect(t.parent).toBe("OPERATIONS");
  });

  it("the three ratified roles derive to TRANSPORT", () => {
    for (const r of TRANSPORT_ROLES) {
      expect(ROLE_CANONICAL_DEPARTMENT[r], r).toBe("TRANSPORT");
    }
  });

  it("Transit roles stay in Transit — customs is not moved", () => {
    for (const r of TRANSIT_ROLES) {
      expect(ROLE_CANONICAL_DEPARTMENT[r], r).toBe("TRANSIT");
    }
  });

  it("NO unrelated role changed department", () => {
    const moved = Object.entries(ROLE_CANONICAL_DEPARTMENT)
      .filter(([, d]) => d === "TRANSPORT")
      .map(([r]) => r)
      .sort();
    expect(moved).toEqual([...TRANSPORT_ROLES].sort());
  });
});

// ============================================ queues follow their people ====

describe("TMS-5C — the work follows the department, not just the label", () => {
  it("the transport and pickup QUEUES belong to TRANSPORT", () => {
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.transport).toBe("TRANSPORT");
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.pickup).toBe("TRANSPORT");
  });

  it("customs queues stay with TRANSIT", () => {
    for (const q of ["transit", "customs_declaration", "customs_field"]) {
      expect(QUEUE_DEPARTMENT_TO_CANONICAL[q], q).toBe("TRANSIT");
    }
  });

  it("the transport lifecycle STAGE moved with the roles — the team keeps its own work", () => {
    // The failure this prevents: remapping roles alone would leave the transport
    // stage pointing at TRANSIT, taking it out of the transport team's queue.
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.transport).toBe("TRANSPORT");
    expect(belongsToLifecycleDepartment(["TRANSPORT_OFFICER"], "transport")).toBe(true);
    expect(belongsToLifecycleDepartment(["PICKUP_AGENT"], "transport")).toBe(true);
  });

  it("customs stays visible to customs people, and is no longer transport's queue", () => {
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.customs).toBe("TRANSIT");
    expect(belongsToLifecycleDepartment(["CUSTOMS_DECLARANT"], "customs")).toBe(true);
    expect(belongsToLifecycleDepartment(["TRANSPORT_OFFICER"], "customs")).toBe(false);
  });

  it("every other lifecycle stage is byte-stable", () => {
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.opening).toBe("OPERATIONS");
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.documentation).toBe("OPERATIONS");
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.archive).toBe("OPERATIONS");
    expect(LIFECYCLE_DEPARTMENT_TO_CANONICAL.finance).toBe("FINANCE");
  });

  it("« Transport & Logistique » now resolves to the real department", () => {
    expect(resolveLegacyDepartmentLabel("Transport & Logistique")).toBe("TRANSPORT");
    expect(resolveLegacyDepartmentLabel("Douane")).toBe("TRANSIT");
  });
});

// ================================================ nothing became authority ====

describe("TMS-5C — organizational metadata, never authorization", () => {
  it("the DRIVER still carries NO dossier visibility — mission scope is unchanged", () => {
    expect(NON_DOSSIER_ROLES).toContain("DRIVER");
    expect(canonicalDepartmentsForRoles(["DRIVER"])).toEqual([]);
    expect(belongsToLifecycleDepartment(["DRIVER"], "transport")).toBe(false);
  });

  it("can_read_file never consults a department — no read access moved", () => {
    const rls = read("supabase", "migrations", "20260614000005_scope_visibility.sql");
    const fn = rls.slice(rls.indexOf("create or replace function public.can_read_file"));
    expect(fn.toLowerCase()).not.toContain("department");
  });

  it("every place the vocabulary IS stored was widened to accept TRANSPORT", () => {
    // CORRECTED (TMS-5C addendum): the registry's doctrine says department is
    // "never stored", and this pin originally asserted that literally. The audit
    // disproved it in THREE places — employee.department (NOT NULL, live),
    // hr_org_unit.canonical_department (live) and
    // process_blocker.source_department_code (latent) each enumerate the codes
    // in a CHECK. The HR wizard builds its picker from CANONICAL_DEPARTMENTS, so
    // without migration 118 filing anyone under « Transport » would have been
    // rejected by the database. No row was rewritten — it is a pure widening.
    // HUMAN_RESOURCES is the probe: it exists ONLY as a canonical department
    // code ('TRANSIT' alone is unusable — 'IN_TRANSIT' is an air-cargo status).
    const dir = path.join(root, "supabase", "migrations");
    const holders = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .filter((n) => fs.readFileSync(path.join(dir, n), "utf-8").includes("HUMAN_RESOURCES"));
    expect(holders).toEqual([
      "20260723000001_workflow_structures.sql",   // process_blocker (latent)
      "20260724000002_hr_employee_registry.sql",  // employee.department (LIVE)
      "20260801000001_hr_organization_foundation.sql", // hr_org_unit (LIVE)
      "20260910000001_canonical_transport_department.sql", // the widening
    ]);
    // …and the live constraint accepts TRANSPORT.
    expect(read("supabase", "migrations", "20260910000001_canonical_transport_department.sql"))
      .toContain("'OPERATIONS', 'TRANSIT', 'TRANSPORT', 'FINANCE', 'HUMAN_RESOURCES'");
    // No seed STORES a department (the only mention is a comment explaining
    // that HR stays canonical metadata — comment-stripped before asserting).
    const seedCode = read("supabase", "seed.sql").replace(/^\s*--.*$/gm, "");
    expect(seedCode).not.toContain("HUMAN_RESOURCES");
  });

  it("the registry stays PURE — no client, no server-only, no query", () => {
    const registry = read("lib", "organization", "departments.ts");
    expect(registry).not.toMatch(/supabase|getAdmin|getServer|\.rpc\(|server-only/);
  });

  it("no transport permission was invented and no role template changed shape", () => {
    const templates = read("lib", "platform", "role-templates.ts");
    for (const invented of ["transport:department", "department:transport", "transport:queue"]) {
      expect(templates, invented).not.toContain(invented);
    }
    // the three moved roles keep their existing transport authorities
    expect(templates).toContain('"transport:request"');
  });
});

// ==================================================== navigation agreement ====

describe("TMS-5C — navigation and canonical organization tell the same story", () => {
  it("every DÉPARTEMENTS entry names a real canonical department", () => {
    const labels = navSections
      .find((s) => s.label === "Départements")!
      .items.map((i) => i.label);
    expect(labels).toEqual(["Opérations", "Transit", "Transport", "Finance"]);
    const canonicalLabels = CANONICAL_DEPARTMENTS.map((d) => d.labelFr);
    for (const label of labels) {
      expect(canonicalLabels, label).toContain(label);
    }
  });

  it("the sidebar still does not DERIVE from the registry — they agree by decision", () => {
    expect(read("lib", "nav.ts")).not.toContain("CANONICAL_DEPARTMENTS");
  });

  it("HUMAN_RESOURCES is canonical but deliberately absent from DÉPARTEMENTS", () => {
    expect(isCanonicalDepartment("HUMAN_RESOURCES")).toBe(true);
    const labels = navSections.find((s) => s.label === "Départements")!.items.map((i) => i.label);
    expect(labels).not.toContain("Ressources humaines");
  });
});
