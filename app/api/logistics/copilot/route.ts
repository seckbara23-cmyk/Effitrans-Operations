/**
 * Logistics Copilot route (Phase 7.6A) — /api/logistics/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only, grounded operational assistance for internal staff. POST:
 *   1. authorizes via logistics:copilot:read (throws → 403),
 *   2. builds the BOUNDED, read-only, permission-degraded context,
 *   3. computes DETERMINISTIC recommendation cards (no model, no fabrication),
 *   4. asks the SHARED provider-neutral engine (runCopilot) for a conversational answer,
 *      grounded in the same context — and on ANY provider failure returns the DETERMINISTIC
 *      summary instead (the UI never fails),
 *   5. audits SAFE metadata only (provider, model, modules, recommendation count, duration,
 *      outcome) — never the prompt, the answer, or any secret.
 *
 * No DB writes, no SQL from the AI, no mutation, no tools. It never calls a provider directly.
 */
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/auth/require-permission";
import { buildLogisticsCopilotContext } from "@/lib/logistics/copilot/context";
import { buildRecommendations, deterministicSummary } from "@/lib/logistics/copilot/cards";
import { buildLogisticsMessages } from "@/lib/logistics/copilot/prompt";
import { runCopilot, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
import { copilotErrorMessage } from "@/lib/copilot/provider-ux";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;

/** Non-secret config snapshot — logistics-gated. */
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

  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawPrompt) return NextResponse.json({ error: "prompt est requis.", code: "bad_request" }, { status: 400 });
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);

  const ctx = await buildLogisticsCopilotContext();
  const cards = buildRecommendations(ctx);
  const summary = deterministicSummary(ctx, cards);
  const messages = buildLogisticsMessages(ctx, prompt);
  const meta = { generatedAt: ctx.generatedAt, modules: ctx.modules, unavailable: ctx.unavailable, counts: ctx.counts };
  const startedAt = Date.now();

  const audit = async (outcome: string) => {
    const cfg = getCopilotConfig();
    // SAFE metadata only — never the prompt, the answer, or any secret.
    await writeAudit({
      action: AuditActions.LOGISTICS_COPILOT_QUERY,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "logistics",
      after: { provider: cfg.provider, model: cfg.model, modules: ctx.modules, recommendationCount: cards.length, durationMs: Date.now() - startedAt, outcome },
    });
  };

  try {
    const text = await runCopilot(messages);
    await audit("answered");
    return NextResponse.json({ text, cards, summary, fallback: false, meta });
  } catch (err) {
    if (err instanceof CopilotError) {
      // Provider unavailable → deterministic summary, never a UI failure (HTTP 200).
      await audit("fallback");
      const cfg = getCopilotConfig();
      return NextResponse.json({
        text: summary, cards, summary, fallback: true, meta,
        notice: copilotErrorMessage(err.code, { provider: cfg.provider, model: cfg.model }),
      });
    }
    reportError(err, { scope: "route", event: "logistics.copilot.post" });
    return NextResponse.json({ error: "Le copilote logistique n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" }, { status: 500 });
  }
}
