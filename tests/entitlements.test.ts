/**
 * Phase 4.0B-2 — entitlements contract (module keys, plan defaults, resolution).
 */
import { describe, it, expect } from "vitest";
import {
  MODULE_KEYS,
  PLAN_KEYS,
  PLAN_MODULE_DEFAULTS,
  defaultModulesForPlan,
  resolveTenantModules,
  isModuleKey,
  isPlanKey,
} from "@/lib/platform/entitlements";

describe("entitlements contract", () => {
  it("exposes the ten module keys in the module.* namespace", () => {
    expect(MODULE_KEYS).toHaveLength(10);
    for (const k of MODULE_KEYS) expect(k.startsWith("module.")).toBe(true);
  });

  it("plan defaults are additive tiers (STARTER ⊆ PROFESSIONAL ⊆ ENTERPRISE)", () => {
    const starter = new Set(PLAN_MODULE_DEFAULTS.STARTER);
    const pro = new Set(PLAN_MODULE_DEFAULTS.PROFESSIONAL);
    const ent = new Set(PLAN_MODULE_DEFAULTS.ENTERPRISE);
    for (const m of starter) expect(pro.has(m)).toBe(true);
    for (const m of pro) expect(ent.has(m)).toBe(true);
    expect(ent.size).toBe(MODULE_KEYS.length); // ENTERPRISE enables everything
  });

  it("resolveTenantModules starts from plan defaults", () => {
    expect(resolveTenantModules("STARTER")).toEqual([...defaultModulesForPlan("STARTER")]);
  });

  it("overrides enable/disable individual modules and stay in canonical order", () => {
    const resolved = resolveTenantModules("STARTER", {
      "module.ai": true,
      "module.finance": false,
    });
    expect(resolved).toContain("module.ai");
    expect(resolved).not.toContain("module.finance");
    // canonical MODULE_KEYS order preserved
    const ordered = MODULE_KEYS.filter((k) => resolved.includes(k));
    expect(resolved).toEqual(ordered);
  });

  it("guards", () => {
    expect(isModuleKey("module.finance")).toBe(true);
    expect(isModuleKey("finance")).toBe(false);
    expect(isPlanKey("ENTERPRISE")).toBe(true);
    expect(isPlanKey("TRIAL")).toBe(false); // TRIAL is a lifecycle state, not a plan
    expect([...PLAN_KEYS]).toEqual(["STARTER", "PROFESSIONAL", "ENTERPRISE"]);
  });
});
