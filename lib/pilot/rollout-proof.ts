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
  const { data: row } = await admin
    .from("tenant_process_rollout")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const rolloutRowMissing = !row;

  const verdict = !env.enabled
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
