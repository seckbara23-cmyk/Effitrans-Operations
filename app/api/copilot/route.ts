/**
 * Operations Copilot route (Phase 3.1A) — POST /api/copilot. SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Read-only AI assistant for a single dossier. The route:
 *   1. authenticates the caller (getCurrentUser → 401),
 *   2. enforces `file:read` (→ 403) — the SAME gate as the dossier page,
 *   3. builds a tenant/visibility-scoped context via the shared read services
 *      (an inaccessible dossier resolves to null → 404),
 *   4. asks the model for a PLAIN-TEXT answer and returns it.
 *
 * No DB writes, no SQL from the AI, no mutation, no email, no task creation —
 * the model only ever produces text from a snapshot the caller is allowed to see.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { buildCopilotContext } from "@/lib/copilot/context";
import { buildMessages } from "@/lib/copilot/prompt";
import { runCopilot, CopilotConfigError, CopilotUpstreamError } from "@/lib/copilot/openai";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_PROMPT_LENGTH = 2000;

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
    return NextResponse.json({ error: "fileId et prompt sont requis." }, { status: 400 });
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
    if (err instanceof CopilotConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof CopilotUpstreamError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
