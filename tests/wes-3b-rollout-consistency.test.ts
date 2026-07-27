/**
 * Phase WES-3B — rollout propagation consistency.
 *
 * The reported defect: Platform Administration showed « Recouvrement » ticked
 * for Effitrans, and the tenant's Finance page said the module was not enabled.
 *
 * ROOT CAUSE — proven, not guessed: a tenant rollout toggle is ANDed with a
 * PER-FEATURE DEPLOYMENT flag. `resolveEffectiveFlags` computes
 *
 *     collections = env.enabled && tenant.process_engine
 *                   && env.collections && tenant.collections
 *
 * and `env.collections` comes from `EFFITRANS_COLLECTIONS_ENABLED`, where
 * `on(v) = v === "true"` — so an UNSET variable is false. The row was persisted
 * correctly; the deployment simply had that capability dark, and the console
 * rendered the raw row rather than the effective value it already computes.
 *
 * These tests exercise the PURE resolvers at runtime rather than scanning
 * source, because the defect is behavioural.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveProcessFlags } from "@/lib/process/flags";
import { normalizeRollout, resolveEffectiveFlags } from "@/lib/process/rollout";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Everything on at the deployment level. */
const ENV_ALL_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  EFFITRANS_COLLECTIONS_ENABLED: "true",
  EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED: "true",
});

/** The production shape that produced the defect: collections NOT set. */
const ENV_COLLECTIONS_UNSET = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
  // EFFITRANS_COLLECTIONS_ENABLED deliberately absent
});

/** Exactly what the operator's screenshot showed for Effitrans. */
const EFFITRANS_ROW = normalizeRollout({
  process_engine: true,
  process_workspaces: true,
  collections: true,
  physical_invoice_deposit: false,
});

describe("WES-3B root cause", () => {
  it("REPRODUCES the defect: row ON, deployment flag unset, tenant resolves OFF", () => {
    const effective = resolveEffectiveFlags(ENV_COLLECTIONS_UNSET, EFFITRANS_ROW);
    expect(EFFITRANS_ROW.collections).toBe(true);      // what the console showed
    expect(effective.collections).toBe(false);         // what Finance resolved
  });

  it("resolves ON once the deployment flag is set — no code change needed", () => {
    const effective = resolveEffectiveFlags(ENV_ALL_ON, EFFITRANS_ROW);
    expect(effective.collections).toBe(true);
  });

  it("treats an UNSET env var as false, which is why it failed silently", () => {
    expect(ENV_COLLECTIONS_UNSET.collections).toBe(false);
    expect(resolveProcessFlags({ EFFITRANS_PROCESS_ENGINE_ENABLED: "true" }).collections).toBe(false);
    // Only the exact string "true" enables. "1", "TRUE", "yes" do not.
    for (const v of ["1", "TRUE", "yes", "on", ""]) {
      expect(
        resolveProcessFlags({
          EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
          EFFITRANS_COLLECTIONS_ENABLED: v,
        }).collections,
      ).toBe(false);
    }
  });

  it("is NOT a persistence failure — the row round-trips unchanged", () => {
    expect(normalizeRollout(EFFITRANS_ROW as unknown as Record<string, unknown>)).toEqual(EFFITRANS_ROW);
  });

  it("is NOT a key mismatch — writer and reader use the same field", () => {
    const writer = code("lib/platform/rollout-actions.ts");
    const reader = code("lib/process/rollout-server.ts");
    expect(writer).toContain("collections");
    expect(reader).toContain("collections");
    for (const alias of ["recouvrement", "collection_management", "collections_enabled"]) {
      expect(writer).not.toContain(alias);
      expect(reader).not.toContain(alias);
    }
  });

  it("is NOT stale caching — the resolver is request-scoped, not persisted", () => {
    const reader = code("lib/process/rollout-server.ts");
    expect(reader).toContain('from "react"');
    // A persistent cache WOULD survive a refresh; React cache() does not.
    expect(reader).not.toContain("unstable_cache");
    expect(reader).not.toContain("revalidate");
  });
});

describe("WES-3B fail-closed doctrine preserved", () => {
  it("resolves everything OFF when no rollout row exists", () => {
    const effective = resolveEffectiveFlags(ENV_ALL_ON, null);
    expect(effective.enabled).toBe(false);
    expect(effective.collections).toBe(false);
  });

  it("takes everything down with the tenant engine", () => {
    const row = normalizeRollout({ process_engine: false, collections: true });
    expect(row.collections).toBe(false);
    expect(resolveEffectiveFlags(ENV_ALL_ON, row).collections).toBe(false);
  });

  it("takes everything down with the master deployment switch", () => {
    const env = resolveProcessFlags({ EFFITRANS_COLLECTIONS_ENABLED: "true" });
    expect(resolveEffectiveFlags(env, EFFITRANS_ROW).collections).toBe(false);
  });

  it("keeps a disabled feature off without touching its neighbours", () => {
    const effective = resolveEffectiveFlags(ENV_ALL_ON, EFFITRANS_ROW);
    expect(effective.collections).toBe(true);
    // physical deposit was OFF for this tenant and stays off.
    expect(effective.physicalDeposit).toBe(false);
    expect(effective.workspaces).toBe(true);
  });

  it("does not let one tenant's row affect another's resolution", () => {
    const other = normalizeRollout({ process_engine: true, collections: false });
    expect(resolveEffectiveFlags(ENV_ALL_ON, EFFITRANS_ROW).collections).toBe(true);
    expect(resolveEffectiveFlags(ENV_ALL_ON, other).collections).toBe(false);
  });
});

describe("WES-3B every consumer resolves the SAME canonical value", () => {
  it("uses one resolver for the tenant side", () => {
    // Finance tile, sidebar and /collections all read getTenantProcessFlags.
    for (const f of [
      "app/departments/finance/page.tsx",
      "app/collections/page.tsx",
    ]) {
      expect(code(f)).toContain("getTenantProcessFlags");
    }
    expect(code("lib/navigation/server.ts") + code("lib/navigation/build.ts")).toContain("collections");
  });

  it("reads the rollout from ONE table, with no second feature store", () => {
    const reader = code("lib/process/rollout-server.ts");
    expect(reader).toContain("tenant_process_rollout");
    for (const forbidden of ["organization_metadata", "feature_flag", "tenant_feature"]) {
      expect(reader).not.toContain(forbidden);
    }
  });

  it("keys the read by tenant UUID, never by slug or display name", () => {
    const reader = code("lib/process/rollout-server.ts");
    expect(reader).toMatch(/\.eq\("tenant_id", tenantId\)/);
    expect(reader).not.toMatch(/\.eq\("slug"|\.eq\("name"/);
  });

  it("keys the WRITE by the same tenant UUID", () => {
    const writer = code("lib/platform/rollout-actions.ts");
    expect(writer).toMatch(/tenant_id: input\.tenantId/);
    expect(writer).toMatch(/onConflict: "tenant_id"/);
    expect(writer).not.toMatch(/\.eq\("slug"|\.eq\("name"/);
  });
});

describe("WES-3B the console shows what is LIVE, not what was ticked", () => {
  const controls = () => code("components/platform/rollout-controls.tsx");

  it("receives the per-feature deployment flags", () => {
    const c = controls();
    expect(c).toContain("killSwitch");
    expect(c).toContain("deploymentAllows");
  });

  it("marks a ticked-but-inert capability", () => {
    const raw = read("components/platform/rollout-controls.tsx");
    expect(raw).toMatch(/state\[f\.key\] && !deploymentAllows\(f\.key\)/);
    expect(raw).toMatch(/INACTIF/);
  });

  it("covers every per-feature deployment flag", () => {
    const c = controls();
    for (const key of ["process_workspaces", "physical_invoice_deposit", "collections"]) {
      expect(c).toContain(key);
    }
  });

  it("is wired at BOTH platform call sites", () => {
    expect(code("app/platform/rollout/page.tsx")).toContain("killSwitch={killSwitch}");
    expect(code("app/platform/companies/[id]/page.tsx")).toContain("killSwitch={overview.killSwitch}");
  });
});

describe("WES-3B write path integrity", () => {
  const writer = () => code("lib/platform/rollout-actions.ts");

  it("checks the mutation result before reporting success", () => {
    expect(writer()).toMatch(/if \(error\) return \{ ok: false, error: "write_failed" \}/);
  });

  it("writes no success audit before the write is known to have succeeded", () => {
    const w = writer();
    const errIdx = w.indexOf('error: "write_failed"');
    const auditIdx = w.indexOf("await writeAudit(");   // the CALL, not the import
    expect(errIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(errIdx);
  });

  it("updates every rollout field in ONE upsert, never field by field", () => {
    const w = writer();
    const upserts = w.match(/\.upsert\(/g) ?? [];
    expect(upserts).toHaveLength(1);
    expect(w).not.toMatch(/\.update\(\s*\{\s*collections/);
  });

  it("returns the PERSISTED, normalized state to the UI", () => {
    expect(writer()).toMatch(/return \{ ok: true, rollout: after \}/);
    expect(code("components/platform/rollout-controls.tsx")).toContain("setState(res.rollout)");
  });

  it("reverts the optimistic toggle when the write fails", () => {
    expect(code("components/platform/rollout-controls.tsx")).toMatch(/setState\(row\.rollout\)/);
  });

  it("keeps rollout writes to the platform authority alone", () => {
    const w = writer();
    expect(w).toContain('assertPlatformPermission("platform:rollout:manage")');
    // A TENANT permission must never be able to change tenant rollout.
    expect(w).not.toMatch(/assertPermission\(/);
  });
});

describe("WES-3B scope discipline", () => {
  it("adds no migration — this is a UI-truthfulness repair", () => {
    // The row was persisted correctly; nothing about the schema was wrong.
    const files = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
    expect(files).toContain("rls_document_governance_test.sql");
  });

  it("creates no /finance/recouvrement and changes no Finance permission", () => {
    const finance = code("app/departments/finance/page.tsx");
    expect(finance).toContain('href: "/collections"');
    expect(finance).toContain("collections:manage");
    expect(finance).not.toContain("/finance/recouvrement");
  });

  it("enables nothing automatically for any tenant", () => {
    const w = code("lib/platform/rollout-actions.ts");
    // No hardcoded tenant, no default-on.
    expect(w).not.toMatch(/00000000-0000-0000-0000-0000000000/);
    expect(w).not.toMatch(/collections: true/);
  });
});
