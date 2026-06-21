/**
 * OpenAI client for the Operations Copilot (Phase 3.1A) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Thin, dependency-free wrapper over the OpenAI Chat Completions API. The model
 * is read-only by construction: it receives the system + user messages built by
 * lib/copilot/prompt.ts and returns plain text. No tools, no function-calling,
 * no DB access — the model can only produce text.
 *
 * Configuration (server env only — never NEXT_PUBLIC):
 *   - OPENAI_API_KEY        (required) — secret, never reaches the client bundle.
 *   - OPENAI_COPILOT_MODEL  (optional) — defaults to the Phase 3.1A model.
 */
import "server-only";
import type { CopilotChatMessage } from "@/lib/copilot/prompt";

const DEFAULT_MODEL = "gpt-5.5";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;

/** Thrown when the Copilot is not configured (missing API key). Route → 503. */
export class CopilotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotConfigError";
  }
}

/** Thrown when the upstream model call fails. Route → 502. */
export class CopilotUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotUpstreamError";
  }
}

export function isCopilotConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
};

/**
 * Run a single non-streaming completion and return the model's plain-text reply.
 * Throws CopilotConfigError (missing key) or CopilotUpstreamError (API failure).
 */
export async function runCopilot(messages: CopilotChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new CopilotConfigError(
      "Copilot non configuré : la variable d'environnement OPENAI_API_KEY est absente.",
    );
  }
  const model = process.env.OPENAI_COPILOT_MODEL || DEFAULT_MODEL;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        // Plain text only — no tools/function-calling, so the model cannot act.
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "réseau";
    throw new CopilotUpstreamError(`Échec de l'appel au modèle (${reason}).`);
  }

  if (!res.ok) {
    // Do not surface the raw upstream body to the client.
    throw new CopilotUpstreamError(`Le modèle a renvoyé une erreur (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as ChatCompletion;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new CopilotUpstreamError("Le modèle n'a renvoyé aucune réponse.");
  }
  return text;
}
