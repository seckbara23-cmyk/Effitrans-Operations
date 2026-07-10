/**
 * AI provider configuration + safety (Phase 3.4F-1) — PURE, unit-testable.
 * ---------------------------------------------------------------------------
 * Resolves the provider/model/base-url/credentials from env with FULL backward
 * compatibility (OPENAI_API_KEY / OPENAI_COPILOT_MODEL still work; with
 * AI_PROVIDER unset behaviour is unchanged), applies the dark-by-default local
 * flag, and rejects unsafe HOSTED configuration (localhost base on Vercel,
 * plain-HTTP remote, remote private endpoint without auth, off-allowlist host).
 * No process.env access here — callers pass the env — so every rule is tested.
 */
import type { AIErrorCode, AIProviderName } from "./types";

/**
 * The subset of env the AI layer reads (all optional). The index signature keeps
 * `process.env` (NodeJS.ProcessEnv) assignable — the named keys are documentation.
 */
export type AIEnv = {
  [key: string]: string | undefined;
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
  AI_COPILOT_ENABLED?: string;
  AI_LOCAL_PROVIDER_ENABLED?: string;
  AI_FALLBACK_PROVIDER?: string;
  AI_FALLBACK_MODEL?: string;
  AI_FALLBACK_BASE_URL?: string;
  AI_FALLBACK_API_KEY?: string;
  AI_BASE_URL_ALLOWLIST?: string;
  AI_ALLOW_INSECURE_HTTP?: string;
  AI_ALLOW_NO_AUTH?: string;
  // Backward compatibility (Phase 3.1A).
  OPENAI_API_KEY?: string;
  OPENAI_COPILOT_MODEL?: string;
  // Hosting signal (Vercel sets VERCEL=1).
  VERCEL?: string;
};

export const AI_LIMITS = {
  /** Combined system+user prompt hard cap (chars). */
  maxPromptChars: 24_000,
  /** Response hard cap (chars) — larger is truncated. */
  maxResponseChars: 20_000,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 60_000,
  defaultMaxTokens: 1_024,
  defaultTemperature: 0.2,
} as const;

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OLLAMA_DEFAULT_BASE = "http://localhost:11434";
const PROVIDER_NAMES: AIProviderName[] = ["openai", "ollama", "vllm"];

export function isAIProviderName(v: string): v is AIProviderName {
  return (PROVIDER_NAMES as string[]).includes(v);
}

export type ResolvedAIConfig = {
  provider: AIProviderName;
  model: string;
  /** Fully-qualified API base (no trailing "/chat/completions"). */
  baseUrl: string;
  apiKey: string | null;
  /** ollama/vllm are "local/private" providers (dark by default). */
  isLocalProvider: boolean;
};

export type ConfigResult =
  | { ok: true; config: ResolvedAIConfig }
  | { ok: false; code: AIErrorCode; reason: string };

const clean = (v: string | undefined): string => (v ?? "").trim();

/** Resolve the primary provider config from env (backward compatible). */
export function resolveAIConfig(env: AIEnv): ConfigResult {
  const providerRaw = clean(env.AI_PROVIDER) || "openai";
  if (!isAIProviderName(providerRaw)) {
    return { ok: false, code: "invalid_config", reason: `Unknown AI_PROVIDER "${providerRaw}"` };
  }
  const provider = providerRaw;
  const isLocalProvider = provider !== "openai";

  const model =
    clean(env.AI_MODEL) ||
    (provider === "openai" ? clean(env.OPENAI_COPILOT_MODEL) || OPENAI_DEFAULT_MODEL : "");
  if (!model) {
    return { ok: false, code: "invalid_config", reason: `AI_MODEL is required for provider "${provider}"` };
  }

  const apiKey =
    clean(env.AI_API_KEY) || (provider === "openai" ? clean(env.OPENAI_API_KEY) : "") || null;

  let baseUrl: string;
  if (provider === "openai") {
    baseUrl = clean(env.AI_BASE_URL) || OPENAI_DEFAULT_BASE;
  } else if (provider === "ollama") {
    baseUrl = clean(env.AI_BASE_URL) || OLLAMA_DEFAULT_BASE;
  } else {
    // vllm — no safe default; a private base URL must be provided.
    baseUrl = clean(env.AI_BASE_URL);
    if (!baseUrl) {
      return { ok: false, code: "invalid_config", reason: 'AI_BASE_URL is required for provider "vllm"' };
    }
  }

  return { ok: true, config: { provider, model, baseUrl: baseUrl.replace(/\/$/, ""), apiKey, isLocalProvider } };
}

/** Optional explicit fallback config (never inferred — no silent paid fallback). */
export function resolveFallbackConfig(env: AIEnv): ResolvedAIConfig | null {
  const providerRaw = clean(env.AI_FALLBACK_PROVIDER);
  if (!providerRaw) return null;
  const sub: AIEnv = {
    AI_PROVIDER: providerRaw,
    AI_MODEL: env.AI_FALLBACK_MODEL,
    AI_BASE_URL: env.AI_FALLBACK_BASE_URL,
    AI_API_KEY: env.AI_FALLBACK_API_KEY,
  };
  const r = resolveAIConfig(sub);
  return r.ok ? r.config : null;
}

// --------------------------------------------------------------- flags ------

/**
 * Copilot master switch. BACKWARD COMPATIBLE: unset => enabled (existing prod is
 * unchanged); only an explicit "false" turns it off. Actual availability then
 * still depends on credentials/health.
 */
export function aiCopilotEnabled(env: AIEnv): boolean {
  return clean(env.AI_COPILOT_ENABLED) !== "false";
}

/** Local providers (ollama/vllm) are DARK BY DEFAULT — opt in explicitly. */
export function aiLocalProviderEnabled(env: AIEnv): boolean {
  return clean(env.AI_LOCAL_PROVIDER_ENABLED) === "true";
}

/** Hosted (Vercel) — cannot reach an office localhost; stricter URL rules apply. */
export function isHostedProduction(env: AIEnv): boolean {
  return clean(env.VERCEL) === "1";
}

export function parseAllowlist(raw: string | undefined): string[] | null {
  const list = clean(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

// ----------------------------------------------------------- validation -----

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

export type ValidateOpts = {
  hosted: boolean;
  allowInsecureHttp: boolean;
  allowNoAuth: boolean;
  allowlist: string[] | null;
};

export type ConfigValidation = { ok: true } | { ok: false; code: AIErrorCode; reason: string };

/** Reject unsafe HOSTED production configuration. Lenient off-Vercel (dev/internal). */
export function validateAIConfig(config: ResolvedAIConfig, opts: ValidateOpts): ConfigValidation {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return { ok: false, code: "invalid_config", reason: `Invalid AI base URL "${config.baseUrl}"` };
  }
  const host = url.hostname.toLowerCase();
  const isLocalHost = LOCAL_HOSTS.has(host);

  if (opts.hosted) {
    if (isLocalHost) {
      return { ok: false, code: "unsafe_config", reason: "localhost AI base URL is unreachable from a hosted (Vercel) deployment" };
    }
    if (url.protocol === "http:" && !opts.allowInsecureHttp) {
      return { ok: false, code: "unsafe_config", reason: "plain-HTTP remote AI endpoint is not allowed in production (use HTTPS or approve AI_ALLOW_INSECURE_HTTP)" };
    }
    if (config.isLocalProvider && !config.apiKey && !opts.allowNoAuth) {
      return { ok: false, code: "unsafe_config", reason: "remote private AI endpoint requires authentication (set AI_API_KEY or approve AI_ALLOW_NO_AUTH for an internal network)" };
    }
    if (opts.allowlist && !opts.allowlist.includes(host)) {
      return { ok: false, code: "unsafe_config", reason: `AI base URL host "${host}" is not in AI_BASE_URL_ALLOWLIST` };
    }
  }
  return { ok: true };
}

/** Host-only view of a base URL (no scheme/path/creds) — safe for admin display. */
export function baseUrlHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid";
  }
}
