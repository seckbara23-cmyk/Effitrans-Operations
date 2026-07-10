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

/** Pure request body for Ollama /api/chat (isolated + testable). */
export function ollamaRequestBody(model: string, input: AIGenerateInput): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userPrompt },
    ],
    stream: false,
    options: {
      temperature: input.temperature ?? AI_LIMITS.defaultTemperature,
      num_predict: input.maxTokens ?? AI_LIMITS.defaultMaxTokens,
    },
    // No tools — Ollama would ignore them anyway; the model only produces text.
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
  const timeoutMs = Math.min(input.timeoutMs ?? AI_LIMITS.defaultTimeoutMs, AI_LIMITS.maxTimeoutMs);
  const started = Date.now();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`; // reverse-proxy token, if any

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(ollamaRequestBody(config.model, input)), signal: AbortSignal.timeout(timeoutMs) });
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

async function ollamaHealth(config: ResolvedAIConfig): Promise<AIHealthResult> {
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/tags`, { method: "GET", headers, signal: AbortSignal.timeout(10_000) });
    const latencyMs = Date.now() - started;
    if (!res.ok) return { healthy: false, provider: "ollama", model: config.model, latencyMs, errorCode: "upstream_error" };
    return { healthy: true, provider: "ollama", model: config.model, latencyMs };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { healthy: false, provider: "ollama", model: config.model, latencyMs: Date.now() - started, errorCode: isTimeout ? "timeout" : "provider_unavailable" };
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
