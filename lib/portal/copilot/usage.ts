/**
 * Customer AI Assistant — rate limiting (Phase 7.6C). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * REUSES the shared audit-log counter (lib/copilot/rate-limit) with the PORTAL actor column
 * (client_user_id) instead of the staff column — no new table, no new logic. Portal limits are
 * deliberately TIGHTER than the internal copilot's: a customer asks a handful of questions about
 * their own dossier, so a lower ceiling bounds both cost and abuse of an internet-facing surface.
 *
 * There is intentionally NO portal usage-summary endpoint: the internal usage view
 * (lib/logistics/copilot/usage.ts, audit:read:all) already reports token/latency aggregates to
 * staff, and a customer must never see provider, model, token or latency diagnostics.
 */
import "server-only";
import { AuditActions } from "@/lib/audit/events";
import { checkAuditRateLimit, intEnv, type RateLimitResult } from "@/lib/copilot/rate-limit";

const ACTION = AuditActions.PORTAL_COPILOT_QUERY;

export type { RateLimitResult };

/** Portal limits (env-overridable, safe defaults). Tighter than the staff copilot's. */
export function portalCopilotRateLimits(env: NodeJS.ProcessEnv = process.env): { perUserPerMin: number; perTenantPerDay: number } {
  return {
    perUserPerMin: intEnv(env.PORTAL_COPILOT_USER_RATE_PER_MIN, 6),
    perTenantPerDay: intEnv(env.PORTAL_COPILOT_TENANT_RATE_PER_DAY, 1000),
  };
}

/** Bounded rate check for a PORTAL actor: own queries (1 min) + tenant-wide portal usage (24 h). */
export async function checkPortalCopilotRateLimit(user: { id: string; tenantId: string }): Promise<RateLimitResult> {
  const { perUserPerMin, perTenantPerDay } = portalCopilotRateLimits();
  return checkAuditRateLimit({
    action: ACTION,
    tenantId: user.tenantId,
    actorColumn: "client_user_id",
    actorId: user.id,
    perActorPerMin: perUserPerMin,
    perTenantPerDay,
  });
}
