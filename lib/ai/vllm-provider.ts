/**
 * vLLM provider (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * A private, self-hosted OpenAI-compatible endpoint (vLLM serving Qwen/Llama).
 * Uses the same /v1/chat/completions transport as OpenAI. Auth is optional at
 * the transport level (a bearer token is sent when AI_API_KEY is set); the
 * PRODUCTION requirement that a remote private endpoint be authenticated is
 * enforced in config validation (unsafe_config), not here.
 */
import "server-only";
import { openAiCompatibleChat, openAiCompatibleHealth } from "./openai-compatible";
import type { AIProvider } from "./types";
import type { ResolvedAIConfig } from "./config";

export function createVllmProvider(config: ResolvedAIConfig): AIProvider {
  return {
    name: "vllm",
    model: config.model,
    generate: (input) =>
      openAiCompatibleChat({ providerName: "vllm", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, requireAuth: false, input }),
    healthCheck: () =>
      openAiCompatibleHealth({ providerName: "vllm", baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model }),
  };
}
