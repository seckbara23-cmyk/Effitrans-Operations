/**
 * Operations Copilot — runner (Phase 10.0F). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * ONE context build → ONE model invocation. It builds the bounded, permission-
 * shaped context, assembles the read-only messages and calls the SHARED
 * provider-neutral engine (runCopilotDetailed). On any provider failure it
 * returns the DETERMINISTIC briefing (grounded in the same context, no model) so
 * the copilot degrades gracefully — never fabricates, never errors the caller.
 *
 * This module wires the library only; no route/UI is added in 10.0F (the
 * invocation seam is ready for a later phase). It performs NO query of its own —
 * all data comes from buildOperationsContext.
 */
import "server-only";
import { runCopilotDetailed, CopilotError } from "@/lib/copilot/engine";
import { buildOperationsContext } from "./context";
import { buildOperationsMessages } from "./prompts";
import { deterministicBriefing } from "./formatter";
import type { OperationsCopilotResult } from "./types";

export async function runOperationsCopilot(
  question = "",
  history: { role: "user" | "assistant"; content: string }[] = [],
): Promise<OperationsCopilotResult> {
  const ctx = await buildOperationsContext(question); // gated + permission-shaped + cache()d
  const generatedAt = ctx.generatedAt;

  try {
    const messages = buildOperationsMessages(ctx, question, history);
    const r = await runCopilotDetailed(messages);
    return {
      text: r.text,
      focus: ctx.focus,
      fallback: false,
      provider: r.provider,
      model: r.model,
      latencyMs: r.latencyMs,
      generatedAt,
    };
  } catch (err) {
    // Provider unavailable / misconfigured ⇒ deterministic, grounded answer.
    if (err instanceof CopilotError) {
      return { text: deterministicBriefing(ctx), focus: ctx.focus, fallback: true, provider: null, model: null, latencyMs: null, generatedAt };
    }
    throw err;
  }
}
