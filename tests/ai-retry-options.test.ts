import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveRetryPolicy, resolveAIConfig, type AIEnv } from "@/lib/ai/config";
import { generateAI } from "@/lib/ai/provider";
import { ollamaRequestBody } from "@/lib/ai/ollama-provider";
import { allNavItems } from "@/lib/nav";

const OLLAMA_ENV: AIEnv = { AI_PROVIDER: "ollama", AI_LOCAL_PROVIDER_ENABLED: "true" };
const OPENAI_ENV: AIEnv = { OPENAI_API_KEY: "sk-test" };

function okRes(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errRes(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}
function seqFetch(seq: Array<Response | Error>): ReturnType<typeof vi.fn> {
  let n = 0;
  return vi.fn(async () => {
    const item = seq[Math.min(n, seq.length - 1)];
    n += 1;
    if (item instanceof Error) throw item;
    return item;
  });
}
const timeoutErr = () => Object.assign(new Error("t"), { name: "TimeoutError" });

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); void warnSpy; });

describe("provider-neutral retry policy", () => {
  it("ollama: retry 5xx only — NOT timeout, NOT connection refusal (by default)", () => {
    const p = resolveRetryPolicy(OLLAMA_ENV);
    expect(p.retryOn.has("upstream_error")).toBe(true);
    expect(p.retryOn.has("timeout")).toBe(false);
    expect(p.retryOn.has("provider_unavailable")).toBe(false);
  });
  it("ollama: OLLAMA_RETRY_ON_TIMEOUT=true opts timeout back in", () => {
    const p = resolveRetryPolicy({ ...OLLAMA_ENV, OLLAMA_RETRY_ON_TIMEOUT: "true" });
    expect(p.retryOn.has("timeout")).toBe(true);
  });
  it("openai/vllm keep the full transient retry set (regression)", () => {
    for (const env of [OPENAI_ENV, { AI_PROVIDER: "vllm" } as AIEnv]) {
      const p = resolveRetryPolicy(env);
      expect(p.retryOn.has("timeout")).toBe(true);
      expect(p.retryOn.has("upstream_error")).toBe(true);
      expect(p.retryOn.has("provider_unavailable")).toBe(true);
    }
  });
});

describe("generateAI retry behavior per provider", () => {
  it("ollama timeout is NOT retried (no double CPU wait)", async () => {
    const f = seqFetch([timeoutErr()]);
    vi.stubGlobal("fetch", f);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "timeout" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("ollama connection refusal is NOT retried", async () => {
    const f = seqFetch([new Error("ECONNREFUSED")]);
    vi.stubGlobal("fetch", f);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("ollama 5xx IS retried once", async () => {
    const f = seqFetch([errRes(500, { error: "boom" }), okRes({ message: { content: "ok" } })]);
    vi.stubGlobal("fetch", f);
    const out = await generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV);
    expect(out.text).toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("ollama timeout IS retried when opted in", async () => {
    const f = seqFetch([timeoutErr(), timeoutErr()]);
    vi.stubGlobal("fetch", f);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, { ...OLLAMA_ENV, OLLAMA_RETRY_ON_TIMEOUT: "true" })).rejects.toMatchObject({ code: "timeout" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("openai timeout still retries once (unchanged)", async () => {
    const f = seqFetch([timeoutErr(), timeoutErr()]);
    vi.stubGlobal("fetch", f);
    await expect(generateAI({ systemPrompt: "s", userPrompt: "u" }, OPENAI_ENV)).rejects.toMatchObject({ code: "timeout" });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("ollama native options (think / num_predict)", () => {
  it("defaults: thinking OFF, num_predict 512", () => {
    const r = resolveAIConfig(OLLAMA_ENV);
    expect(r.ok && r.config.ollama).toEqual({ think: false, numPredict: 512 });
  });
  it("OLLAMA_THINKING / OLLAMA_NUM_PREDICT override", () => {
    const r = resolveAIConfig({ ...OLLAMA_ENV, OLLAMA_THINKING: "true", OLLAMA_NUM_PREDICT: "256" });
    expect(r.ok && r.config.ollama).toEqual({ think: true, numPredict: 256 });
  });
  it("rejects an invalid num_predict (fail closed)", () => {
    for (const bad of ["abc", "0", "-5", "1.5"]) {
      expect(resolveAIConfig({ ...OLLAMA_ENV, OLLAMA_NUM_PREDICT: bad })).toMatchObject({ ok: false, code: "invalid_config" });
    }
  });
  it("non-ollama providers carry no ollama options", () => {
    const r = resolveAIConfig(OPENAI_ENV);
    expect(r.ok && r.config.ollama).toBeUndefined();
  });
  it("ollamaRequestBody: thinking disabled by default, overridable, still no tools", () => {
    const input = { systemPrompt: "S", userPrompt: "U" };
    const def = ollamaRequestBody("qwen3:4b", input);
    expect(def.think).toBe(false);
    expect(def).not.toHaveProperty("tools");
    expect(def).not.toHaveProperty("functions");
    const on = ollamaRequestBody("qwen3:4b", input, { think: true, numPredict: 256 });
    expect(on.think).toBe(true);
    expect((on.options as { num_predict: number }).num_predict).toBe(256);
  });
  it("generateAI(ollama) sends think:false + num_predict:512, stream:false, no tools", async () => {
    const f = seqFetch([okRes({ message: { content: "Bonjour" } })]);
    vi.stubGlobal("fetch", f);
    await generateAI({ systemPrompt: "s", userPrompt: "u" }, OLLAMA_ENV);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(512);
    expect(body.tools).toBeUndefined();
    expect(body.functions).toBeUndefined();
  });
});

describe("admin AI settings nav gate", () => {
  it("reaches /settings/ai through Paramètres, behind admin:config:manage", () => {
    // Phase 5.0E-3: the AI settings stopped being a top-level sidebar entry called
    // "Paramètres IA" — a name that described the one settings page that happened to
    // exist first. They now live under Paramètres, which is gated identically.
    const settings = allNavItems.find((i) => i.href === "/settings");
    expect(settings).toBeTruthy();
    expect(settings?.label).toBe("Paramètres");
    expect(settings?.permission).toBe("admin:config:manage");

    // The AI page is one click from there, and re-checks the permission itself.
    const hub = readFileSync(
      fileURLToPath(new URL("../app/settings/page.tsx", import.meta.url)),
      "utf8",
    );
    expect(hub).toContain('href: "/settings/ai"');
    expect(hub).toContain('permission: "admin:config:manage"');
  });
});
