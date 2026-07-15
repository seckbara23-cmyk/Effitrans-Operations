/**
 * Platform Copilot route (Phase 6.0F) — /api/platform/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only, aggregate-first tenant awareness for platform operators. POST:
 *   1. authorizes via platform:copilot:read (a tenant user resolves to null in
 *      getPlatformUser → 403; an anonymous caller → 403),
 *   2. builds the ALLOWLISTED platform snapshot (no tenant secrets or business data),
 *   3. asks the SHARED provider-neutral engine (runCopilot) for a plain-text answer,
 *   4. audits SAFE metadata only (provider, model, tenant count, categories, outcome) —
 *      never the prompt, the answer, or any tenant secret.
 *
 * No DB writes, no SQL from the AI, no mutation, no tools. It never calls a provider
 * directly — it reuses lib/copilot/engine, which resolves the provider from lib/ai.
 */
import { NextResponse } from "next/server";
import { PlatformAuthError, assertPlatformPermission } from "@/lib/platform/auth";
import { buildPlatformCopilotContext } from "@/lib/platform/copilot/context";
import { buildPlatformMessages } from "@/lib/platform/copilot/prompt";
import { runCopilot, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
import { copilotErrorMessage } from "@/lib/copilot/provider-ux";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;

/** Non-secret config snapshot — platform-gated. */
export async function GET() {
  try {
    await assertPlatformPermission("platform:copilot:read");
  } catch (e) {
    if (e instanceof PlatformAuthError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  const config = getCopilotConfig();
  return NextResponse.json({
    configured: config.configured,
    provider: config.provider,
    model: config.model,
    apiKeyPresent: config.apiKeyPresent,
  });
}

export async function POST(req: Request) {
  let actor;
  try {
    actor = await assertPlatformPermission("platform:copilot:read");
  } catch (e) {
    if (e instanceof PlatformAuthError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }

  const body = (await req.json().catch(() => null)) as { prompt?: unknown } | null;
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawPrompt) {
    return NextResponse.json({ error: "prompt est requis.", code: "bad_request" }, { status: 400 });
  }
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);

  const ctx = await buildPlatformCopilotContext(Date.now());
  const messages = buildPlatformMessages(ctx, prompt);

  try {
    const text = await runCopilot(messages);
    const cfg = getCopilotConfig();
    // SAFE metadata only — never the prompt, the answer, or a tenant secret.
    await writeAudit({
      action: AuditActions.PLATFORM_COPILOT_QUERY,
      platformActorId: actor.id,
      entity: "platform",
      after: {
        provider: cfg.provider,
        model: cfg.model,
        tenantCount: ctx.tenantCount,
        categories: ctx.categories,
        outcome: "answered",
      },
    });
    return NextResponse.json({
      text,
      meta: { tenantCount: ctx.tenantCount, generatedAt: ctx.generatedAt, categories: ctx.categories },
    });
  } catch (err) {
    if (err instanceof CopilotError) {
      const cfg = getCopilotConfig();
      return NextResponse.json(
        { error: copilotErrorMessage(err.code, { provider: cfg.provider, model: cfg.model }), code: err.code },
        { status: err.httpStatus },
      );
    }
    reportError(err, { scope: "route", event: "platform.copilot.post" });
    return NextResponse.json(
      { error: "Le copilote plateforme n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" },
      { status: 500 },
    );
  }
}
