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
import { buildCopilotContext } from "@/lib/copilot/context";
import { buildMessages } from "@/lib/copilot/prompt";
import { runCopilot, CopilotError, getCopilotConfig } from "@/lib/copilot/engine";
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

  const body = (await req.json().catch(() => null)) as { fileId?: unknown; prompt?: unknown } | null;
  const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
  const rawPrompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!fileId || !rawPrompt) {
    return NextResponse.json({ error: "fileId et prompt sont requis.", code: "bad_request" }, { status: 400 });
  }
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LENGTH);

  // Tenant isolation + visibility are inherited from the shared read services.
  const context = await buildCopilotContext(fileId, permissions);
  if (!context) return new NextResponse("Not found", { status: 404 });

  const messages = buildMessages(context, prompt);

  try {
    const text = await runCopilot(messages);
    return NextResponse.json({ text });
  } catch (err) {
    if (err instanceof CopilotError) {
      // Specific, secret-free diagnostic (the openai client already logged it).
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    // Unexpected — log and fail generic (never leak internals to the client).
    reportError(err, { scope: "route", event: "copilot.post" });
    return NextResponse.json(
      { error: "Le copilote n'a pas pu répondre. Veuillez réessayer.", code: "internal_error" },
      { status: 500 },
    );
  }
}
