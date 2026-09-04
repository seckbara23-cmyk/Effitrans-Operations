/**
 * file:transition — advancing the dossier ladder is not editing it.
 *
 * Advancing `operational_file.status` was guarded by `file:update`, the
 * permission that authorizes EDITING the dossier record. OPS_SUPERVISOR holds
 * file:read:all, file:assign, file:delete, transport:complete, process:manage
 * and process:owner:assign — it can open a workflow, assign its owner, complete
 * transport and delete the dossier — but not file:update. So « Avancer →
 * Clôturé » never rendered, and `canUpdate && next.length > 0` short-circuited
 * before the status was even consulted.
 *
 * The status ladder had inherited the edit permission instead of owning one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260728000003_file_transition_permission.sql";
const HOLDERS = ["SYSTEM_ADMIN", "ACCOUNT_MANAGER", "COORDINATOR", "OPS_SUPERVISOR"];
const perms = (key: string) =>
  TENANT_ROLE_TEMPLATES.find((t) => t.key === key)?.permissions ?? [];

// ---------------------------------------------------------------------------
describe("the grant", () => {
  it.each(HOLDERS)("%s holds file:transition", (role) => {
    expect(perms(role)).toContain("file:transition");
  });

  it("the two authorities stay SEPARATE — the distinction, not the grant, was the point", () => {
    // Ratified 2026-07-28: advancing the status ladder and editing master data
    // are different acts, so they are different permissions. H-9 (2026-09-03)
    // granted OPS_SUPERVISOR the second one as well — a dossier is a living
    // record and Operations maintains it. What must never happen is the two
    // collapsing into one permission, or `file:transition` implying edit rights.
    expect(perms("OPS_SUPERVISOR")).toContain("file:transition");
    expect(perms("OPS_SUPERVISOR")).toContain("file:update");
    const catalogue = read("supabase/seed.sql") + read("lib/platform/role-templates.ts");
    expect(catalogue).toContain("file:transition");
    expect(catalogue).toContain("file:update");
  });

  it("file:update is held by exactly the four ratified roles", () => {
    for (const role of ["SYSTEM_ADMIN", "ACCOUNT_MANAGER", "COORDINATOR", "OPS_SUPERVISOR"]) {
      expect(perms(role), role).toContain("file:update");
    }
    // Editing a dossier is Operations' business and nobody else's.
    for (const role of ["FINANCE_OFFICER", "CASHIER", "CLIENT_USER", "COURIER", "CUSTOMS_DECLARANT"]) {
      expect(perms(role), role).not.toContain("file:update");
    }
  });

  it("H-9 granted the EDIT only — creation was deliberately withheld", () => {
    expect(perms("OPS_SUPERVISOR")).not.toContain("file:create");
  });

  it("is NOT granted by analogy to unrelated roles", () => {
    for (const role of [
      "FINANCE_OFFICER", "CASHIER", "BILLING_OFFICER",
      "CUSTOMS_DECLARANT", "CUSTOMS_FIELD_AGENT", "CHIEF_OF_TRANSIT",
      "TRANSPORT_OFFICER", "PICKUP_AGENT", "DRIVER", "CEO",
    ]) {
      expect(perms(role), role).not.toContain("file:transition");
    }
  });

  it("exactly four roles hold it", () => {
    const holders = TENANT_ROLE_TEMPLATES
      .filter((t) => t.permissions.includes("file:transition"))
      .map((t) => t.key)
      .sort();
    expect(holders).toEqual([...HOLDERS].sort());
  });
});

// ---------------------------------------------------------------------------
describe("the migration reaches EXISTING tenants", () => {
  const sql = () => sqlCode(MIGRATION);

  it("adds the permission to the catalogue", () => {
    expect(sql()).toMatch(/insert into public\.permission[\s\S]{0,200}'file:transition'/);
    expect(sql()).toContain("on conflict (code) do nothing");
  });

  it("grants WITHOUT a tenant filter, so every provisioned tenant receives it", () => {
    const s = sql();
    const grant = s.slice(s.indexOf("insert into public.role_permission"));
    expect(grant).toContain("where r.code in ('SYSTEM_ADMIN', 'ACCOUNT_MANAGER', 'COORDINATOR', 'OPS_SUPERVISOR')");
    // a tenant filter here would leave existing tenants without the grant
    expect(grant).not.toMatch(/r\.tenant_id\s*=/);
  });

  it("is idempotent", () => {
    expect(sql()).toContain("on conflict do nothing");
  });

  it("changes no schema and revokes nothing", () => {
    const s = sql();
    expect(s).not.toMatch(/create table|alter table|drop |revoke /i);
    expect(s).not.toMatch(/delete from public\.role_permission/i);
  });

  it("seed and templates agree — provisioning parity", () => {
    const seed = read("supabase/seed.sql");
    expect(seed).toContain("'file:transition'");
    expect(seed).toMatch(/p\.code = 'file:transition'[\s\S]{0,200}OPS_SUPERVISOR/);
    // H-9 — the same role now also carries file:update, in all three sources.
    expect(seed).toMatch(/p\.code = 'file:update'[\s\S]{0,200}OPS_SUPERVISOR/);
    const migration = read("supabase/migrations/20260929000001_ops_supervisor_file_update.sql");
    expect(migration).toContain("'file:update'");
    expect(migration).toContain("OPS_SUPERVISOR");
  });
});

// ---------------------------------------------------------------------------
describe("enforcement", () => {
  it("the SERVER requires file:transition, not file:update", () => {
    const s = code("lib/files/actions.ts");
    const fn = s.slice(s.indexOf("export async function transitionFile"));
    expect(fn).toContain('assertPermission("file:transition")');
    expect(fn.slice(0, fn.indexOf("closureBlockers"))).not.toContain('assertPermission("file:update")');
  });

  it("the UI gate uses the same permission", () => {
    expect(code("app/files/[id]/page.tsx")).toContain('hasPermission(permissions, "file:transition")');
    expect(code("components/files/file-workflow.tsx")).toContain("{canTransitionStatus && next.length > 0 && (");
  });

  it("a user without it sees status and history but no transition control", () => {
    const w = code("components/files/file-workflow.tsx");
    // the heading, status and history sit OUTSIDE the gate
    expect(w).toContain('id="closure"');
    expect(w).toContain("Clôture du dossier");
    expect(w).toMatch(/\{canTransitionStatus && next\.length > 0 && \(/);
  });

  it("file:update still guards EDITING, untouched", () => {
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain('hasPermission(permissions, "file:update")');
    // and the edit form still receives it
    expect(page).toMatch(/FileForm[\s\S]{0,200}canUpdate=\{canUpdate\}/);
  });
});

// ---------------------------------------------------------------------------
describe("nothing else was weakened", () => {
  const fn = () => {
    const s = code("lib/files/actions.ts");
    // transitionFile is the LAST export in the file — slice to the end.
    return s.slice(s.indexOf("export async function transitionFile"));
  };

  it("transition legality is still checked", () => {
    expect(fn()).toContain("if (!canTransition(fromStatus, toStatus))");
  });

  it("closure blockers still run, and still name the reason", () => {
    const b = fn();
    expect(b).toContain("closureBlockers({");
    expect(b).toContain("if (blockers.length > 0) return { ok: false, error: blockers[0] };");
  });

  it("the permission check precedes the closure gate and any write", () => {
    const b = fn();
    const perm = b.indexOf('assertPermission("file:transition")');
    const gate = b.indexOf("closureBlockers({");
    // the UPDATE, not the initial read — both use .from("operational_file")
    const write = b.indexOf(".update(patch)");
    expect(perm).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(perm);
    expect(write).toBeGreaterThan(gate);
  });

  it("history and audit are still written", () => {
    const b = fn();
    expect(b).toContain('from("file_state_transition")');
    expect(b).toContain("AuditActions.FILE_TRANSITION");
  });

  it("automatic transport convergence is untouched", () => {
    expect(code("lib/transport/actions.ts")).toContain("advanceFileToDeliveredFromTransport");
    const adv = code("lib/files/auto-advance.ts");
    // it still asserts NO permission — the transport transition authorized it
    expect(adv).not.toContain("assertPermission");
    expect(adv).toMatch(/\.eq\("status", current\)/); // CAS preserved
  });
});
