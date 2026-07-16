/**
 * Customer AI Assistant route (Phase 7.6C) — /api/portal/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The CUSTOMER-FACING sibling of /api/logistics/copilot, with the SAME provider chain and the
 * SAME read-only guarantees, but gated on PORTAL identity instead of staff RBAC. POST:
 *   1. authorizes via the PORTAL identity only (getCurrentPortalUser + ACTIVE → else 403). It
 *      NEVER calls assertPermission: a portal user holds no transport/customs/finance permission
 *      and must not acquire one here (no privilege escalation),
 *   2. enforces a bounded rate limit (per portal user + per tenant, over the audit log),
 *   3. builds the BOUNDED, read-only, RLS-scoped, question-BUDGETED customer context,
 *   4. computes DETERMINISTIC customer-safe cards (no model, no fabrication),
 *   5. asks the SHARED provider-neutral engine (runCopilotDetailed) grounded in the same context
 *      + bounded session history — and on ANY provider failure or rate-limit returns the
 *      DETERMINISTIC summary (the panel never fails),
 *   6. audits SAFE metadata only (provider, model, duration, tokens, outcome) attributed to the
 *      PORTAL actor — never the prompt, the answer, the conversation, or any shipment detail.
 *
 * No DB writes (except the audit row), no SQL from the AI, no mutation, no tools. A provider call
 * happens ONLY on an explicit customer question — never on page load (GET returns config only).
 *
 * ERROR SURFACE: a customer must never see provider diagnostics. Where the internal route returns
 * copilotErrorMessage(code) (naming the provider/model/API key), this route returns ONE generic
 * customer notice and keeps the specific code server-side, in the audit row.
 */
import { NextResponse } from "next/server";
import { getCurrentPortalUser } from "@/lib/portal/auth";
import { getPortalShipmentContext } from "@/lib/portal/copilot/context";
import { buildPortalRecommendations, portalDeterministicSummary } from "@/lib/portal/copilot/cards";
import { buildPortalMessages } from "@/lib/portal/copilot/prompt";
import { checkPortalCopilotRateLimit } from "@/lib/portal/copilot/usage";
import { runCopilotDetailed, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 1200;

/** One customer-facing notice for EVERY provider failure — never the provider/model/key detail. */
const FALLBACK_NOTICE =
  "L'assistant intelligent est momentanément indisponible. Voici une synthèse automatique de votre expédition, établie à partir de vos données réelles.";
const RATE_NOTICE =
  "Vous avez posé plusieurs questions coup sur coup. Voici une synthèse automatique de votre expédition — réessayez dans un instant.";

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

/** Is the assistant usable right now? Config only — no provider call, no diagnostics. */
export async function GET() {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return new NextResponse("Forbidden", { status: 403 });
  const config = getCopilotConfig();
  // Deliberately NOT exposed to a customer: provider, model, apiKeyPresent.
  return NextResponse.json({ available: config.configured });
}

export async function POST(req: Request) {
  const user = await getCurrentPortalUser();
  if (!user || user.status !== "ACTIVE") return new NextResponse("Forbidden", { status: 403 });

  const body = (await req.json().catch(() => null)) as { prompt?: unknown; fileId?: unknown; history?: unknown } | null;
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!rawPrompt) return NextResponse.json({ error: "Votre question est requise.", code: "bad_request" }, { status: 400 });
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);
  const fileId = typeof body?.fileId === "string" && body.fileId ? body.fileId : undefined;
  const history = sanitizeHistory(body?.history);

  // RLS-scoped to this customer. An unowned/unknown fileId yields null — uniform 404, no probe.
  const ctx = await getPortalShipmentContext(prompt, fileId);
  if (!ctx) return NextResponse.json({ error: "Expédition introuvable.", code: "not_found" }, { status: 404 });

  const cards = buildPortalRecommendations(ctx);
  const summary = portalDeterministicSummary(ctx, cards);
  const meta = {
    generatedAt: ctx.generatedAt,
    scope: ctx.scope,
    sections: ctx.sections,
    unavailable: ctx.unavailable,
    truncated: ctx.truncated,
  };
  const kinds = Array.from(new Set(cards.map((c) => c.kind)));
  const startedAt = Date.now();

  const audit = async (outcome: string, extra: Record<string, unknown> = {}) => {
    const cfg = getCopilotConfig();
    // SAFE metadata only — attributed to the PORTAL actor. Never the prompt, the answer, the
    // history, the shipment detail, or any secret.
    await writeAudit({
      action: AuditActions.PORTAL_COPILOT_QUERY,
      clientUserId: user.id,
      tenantId: user.tenantId,
      entity: "portal_copilot",
      after: {
        provider: cfg.provider,
        model: cfg.model,
        scope: ctx.scope,
        questionClass: ctx.questionClass,
        sectionsAvailable: ctx.sections,
        sectionsUnavailable: ctx.unavailable,
        truncated: ctx.truncated.length > 0,
        recommendationKinds: kinds,
        durationMs: Date.now() - startedAt,
        outcome,
        ...extra,
      },
    });
  };

  // Rate limit → deterministic fallback (never fail the panel).
  const rl = await checkPortalCopilotRateLimit(user);
  if (!rl.ok) {
    await audit("rate_limited", { scope: rl.scope });
    return NextResponse.json({ text: summary, cards, summary, fallback: true, meta, code: "rate_limited", notice: RATE_NOTICE });
  }

  try {
    const result = await runCopilotDetailed(buildPortalMessages(ctx, prompt, history));
    const tokens = result.usage
      ? { prompt: result.usage.promptTokens ?? 0, completion: result.usage.completionTokens ?? 0, total: result.usage.totalTokens ?? 0 }
      : null;
    await audit("answered", { tokens });
    return NextResponse.json({ text: result.text, cards, summary, fallback: false, meta });
  } catch (err) {
    if (err instanceof CopilotError) {
      // The specific failure code is recorded for staff, never returned to the customer.
      await audit("fallback", { failureCode: err.code });
      return NextResponse.json({ text: summary, cards, summary, fallback: true, meta, code: "unavailable", notice: FALLBACK_NOTICE });
    }
    reportError(err, { scope: "route", event: "portal.copilot.post" });
    await audit("failed").catch(() => {});
    return NextResponse.json({ text: summary, cards, summary, fallback: true, meta, code: "unavailable", notice: FALLBACK_NOTICE });
  }
}
