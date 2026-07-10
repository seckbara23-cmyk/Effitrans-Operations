import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCopilot, getCopilotConfig, CopilotError, type CopilotErrorCode } from "@/lib/copilot/openai";
import type { CopilotChatMessage } from "@/lib/copilot/prompt";

const MESSAGES: CopilotChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "Résume le dossier" },
];

const KEY = "sk-secret-value-DO-NOT-LEAK-123";

// Build a fake OpenAI fetch Response.
function res(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.OPENAI_API_KEY = KEY;
  delete process.env.OPENAI_COPILOT_MODEL;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_COPILOT_MODEL;
});

async function expectCode(code: CopilotErrorCode, status: number): Promise<CopilotError> {
  const err = await runCopilot(MESSAGES).catch((e) => e);
  expect(err).toBeInstanceOf(CopilotError);
  expect((err as CopilotError).code).toBe(code);
  expect((err as CopilotError).httpStatus).toBe(status);
  expect((err as CopilotError).message).toBeTruthy();
  return err as CopilotError;
}

describe("getCopilotConfig (secret-free diagnostics)", () => {
  it("reports key presence as a boolean and never the key itself", () => {
    const c = getCopilotConfig();
    expect(c.apiKeyPresent).toBe(true);
    expect(c.provider).toBe("openai");
    expect(c.model).toBe("gpt-4o-mini");
    expect(JSON.stringify(c)).not.toContain(KEY);
  });

  it("defaults are overridable and presence flips when the key is absent", () => {
    process.env.OPENAI_COPILOT_MODEL = "gpt-4o";
    expect(getCopilotConfig().model).toBe("gpt-4o");
    delete process.env.OPENAI_API_KEY;
    expect(getCopilotConfig().apiKeyPresent).toBe(false);
  });
});

describe("runCopilot — error differentiation (Phase 3.1A audit)", () => {
  it("missing API key → missing_api_key (503), no network call", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expectCode("missing_api_key", 503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 401 → invalid_api_key (502)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(401, { error: { code: "invalid_api_key", type: "invalid_request_error", message: "Incorrect API key" } })));
    await expectCode("invalid_api_key", 502);
  });

  it("HTTP 404 model_not_found → invalid_model (502)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(404, { error: { code: "model_not_found", message: "The model does not exist" } })));
    await expectCode("invalid_model", 502);
  });

  it("HTTP 400 mentioning the model → invalid_model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(400, { error: { message: "Unknown model: gpt-x" } })));
    await expectCode("invalid_model", 502);
  });

  it("HTTP 429 → rate_limited (429)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(429, { error: { code: "rate_limit_exceeded" } })));
    await expectCode("rate_limited", 429);
  });

  it("HTTP 500 → upstream_error (502)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(500, { error: { message: "server error" } })));
    await expectCode("upstream_error", 502);
  });

  it("timeout (AbortSignal) → timeout (504)", async () => {
    const timeoutErr = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutErr));
    await expectCode("timeout", 504);
  });

  it("network failure → upstream_error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expectCode("upstream_error", 502);
  });

  it("empty completion → empty_response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { choices: [{ message: { content: "  " } }] })));
    await expectCode("empty_response", 502);
  });

  it("valid completion → plain text (read-only, no tools requested)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { choices: [{ message: { content: "Résumé du dossier." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const text = await runCopilot(MESSAGES);
    expect(text).toBe("Résumé du dossier.");
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(sentBody.tools).toBeUndefined();
    expect(sentBody.functions).toBeUndefined();
  });
});

describe("structured logging never leaks the secret", () => {
  it("logs apiKeyPresent + status + openai code but not the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(401, { error: { code: "invalid_api_key", type: "invalid_request_error", message: "Incorrect API key provided: sk-xxx" } })));
    await runCopilot(MESSAGES).catch(() => {});
    const logged = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("copilot.openai");
    expect(logged).toContain("\"apiKeyPresent\":true");
    expect(logged).toContain("\"httpStatus\":401");
    expect(logged).toContain("invalid_api_key");
    expect(logged).not.toContain(KEY); // the real secret is never logged
  });
});
