/**
 * AI status snapshot for the admin health view (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A SECRET-FREE description of how the AI layer is configured right now, plus an
 * optional live health probe run in the CURRENT request (nothing persisted). It
 * returns the base URL HOST only and credential presence as a boolean — never
 * the key/token, prompt, or dossier content.
 */
import "server-only";
import {
  aiCopilotEnabled,
  aiLocalProviderEnabled,
  baseUrlHost,
  isHostedProduction,
  resolveAIConfig,
  type AIEnv,
} from "./config";
import { assertConfigSafe, buildProvider } from "./provider";
import { AIError, type AIHealthResult } from "./types";

export type AIStatus = {
  copilotEnabled: boolean;
  localProviderEnabled: boolean;
  hosted: boolean;
  provider: string | null;
  model: string | null;
  baseUrlHost: string | null;
  credentialsPresent: boolean;
  configOk: boolean;
  configError?: string;
  health?: AIHealthResult;
};

export async function getAIStatus(env: AIEnv, opts?: { runHealthCheck?: boolean }): Promise<AIStatus> {
  const base: AIStatus = {
    copilotEnabled: aiCopilotEnabled(env),
    localProviderEnabled: aiLocalProviderEnabled(env),
    hosted: isHostedProduction(env),
    provider: null,
    model: null,
    baseUrlHost: null,
    credentialsPresent: false,
    configOk: false,
  };

  const resolved = resolveAIConfig(env);
  if (!resolved.ok) {
    return { ...base, configError: resolved.reason };
  }
  const config = resolved.config;
  const snapshot: AIStatus = {
    ...base,
    provider: config.provider,
    model: config.model,
    baseUrlHost: baseUrlHost(config.baseUrl),
    credentialsPresent: Boolean(config.apiKey),
  };

  if (config.isLocalProvider && !base.localProviderEnabled) {
    return { ...snapshot, configError: "Local providers are disabled (AI_LOCAL_PROVIDER_ENABLED)." };
  }
  try {
    assertConfigSafe(config, env);
  } catch (err) {
    return { ...snapshot, configError: err instanceof AIError ? err.message : "Invalid configuration." };
  }

  const status: AIStatus = { ...snapshot, configOk: true };
  if (opts?.runHealthCheck === false) return status;

  try {
    status.health = await buildProvider(config).healthCheck();
  } catch (err) {
    status.health = { healthy: false, provider: config.provider, model: config.model, errorCode: err instanceof AIError ? err.code : "upstream_error" };
  }
  return status;
}
