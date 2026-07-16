/**
 * Executive Copilot route (Phase 7.7) — /api/executive/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The THIRD sibling of the copilot route family (internal 7.6A/B · portal 7.6C · executive 7.7),
 * with the SAME provider chain and the SAME read-only guarantees. POST:
 *   1. authorizes via executive:dashboard:read (throws → 403). It grants NO operational
 *      capability: every module reader underneath still enforces its own read permission,
 *   2. enforces a bounded rate limit (per user + per tenant) over the audit log — the SHARED
 *      counter from 7.6C, keyed on the executive action,
 *   3. reuses the ALREADY-COMPOSED, request-cached executive snapshot (getExecutiveIntelligence)
 *      — asking a question triggers NO additional query and NO provider call beyond the model,
 *   4. computes DETERMINISTIC executive cards (no model, no fabrication),
 *   5. asks the SHARED provider-neutral engine (runCopilotDetailed) grounded in the same snapshot
 *      + bounded session history — and on ANY provider failure or rate-limit returns the
 *      DETERMINISTIC summary (the panel never fails),
 *   6. audits SAFE metadata only (provider, model, duration, tokens, outcome, which sections were
 *      available) — never the prompt, the answer, the history, or ANY executive metric.
 *
 * No DB writes (except the audit row), no SQL from the AI, no mutation, no tools.
 */
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/auth/require-permission";
import { getExecutiveIntelligence } from "@/lib/executive/reader";
import { buildExecutiveRecommendations, executiveDeterministicSummary } from "@/lib/executive/copilot/cards";
import { buildExecutiveMessages } from "@/lib/executive/copilot/prompt";
import { checkAuditRateLimit, intEnv } from "@/lib/copilot/rate-limit";
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
    .map((t): HistoryTurn => ({
      role: (t as HistoryTurn).role === "assistant" ? "assistant" : "user",
      content: typeof (t as HistoryTurn).content === "string" ? (t as HistoryTurn).content.slice(0, MAX_TURN_CHARS) : "",
    }))
    .filter((t) => t.content.trim().length > 0)
    .slice(-MAX_HISTORY_TURNS);
}

export async function POST(req: Request) {
  let user;
  try {
    user = await assertPermission("executive:dashboard:read");
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }

  const body = (await req.json().catch(() => null)) as { prompt?: unknown; history?: unknown } | null;
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawPrompt) return NextResponse.json({ error: "La question est requise.", code: "bad_request" }, { status: 400 });
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);
  const history = sanitizeHistory(body?.history);

  // Request-cached: the page already composed this snapshot; no second read of any module.
  const ctx = await getExecutiveIntelligence();
  const cards = buildExecutiveRecommendations(ctx);
  const summary = executiveDeterministicSummary(ctx, cards);
  const meta = { generatedAt: ctx.generatedAt, sections: ctx.sections, unavailable: ctx.unavailable };
  const kinds = Array.from(new Set(cards.map((c) => c.kind)));
  const startedAt = Date.now();

  const audit = async (outcome: string, extra: Record<string, unknown> = {}) => {
    const cfg = getCopilotConfig();
    // SAFE metadata only — never the prompt, the answer, the history, or any executive metric.
    await writeAudit({
      action: AuditActions.EXECUTIVE_COPILOT_QUERY,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "executive",
      after: {
        provider: cfg.provider,
        model: cfg.model,
        sectionsAvailable: ctx.sections,
        sectionsUnavailable: ctx.unavailable,
        recommendationKinds: kinds,
        durationMs: Date.now() - startedAt,
        outcome,
        ...extra,
      },
    });
  };

  const rl = await checkAuditRateLimit({
    action: AuditActions.EXECUTIVE_COPILOT_QUERY,
    tenantId: user.tenantId,
    actorColumn: "actor_id",
    actorId: user.id,
    perActorPerMin: intEnv(process.env.EXECUTIVE_COPILOT_USER_RATE_PER_MIN, 12),
    perTenantPerDay: intEnv(process.env.EXECUTIVE_COPILOT_TENANT_RATE_PER_DAY, 1000),
  });
  if (!rl.ok) {
    await audit("rate_limited", { scope: rl.scope });
    return NextResponse.json({
      text: summary, cards, summary, fallback: true, meta, code: "rate_limited",
      notice: rl.scope === "user"
        ? "Limite de requêtes atteinte pour votre compte — synthèse déterministe affichée."
        : "Limite quotidienne du tenant atteinte — synthèse déterministe affichée.",
    });
  }

  try {
    const result = await runCopilotDetailed(buildExecutiveMessages(ctx, prompt, history));
    const tokens = result.usage
      ? { prompt: result.usage.promptTokens ?? 0, completion: result.usage.completionTokens ?? 0, total: result.usage.totalTokens ?? 0 }
      : null;
    await audit("answered", { tokens });
    return NextResponse.json({ text: result.text, cards, summary, fallback: false, meta });
  } catch (err) {
    if (err instanceof CopilotError) {
      await audit("fallback", { failureCode: err.code });
      const cfg = getCopilotConfig();
      // The executive audience is internal staff, so the same operator-grade diagnostic the
      // internal copilot returns is appropriate here (unlike the customer-facing portal route).
      return NextResponse.json({
        text: summary, cards, summary, fallback: true, meta, code: err.code,
        notice: copilotErrorMessage(err.code, { provider: cfg.provider, model: cfg.model }),
      });
    }
    reportError(err, { scope: "route", event: "executive.copilot.post" });
    return NextResponse.json({ error: "L'assistant exécutif n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" }, { status: 500 });
  }
}
