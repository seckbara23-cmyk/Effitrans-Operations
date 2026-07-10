/**
 * Operations Copilot engine (Phase 3.4F-1) — SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * The Copilot's model call now goes through the PROVIDER-NEUTRAL AI abstraction
 * (lib/ai) instead of importing OpenAI directly — switching OpenAI → Ollama
 * (Qwen) → vLLM (Qwen/Llama) is configuration, not a rewrite. The read-only
 * contract is unchanged: system+user prompt in, plain text out, no tools, no
 * actions. This module keeps the Copilot's stable error contract (CopilotError
 * codes + HTTP statuses + French messages) by mapping the abstraction's AIError.
 *
 * BACKWARD COMPATIBLE: with AI_PROVIDER unset the abstraction resolves to the
 * existing OpenAI configuration (OPENAI_API_KEY / OPENAI_COPILOT_MODEL) and the
 * behaviour is identical to Phase 3.1A.
 */
import "server-only";
import { generateAI } from "@/lib/ai/provider";
import { aiCopilotEnabled, aiLocalProviderEnabled, resolveAIConfig } from "@/lib/ai/config";
import { AIError, type AIErrorCode } from "@/lib/ai/types";
import type { CopilotChatMessage } from "@/lib/copilot/prompt";

export type CopilotErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "invalid_model"
  | "rate_limited"
  | "timeout"
  | "upstream_error"
  | "empty_response"
  | "provider_unavailable"
  | "invalid_config"
  | "unsafe_config"
  | "prompt_too_large";

const HTTP_STATUS: Record<CopilotErrorCode, number> = {
  missing_api_key: 503,
  invalid_api_key: 502,
  invalid_model: 502,
  rate_limited: 429,
  timeout: 504,
  upstream_error: 502,
  empty_response: 502,
  provider_unavailable: 503,
  invalid_config: 503,
  unsafe_config: 503,
  prompt_too_large: 413,
};

const MESSAGES: Record<CopilotErrorCode, string> = {
  missing_api_key: "Copilote non configuré : aucune clé/authentification pour le fournisseur IA (AI_API_KEY / OPENAI_API_KEY).",
  invalid_api_key: "Authentification du fournisseur IA refusée. Vérifiez la clé (AI_API_KEY / OPENAI_API_KEY).",
  invalid_model: "Modèle IA invalide ou indisponible. Vérifiez AI_MODEL (ou OPENAI_COPILOT_MODEL).",
  rate_limited: "Limite de requêtes du fournisseur IA atteinte. Réessayez dans un instant.",
  timeout: "Le modèle n'a pas répondu dans le délai imparti. Réessayez.",
  upstream_error: "Le service IA a renvoyé une erreur. Réessayez plus tard.",
  empty_response: "Le modèle n'a renvoyé aucune réponse.",
  provider_unavailable: "Le fournisseur IA est indisponible ou désactivé sur cet environnement.",
  invalid_config: "Configuration IA invalide (fournisseur, modèle ou URL manquant/incorrect).",
  unsafe_config: "Configuration IA refusée en production (URL locale, HTTP non sécurisé, ou authentification manquante).",
  prompt_too_large: "La requête est trop volumineuse pour le modèle.",
};

/** A classified Copilot failure — machine code + HTTP status (stable contract). */
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

/** Map the provider-neutral AIError code to the Copilot's stable code. */
function toCopilotCode(code: AIErrorCode): CopilotErrorCode {
  switch (code) {
    case "missing_credentials":
      return "missing_api_key";
    case "invalid_credentials":
      return "invalid_api_key";
    case "model_not_found":
      return "invalid_model";
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "empty_response":
      return "empty_response";
    case "provider_unavailable":
      return "provider_unavailable";
    case "invalid_config":
      return "invalid_config";
    case "unsafe_config":
      return "unsafe_config";
    case "prompt_too_large":
      return "prompt_too_large";
    case "response_too_large":
    case "upstream_error":
    default:
      return "upstream_error";
  }
}

export type CopilotConfig = { apiKeyPresent: boolean; model: string; provider: string; configured: boolean };

/** Non-secret configuration snapshot (diagnostics — never returns the key). */
export function getCopilotConfig(): CopilotConfig {
  const resolved = resolveAIConfig(process.env);
  if (!resolved.ok) {
    return {
      provider: (process.env.AI_PROVIDER || "openai").trim(),
      model: (process.env.AI_MODEL || "").trim(),
      apiKeyPresent: Boolean((process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "").trim()),
      configured: false,
    };
  }
  return {
    provider: resolved.config.provider,
    model: resolved.config.model,
    apiKeyPresent: Boolean(resolved.config.apiKey),
    configured: isCopilotConfigured(),
  };
}

/** Whether the Copilot can actually run right now (flags + credentials/config). */
export function isCopilotConfigured(): boolean {
  if (!aiCopilotEnabled(process.env)) return false;
  const resolved = resolveAIConfig(process.env);
  if (!resolved.ok) return false;
  if (resolved.config.isLocalProvider) return aiLocalProviderEnabled(process.env);
  return Boolean(resolved.config.apiKey); // OpenAI needs a key
}

/**
 * Run one read-only completion and return the model's plain-text reply. Throws a
 * CopilotError with a specific code on any failure (the AI layer already logged
 * a secret-free diagnostic).
 */
export async function runCopilot(messages: CopilotChatMessage[]): Promise<string> {
  const systemPrompt = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const userPrompt = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  try {
    const result = await generateAI({ systemPrompt, userPrompt }, process.env);
    return result.text;
  } catch (err) {
    if (err instanceof AIError) throw new CopilotError(toCopilotCode(err.code));
    throw new CopilotError("upstream_error");
  }
}
