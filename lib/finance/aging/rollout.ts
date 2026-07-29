/**
 * Aging Balance rollout. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The same env-kill-switch idiom the Messaging Center uses (lib/messaging/
 * rollout.ts), NOT a second rollout system and NOT forced into the 26-step
 * engine's ROLLOUT_FEATURES — the Aging Balance has no dependency on that engine,
 * and adding a column to `tenant_process_rollout` would mean a migration this
 * phase is not authorised to write.
 *
 * ===========================================================================
 * WHY ONE LAYER HERE AND TWO ELSEWHERE
 * ===========================================================================
 * Messaging pairs the env flag with a `tenant_messaging_rollout` row so a single
 * tenant can pilot it. The Aging Balance does not need that yet, and inventing
 * the table now would be speculative: production darkness is already absolute
 * through a stronger mechanism.
 *
 * `finance:aging:read` DOES NOT EXIST in the production database. Migration 72
 * is unapplied, so the permission row is absent, so no role can hold it, so the
 * gate denies everyone and the nav entry never renders — regardless of what any
 * environment variable says. The env flag exists so development and preview can
 * turn the workspace ON for authorised users without that being a production
 * decision, and so there is a kill switch that works when the database is the
 * thing that is broken.
 *
 * When a tenant-by-tenant pilot is actually needed, the tenant row joins this
 * function and the rule becomes `env AND tenant_row`, exactly as messaging does.
 *
 * FAIL CLOSED: unset, empty or anything other than the literal "true" is OFF.
 */
import "server-only";

/** The GLOBAL kill switch. NECESSARY, never sufficient — the permission still decides. */
export function agingWorkspaceEnabled(): boolean {
  return process.env.EFFITRANS_FINANCE_AGING_ENABLED === "true";
}
