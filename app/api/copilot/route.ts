/**
 * Operations Copilot route (Phase 3.1A) — /api/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only AI assistant for a single dossier. POST:
 *   1. authenticates the caller (getCurrentUser → 401),
 *   2. enforces `file:read` (→ 403) — the SAME gate as the dossier page,
 *   3. builds a tenant/visibility-scoped context via the shared read services
 *      (an inaccessible dossier resolves to null → 404),
 *   4. asks the model for a PLAIN-TEXT answer and returns it.
 *
 * On failure the response carries a SPECIFIC diagnostic { error, code } (missing
 * key / invalid key / invalid model / rate limit / timeout / upstream) instead of
 * a generic "not configured". GET returns a secret-free config snapshot so the
 * deployed environment can be verified without exposing the key.
 *
 * No DB writes, no SQL from the AI, no mutation, no email, no task creation.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getShipmentContext } from "@/lib/copilot/context";
import { buildMessages } from "@/lib/copilot/prompt";
import { detectSkill, isCopilotSkill, wantsEnglish, type CopilotSkill } from "@/lib/copilot/skills";
import { buildTransparency } from "@/lib/copilot/transparency";
import { copilotErrorMessage } from "@/lib/copilot/provider-ux";
import { runCopilot, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
import type { CopilotHistoryTurn } from "@/lib/copilot/prompt";
import { reportError } from "@/lib/observability/report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;

/**
 * Diagnostics (Phase 3.1A audit). Authenticated + file:read gated. Returns ONLY
 * non-secret config — whether the key is present (bool), the model name and the
 * provider — so production configuration can be verified instantly.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return new NextResponse("Forbidden", { status: 403 });
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
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "file:read")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as
    | { fileId?: unknown; prompt?: unknown; skill?: unknown; history?: unknown }
    | null;
  const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!fileId || !rawPrompt) {
    return NextResponse.json({ error: "fileId et prompt sont requis.", code: "bad_request" }, { status: 400 });
  }
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);

  // Skill routing (D3/D4): honour an explicit skill from a panel chip when valid,
  // otherwise detect it from the question. Detection is deterministic + secret-free.
  const requested = typeof body?.skill === "string" && isCopilotSkill(body.skill) ? (body.skill as CopilotSkill) : null;
  const skill: CopilotSkill = requested ?? detectSkill(prompt);
  const english = wantsEnglish(prompt);

  // Conversation history (D6) — client-supplied recent turns (stateless server).
  const history: CopilotHistoryTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter((h): h is { role?: unknown; text?: unknown } => Boolean(h) && typeof h === "object")
        .filter((h) => typeof h.text === "string")
        .map((h) => ({ role: h.role === "assistant" ? ("assistant" as const) : ("user" as const), text: String(h.text).slice(0, 2000) }))
        .slice(-6)
    : [];

  // Tenant isolation + visibility are inherited from the shared read services.
  // Cached per tenant + file + permission fingerprint (D12).
  const context = await getShipmentContext(fileId, user.tenantId, permissions);
  if (!context) return new NextResponse("Not found", { status: 404 });

  const messages = buildMessages(context, prompt, { skill, english, history });
  // Transparency footer (D10/D11) is computed deterministically from the context,
  // NOT taken from the model — no fabricated certainty.
  const meta = { skill, ...buildTransparency(context, skill) };

  try {
    const text = await runCopilot(messages);
    return NextResponse.json({ text, meta });
  } catch (err) {
    if (err instanceof CopilotError) {
      // Provider-aware, secret-free diagnostic (D1) — the client shows it verbatim.
      const cfg = getCopilotConfig();
      return NextResponse.json(
        { error: copilotErrorMessage(err.code, { provider: cfg.provider, model: cfg.model }), code: err.code, provider: cfg.provider },
        { status: err.httpStatus },
      );
    }
    // Unexpected — log and fail generic (never leak internals to the client).
    reportError(err, { scope: "route", event: "copilot.post" });
    return NextResponse.json(
      { error: "Le copilote n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" },
      { status: 500 },
    );
  }
}
