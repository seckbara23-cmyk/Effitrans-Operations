/**
 * Tenant entitlements contract (Phase 4.0B-2). PURE — CONTRACT ONLY.
 * ---------------------------------------------------------------------------
 * Prepares the plan / module-entitlement model WITHOUT enforcing it. Enforcement
 * (route/feature gating) is Phase 4.0D. Three distinct layers, kept separate:
 *
 *   Plan             → entitlement DEFAULTS (which modules a plan turns on)
 *   Tenant modules   → the modules actually ENABLED for a tenant
 *   Role permission  → the actions ALLOWED inside a module (tenant RBAC — separate)
 *
 * Entitlements are NEVER merged into RBAC: a module being enabled does not grant
 * any permission, and holding a permission does not enable a module.
 */

export const MODULE_KEYS = [
  "module.documentation",
  "module.customs",
  "module.transport",
  "module.finance",
  "module.analytics",
  "module.client_portal",
  "module.driver",
  "module.tracking",
  "module.ai",
  "module.integrations",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The modules a tenant has enabled (a full selection; missing keys = disabled). */
export type TenantModuleSelection = Partial<Record<ModuleKey, boolean>>;

export const PLAN_KEYS = ["STARTER", "PROFESSIONAL", "ENTERPRISE"] as const;
export type TenantPlanKey = (typeof PLAN_KEYS)[number];

const CORE: ModuleKey[] = [
  "module.documentation",
  "module.customs",
  "module.transport",
  "module.finance",
  "module.analytics",
  "module.client_portal",
];

/** Plan → default enabled modules (additive tiers). */
export const PLAN_MODULE_DEFAULTS: Record<TenantPlanKey, readonly ModuleKey[]> = {
  STARTER: [...CORE],
  PROFESSIONAL: [...CORE, "module.tracking", "module.driver", "module.ai"],
  ENTERPRISE: [...MODULE_KEYS],
};

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}

export function isPlanKey(v: string): v is TenantPlanKey {
  return (PLAN_KEYS as readonly string[]).includes(v);
}

export function defaultModulesForPlan(plan: TenantPlanKey): readonly ModuleKey[] {
  return PLAN_MODULE_DEFAULTS[plan] ?? [];
}

/**
 * Resolve a tenant's enabled modules: start from the plan defaults, then apply any
 * explicit per-tenant overrides (true enables, false disables). Deterministic;
 * returns modules in canonical MODULE_KEYS order.
 */
export function resolveTenantModules(
  plan: TenantPlanKey,
  overrides?: TenantModuleSelection,
): ModuleKey[] {
  const enabled = new Set<ModuleKey>(defaultModulesForPlan(plan));
  if (overrides) {
    for (const key of MODULE_KEYS) {
      const v = overrides[key];
      if (v === true) enabled.add(key);
      else if (v === false) enabled.delete(key);
    }
  }
  return MODULE_KEYS.filter((k) => enabled.has(k));
}
