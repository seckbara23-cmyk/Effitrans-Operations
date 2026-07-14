/**
 * Tenant-scoped rollout resolution (Phase 5.0E-2A). PURE — no env, no I/O.
 * ---------------------------------------------------------------------------
 * THE RULE, in one place:
 *
 *     effective(feature) = global_env(feature) AND tenant_row(feature)
 *
 * Two gates with different jobs, and they are not interchangeable:
 *
 *   • The ENV FLAG is the KILL SWITCH. It ships with the deployment and needs no
 *     database access, so it still works when the database is the thing that is
 *     broken. Flipping it off stops the feature for every tenant at once.
 *
 *   • The TENANT ROW is the ENABLEMENT. A platform admin toggles it without a
 *     redeploy, which is what makes a one-tenant pilot possible at all.
 *
 * BOTH default to false and a MISSING ROW MEANS DISABLED. Every "unknown" answer in
 * this file resolves to OFF. A tenant nobody has thought about cannot acquire the
 * engine through a forgotten migration, a half-finished provisioning run, or a typo.
 *
 * This is also the only place that knows a sub-capability requires its master. The
 * env resolver already enforces that (lib/process/flags.ts); so does a CHECK
 * constraint on the table. Three layers agree, deliberately: getting this wrong
 * means showing a user queues over a dark engine, which are always empty.
 */
import type { ProcessFlags } from "./flags";

/** The capabilities a platform admin can roll out per tenant. */
export const ROLLOUT_FEATURES = [
  "process_engine",
  "process_workspaces",
  "physical_invoice_deposit",
  "collections",
] as const;
export type RolloutFeature = (typeof ROLLOUT_FEATURES)[number];

/** One row of public.tenant_process_rollout. */
export type TenantRollout = Record<RolloutFeature, boolean>;

/** The state every tenant starts in, and falls back to whenever anything is unknown. */
export const ROLLOUT_DISABLED: TenantRollout = {
  process_engine: false,
  process_workspaces: false,
  physical_invoice_deposit: false,
  collections: false,
};

export function isRolloutFeature(v: string): v is RolloutFeature {
  return (ROLLOUT_FEATURES as readonly string[]).includes(v);
}

/**
 * Normalize whatever came back from the database into a TenantRollout.
 * `null` (no row) → everything off. Anything not exactly `true` → off.
 */
export function normalizeRollout(row: Partial<Record<string, unknown>> | null): TenantRollout {
  if (!row) return { ...ROLLOUT_DISABLED };
  const out = { ...ROLLOUT_DISABLED };
  for (const f of ROLLOUT_FEATURES) {
    out[f] = row[f] === true;
  }
  // A sub-capability without the engine is incoherent. Enforced here as well as by
  // the CHECK constraint, so a hand-edited row cannot produce empty queues.
  if (!out.process_engine) {
    out.process_workspaces = false;
    out.physical_invoice_deposit = false;
    out.collections = false;
  }
  return out;
}

/**
 * THE effective flags for one tenant. `env` is the deployment kill switch (already
 * resolved by resolveProcessFlags); `rollout` is the tenant's row, or null.
 *
 * Note what is NOT tenant-scoped: `compatibility` and `overrideAllowed`. Those are
 * governance escape hatches, not features — historical backfill and the
 * maker-checker override. They stay purely environment-controlled so that no
 * platform admin can hand a tenant the ability to self-validate by ticking a box.
 */
export function resolveEffectiveFlags(
  env: ProcessFlags,
  rollout: TenantRollout | null,
): ProcessFlags {
  const t = normalizeRollout(rollout);

  const enabled = env.enabled && t.process_engine;

  return {
    enabled,
    // Every sub-capability requires the effective master, exactly as in the env
    // resolver — so "engine rolled back" really does mean everything goes dark.
    workspaces: enabled && env.workspaces && t.process_workspaces,
    physicalDeposit: enabled && env.physicalDeposit && t.physical_invoice_deposit,
    collections: enabled && env.collections && t.collections,
    // Environment-only. Deliberately not delegable to a tenant toggle.
    compatibility: enabled && env.compatibility,
    overrideAllowed: enabled && env.overrideAllowed,
  };
}

/** Nothing is on. Used wherever a tenant cannot be resolved. */
export const FLAGS_ALL_OFF: ProcessFlags = {
  enabled: false,
  workspaces: false,
  physicalDeposit: false,
  collections: false,
  compatibility: false,
  overrideAllowed: false,
};
