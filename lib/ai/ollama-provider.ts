/**
 * Ollama provider (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Talks to Ollama's NATIVE chat API (POST /api/chat, non-streaming) — distinct
 * transport from the OpenAI-compatible providers, isolated here. Intended for a
 * LOCAL Qwen/Llama pilot on an approved machine (dark by default via
 * AI_LOCAL_PROVIDER_ENABLED). Connection refused (server down) →
 * provider_unavailable so the admin health view is precise. Text-only body — no
 * tools/functions.
 */
import "server-only";
import { AI_LIMITS, baseUrlHost } from "./config";
import { logAIRequest } from "./log";
import { AIError, type AIGenerateInput, type AIGenerateResult, type AIHealthResult, type AIProvider } from "./types";
import type { ResolvedAIConfig } from "./config";

type OllamaChatResponse = {
  message?: { content?: string | null };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

/**
 * Pure request body for Ollama /api/chat (isolated + testable). `opts` carries
 * the native Ollama options resolved from config: `think` (default OFF — concise,
 * faster on CPU) and `num_predict` (answer token cap). No tools/functions — the
 * model only produces text.
 */
export function ollamaRequestBody(
  model: string,
  input: AIGenerateInput,
  opts?: { think?: boolean; numPredict?: number },
): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    stream: false,
    // Suppress reasoning by default (Qwen "thinking") for routine ops questions.
    think: opts?.think ?? false,
    options: {
      temperature: input.temperature ?? AI_LIMITS.defaultTemperature,
      num_predict: opts?.numPredict ?? input.maxTokens ?? AI_LIMITS.defaultMaxTokens,
    },
  };
}

/** Pure classification of an Ollama HTTP failure. */
export function classifyOllama(status: number, errorText: string | undefined): AIError {
  const msg = errorText ?? "";
  if (status === 404 || /not found|no such model|model .* not/i.test(msg)) return new AIError("model_not_found");
  if (status === 400 && /model/i.test(msg)) return new AIError("model_not_found");
  if (status === 429) return new AIError("rate_limited");
  return new AIError("upstream_error");
}

async function ollamaChat(config: ResolvedAIConfig, input: AIGenerateInput): Promise<AIGenerateResult> {
  const host = baseUrlHost(config.baseUrl);
  const url = `${config.baseUrl.replace(/\/$/, "")}/api/chat`;
  const timeoutMs = Math.min(input.timeoutMs ?? config.timeoutMs, AI_LIMITS.maxTimeoutMs);
  const started = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`; // reverse-proxy token, if any

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(ollamaRequestBody(config.model, input, config.ollama)), signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // A refused connection means the local server is not running/reachable.
    const aiErr = isTimeout ? new AIError("timeout") : new AIError("provider_unavailable");
    logAIRequest({ provider: "ollama", model: config.model, host, credentialsPresent: Boolean(config.apiKey), httpStatus: null, outcome: aiErr.code, errorCode: aiErr.code, latencyMs: Date.now() - started, detail: err instanceof Error ? err.name : "network" });
    throw aiErr;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as OllamaChatResponse | null;
    const aiErr = classifyOllama(res.status, body?.error);
    logAIRequest({ provider: "ollama", model: config.model, host, credentialsPresent: Boolean(config.apiKey), httpStatus: res.status, outcome: aiErr.code, errorCode: aiErr.code, latencyMs: Date.now() - started, detail: body?.error ?? null });
    throw aiErr;
  }

  const data = (await res.json().catch(() => null)) as OllamaChatResponse | null;
  const text = data?.message?.content?.trim() ?? "";
  const latencyMs = Date.now() - started;
  if (!text) {
    logAIRequest({ provider: "ollama", model: config.model, host, credentialsPresent: Boolean(config.apiKey), httpStatus: res.status, outcome: "empty_response", errorCode: "empty_response", latencyMs });
    throw new AIError("empty_response");
  }
  logAIRequest({ provider: "ollama", model: config.model, host, credentialsPresent: Boolean(config.apiKey), httpStatus: res.status, outcome: "ok", latencyMs });
  return {
    text,
    provider: "ollama",
    model: config.model,
    latencyMs,
    usage: { promptTokens: data?.prompt_eval_count, completionTokens: data?.eval_count, totalTokens: (data?.prompt_eval_count ?? 0) + (data?.eval_count ?? 0) },
  };
}

type OllamaTag = { name?: string; model?: string };
type OllamaTagsResponse = { models?: OllamaTag[] };

/**
 * Is the configured model present in the /api/tags list? PURE + testable. Matches
 * on the tag name/model exactly; if the configured name omits a ":tag", matches
 * on the base name (e.g. "qwen3" matches "qwen3:8b").
 */
export function ollamaModelPresent(models: OllamaTag[] | undefined, configured: string): boolean {
  const want = configured.trim().toLowerCase();
  if (!want) return false;
  const wantBase = want.split(":")[0];
  return (models ?? []).some((m) => {
    const names = [m.name, m.model].filter(Boolean).map((s) => String(s).toLowerCase());
    return names.some((n) => n === want || (!want.includes(":") && n.split(":")[0] === wantBase));
  });
}

/** Best-effort Ollama version (safe to surface — no URL/network detail). */
async function ollamaVersion(config: ResolvedAIConfig, headers: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/version`, { method: "GET", headers, signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { version?: string } | null;
    return typeof data?.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Health via GET /api/tags. Distinguishes reachable/unreachable and configured-
 * model present/missing. SECRET-FREE (no internal URL / network detail).
 */
async function ollamaHealth(config: ResolvedAIConfig): Promise<AIHealthResult> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return { healthy: false, provider: "ollama", model: config.model, latencyMs, reachable: true, configuredModel: config.model, modelPresent: false, errorCode: "upstream_error" };
    }
    const data = (await res.json().catch(() => null)) as OllamaTagsResponse | null;
    const modelPresent = ollamaModelPresent(data?.models, config.model);
    const version = await ollamaVersion(config, headers);
    return {
      healthy: modelPresent,
      provider: "ollama",
      model: config.model,
      latencyMs,
      reachable: true,
      configuredModel: config.model,
      modelPresent,
      ...(version ? { version } : {}),
      ...(modelPresent ? {} : { errorCode: "model_not_found" as const }),
    };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { healthy: false, provider: "ollama", model: config.model, latencyMs: Date.now() - started, reachable: false, configuredModel: config.model, modelPresent: false, errorCode: isTimeout ? "timeout" : "provider_unavailable" };
  }
}

export function createOllamaProvider(config: ResolvedAIConfig): AIProvider {
  return {
    name: "ollama",
    model: config.model,
    generate: (input) => ollamaChat(config, input),
    healthCheck: () => ollamaHealth(config),
  };
}
