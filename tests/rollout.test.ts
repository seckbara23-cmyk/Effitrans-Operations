/**
 * Phase 5.0E-2A — tenant-scoped rollout.
 *
 * The whole point of this phase is that turning the engine on for the pilot must NOT
 * turn it on for anyone else. Everything below is a way of failing that claim.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  resolveEffectiveFlags,
  normalizeRollout,
  isRolloutFeature,
  ROLLOUT_FEATURES,
  ROLLOUT_DISABLED,
  FLAGS_ALL_OFF,
  type TenantRollout,
} from "@/lib/process/rollout";
import { resolveProcessFlags } from "@/lib/process/flags";
import { PLATFORM_ROLE_PERMISSIONS, PLATFORM_PERMISSIONS } from "@/lib/platform/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const ENV_ALL_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
  EFFITRANS_PROCESS_COMPATIBILITY_ENABLED: "true",
  EFFITRANS_PROCESS_OVERRIDE_ENABLED: "true",
});
const ENV_OFF = resolveProcessFlags({});

const TENANT_ALL_ON: TenantRollout = {
  process_engine: true,
  process_workspaces: true,
  physical_invoice_deposit: true,
  collections: true,
};

// ---------------------------------------------------------- the effective rule ----

describe("effective = global AND tenant", () => {
  it("is OFF when the tenant has no row — the pilot must not leak to anyone else", () => {
    // THE central claim of this phase. The deployment is fully switched on (that is
    // what the pilot requires), and a tenant nobody has enabled still gets nothing.
    const f = resolveEffectiveFlags(ENV_ALL_ON, null);
    expect(f).toEqual(FLAGS_ALL_OFF);
  });

  it("is OFF when the tenant is enabled but the kill switch is cut", () => {
    const f = resolveEffectiveFlags(ENV_OFF, TENANT_ALL_ON);
    expect(f).toEqual(FLAGS_ALL_OFF);
  });

  it("is ON only when BOTH agree", () => {
    const f = resolveEffectiveFlags(ENV_ALL_ON, TENANT_ALL_ON);
    expect(f.enabled).toBe(true);
    expect(f.workspaces).toBe(true);
    expect(f.physicalDeposit).toBe(true);
    expect(f.collections).toBe(true);
  });

  it("lets the deployment veto a single capability the tenant asked for", () => {
    // Collections not shipped in this deployment; the tenant ticked it anyway.
    const env = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
    });
    const f = resolveEffectiveFlags(env, TENANT_ALL_ON);
    expect(f.workspaces).toBe(true);
    expect(f.collections).toBe(false);
    expect(f.physicalDeposit).toBe(false);
  });

  it("kills every sub-capability when the tenant's engine goes off", () => {
    // The rollback path. A tenant left with queues over a dark engine would see
    // permanently empty lists and conclude the product is broken.
    const rollout = normalizeRollout({
      process_engine: false,
      process_workspaces: true,
      physical_invoice_deposit: true,
      collections: true,
    });
    expect(rollout).toEqual(ROLLOUT_DISABLED);
    expect(resolveEffectiveFlags(ENV_ALL_ON, rollout)).toEqual(FLAGS_ALL_OFF);
  });

  it("keeps compatibility and override ENVIRONMENT-only — never delegable to a tenant", () => {
    // A platform admin must not be able to hand a tenant the ability to self-validate
    // by ticking a box. These two are governance escape hatches, not features.
    expect(isRolloutFeature("compatibility")).toBe(false);
    expect(isRolloutFeature("overrideAllowed")).toBe(false);

    const envNoEscapes = resolveProcessFlags({
      EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
      EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
    });
    const f = resolveEffectiveFlags(envNoEscapes, TENANT_ALL_ON);
    expect(f.overrideAllowed).toBe(false);
    expect(f.compatibility).toBe(false);
  });
});

// --------------------------------------------------------------- fail closed ----

describe("every unknown answer resolves to OFF", () => {
  it("treats a missing row as disabled", () => {
    expect(normalizeRollout(null)).toEqual(ROLLOUT_DISABLED);
  });

  it("treats a truthy-but-not-true value as disabled", () => {
    // A "1", a "true" string, a null — none of these are true.
    for (const v of ["true", 1, "1", "yes", {}, [], null, undefined]) {
      const r = normalizeRollout({ process_engine: v });
      expect(r.process_engine, String(v)).toBe(false);
    }
  });

  it("ignores unknown columns rather than inferring anything from them", () => {
    const r = normalizeRollout({ process_engine: true, gaindeEnabled: true });
    expect(r).toEqual({ ...ROLLOUT_DISABLED, process_engine: true });
  });

  it("the server reader fails CLOSED on a query error", () => {
    const src = read("../lib/process/rollout-server.ts");
    // A rollout control that opens on error is not a control.
    expect(src).toMatch(/if \(error\) return normalizeRollout\(null\)/);
  });

  it("the server reader checks the kill switch BEFORE it queries", () => {
    // The kill switch must work when the database is the thing that is broken.
    const src = read("../lib/process/rollout-server.ts");
    const body = src.slice(src.indexOf("getTenantProcessFlags = cache"));
    expect(body.indexOf("getProcessFlags()")).toBeLessThan(body.indexOf("getTenantRollout("));
  });
});

// ------------------------------------------------------------- authorization ----

describe("only a platform SUPER_ADMIN may roll out", () => {
  it("defines the permission", () => {
    expect(PLATFORM_PERMISSIONS).toContain("platform:rollout:manage");
  });

  it("grants it to SUPER_ADMIN and to nobody else", () => {
    expect(PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPER_ADMIN).toContain("platform:rollout:manage");
    for (const role of ["PLATFORM_SUPPORT", "PLATFORM_BILLING", "PLATFORM_READ_ONLY"] as const) {
      expect(PLATFORM_ROLE_PERMISSIONS[role], role).not.toContain("platform:rollout:manage");
    }
  });

  it("gates the write action on that permission", () => {
    const src = read("../lib/platform/rollout-actions.ts");
    expect(src).toContain('assertPlatformPermission("platform:rollout:manage")');
  });

  it("audits every change, with before AND after", () => {
    const src = read("../lib/platform/rollout-actions.ts");
    expect(src).toContain('action: "platform.rollout.updated"');
    expect(src).toMatch(/before,/);
    expect(src).toMatch(/after: \{ \.\.\.after/);
  });

  it("gives a tenant NO write path at all — not even a SYSTEM_ADMIN", () => {
    const sql = read("../supabase/migrations/20260714000004_tenant_process_rollout.sql");
    // SELECT policy only, and SELECT grant only. A tenant admin cannot enable their
    // own pilot: there is no policy and no privilege that would let them try.
    expect(sql).toMatch(/for select to authenticated/);
    expect(sql).not.toMatch(/for (insert|update|delete|all) to authenticated/);
    expect(sql).toMatch(/grant select on public\.tenant_process_rollout to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete|all) on public\.tenant_process_rollout/);
  });
});

// --------------------------------------------------------------- idempotency ----

describe("toggling off and on again is safe", () => {
  it("is a pure function of the two inputs — no accumulated state", () => {
    // Rollback then re-enable must land on exactly the state you started from. If
    // resolution depended on anything but (env, row), toggling could drift.
    const on = resolveEffectiveFlags(ENV_ALL_ON, TENANT_ALL_ON);
    const off = resolveEffectiveFlags(ENV_ALL_ON, ROLLOUT_DISABLED);
    const backOn = resolveEffectiveFlags(ENV_ALL_ON, TENANT_ALL_ON);
    expect(off).toEqual(FLAGS_ALL_OFF);
    expect(backOn).toEqual(on);
  });

  it("upserts rather than inserting — a re-enable cannot duplicate the row", () => {
    const src = read("../lib/platform/rollout-actions.ts");
    expect(src).toContain('{ onConflict: "tenant_id" }');
    // tenant_id is the PRIMARY KEY, so a second row is not merely avoided — it is
    // impossible.
    const sql = read("../supabase/migrations/20260714000004_tenant_process_rollout.sql");
    expect(sql).toMatch(/tenant_id\s+uuid primary key/);
  });

  it("re-enabling does not reset first_enabled_at", () => {
    const src = read("../lib/platform/rollout-actions.ts");
    // Only stamped on the transition from off -> on.
    expect(src).toContain("const nowEnabling = !before.process_engine && after.process_engine;");
    expect(src).toContain("...(nowEnabling ? { first_enabled_at:");
  });

  it("names the rollback so the audit trail says ROLLBACK, not just a diff", () => {
    const src = read("../lib/platform/rollout-actions.ts");
    expect(src).toContain("export async function rollbackTenantRollout");
    expect(src).toContain("`ROLLBACK: ${reason}`");
  });
});

// ------------------------------------------------------- no bypass remains ----

describe("no code path still asks the DEPLOYMENT what a TENANT is allowed to do", () => {
  const SRC_DIRS = ["../app", "../lib", "../components"];

  function walk(dir: string): string[] {
    const base = fileURLToPath(new URL(dir, import.meta.url));
    const out: string[] = [];
    const rec = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`;
        if (e.isDirectory()) rec(p);
        else if (/\.tsx?$/.test(e.name)) out.push(p);
      }
    };
    rec(base);
    return out;
  }

  it("leaves getProcessFlags() callable ONLY from the rollout resolver", () => {
    // This is the guard that stops the next phase from quietly reintroducing an
    // environment-wide check on a tenant-scoped decision.
    const ALLOWED = ["lib/process/config.ts", "lib/process/rollout-server.ts", "lib/platform/rollout-read.ts"];
    const offenders: string[] = [];

    for (const dir of SRC_DIRS) {
      for (const file of walk(dir)) {
        const rel = file.replace(/\\/g, "/").split(/\/(?=app\/|lib\/|components\/)/).pop()!;
        if (ALLOWED.some((a) => rel.endsWith(a))) continue;
        if (readFileSync(file, "utf8").includes("getProcessFlags()")) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("routes every rollout-controlled surface through getTenantProcessFlags", () => {
    const GUARDED = [
      "../app/my-work/page.tsx",
      "../app/queues/[queueKey]/page.tsx",
      "../app/collections/page.tsx",
      "../app/deposits/page.tsx",
      "../app/courier/page.tsx",
      "../app/portfolio/page.tsx",
      "../app/transport-readiness/page.tsx",
      "../lib/process/engine/actions.ts",
      "../lib/process/engine/service.ts",
      "../lib/process/billing/actions.ts",
      "../lib/collections/actions.ts",
      "../lib/deposit/actions.ts",
      "../lib/navigation/server.ts",
    ];
    for (const f of GUARDED) {
      expect(read(f), f).toContain("getTenantProcessFlags");
    }
  });

  it("covers all four rollout features and nothing else", () => {
    expect([...ROLLOUT_FEATURES]).toEqual([
      "process_engine",
      "process_workspaces",
      "physical_invoice_deposit",
      "collections",
    ]);
  });
});

// ----------------------------------------------------------- clean replay ----

describe("the migration is clean-replay safe", () => {
  it("inserts NO tenant-scoped row", () => {
    // Migrations run against an EMPTY database before seed.sql. A literal insert
    // referencing a tenant uuid would violate the organization FK and abort the whole
    // replay — the Phase 3.4 failure that hid for a month.
    const sql = read("../supabase/migrations/20260714000004_tenant_process_rollout.sql");
    const inserts = sql.match(/^\s*insert\s+into/gim) ?? [];
    expect(inserts).toEqual([]);
  });

  it("cannot store a sub-capability without the engine", () => {
    const sql = read("../supabase/migrations/20260714000004_tenant_process_rollout.sql");
    expect(sql).toContain("tenant_process_rollout_requires_engine");
  });
});
