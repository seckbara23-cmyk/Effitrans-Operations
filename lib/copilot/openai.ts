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
 *   - OPENAI_COPILOT_MODEL  (optional) — defaults to DEFAULT_MODEL.
 *
 * Phase 3.1A audit: failures are classified into distinct diagnostics (missing
 * key / invalid key / invalid model / rate limit / timeout / upstream error) and
 * a structured, SECRET-FREE line is logged per attempt (key presence as a bool
 * only — never the key or Authorization header).
 */
import "server-only";
import { reportMessage } from "@/lib/observability/report";
import type { CopilotChatMessage } from "@/lib/copilot/prompt";

// A broadly-available, valid, low-cost model — right-sized for read-only dossier
// summarisation. Override per environment with OPENAI_COPILOT_MODEL.
const DEFAULT_MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const PROVIDER = "openai" as const;
const REQUEST_TIMEOUT_MS = 30_000;

/** Distinct, client-safe failure categories for the Copilot. */
export type CopilotErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "invalid_model"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "empty_response";

// HTTP status the route returns for each diagnostic.
const HTTP_STATUS: Record<CopilotErrorCode, number> = {
  missing_api_key: 503,
  invalid_api_key: 502,
  invalid_model: 502,
  rate_limited: 429,
  timeout: 504,
  upstream_error: 502,
  empty_response: 502,
};

// User-facing French message per diagnostic. No secrets, no raw upstream body.
const MESSAGES: Record<CopilotErrorCode, string> = {
  missing_api_key:
    "Copilote non configuré : la clé API OpenAI (OPENAI_API_KEY) est absente de cet environnement.",
  invalid_api_key:
    "Clé API OpenAI invalide ou refusée. Vérifiez la variable OPENAI_API_KEY.",
  invalid_model:
    "Modèle OpenAI invalide ou indisponible. Vérifiez la variable OPENAI_COPILOT_MODEL.",
  rate_limited: "Limite de requêtes OpenAI atteinte. Réessayez dans un instant.",
  timeout: "Le modèle n'a pas répondu dans le délai imparti. Réessayez.",
  upstream_error: "Le service IA a renvoyé une erreur. Réessayez plus tard.",
  empty_response: "Le modèle n'a renvoyé aucune réponse.",
};

/** A classified Copilot failure — carries a machine code + the HTTP status. */
export class CopilotError extends Error {
  readonly code: CopilotErrorCode;
  readonly httpStatus: number;
  constructor(code: CopilotErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "CopilotError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
  }
}

export type CopilotConfig = { apiKeyPresent: boolean; model: string; provider: typeof PROVIDER };

/** Non-secret configuration snapshot (for diagnostics — never returns the key). */
export function getCopilotConfig(): CopilotConfig {
  return {
    apiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_COPILOT_MODEL || DEFAULT_MODEL,
    provider: PROVIDER,
  };
}

export function isCopilotConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

type OpenAiError = { message?: string; type?: string; code?: string };
type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
  error?: OpenAiError;
};

/** Map an OpenAI HTTP status + error body to a distinct Copilot diagnostic. */
function classify(status: number, err: OpenAiError | undefined): CopilotErrorCode {
  const code = err?.code ?? "";
  if (code === "model_not_found") return "invalid_model";
  if (code === "invalid_api_key") return "invalid_api_key";
  if (status === 401 || status === 403) return "invalid_api_key";
  if (status === 404) return "invalid_model";
  if (status === 429) return "rate_limited";
  if (status === 400) return /model/i.test(code) || /model/i.test(err?.message ?? "") ? "invalid_model" : "upstream_error";
  return "upstream_error";
}

/**
 * One structured, secret-free diagnostic line per attempt. Captured by the
 * Vercel runtime log drain (greppable via `[observe]` / event copilot.openai).
 * NEVER logs the API key or the Authorization header.
 */
function logDiag(fields: {
  apiKeyPresent: boolean;
  model: string;
  httpStatus: number | null;
  outcome: string;
  errorCode?: CopilotErrorCode;
  openaiErrorCode?: string | null;
  openaiErrorType?: string | null;
  openaiErrorMessage?: string | null;
}): void {
  reportMessage("copilot openai call", {
    scope: "route",
    event: "copilot.openai",
    extra: { provider: PROVIDER, ...fields },
  });
}

/**
 * Run a single non-streaming completion and return the model's plain-text reply.
 * Throws a CopilotError with a specific `code` on any failure.
 */
export async function runCopilot(messages: CopilotChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_COPILOT_MODEL || DEFAULT_MODEL;
  const apiKeyPresent = Boolean(apiKey);

  if (!apiKey) {
    logDiag({ apiKeyPresent: false, model, httpStatus: null, outcome: "missing_api_key", errorCode: "missing_api_key" });
    throw new CopilotError("missing_api_key");
  }

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
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const code: CopilotErrorCode = isTimeout ? "timeout" : "upstream_error";
    logDiag({
      apiKeyPresent,
      model,
      httpStatus: null,
      outcome: code,
      errorCode: code,
      openaiErrorMessage: err instanceof Error ? err.message : "network",
    });
    throw new CopilotError(code);
  }

  if (!res.ok) {
    // The error body describes the failure (no secret) — parse it for the code.
    const body = (await res.json().catch(() => null)) as ChatCompletion | null;
    const oaError = body?.error;
    const code = classify(res.status, oaError);
    logDiag({
      apiKeyPresent,
      model,
      httpStatus: res.status,
      outcome: code,
      errorCode: code,
      openaiErrorCode: oaError?.code ?? null,
      openaiErrorType: oaError?.type ?? null,
      openaiErrorMessage: oaError?.message ?? null,
    });
    throw new CopilotError(code);
  }

  const data = (await res.json()) as ChatCompletion;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    logDiag({ apiKeyPresent, model, httpStatus: res.status, outcome: "empty_response", errorCode: "empty_response" });
    throw new CopilotError("empty_response");
  }

  logDiag({ apiKeyPresent, model, httpStatus: res.status, outcome: "ok" });
  return text;
}
