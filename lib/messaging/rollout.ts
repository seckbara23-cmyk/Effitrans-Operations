/**
 * Messaging Center rollout (Phase 8.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Independent of the 26-step process engine's rollout (lib/process/rollout.ts):
 * messaging has no dependency on that engine, so it gets its own tiny env-kill-
 * switch + tenant-row pair rather than being force-fit into ROLLOUT_FEATURES.
 * Same rule: effective = env_enabled AND tenant_row_enabled. FAIL CLOSED — a
 * missing row, a query error, or an unresolved tenant all mean OFF.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

function envEnabled(): boolean {
  return process.env.EFFITRANS_MESSAGING_CENTER_ENABLED === "true";
}

/** The GLOBAL kill switch — no tenant, no query. NECESSARY, never sufficient. */
export function messagingGlobalKillSwitch(): boolean {
  return envEnabled();
}

/** THE effective answer for one tenant: env kill switch ANDed with the tenant's own enablement. */
export const getTenantMessagingEnabled = cache(async (tenantId: string): Promise<boolean> => {
  if (!envEnabled()) return false;
  if (!tenantId) return false;

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("tenant_messaging_rollout")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) return false; // fail closed
  return data.enabled === true;
});
