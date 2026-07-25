/**
 * Operations Copilot route (Phase 10.0F-2) — /api/operations/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only, grounded operational assistance for internal staff. POST:
 *   1. authorizes via logistics:copilot:read (the EXISTING operational-AI gate — throws → 403),
 *   2. validates the question (non-empty plain string, bounded length) — and reads ONLY the
 *      question: tenant / user / permissions / context / provider / model / system-prompt fields
 *      from the client are IGNORED (the server resolves all identity and context),
 *   3. enforces a bounded rate limit over the audit log (per-user + per-tenant — no new table),
 *   4. calls the EXISTING runOperationsCopilot() seam (one context build → one model call →
 *      deterministic fallback on provider failure),
 *   5. audits SAFE metadata only (provider, model, focus, fallback, duration, outcome) — never the
 *      question, the answer, or the context,
 *   6. returns a controlled, redacted JSON shape (answer + safe metadata) with French errors.
 * No DB writes except the audit row, no SQL from the AI, no mutation, no tools, no new permission.
 */
import { NextResponse } from "next/server";
import { assertPermission, PermissionError } from "@/lib/auth/require-permission";
import { runOperationsCopilot } from "@/lib/operations/copilot/reader";
import { checkAuditRateLimit } from "@/lib/copilot/rate-limit";
import { getCopilotConfig } from "@/lib/copilot/engine";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_QUESTION = 2000;
const RATE_PER_MIN = 8;
const RATE_PER_DAY = 500;

/** Non-secret config snapshot for the UI (gated) — never returns a key. */
export async function GET() {
  try {
    await assertPermission("logistics:copilot:read");
  } catch (e) {
    if (e instanceof PermissionError) return new NextResponse("Forbidden", { status: 403 });
    throw e;
  }
  const cfg = getCopilotConfig();
  return NextResponse.json({ configured: cfg.configured, provider: cfg.provider });
}

export async function POST(req: Request) {
  let user;
  try {
    user = await assertPermission("logistics:copilot:read");
  } catch (e) {
    if (e instanceof PermissionError) return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    throw e;
  }

  // Read ONLY the question — every other client field (tenant, context, provider, model, prompt) is ignored.
  const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
  const raw = typeof body?.question === "string" ? body.question.trim() : "";
  if (!raw) return NextResponse.json({ error: "La question est requise." }, { status: 400 });
  if (raw.length > MAX_QUESTION) {
    return NextResponse.json({ error: "La question est trop longue (2000 caractères maximum)." }, { status: 400 });
  }

  // Smallest available abuse protection — bounded counting over the copilot's own audit rows.
  const rl = await checkAuditRateLimit({
    action: AuditActions.OPERATIONS_COPILOT_QUERY,
    tenantId: user.tenantId,
    actorColumn: "actor_id",
    actorId: user.id,
    perActorPerMin: RATE_PER_MIN,
    perTenantPerDay: RATE_PER_DAY,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: rl.scope === "user" ? "Trop de requêtes. Réessayez dans un instant." : "Limite quotidienne atteinte pour votre organisation." },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  try {
    // runOperationsCopilot handles the context build, the single model call AND the deterministic
    // fallback (usedFallback) — a provider failure degrades here, it does NOT error the caller.
    const result = await runOperationsCopilot(raw);
    const cfg = getCopilotConfig();
    await writeAudit({
      action: AuditActions.OPERATIONS_COPILOT_QUERY,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "operations",
      after: {
        provider: cfg.provider,
        model: cfg.model,
        focus: result.focus,
        usedFallback: result.fallback,
        durationMs: Date.now() - startedAt,
        outcome: result.fallback ? "fallback" : "answered",
      },
    });
    return NextResponse.json({
      answer: result.text,
      generatedAt: result.generatedAt,
      provider: result.provider ?? undefined,
      usedFallback: result.fallback,
    });
  } catch (err) {
    // Only UNEXPECTED failures land here (provider errors already degraded to fallback).
    reportError(err, { scope: "route", event: "operations.copilot.post" });
    return NextResponse.json({ error: "Le copilote des opérations n'a pas pu répondre. Veuillez réessayer." }, { status: 500 });
  }
}
