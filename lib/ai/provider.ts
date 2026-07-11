/**
 * Provider factory + reliable generate (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Selects the configured provider (with the dark-by-default local gate + the
 * hosted-production safety checks), enforces the prompt-size cap, runs ONE
 * bounded retry on transient errors, applies an EXPLICIT fallback provider only
 * when configured (never a silent paid fallback), and truncates an oversize
 * response. This is the single entry point the Copilot calls — it never imports
 * a concrete provider.
 */
import "server-only";
import {
  AI_LIMITS,
  aiCopilotEnabled,
  aiLocalProviderEnabled,
  baseUrlHost,
  isHostedProduction,
  parseAllowlist,
  resolveAIConfig,
  resolveFallbackConfig,
  resolveRetryPolicy,
  validateAIConfig,
  type AIEnv,
  type ResolvedAIConfig,
  type RetryPolicy,
} from "./config";
import { createOpenAIProvider } from "./openai-provider";
import { createOllamaProvider } from "./ollama-provider";
import { createVllmProvider } from "./vllm-provider";
import { AIError, type AIGenerateInput, type AIGenerateResult, type AIProvider } from "./types";

/** Build the concrete provider for a resolved config (no validation here). */
export function buildProvider(config: ResolvedAIConfig): AIProvider {
  switch (config.provider) {
    case "openai":
      return createOpenAIProvider(config);
    case "ollama":
      return createOllamaProvider(config);
    case "vllm":
      return createVllmProvider(config);
  }
}

/** Validate a config against the hosting-safety rules for this env. Throws AIError. */
export function assertConfigSafe(config: ResolvedAIConfig, env: AIEnv): void {
  const v = validateAIConfig(config, {
    hosted: isHostedProduction(env),
    allowInsecureHttp: (env.AI_ALLOW_INSECURE_HTTP ?? "").trim() === "true",
    allowNoAuth: (env.AI_ALLOW_NO_AUTH ?? "").trim() === "true",
    allowlist: parseAllowlist(env.AI_BASE_URL_ALLOWLIST),
  });
  if (!v.ok) throw new AIError(v.code, v.reason, { retriable: false });
}

/**
 * Resolve + validate + select the primary provider for this env. Throws AIError
 * (disabled / invalid_config / unsafe_config) — callers map it to a diagnostic.
 */
export function getAIProvider(env: AIEnv): AIProvider {
  if (!aiCopilotEnabled(env)) {
    throw new AIError("provider_unavailable", "The AI Copilot is disabled (AI_COPILOT_ENABLED=false).", { retriable: false });
  }
  const resolved = resolveAIConfig(env);
  if (!resolved.ok) throw new AIError(resolved.code, resolved.reason, { retriable: false });
  const config = resolved.config;

  if (config.isLocalProvider && !aiLocalProviderEnabled(env)) {
    throw new AIError("provider_unavailable", `Local AI providers are disabled (set AI_LOCAL_PROVIDER_ENABLED=true to use "${config.provider}").`, { retriable: false });
  }
  assertConfigSafe(config, env);
  return buildProvider(config);
}

async function runWithRetryPolicy(provider: AIProvider, input: AIGenerateInput, policy: RetryPolicy): Promise<AIGenerateResult> {
  let attempt = 0;
  for (;;) {
    try {
      return await provider.generate(input);
    } catch (err) {
      const canRetry = err instanceof AIError && policy.retryOn.has(err.code) && attempt < policy.maxRetries;
      if (!canRetry) throw err;
      attempt += 1;
    }
  }
}

function truncateResult(result: AIGenerateResult): AIGenerateResult {
  if (result.text.length <= AI_LIMITS.maxResponseChars) return result;
  return { ...result, text: result.text.slice(0, AI_LIMITS.maxResponseChars) };
}

/**
 * The Copilot's single generate entry point. Enforces the prompt cap, retries
 * once, falls back ONLY to an explicitly-configured provider, truncates oversize
 * output. Throws AIError on failure.
 */
export async function generateAI(input: AIGenerateInput, env: AIEnv): Promise<AIGenerateResult> {
  const promptChars = input.systemPrompt.length + input.userPrompt.length;
  if (promptChars > AI_LIMITS.maxPromptChars) {
    throw new AIError("prompt_too_large", `Prompt exceeds the ${AI_LIMITS.maxPromptChars}-char limit.`, { retriable: false });
  }

  const provider = getAIProvider(env); // may throw config/unsafe/disabled
  const policy = resolveRetryPolicy(env);

  try {
    return truncateResult(await runWithRetryPolicy(provider, input, policy));
  } catch (err) {
    // Explicit fallback ONLY (configured provider), and only for transient errors.
    if (err instanceof AIError && err.retriable) {
      const fbConfig = resolveFallbackConfig(env);
      if (fbConfig) {
        assertConfigSafe(fbConfig, env);
        const fallback = buildProvider(fbConfig);
        return truncateResult(await fallback.generate(input));
      }
    }
    throw err;
  }
}

/** Non-secret host of the primary base URL, for diagnostics. */
export function providerBaseHost(env: AIEnv): string | null {
  const r = resolveAIConfig(env);
  return r.ok ? baseUrlHost(r.config.baseUrl) : null;
}
