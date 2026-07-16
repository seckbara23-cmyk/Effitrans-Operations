/**
 * Shared Copilot rate limiting (Phase 7.6C — extracted from 7.6B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reuses the EXISTING audit_log as the counter (no new table, no new state): a copilot's own
 * per-query audit rows ARE its rate-limit ledger. Extracted from lib/logistics/copilot/usage.ts so
 * the Logistics Copilot (staff actor → actor_id) and the Customer Portal Copilot (portal actor →
 * client_user_id) share ONE bounded counting rule instead of each copying it. The only difference
 * between callers is the action name, the actor COLUMN, and the limits.
 *
 * Bounded by construction: two `head: true` COUNT queries over an indexed (tenant, action, time)
 * window — never a tenant-wide row scan, never N+1.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

/** Which audit column attributes the actor — staff (actor_id) or portal (client_user_id). */
export type ActorColumn = "actor_id" | "client_user_id";

export type RateLimitResult = { ok: true } | { ok: false; scope: "user" | "tenant" };

/** Read a positive integer env override, else the documented default. */
export function intEnv(v: string | undefined, def: number): number {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/**
 * Bounded rate check over the copilot's own audit rows: per-actor (short window) and per-tenant
 * (daily). The actor window fails first so a single noisy caller is told it is THEIR limit.
 */
export async function checkAuditRateLimit(input: {
  action: string;
  tenantId: string;
  actorColumn: ActorColumn;
  actorId: string;
  perActorPerMin: number;
  perTenantPerDay: number;
}): Promise<RateLimitResult> {
  const admin = getAdminSupabaseClient();
  const nowMs = Date.now();
  const minAgo = new Date(nowMs - 60_000).toISOString();
  const dayAgo = new Date(nowMs - 86_400_000).toISOString();

  const [actorRes, tenantRes] = await Promise.all([
    admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq(input.actorColumn, input.actorId)
      .eq("action", input.action)
      .gte("occurred_at", minAgo),
    admin
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("action", input.action)
      .gte("occurred_at", dayAgo),
  ]);

  if ((actorRes.count ?? 0) >= input.perActorPerMin) return { ok: false, scope: "user" };
  if ((tenantRes.count ?? 0) >= input.perTenantPerDay) return { ok: false, scope: "tenant" };
  return { ok: true };
}
