import { describe, it, expect } from "vitest";
import { prettyModel, providerDisplay, copilotErrorMessage } from "@/lib/copilot/provider-ux";

describe("prettyModel", () => {
  it("formats an Ollama tag into a human label", () => {
    expect(prettyModel("qwen2.5:3b")).toBe("Qwen2.5 3B");
    expect(prettyModel("llama3.2:3b")).toBe("Llama3.2 3B");
    expect(prettyModel("mistral")).toBe("Mistral");
    expect(prettyModel("")).toBe("");
  });
});

describe("providerDisplay — badge label + tier", () => {
  it("maps each provider to a label and tier", () => {
    expect(providerDisplay("ollama", "qwen2.5:3b")).toEqual({ label: "Qwen2.5 3B", tier: "local" });
    expect(providerDisplay("openai", "gpt-4o-mini")).toEqual({ label: "OpenAI", tier: "cloud" });
    expect(providerDisplay("vllm", "qwen2.5-32b")).toEqual({ label: "vLLM", tier: "enterprise" });
    expect(providerDisplay("something", null)).toEqual({ label: "something", tier: "cloud" });
  });
});

describe("copilotErrorMessage — provider-aware French messages (D1)", () => {
  it("Ollama server down → local-assistant message mentioning Ollama", () => {
    const m = copilotErrorMessage("provider_unavailable", { provider: "ollama", model: "qwen2.5:3b" });
    expect(m).toMatch(/local/i);
    expect(m).toMatch(/Ollama/);
  });
  it("missing Ollama model → names the model + the pull command", () => {
    const m = copilotErrorMessage("invalid_model", { provider: "ollama", model: "qwen2.5:3b" });
    expect(m).toContain("qwen2.5:3b");
    expect(m).toContain("ollama pull qwen2.5:3b");
  });
  it("Ollama timeout hints the model may be starting", () => {
    expect(copilotErrorMessage("timeout", { provider: "ollama", model: "qwen2.5:3b" })).toMatch(/démarre/);
  });
  it("rate-limit wording is OpenAI-specific", () => {
    expect(copilotErrorMessage("rate_limited", { provider: "openai", model: "" })).toMatch(/Limite de requêtes du fournisseur/);
    // Ollama gets a generic concurrency message, NOT the provider rate-limit wording.
    expect(copilotErrorMessage("rate_limited", { provider: "ollama", model: "" })).not.toMatch(/Limite de requêtes du fournisseur/);
  });
  it("missing OpenAI key names OPENAI_API_KEY", () => {
    expect(copilotErrorMessage("missing_api_key", { provider: "openai", model: "" })).toContain("OPENAI_API_KEY");
  });
  it("falls back to a safe generic message for unknown codes", () => {
    expect(copilotErrorMessage("weird_code", { provider: "ollama", model: "" })).toMatch(/service IA/i);
  });
});
