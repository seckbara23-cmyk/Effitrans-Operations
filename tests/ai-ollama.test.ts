import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAIConfig, type AIEnv, type ResolvedAIConfig } from "@/lib/ai/config";
import { getAIProvider, buildProvider, generateAI } from "@/lib/ai/provider";
import { ollamaModelPresent } from "@/lib/ai/ollama-provider";
import { AIError } from "@/lib/ai/types";

const OLLAMA_ENV: AIEnv = { AI_PROVIDER: "ollama", AI_LOCAL_PROVIDER_ENABLED: "true" };

function okRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errRes(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}
function badJsonRes(): Response {
  return { ok: true, status: 200, json: async () => { throw new Error("bad json"); } } as unknown as Response;
}
/** Route the mocked fetch by Ollama endpoint. */
function routeFetch(routes: { chat?: Response | Error; tags?: Response | Error; version?: Response | Error }): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    const pick = u.includes("/api/chat") ? routes.chat : u.includes("/api/tags") ? routes.tags : u.includes("/api/version") ? routes.version : undefined;
    if (pick === undefined) return okRes({});
    if (pick instanceof Error) throw pick;
    return pick;
  });
}
function cfg(env: AIEnv): ResolvedAIConfig {
  const r = resolveAIConfig(env);
  if (!r.ok) throw new Error(r.reason);
  return r.config;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); void warnSpy; });

describe("ollama config: precedence OLLAMA_* → AI_* → defaults", () => {
  it("applies safe defaults (qwen3:8b, 127.0.0.1:11434, 120s)", () => {
    expect(cfg(OLLAMA_ENV)).toMatchObject({ provider: "ollama", model: "qwen3:8b", baseUrl: "http://127.0.0.1:11434", timeoutMs: 120_000, isLocalProvider: true });
  });
  it("OLLAMA_* overrides AI_*", () => {
    const c = cfg({ AI_PROVIDER: "ollama", OLLAMA_MODEL: "qwen3:14b", AI_MODEL: "ignored", OLLAMA_BASE_URL: "http://127.0.0.1:9999", AI_BASE_URL: "http://ignored:1" });
    expect(c).toMatchObject({ model: "qwen3:14b", baseUrl: "http://127.0.0.1:9999" });
  });
  it("falls back to AI_* when OLLAMA_* absent", () => {
    const c = cfg({ AI_PROVIDER: "ollama", AI_MODEL: "qwen3:4b", AI_BASE_URL: "http://127.0.0.1:8888" });
    expect(c).toMatchObject({ model: "qwen3:4b", baseUrl: "http://127.0.0.1:8888" });
  });
  it("timeout precedence OLLAMA_REQUEST_TIMEOUT_MS → AI_REQUEST_TIMEOUT_MS → 120000, clamped to 180000", () => {
    expect(cfg({ AI_PROVIDER: "ollama", OLLAMA_REQUEST_TIMEOUT_MS: "5000" }).timeoutMs).toBe(5000);
    expect(cfg({ AI_PROVIDER: "ollama", AI_REQUEST_TIMEOUT_MS: "7000" }).timeoutMs).toBe(7000);
    expect(cfg({ AI_PROVIDER: "ollama", OLLAMA_REQUEST_TIMEOUT_MS: "5000", AI_REQUEST_TIMEOUT_MS: "7000" }).timeoutMs).toBe(5000);
    expect(cfg({ AI_PROVIDER: "ollama" }).timeoutMs).toBe(120_000);
    expect(cfg({ AI_PROVIDER: "ollama", OLLAMA_REQUEST_TIMEOUT_MS: "999999" }).timeoutMs).toBe(180_000); // clamp
  });
  it("rejects invalid / unsafe timeout values (fail closed)", () => {
    for (const bad of ["abc", "-100", "0", "1.5"]) {
      expect(resolveAIConfig({ AI_PROVIDER: "ollama", OLLAMA_REQUEST_TIMEOUT_MS: bad })).toMatchObject({ ok: false, code: "invalid_config" });
    }
    expect(resolveAIConfig({ AI_PROVIDER: "ollama", AI_REQUEST_TIMEOUT_MS: "nope" })).toMatchObject({ ok: false, code: "invalid_config" });
  });
  it("rejects an invalid URL protocol", () => {
    expect(resolveAIConfig({ AI_PROVIDER: "ollama", OLLAMA_BASE_URL: "ftp://x:11434" })).toMatchObject({ ok: false, code: "invalid_config" });
    expect(resolveAIConfig({ AI_PROVIDER: "ollama", OLLAMA_BASE_URL: "not-a-url" })).toMatchObject({ ok: false, code: "invalid_config" });
    expect(resolveAIConfig({ AI_PROVIDER: "ollama", OLLAMA_BASE_URL: "https://ollama.internal" }).ok).toBe(true);
  });
  it("whitespace-only model: vLLM fails, ollama falls back to the default", () => {
    expect(resolveAIConfig({ AI_PROVIDER: "vllm", AI_MODEL: "   ", AI_BASE_URL: "https://x/v1" })).toMatchObject({ ok: false, code: "invalid_config" });
    expect(cfg({ AI_PROVIDER: "ollama", OLLAMA_MODEL: "   " }).model).toBe("qwen3:8b");
  });
});

describe("provider factory selection (regression) + gating", () => {
  it("selects the right provider by AI_PROVIDER", () => {
    expect(buildProvider(cfg({ OPENAI_API_KEY: "k" })).name).toBe("openai");
    expect(buildProvider(cfg(OLLAMA_ENV)).name).toBe("ollama");
    expect(buildProvider(cfg({ AI_PROVIDER: "vllm", AI_MODEL: "m", AI_BASE_URL: "https://x/v1" })).name).toBe("vllm");
  });
  it("getAIProvider selects Ollama when local is enabled, else provider_unavailable", () => {
    expect(getAIProvider(OLLAMA_ENV).name).toBe("ollama");
    try { getAIProvider({ AI_PROVIDER: "ollama" }); expect.unreachable(); }
    catch (e) { expect((e as AIError).code).toBe("provider_unavailable"); }
  });
  it("existing OpenAI and vLLM config is unchanged (30s timeout)", () => {
    expect(cfg({ OPENAI_API_KEY: "k" })).toMatchObject({ provider: "openai", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1", timeoutMs: 30_000 });
    expect(cfg({ AI_PROVIDER: "vllm", AI_MODEL: "m", AI_BASE_URL: "https://ai.x/v1", AI_API_KEY: "t" })).toMatchObject({ provider: "vllm", timeoutMs: 30_000 });
  });
});

describe("ollama /api/chat transport (native mapping, errors)", () => {
  it("returns assistant text and sends stream:false with no tools", async () => {
    const fetchMock = routeFetch({ chat: okRes({ message: { content: "Bonjour" }, prompt_eval_count: 5, eval_count: 3 }) });
    vi.stubGlobal("fetch", fetchMock);
    const out = await generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV);
    expect(out).toMatchObject({ text: "Bonjour", provider: "ollama", model: "qwen3:8b" });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/chat"))!;
    expect(String(call[0])).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: "qwen3:8b", stream: false });
    expect(body.tools).toBeUndefined();
    expect(body.functions).toBeUndefined();
  });
  it("connection refused → provider_unavailable", async () => {
    vi.stubGlobal("fetch", routeFetch({ chat: new Error("ECONNREFUSED 127.0.0.1:11434") }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "provider_unavailable" });
  });
  it("timeout → timeout", async () => {
    const timeoutErr = Object.assign(new Error("t"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", routeFetch({ chat: timeoutErr }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "timeout" });
  });
  it("non-200 → upstream_error / model_not_found", async () => {
    vi.stubGlobal("fetch", routeFetch({ chat: errRes(500, { error: "boom" }) }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "upstream_error" });
    vi.stubGlobal("fetch", routeFetch({ chat: errRes(404, { error: "model 'qwen3:8b' not found" }) }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "model_not_found" });
  });
  it("malformed JSON → empty_response", async () => {
    vi.stubGlobal("fetch", routeFetch({ chat: badJsonRes() }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "empty_response" });
  });
  it("empty assistant content → empty_response", async () => {
    vi.stubGlobal("fetch", routeFetch({ chat: okRes({ message: { content: "   " } }) }));
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "empty_response" });
  });
  it("honours the configured (override) timeout", async () => {
    const fetchMock = routeFetch({ chat: okRes({ message: { content: "ok" } }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateAI({ systemPrompt: "s", userPrompt: "u" }, { ...OLLAMA_ENV, OLLAMA_REQUEST_TIMEOUT_MS: "4000" });
    // The AbortSignal is created from the config timeout; we assert config resolves it.
    expect(cfg({ ...OLLAMA_ENV, OLLAMA_REQUEST_TIMEOUT_MS: "4000" }).timeoutMs).toBe(4000);
  });
});

describe("ollama health (reachable / model present / missing)", () => {
  it("ollamaModelPresent matches by name/model, base name, and rejects absent", () => {
    expect(ollamaModelPresent([{ name: "qwen3:8b" }], "qwen3:8b")).toBe(true);
    expect(ollamaModelPresent([{ model: "qwen3:8b" }], "qwen3:8b")).toBe(true);
    expect(ollamaModelPresent([{ name: "qwen3:8b" }], "qwen3")).toBe(true);
    expect(ollamaModelPresent([{ name: "llama3:8b" }], "qwen3:8b")).toBe(false);
    expect(ollamaModelPresent([], "qwen3:8b")).toBe(false);
    expect(ollamaModelPresent(undefined, "qwen3:8b")).toBe(false);
  });
  it("reachable + model present → healthy, with version", async () => {
    vi.stubGlobal("fetch", routeFetch({ tags: okRes({ models: [{ name: "qwen3:8b" }] }), version: okRes({ version: "0.3.0" }) }));
    const h = await buildProvider(cfg(OLLAMA_ENV)).healthCheck();
    expect(h).toMatchObject({ provider: "ollama", reachable: true, configuredModel: "qwen3:8b", modelPresent: true, healthy: true, version: "0.3.0" });
  });
  it("reachable + model MISSING → not healthy, model_not_found", async () => {
    vi.stubGlobal("fetch", routeFetch({ tags: okRes({ models: [{ name: "llama3:8b" }] }), version: errRes(404, {}) }));
    const h = await buildProvider(cfg(OLLAMA_ENV)).healthCheck();
    expect(h).toMatchObject({ reachable: true, modelPresent: false, healthy: false, errorCode: "model_not_found" });
    expect(h.version).toBeUndefined();
  });
  it("unreachable → reachable:false, provider_unavailable", async () => {
    vi.stubGlobal("fetch", routeFetch({ tags: new Error("ECONNREFUSED") }));
    const h = await buildProvider(cfg(OLLAMA_ENV)).healthCheck();
    expect(h).toMatchObject({ reachable: false, modelPresent: false, healthy: false, errorCode: "provider_unavailable" });
  });
  it("malformed /api/tags → reachable but model not present", async () => {
    vi.stubGlobal("fetch", routeFetch({ tags: badJsonRes(), version: errRes(404, {}) }));
    const h = await buildProvider(cfg(OLLAMA_ENV)).healthCheck();
    expect(h).toMatchObject({ reachable: true, modelPresent: false, healthy: false });
  });
});

describe("no server-only / OLLAMA_ env leakage into client code", () => {
  function walk(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
    return out;
  }
  it("client components never reference OLLAMA_/AI secrets or import @/lib/ai", () => {
    const files = ["components", "app"].flatMap((d) => walk(join(process.cwd(), d)));
    const clientFiles = files.filter((f) => /["']use client["']/.test(readFileSync(f, "utf8")));
    expect(clientFiles.length).toBeGreaterThan(0);
    for (const f of clientFiles) {
      const c = readFileSync(f, "utf8");
      expect(c, `${f} must not reference OLLAMA_`).not.toMatch(/OLLAMA_/);
      expect(c, `${f} must not import @/lib/ai`).not.toMatch(/@\/lib\/ai\//);
      expect(c, `${f} must not reference AI/provider secrets`).not.toMatch(/AI_BASE_URL|AI_API_KEY|OPENAI_API_KEY/);
    }
  });
});
