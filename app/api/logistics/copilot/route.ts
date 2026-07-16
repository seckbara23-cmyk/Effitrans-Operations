/**
 * Logistics Copilot route (Phase 7.6A + 7.6B) — /api/logistics/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only, grounded operational assistance for internal staff. POST:
 *   1. authorizes via logistics:copilot:read (throws → 403),
 *   2. enforces a bounded rate limit (per-user + per-tenant, over the audit log),
 *   3. builds the BOUNDED, read-only, permission-degraded, question-BUDGETED context,
 *   4. computes DETERMINISTIC recommendation cards (no model, no fabrication),
 *   5. asks the SHARED provider-neutral engine (runCopilotDetailed — usage/latency for audit)
 *      grounded in the same context + bounded session history — and on ANY provider failure or
 *      rate-limit returns the DETERMINISTIC summary (the UI never fails),
 *   6. audits SAFE metadata only (provider, model, modules available/unavailable, counts,
 *      truncated, recommendation kinds, duration, token usage, outcome) — never the prompt,
 *      the answer, the history, or any secret.
 * No DB writes (except the audit row), no SQL from the AI, no mutation, no tools.
 */
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/auth/require-permission";
import { buildLogisticsCopilotContext } from "@/lib/logistics/copilot/context";
import { buildRecommendations, deterministicSummary } from "@/lib/logistics/copilot/cards";
import { buildLogisticsMessages } from "@/lib/logistics/copilot/prompt";
import { checkCopilotRateLimit } from "@/lib/logistics/copilot/usage";
import { runCopilotDetailed, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
import { copilotErrorMessage } from "@/lib/copilot/provider-ux";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 1200;

type HistoryTurn = { role: "user" | "assistant"; content: string };
function sanitizeHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { role: unknown; content: unknown } => !!t && typeof t === "object")
    .map((t): HistoryTurn => ({ role: (t as HistoryTurn).role === "assistant" ? "assistant" : "user", content: typeof (t as HistoryTurn).content === "string" ? (t as HistoryTurn).content.slice(0, MAX_TURN_CHARS) : "" }))
    .filter((t) => t.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS);
}

export async function GET() {
  try {
    await assertPermission("logistics:copilot:read");
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  const config = getCopilotConfig();
  return NextResponse.json({ configured: config.configured, provider: config.provider, model: config.model, apiKeyPresent: config.apiKeyPresent });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await assertPermission("logistics:copilot:read");
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }

  const body = (await req.json().catch(() => null)) as { prompt?: unknown; history?: unknown } | null;
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawPrompt) return NextResponse.json({ error: "prompt est requis.", code: "bad_request" }, { status: 400 });
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);
  const history = sanitizeHistory(body?.history);

  const ctx = await buildLogisticsCopilotContext(prompt);
  const cards = buildRecommendations(ctx);
  const summary = deterministicSummary(ctx, cards);
  const meta = { generatedAt: ctx.generatedAt, questionClass: ctx.questionClass, modules: ctx.modules, unavailable: ctx.unavailable, truncated: ctx.truncated, counts: ctx.counts };
  const kinds = Array.from(new Set(cards.map((c) => c.kind)));
  const startedAt = Date.now();

  const audit = async (outcome: string, extra: Record<string, unknown> = {}) => {
    const cfg = getCopilotConfig();
    // SAFE metadata only — never the prompt, the answer, the history, or any secret.
    await writeAudit({
      action: AuditActions.LOGISTICS_COPILOT_QUERY, actorId: user.id, tenantId: user.tenantId, entity: "logistics",
      after: { provider: cfg.provider, model: cfg.model, modulesAvailable: ctx.modules, modulesUnavailable: ctx.unavailable, contextCounts: ctx.counts, truncated: ctx.truncated.length > 0, recommendationKinds: kinds, durationMs: Date.now() - startedAt, outcome, ...extra },
    });
  };

  // Rate limit → deterministic fallback (never fail the UI).
  const rl = await checkCopilotRateLimit(user);
  if (!rl.ok) {
    await audit("rate_limited", { scope: rl.scope });
    return NextResponse.json({ text: summary, cards, summary, fallback: true, meta, code: "rate_limited", notice: rl.scope === "user" ? "Limite de requêtes atteinte pour votre compte — synthèse déterministe affichée. Réessayez dans un instant." : "Limite quotidienne du tenant atteinte — synthèse déterministe affichée." });
  }

  try {
    const result = await runCopilotDetailed(buildLogisticsMessages(ctx, prompt, history));
    const tokens = result.usage ? { prompt: result.usage.promptTokens ?? 0, completion: result.usage.completionTokens ?? 0, total: result.usage.totalTokens ?? 0 } : null;
    await audit("answered", { tokens });
    return NextResponse.json({ text: result.text, cards, summary, fallback: false, meta });
  } catch (err) {
    if (err instanceof CopilotError) {
      await audit("fallback", { failureCode: err.code });
      const cfg = getCopilotConfig();
      return NextResponse.json({ text: summary, cards, summary, fallback: true, meta, code: err.code, notice: copilotErrorMessage(err.code, { provider: cfg.provider, model: cfg.model }) });
    }
    reportError(err, { scope: "route", event: "logistics.copilot.post" });
    return NextResponse.json({ error: "Le copilote logistique n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" }, { status: 500 });
  }
}
