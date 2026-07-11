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
  /** Generic request timeout (ms) — the middle layer under provider-specific overrides. */
  AI_REQUEST_TIMEOUT_MS?: string;
  // Ollama provider-specific overrides (layered ABOVE the generic AI_* config).
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;
  OLLAMA_REQUEST_TIMEOUT_MS?: string;
  /** Enable model "thinking"/reasoning mode. Default OFF (faster, concise answers). */
  OLLAMA_THINKING?: string;
  /** Max response tokens (num_predict) for Ollama. Default 512. */
  OLLAMA_NUM_PREDICT?: string;
  /** Retry an Ollama TIMEOUT. Default OFF — CPU-bound retries double the wait. */
  OLLAMA_RETRY_ON_TIMEOUT?: string;
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

// Timeouts (ms) — shared, named constants (no scattered literals).
/** Generic default request timeout for cloud providers (OpenAI/vLLM). */
export const DEFAULT_AI_TIMEOUT_MS = 30_000;
/** Ollama's default — local models are slower to first token, so 120 s. */
export const OLLAMA_DEFAULT_TIMEOUT_MS = 120_000;
/**
 * Documented safe upper bound for any AI request timeout (3 min). A configured
 * timeout above this is clamped down — raised from the previous 60 s only as much
 * as the 120 s Ollama default requires, with headroom for slower local models.
 */
export const MAX_AI_TIMEOUT_MS = 180_000;

export const AI_LIMITS = {
  /** Combined system+user prompt hard cap (chars). */
  maxPromptChars: 24_000,
  /** Response hard cap (chars) — larger is truncated. */
  maxResponseChars: 20_000,
  defaultTimeoutMs: DEFAULT_AI_TIMEOUT_MS,
  maxTimeoutMs: MAX_AI_TIMEOUT_MS,
  defaultMaxTokens: 1_024,
  defaultTemperature: 0.2,
} as const;

const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OLLAMA_DEFAULT_BASE = "http://127.0.0.1:11434";
const OLLAMA_DEFAULT_MODEL = "qwen3:8b";
/** Default Ollama response token cap — concise Copilot answers on CPU. */
const OLLAMA_DEFAULT_NUM_PREDICT = 512;
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
  /** Resolved request timeout (ms), already clamped to MAX_AI_TIMEOUT_MS. */
  timeoutMs: number;
  /** ollama/vllm are "local/private" providers (dark by default). */
  isLocalProvider: boolean;
  /** Ollama-only native options (present only for provider "ollama"). */
  ollama?: { think: boolean; numPredict: number };
};

export type ConfigResult =
  | { ok: true; config: ResolvedAIConfig }
  | { ok: false; code: AIErrorCode; reason: string };

const clean = (v: string | undefined): string => (v ?? "").trim();

/** Parse a positive-integer env value: unset, a safe positive integer, or invalid (fail closed). */
type IntParse = { set: false } | { set: true; ok: true; value: number } | { set: true; ok: false };
function parsePositiveIntEnv(raw: string | undefined): IntParse {
  const s = clean(raw);
  if (!s) return { set: false };
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) return { set: true, ok: false };
  return { set: true, ok: true, value: n };
}
/** The parsed value if valid, else null (unset or invalid). */
function okInt(t: IntParse): number | null {
  return t.set && t.ok ? t.value : null;
}

/** URL protocol, or null when unparseable. Shared (config layer) — http(s) only. */
function urlProtocol(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

/**
 * Resolve the primary provider config from env. Layered precedence, generic AI_*
 * canonical: OLLAMA_* override → AI_* generic → safe default. Shared validation
 * (http(s) URL, positive-integer timeout) lives here in the config layer.
 */
export function resolveAIConfig(env: AIEnv): ConfigResult {
  const providerRaw = clean(env.AI_PROVIDER) || "openai";
  if (!isAIProviderName(providerRaw)) {
    return { ok: false, code: "invalid_config", reason: `Unknown AI_PROVIDER "${providerRaw}"` };
  }
  const provider = providerRaw;
  const isLocalProvider = provider !== "openai";

  // model: OLLAMA_MODEL → AI_MODEL → provider default (qwen3:8b for ollama).
  let model: string;
  if (provider === "openai") {
    model = clean(env.AI_MODEL) || clean(env.OPENAI_COPILOT_MODEL) || OPENAI_DEFAULT_MODEL;
  } else if (provider === "ollama") {
    model = clean(env.OLLAMA_MODEL) || clean(env.AI_MODEL) || OLLAMA_DEFAULT_MODEL;
  } else {
    model = clean(env.AI_MODEL); // vllm — required
  }
  if (!model) {
    return { ok: false, code: "invalid_config", reason: `AI_MODEL is required for provider "${provider}"` };
  }

  const apiKey =
    clean(env.AI_API_KEY) || (provider === "openai" ? clean(env.OPENAI_API_KEY) : "") || null;

  // baseUrl: OLLAMA_BASE_URL → AI_BASE_URL → default (127.0.0.1:11434 for ollama).
  let baseUrl: string;
  if (provider === "openai") {
    baseUrl = clean(env.AI_BASE_URL) || OPENAI_DEFAULT_BASE;
  } else if (provider === "ollama") {
    baseUrl = clean(env.OLLAMA_BASE_URL) || clean(env.AI_BASE_URL) || OLLAMA_DEFAULT_BASE;
  } else {
    baseUrl = clean(env.AI_BASE_URL); // vllm — required
    if (!baseUrl) {
      return { ok: false, code: "invalid_config", reason: 'AI_BASE_URL is required for provider "vllm"' };
    }
  }
  baseUrl = baseUrl.replace(/\/$/, "");
  const proto = urlProtocol(baseUrl);
  if (proto === null) {
    return { ok: false, code: "invalid_config", reason: `Invalid AI base URL "${baseUrl}"` };
  }
  if (proto !== "http:" && proto !== "https:") {
    return { ok: false, code: "invalid_config", reason: `AI base URL must be http(s): "${baseUrl}"` };
  }

  // timeout: OLLAMA_REQUEST_TIMEOUT_MS → AI_REQUEST_TIMEOUT_MS → provider default.
  const genericT = parsePositiveIntEnv(env.AI_REQUEST_TIMEOUT_MS);
  if (genericT.set && !genericT.ok) {
    return { ok: false, code: "invalid_config", reason: "AI_REQUEST_TIMEOUT_MS must be a positive integer (ms)" };
  }
  const generic = okInt(genericT);
  let timeoutMs: number;
  let ollama: ResolvedAIConfig["ollama"];
  if (provider === "ollama") {
    const ollamaT = parsePositiveIntEnv(env.OLLAMA_REQUEST_TIMEOUT_MS);
    if (ollamaT.set && !ollamaT.ok) {
      return { ok: false, code: "invalid_config", reason: "OLLAMA_REQUEST_TIMEOUT_MS must be a positive integer (ms)" };
    }
    timeoutMs = okInt(ollamaT) ?? generic ?? OLLAMA_DEFAULT_TIMEOUT_MS;

    // Ollama-only native options: thinking OFF by default (concise, faster on CPU);
    // num_predict caps the answer length (positive integer, fail closed if invalid).
    const npParse = parsePositiveIntEnv(env.OLLAMA_NUM_PREDICT);
    if (npParse.set && !npParse.ok) {
      return { ok: false, code: "invalid_config", reason: "OLLAMA_NUM_PREDICT must be a positive integer" };
    }
    ollama = {
      think: clean(env.OLLAMA_THINKING) === "true",
      numPredict: okInt(npParse) ?? OLLAMA_DEFAULT_NUM_PREDICT,
    };
  } else {
    timeoutMs = generic ?? DEFAULT_AI_TIMEOUT_MS;
  }
  timeoutMs = Math.min(timeoutMs, MAX_AI_TIMEOUT_MS);

  return { ok: true, config: { provider, model, baseUrl, apiKey, timeoutMs, isLocalProvider, ...(ollama ? { ollama } : {}) } };
}

// ------------------------------------------------------------ retry policy ----

/**
 * Provider-neutral retry policy (Phase 3.4F-3). Which AIError codes get the
 * single bounded retry, per provider — instead of hard-coding checks around the
 * codebase. Ollama does NOT retry a TIMEOUT by default (CPU-bound retries double
 * the wait) and fails immediately on connection refusal (provider_unavailable);
 * a bounded 5xx (upstream_error) retry remains. OpenAI/vLLM keep the existing
 * transient retry set.
 */
export type RetryPolicy = { maxRetries: number; retryOn: ReadonlySet<AIErrorCode> };

export function resolveRetryPolicy(env: AIEnv): RetryPolicy {
  const provider = clean(env.AI_PROVIDER) || "openai";
  if (provider === "ollama") {
    const retryOn = new Set<AIErrorCode>(["upstream_error"]);
    if (clean(env.OLLAMA_RETRY_ON_TIMEOUT) === "true") retryOn.add("timeout");
    return { maxRetries: 1, retryOn };
  }
  return { maxRetries: 1, retryOn: new Set<AIErrorCode>(["timeout", "upstream_error", "provider_unavailable"]) };
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
