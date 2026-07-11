/**
 * Provider-neutral AI types (Phase 3.4F-1). Client + server safe (no I/O).
 * ---------------------------------------------------------------------------
 * A common interface for the Operations Copilot's model backend so switching
 * OpenAI → Ollama (Qwen local) → vLLM (Qwen/Llama private) is CONFIGURATION,
 * not a rewrite. The model stays read-only by construction: providers accept a
 * system + user prompt and return plain text — no tools, no function-calling,
 * no DB access. Nothing here holds a secret.
 */

export type AIProviderName = "openai" | "ollama" | "vllm";

export type AIGenerateInput = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AIUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AIGenerateResult = {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
  usage?: AIUsage;
};

export type AIHealthResult = {
  healthy: boolean;
  provider: string;
  model: string;
  latencyMs?: number;
  errorCode?: string;
  // Enriched, SECRET-FREE health detail (providers populate what they can; e.g.
  // Ollama distinguishes reachable/unreachable and configured-model present/missing).
  reachable?: boolean;
  configuredModel?: string;
  modelPresent?: boolean;
  /** Provider version, only when reliably available (no internal URL/network detail). */
  version?: string;
};

/** The transport a provider implements. Text-only; no tool/function surface. */
export interface AIProvider {
  name: AIProviderName;
  model: string;
  generate(input: AIGenerateInput): Promise<AIGenerateResult>;
  healthCheck(): Promise<AIHealthResult>;
}

/** Distinct, client-safe failure categories (secret-free). */
export type AIErrorCode =
  | "missing_credentials"
  | "invalid_credentials"
  | "model_not_found"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "empty_response"
  | "response_too_large"
  | "provider_unavailable"
  | "invalid_config"
  | "unsafe_config"
  | "prompt_too_large";

/** Transient failures worth exactly one bounded retry / an explicit fallback. */
export const RETRIABLE_AI_CODES: ReadonlySet<AIErrorCode> = new Set<AIErrorCode>([
  "timeout",
  "upstream_error",
  "provider_unavailable",
]);

/** A classified AI failure. `retriable` drives the single bounded retry. */
export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly retriable: boolean;
  constructor(code: AIErrorCode, message?: string, opts?: { retriable?: boolean }) {
    super(message ?? code);
    this.name = "AIError";
    this.code = code;
    this.retriable = opts?.retriable ?? RETRIABLE_AI_CODES.has(code);
  }
}

export function isAIError(e: unknown): e is AIError {
  return e instanceof AIError;
}
