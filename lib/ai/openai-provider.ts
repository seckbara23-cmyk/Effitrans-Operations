/**
 * OpenAI provider (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The default, backward-compatible provider (Phase 3.1A behaviour). Uses the
 * shared OpenAI-compatible transport; requires an API key (missing key →
 * missing_credentials, no network call).
 */
import "server-only";
import { openAiCompatibleChat, openAiCompatibleHealth } from "./openai-compatible";
import type { AIProvider } from "./types";
import type { ResolvedAIConfig } from "./config";

export function createOpenAIProvider(config: ResolvedAIConfig): AIProvider {
  return {
    name: "openai",
    model: config.model,
    generate: (input) =>
      openAiCompatibleChat({ providerName: "openai", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, requireAuth: true, timeoutMs: config.timeoutMs, input }),
    healthCheck: () =>
      openAiCompatibleHealth({ providerName: "openai", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }),
  };
}
