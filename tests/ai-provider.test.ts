import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveAIConfig,
  validateAIConfig,
  resolveFallbackConfig,
  aiCopilotEnabled,
  aiLocalProviderEnabled,
  isHostedProduction,
  parseAllowlist,
  baseUrlHost,
  AI_LIMITS,
  type AIEnv,
  type ResolvedAIConfig,
} from "@/lib/ai/config";
import { getAIProvider, buildProvider, generateAI } from "@/lib/ai/provider";
import { ollamaRequestBody, classifyOllama } from "@/lib/ai/ollama-provider";
import { classifyOpenAiCompatible } from "@/lib/ai/openai-compatible";
import { AIError } from "@/lib/ai/types";

const KEY = "sk-secret-DO-NOT-LEAK-999";
const OPENAI_ENV: AIEnv = { OPENAI_API_KEY: KEY };
const OLLAMA_ENV: AIEnv = { AI_PROVIDER: "ollama", AI_MODEL: "qwen2.5:7b", AI_LOCAL_PROVIDER_ENABLED: "true" };
const VLLM_ENV: AIEnv = { AI_PROVIDER: "vllm", AI_MODEL: "qwen2.5:32b", AI_BASE_URL: "https://ai.effitrans.sn/v1", AI_API_KEY: "tok", AI_LOCAL_PROVIDER_ENABLED: "true" };

function okRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errRes(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}
/** Return each queued item per call; repeat the last for extra calls. */
function seqFetch(seq: Array<Response | Error>): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn(async () => {
    const item = seq[Math.min(n, seq.length - 1)];
    n += 1;
    if (item instanceof Error) throw item;
    return item;
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("config resolution + provider selection (backward compatible)", () => {
  it("defaults to OpenAI gpt-4o-mini when AI_PROVIDER is unset", () => {
    const r = resolveAIConfig(OPENAI_ENV);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toMatchObject({ provider: "openai", model: "gpt-4o-mini", apiKey: KEY, isLocalProvider: false });
    expect(r.config.baseUrl).toBe("https://api.openai.com/v1");
  });
  it("honours OPENAI_COPILOT_MODEL and AI_* overrides", () => {
    const r1 = resolveAIConfig({ OPENAI_API_KEY: KEY, OPENAI_COPILOT_MODEL: "gpt-4o" });
    expect(r1.ok && r1.config.model).toBe("gpt-4o");
    const r2 = resolveAIConfig({ AI_PROVIDER: "openai", AI_MODEL: "gpt-4.1", AI_API_KEY: "k2" });
    expect(r2.ok && r2.config.model).toBe("gpt-4.1");
    expect(r2.ok && r2.config.apiKey).toBe("k2");
  });
  it("selects the right concrete provider", () => {
    const cfg = (e: AIEnv) => { const r = resolveAIConfig(e); if (!r.ok) throw new Error(r.reason); return r.config; };
    expect(buildProvider(cfg(OPENAI_ENV)).name).toBe("openai");
    expect(buildProvider(cfg(OLLAMA_ENV)).name).toBe("ollama");
    expect(buildProvider(cfg(VLLM_ENV)).name).toBe("vllm");
  });
  it("requires a base URL for vLLM, rejects unknown providers; ollama gets safe defaults", () => {
    expect(resolveAIConfig({ AI_PROVIDER: "vllm", AI_MODEL: "m" })).toMatchObject({ ok: false, code: "invalid_config" });
    expect(resolveAIConfig({ AI_PROVIDER: "bogus" })).toMatchObject({ ok: false, code: "invalid_config" });
    const oll = resolveAIConfig({ AI_PROVIDER: "ollama" });
    expect(oll.ok && oll.config).toMatchObject({ provider: "ollama", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434" });
  });
  it("ollama defaults base URL to 127.0.0.1:11434", () => {
    const r = resolveAIConfig(OLLAMA_ENV);
    expect(r.ok && r.config.baseUrl).toBe("http://127.0.0.1:11434");
  });
  it("resolveFallbackConfig only returns a config when explicitly set", () => {
    expect(resolveFallbackConfig({})).toBeNull();
    const fb = resolveFallbackConfig({ AI_FALLBACK_PROVIDER: "openai", AI_FALLBACK_MODEL: "gpt-4o", AI_FALLBACK_API_KEY: "k" });
    expect(fb?.provider).toBe("openai");
  });
});

describe("flags", () => {
  it("copilot master: unset enabled (backward compat), explicit false disables", () => {
    expect(aiCopilotEnabled({})).toBe(true);
    expect(aiCopilotEnabled({ AI_COPILOT_ENABLED: "true" })).toBe(true);
    expect(aiCopilotEnabled({ AI_COPILOT_ENABLED: "false" })).toBe(false);
  });
  it("local providers are dark by default", () => {
    expect(aiLocalProviderEnabled({})).toBe(false);
    expect(aiLocalProviderEnabled({ AI_LOCAL_PROVIDER_ENABLED: "true" })).toBe(true);
  });
  it("hosted only when VERCEL=1; parseAllowlist splits CSV", () => {
    expect(isHostedProduction({})).toBe(false);
    expect(isHostedProduction({ VERCEL: "1" })).toBe(true);
    expect(parseAllowlist("a.com, b.com")).toEqual(["a.com", "b.com"]);
    expect(parseAllowlist("")).toBeNull();
  });
});

describe("production safety validation", () => {
  const cfg: ResolvedAIConfig = { provider: "vllm", model: "m", baseUrl: "http://ai.local:8000/v1", apiKey: null, timeoutMs: 30_000, isLocalProvider: true };
  const opts = { hosted: true, allowInsecureHttp: false, allowNoAuth: false, allowlist: null };

  it("rejects localhost base URL on a hosted deployment", () => {
    const local: ResolvedAIConfig = { ...cfg, baseUrl: "http://localhost:11434", apiKey: "t" };
    expect(validateAIConfig(local, opts)).toMatchObject({ ok: false, code: "unsafe_config" });
    // ...but is allowed off-Vercel (dev / internal).
    expect(validateAIConfig(local, { ...opts, hosted: false })).toEqual({ ok: true });
  });
  it("rejects a plain-HTTP remote endpoint in production unless approved", () => {
    const httpRemote: ResolvedAIConfig = { ...cfg, baseUrl: "http://ai.effitrans.sn/v1", apiKey: "t" };
    expect(validateAIConfig(httpRemote, opts)).toMatchObject({ ok: false, code: "unsafe_config" });
    expect(validateAIConfig(httpRemote, { ...opts, allowInsecureHttp: true })).toEqual({ ok: true });
  });
  it("rejects an unauthenticated remote private endpoint unless approved", () => {
    const noAuth: ResolvedAIConfig = { ...cfg, baseUrl: "https://ai.effitrans.sn/v1", apiKey: null };
    expect(validateAIConfig(noAuth, opts)).toMatchObject({ ok: false, code: "unsafe_config" });
    expect(validateAIConfig(noAuth, { ...opts, allowNoAuth: true })).toEqual({ ok: true });
  });
  it("enforces the base URL host allowlist in production", () => {
    const ok: ResolvedAIConfig = { ...cfg, baseUrl: "https://ai.effitrans.sn/v1", apiKey: "t" };
    expect(validateAIConfig(ok, { ...opts, allowlist: ["ai.effitrans.sn"] })).toEqual({ ok: true });
    expect(validateAIConfig(ok, { ...opts, allowlist: ["other.host"] })).toMatchObject({ ok: false, code: "unsafe_config" });
  });
  it("rejects a malformed base URL as invalid_config (even off-Vercel)", () => {
    const bad: ResolvedAIConfig = { ...cfg, baseUrl: "not-a-url", apiKey: "t" };
    expect(validateAIConfig(bad, { ...opts, hosted: false })).toMatchObject({ ok: false, code: "invalid_config" });
  });
});

describe("getAIProvider gating", () => {
  it("throws provider_unavailable when the copilot is disabled", () => {
    expect(() => getAIProvider({ ...OPENAI_ENV, AI_COPILOT_ENABLED: "false" })).toThrow(AIError);
    try { getAIProvider({ ...OPENAI_ENV, AI_COPILOT_ENABLED: "false" }); } catch (e) { expect((e as AIError).code).toBe("provider_unavailable"); }
  });
  it("throws provider_unavailable when a local provider is not enabled", () => {
    try { getAIProvider({ AI_PROVIDER: "ollama", AI_MODEL: "m" }); expect.unreachable(); }
    catch (e) { expect((e as AIError).code).toBe("provider_unavailable"); }
  });
  it("throws invalid_config for a malformed base URL", () => {
    try { getAIProvider({ AI_PROVIDER: "vllm", AI_MODEL: "m", AI_BASE_URL: "not-a-url", AI_LOCAL_PROVIDER_ENABLED: "true" }); expect.unreachable(); }
    catch (e) { expect((e as AIError).code).toBe("invalid_config"); }
  });
});

describe("ollama native request mapping (isolated transport)", () => {
  it("maps to /api/chat body shape with NO tools/functions", () => {
    const body = ollamaRequestBody("qwen2.5:7b", { systemPrompt: "S", userPrompt: "U", temperature: 0.1, maxTokens: 128 });
    expect(body).toMatchObject({
      model: "qwen2.5:7b",
      messages: [ { role: "system", content: "S" }, { role: "user", content: "U" } ],
      stream: false,
      options: { temperature: 0.1, num_predict: 128 },
    });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("functions");
  });
  it("classifyOllama maps 404 / model text to model_not_found", () => {
    expect(classifyOllama(404, "model 'x' not found").code).toBe("model_not_found");
    expect(classifyOllama(400, "unknown model").code).toBe("model_not_found");
    expect(classifyOllama(500, "boom").code).toBe("upstream_error");
  });
});

describe("classifyOpenAiCompatible", () => {
  it("maps upstream statuses to distinct codes", () => {
    expect(classifyOpenAiCompatible(401, { code: "invalid_api_key" }).code).toBe("invalid_credentials");
    expect(classifyOpenAiCompatible(404, { code: "model_not_found" }).code).toBe("model_not_found");
    expect(classifyOpenAiCompatible(429, undefined).code).toBe("rate_limited");
    expect(classifyOpenAiCompatible(500, undefined).code).toBe("upstream_error");
    expect(classifyOpenAiCompatible(400, { message: "Unknown model foo" }).code).toBe("model_not_found");
  });
});

describe("generateAI — OpenAI-compatible transport (read-only body, errors, retry, fallback)", () => {
  it("returns plain text and sends NO tools/functions", async () => {
    const fetchMock = seqFetch([okRes({ choices: [{ message: { content: "Bonjour" } }] })]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await generateAI({ systemPrompt: "sys", userPrompt: "Résume" }, OPENAI_ENV);
    expect(out.text).toBe("Bonjour");
    expect(out.provider).toBe("openai");
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.tools).toBeUndefined();
    expect(body.functions).toBeUndefined();
  });
  it("rejects an empty completion", async () => {
    vi.stubGlobal("fetch", seqFetch([okRes({ choices: [{ message: { content: "   " } }] })]));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "empty_response" });
  });
  it("classifies a timeout", async () => {
    const timeoutErr = Object.assign(new Error("t"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", seqFetch([timeoutErr]));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "timeout" });
  });
  it("retries ONCE on a transient (5xx) error then succeeds", async () => {
    const fetchMock = seqFetch([errRes(500, { error: { message: "boom" } }), okRes({ choices: [{ message: { content: "ok" } }] })]);
    vi.stubGlobal("fetch", fetchMock);
    const out = await generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV);
    expect(out.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does NOT retry a non-transient (401) error", async () => {
    const fetchMock = seqFetch([errRes(401, { error: { code: "invalid_api_key" } })]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses an EXPLICIT fallback provider after the primary exhausts retries", async () => {
    const fetchMock = seqFetch([errRes(500, {}), errRes(500, {}), okRes({ choices: [{ message: { content: "via-fallback" } }] })]);
    vi.stubGlobal("fetch", fetchMock);
    const env: AIEnv = { ...OPENAI_ENV, AI_FALLBACK_PROVIDER: "openai", AI_FALLBACK_MODEL: "gpt-4o", AI_FALLBACK_API_KEY: "k2" };
    const out = await generateAI({ systemPrompt: "s", userPrompt: "u" }, env);
    expect(out.text).toBe("via-fallback");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does NOT fall back when no fallback is configured", async () => {
    const fetchMock = seqFetch([errRes(500, {}), errRes(500, {})]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "upstream_error" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // primary + one retry, no fallback
  });
  it("enforces the prompt-size limit before any network call", async () => {
    const fetchMock = seqFetch([okRes({ choices: [{ message: { content: "x" } }] })]);
    vi.stubGlobal("fetch", fetchMock);
    const huge = "x".repeat(AI_LIMITS.maxPromptChars + 1);
    await expect(generateAI({ systemPrompt: huge, userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "prompt_too_large" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("truncates an oversize response to the max", async () => {
    const big = "a".repeat(AI_LIMITS.maxResponseChars + 500);
    vi.stubGlobal("fetch", seqFetch([okRes({ choices: [{ message: { content: big } }] })]));
    const out = await generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV);
    expect(out.text.length).toBe(AI_LIMITS.maxResponseChars);
  });
  it("missing OpenAI credentials → missing_credentials, no network call", async () => {
    const fetchMock = seqFetch([okRes({})]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, {})).rejects.toMatchObject({ code: "missing_credentials" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("secret redaction in diagnostics", () => {
  it("never logs the API key on failure", async () => {
    vi.stubGlobal("fetch", seqFetch([errRes(401, { error: { code: "invalid_api_key", message: `bad key ${KEY}` } })]));
    await generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV).catch(() => {});
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("ai.request");
    expect(logged).toContain('"provider":"openai"');
    expect(logged).not.toContain(KEY);
  });
  it("baseUrlHost returns host only", () => {
    expect(baseUrlHost("https://ai.effitrans.sn/v1")).toBe("ai.effitrans.sn");
    expect(baseUrlHost("nonsense")).toBe("invalid");
  });
});
