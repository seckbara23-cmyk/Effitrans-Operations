/**
 * Tenant rollout reader (Phase 5.0E-2A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The ONE place that resolves "is the official process live for THIS tenant".
 * Navigation, route guards and every engine mutation call through here, so there
 * is a single answer and it cannot drift between what a user can SEE and what they
 * can DO.
 *
 * Request-memoized (React cache): a page that checks the flags in the layout, in the
 * route guard and again inside a service pays for ONE query.
 *
 * FAIL CLOSED. If the row is missing, the query errors, or the tenant cannot be
 * resolved, the answer is OFF. A rollout control that fails open is not a control.
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { ProcessFlags } from "./flags";
import { getProcessFlags } from "./config";
import {
  resolveEffectiveFlags,
  normalizeRollout,
  FLAGS_ALL_OFF,
  type TenantRollout,
} from "./rollout";

/** The tenant's raw rollout row (all-false when absent). */
export const getTenantRollout = cache(async (tenantId: string): Promise<TenantRollout> => {
  if (!tenantId) return normalizeRollout(null);

  const admin = getAdminSupabaseClient();
  const { data, error } = await admin
    .from("tenant_process_rollout")
    .select("process_engine, process_workspaces, physical_invoice_deposit, collections")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  // Fail closed: a rollout control that opens on error is not a control.
  if (error) return normalizeRollout(null);
  return normalizeRollout(data as Record<string, unknown> | null);
});

/**
 * THE effective process flags for one tenant: the deployment kill switch ANDed with
 * the tenant's enablement.
 *
 * The env flag is checked FIRST and short-circuits. That is not just an optimization:
 * with the kill switch off we must not query the database at all, because the kill
 * switch has to keep working when the database is the thing that is broken.
 */
export const getTenantProcessFlags = cache(async (tenantId: string): Promise<ProcessFlags> => {
  const env = getProcessFlags();
  if (!env.enabled) return FLAGS_ALL_OFF;
  if (!tenantId) return FLAGS_ALL_OFF;

  const rollout = await getTenantRollout(tenantId);
  return resolveEffectiveFlags(env, rollout);
});

/**
 * The GLOBAL kill switch, with no tenant and no query.
 *
 * Call this ONLY where a tenant is not yet known and a cheap "is this feature dark
 * everywhere" answer is enough — chiefly the root layout, which must not resolve a
 * session before it knows the feature is even compiled in (a cookie-reading layout
 * forces every route beneath it to render dynamically). It is a NECESSARY condition,
 * never a sufficient one: any code that acts on a tenant must call
 * getTenantProcessFlags.
 */
export function globalKillSwitch(): ProcessFlags {
  return getProcessFlags();
}
