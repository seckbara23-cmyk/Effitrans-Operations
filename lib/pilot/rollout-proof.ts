/**
 * Effective rollout proof (Phase 5.0E-3D). SERVER-ONLY, READ-ONLY.
 * ---------------------------------------------------------------------------
 * Prints the eight numbers that answer "is the official process actually on for us,
 * and if not, which of the two gates is closed?"
 *
 *     effective(feature) = global_env(feature) AND tenant_row(feature)
 *
 * WHY THIS EXISTS AS A PAGE RATHER THAN A QUERY I RAN FOR YOU
 *
 * The two gates live in two different places, and neither is visible from a laptop:
 * the GLOBAL flags are Vercel environment variables, and the TENANT row is in the
 * linked Supabase project. Reading them from outside means holding production
 * credentials. Reading them from INSIDE means the app tells you what it actually
 * resolved — which is the thing you want to know anyway. A number I transcribe from a
 * console can be stale by the time you read it; this one cannot be, because it IS the
 * value the navigation and the route guards used on this very request.
 *
 * It calls the SAME resolvers the sidebar and every engine guard call. There is no
 * second opinion here: if this says Effective Workspaces = false, then Mon Travail
 * 404s, and that is not a coincidence — it is the same function.
 *
 * Exposes only rollout booleans and the organization's own id/slug. No secret, no key,
 * no other tenant.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  globalKillSwitch,
  getTenantRollout,
  getTenantProcessFlags,
} from "@/lib/process/rollout-server";

export type RolloutProof = {
  /** The deployment kill switch — Vercel env, no database involved. */
  globalEngine: boolean;
  globalWorkspaces: boolean;
  /** The tenant's row in tenant_process_rollout. Absent row = both false. */
  tenantEngine: boolean;
  tenantWorkspaces: boolean;
  /** What the app ACTUALLY used on this request: global AND tenant. */
  effectiveEngine: boolean;
  effectiveWorkspaces: boolean;
  organizationId: string;
  organizationSlug: string | null;
  organizationName: string | null;
  /** True when no row exists at all — the state every un-piloted tenant is in. */
  rolloutRowMissing: boolean;
  /**
   * True when the TABLE itself is absent — i.e. migration 20260714000004 has never been
   * applied to this database.
   *
   * This distinction matters and the first version of this page could not make it.
   * getTenantRollout() fails CLOSED on any error (correctly — a rollout control that
   * opens on error is not a control), so "table does not exist" and "row does not exist"
   * produced identical output: both said DISABLED. They call for completely different
   * actions — one is `supabase db push`, the other is a click in the platform console —
   * and a diagnostic that cannot tell them apart sends you to the wrong one.
   */
  rolloutTableMissing: boolean;
  /** The raw Postgres error, when the lookup failed. Sanitized: code + message only. */
  dbError: string | null;
  /** Whether ANY platform admin exists. Without one, nobody can enable this tenant. */
  platformAdminCount: number;
  /** Which gate is closed, in one sentence. The whole point of the page. */
  verdict: string;
};

export async function getRolloutProof(tenantId: string): Promise<RolloutProof> {
  // globalKillSwitch(), not getProcessFlags(): a repo guard forbids reading the raw env
  // flags outside the resolver, precisely so a tenant-scoped decision can never regress
  // to a deployment-wide one. We only want to DISPLAY the global gate, and this is the
  // sanctioned accessor for it — "a necessary condition, never a sufficient one".
  const env = globalKillSwitch();
  const rollout = await getTenantRollout(tenantId);
  const effective = await getTenantProcessFlags(tenantId);

  const admin = getAdminSupabaseClient();
  const { data: org } = await admin
    .from("organization")
    .select("id, slug, name")
    .eq("id", tenantId)
    .maybeSingle();

  // A missing row and an all-false row are indistinguishable to the resolver (both mean
  // DISABLED, by design), but they are NOT the same thing to a human: one means "nobody
  // has enabled this tenant", the other means "somebody turned it off".
  const { data: row, error: rowError } = await admin
    .from("tenant_process_rollout")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Postgres 42P01 = undefined_table. PostgREST surfaces it as PGRST205 / "does not
  // exist" depending on version, so we match on both the code and the text.
  const rolloutTableMissing = Boolean(
    rowError &&
      (rowError.code === "42P01" ||
        rowError.code === "PGRST205" ||
        /does not exist|schema cache/i.test(rowError.message ?? "")),
  );
  const rolloutRowMissing = !row && !rolloutTableMissing;
  const dbError = rowError ? `${rowError.code ?? "?"}: ${rowError.message ?? "unknown"}` : null;

  // Nobody can enable a tenant without a platform admin, and none is seeded by any
  // migration. If this is 0, the rollout console is unreachable by every human alive —
  // which is the actual reason a tenant can sit at "no row" forever.
  const { count } = await admin
    .from("platform_admin")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const platformAdminCount = count ?? 0;

  const verdict = rolloutTableMissing
    ? "The tenant_process_rollout TABLE does not exist in this database. Migration 20260714000004 has never been applied here. Run `supabase db push` against the linked project — nothing else will work until you do."
    : platformAdminCount === 0 && rolloutRowMissing
      ? "BOOTSTRAP DEADLOCK: this tenant has no rollout row, and NO platform admin exists to create one. A tenant SYSTEM_ADMIN cannot enable its own rollout (by design). Run supabase/scripts/bootstrap_platform_super_admin.sql once, then enable the tenant at /platform/rollout."
      : !env.enabled
    ? "GLOBAL kill switch is OFF. EFFITRANS_PROCESS_ENGINE_ENABLED is not set in the deployment, so the engine is dark for EVERY tenant — the tenant row below is irrelevant until it is set."
    : !env.workspaces
      ? "Global engine is ON but EFFITRANS_PROCESS_WORKSPACES_ENABLED is not set, so no workspace or queue is reachable for anyone."
      : rolloutRowMissing
        ? "Global flags are ON, but this tenant has NO rollout row — which means DISABLED. Enable it at /platform/rollout (platform SUPER_ADMIN)."
        : !rollout.process_engine
          ? "Global flags are ON, but this tenant's engine is switched OFF. Enable it at /platform/rollout."
          : !rollout.process_workspaces
            ? "Engine is on for this tenant, but its workspaces are not. Mon Travail and Parcours des dossiers will 404."
            : "LIVE. Both gates are open: the official process is active for this tenant.";

  return {
    rolloutTableMissing,
    dbError,
    platformAdminCount,
    globalEngine: env.enabled,
    globalWorkspaces: env.workspaces,
    tenantEngine: rollout.process_engine,
    tenantWorkspaces: rollout.process_workspaces,
    effectiveEngine: effective.enabled,
    effectiveWorkspaces: effective.workspaces,
    organizationId: (org?.id as string) ?? tenantId,
    organizationSlug: (org?.slug as string) ?? null,
    organizationName: (org?.name as string) ?? null,
    rolloutRowMissing,
    verdict,
  };
}
