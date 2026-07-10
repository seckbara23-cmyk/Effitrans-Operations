/**
 * OpenAI-compatible Chat Completions transport (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Shared by the OpenAI and vLLM providers (vLLM exposes the same /v1/chat/
 * completions contract). Text-only: the body carries system+user messages,
 * temperature and max_tokens — NEVER `tools` or `functions`, so the model
 * cannot request an action. Failures are classified into distinct AIError codes;
 * one secret-free diagnostic is logged per attempt.
 */
import "server-only";
import { AI_LIMITS, baseUrlHost } from "./config";
import { logAIRequest } from "./log";
import { AIError, type AIGenerateInput, type AIGenerateResult, type AIHealthResult, type AIProviderName } from "./types";

type OpenAiError = { message?: string; type?: string; code?: string };
type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: OpenAiError;
};

/** Map an OpenAI-compatible HTTP status + error body to a distinct AIError code. */
export function classifyOpenAiCompatible(status: number, err: OpenAiError | undefined): AIError {
  const code = (err?.code ?? "").toLowerCase();
  const msg = err?.message ?? "";
  if (code === "model_not_found") return new AIError("model_not_found");
  if (code === "invalid_api_key") return new AIError("invalid_credentials");
  if (status === 401 || status === 403) return new AIError("invalid_credentials");
  if (status === 404) return new AIError("model_not_found");
  if (status === 429) return new AIError("rate_limited");
  if (status === 400) {
    return /model/i.test(code) || /model/i.test(msg) ? new AIError("model_not_found") : new AIError("upstream_error");
  }
  return new AIError("upstream_error"); // 5xx and anything else → transient
}

export async function openAiCompatibleChat(params: {
  providerName: AIProviderName;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  requireAuth: boolean;
  input: AIGenerateInput;
}): Promise<AIGenerateResult> {
  const { providerName, baseUrl, apiKey, model, requireAuth, input } = params;
  const host = baseUrlHost(baseUrl);
  const credentialsPresent = Boolean(apiKey);

  if (requireAuth && !apiKey) {
    logAIRequest({ provider: providerName, model, host, credentialsPresent: false, httpStatus: null, outcome: "missing_credentials", errorCode: "missing_credentials" });
    throw new AIError("missing_credentials");
  }

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = Math.min(input.timeoutMs ?? AI_LIMITS.defaultTimeoutMs, AI_LIMITS.maxTimeoutMs);
  const started = Date.now();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        temperature: input.temperature ?? AI_LIMITS.defaultTemperature,
        max_tokens: input.maxTokens ?? AI_LIMITS.defaultMaxTokens,
        // No tools / functions — the model can only produce text.
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const aiErr = isTimeout ? new AIError("timeout") : new AIError("upstream_error");
    logAIRequest({ provider: providerName, model, host, credentialsPresent, httpStatus: null, outcome: aiErr.code, errorCode: aiErr.code, latencyMs: Date.now() - started, detail: err instanceof Error ? err.name : "network" });
    throw aiErr;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ChatCompletion | null;
    const aiErr = classifyOpenAiCompatible(res.status, body?.error);
    logAIRequest({ provider: providerName, model, host, credentialsPresent, httpStatus: res.status, outcome: aiErr.code, errorCode: aiErr.code, latencyMs: Date.now() - started, detail: body?.error?.code ?? body?.error?.type ?? null });
    throw aiErr;
  }

  const data = (await res.json().catch(() => null)) as ChatCompletion | null;
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  const latencyMs = Date.now() - started;
  if (!text) {
    logAIRequest({ provider: providerName, model, host, credentialsPresent, httpStatus: res.status, outcome: "empty_response", errorCode: "empty_response", latencyMs });
    throw new AIError("empty_response");
  }

  logAIRequest({ provider: providerName, model, host, credentialsPresent, httpStatus: res.status, outcome: "ok", latencyMs });
  return {
    text,
    provider: providerName,
    model,
    latencyMs,
    usage: data?.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
      : undefined,
  };
}

/** GET /models health probe for an OpenAI-compatible endpoint. */
export async function openAiCompatibleHealth(params: {
  providerName: AIProviderName;
  baseUrl: string;
  apiKey: string | null;
  model: string;
}): Promise<AIHealthResult> {
  const { providerName, baseUrl, apiKey, model } = params;
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const err = classifyOpenAiCompatible(res.status, undefined);
      return { healthy: false, provider: providerName, model, latencyMs, errorCode: err.code };
    }
    return { healthy: true, provider: providerName, model, latencyMs };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { healthy: false, provider: providerName, model, latencyMs: Date.now() - started, errorCode: isTimeout ? "timeout" : "provider_unavailable" };
  }
}
