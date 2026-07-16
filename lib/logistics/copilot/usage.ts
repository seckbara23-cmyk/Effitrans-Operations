/**
 * Logistics Copilot — rate limiting + usage visibility (Phase 7.6B, Parts 14-15). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reuses the EXISTING audit_log (no new table): the per-query LOGISTICS_COPILOT_QUERY rows are
 * both the rate-limit counter and the usage-summary source. Rate limits are per-user (short
 * window) and per-tenant (daily), env-configurable with safe defaults. The usage summary is
 * admin-gated (audit:read:all) and exposes SAFE aggregates only — counts, outcomes, average
 * duration, and token totals where present — never a prompt, an answer, or a secret.
 */
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { AuditActions } from "@/lib/audit/events";
import { checkAuditRateLimit, intEnv, type RateLimitResult } from "@/lib/copilot/rate-limit";
import type { CopilotUsageSummary } from "./types";

const ACTION = AuditActions.LOGISTICS_COPILOT_QUERY;

export function copilotRateLimits(env: NodeJS.ProcessEnv = process.env): { perUserPerMin: number; perTenantPerDay: number } {
  return { perUserPerMin: intEnv(env.COPILOT_USER_RATE_PER_MIN, 12), perTenantPerDay: intEnv(env.COPILOT_TENANT_RATE_PER_DAY, 2000) };
}

export type { RateLimitResult };

/** Bounded rate check: counts recent copilot audit rows for the STAFF user (1 min) + tenant (24 h).
 *  Delegates to the shared counter (7.6C) — the portal copilot uses it with the portal actor. */
export async function checkCopilotRateLimit(user: { id: string; tenantId: string }): Promise<RateLimitResult> {
  const { perUserPerMin, perTenantPerDay } = copilotRateLimits();
  return checkAuditRateLimit({
    action: ACTION,
    tenantId: user.tenantId,
    actorColumn: "actor_id",
    actorId: user.id,
    perActorPerMin: perUserPerMin,
    perTenantPerDay,
  });
}

type AuditAfter = { provider?: string; model?: string; durationMs?: number; outcome?: string; tokens?: { prompt?: number; completion?: number; total?: number } | null };

/** Admin-safe usage aggregates over the copilot audit rows (tenant-scoped). No prompt/answer. */
export async function getCopilotUsageSummary(windowDays = 7): Promise<CopilotUsageSummary> {
  const user = await assertPermission("audit:read:all");
  const admin = getAdminSupabaseClient();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data } = await admin
    .from("audit_log")
    .select("after, occurred_at")
    .eq("tenant_id", user.tenantId)
    .eq("action", ACTION)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .range(0, 5000)
    .returns<{ after: AuditAfter | null; occurred_at: string }[]>();

  const rows = data ?? [];
  let answered = 0, fallback = 0, failed = 0, exports = 0, durSum = 0, durN = 0, pT = 0, cT = 0, tT = 0, hasTokens = false;
  const providers = new Set<string>(), models = new Set<string>();
  for (const r of rows) {
    const a = r.after ?? {};
    switch (a.outcome) {
      case "answered": answered++; break;
      case "fallback": fallback++; break;
      case "failed": failed++; break;
      case "export": exports++; break;
    }
    if (typeof a.durationMs === "number") { durSum += a.durationMs; durN++; }
    if (a.provider) providers.add(a.provider);
    if (a.model) models.add(a.model);
    if (a.tokens) { hasTokens = true; pT += a.tokens.prompt ?? 0; cT += a.tokens.completion ?? 0; tT += a.tokens.total ?? 0; }
  }
  return {
    windowDays,
    total: rows.length,
    answered, fallback, failed, exports,
    avgDurationMs: durN ? Math.round(durSum / durN) : null,
    tokens: hasTokens ? { prompt: pT, completion: cT, total: tT } : null,
    providers: Array.from(providers),
    models: Array.from(models),
  };
}
