/**
 * Local model evaluation runner (Phase 3.4F-2). LOCAL-ONLY, run via vitest with
 * the dedicated config so it never runs under `npm test`:
 *
 *   EVAL_MODEL=qwen3:4b   npm run ai:eval:local
 *   EVAL_MODEL=qwen2.5:3b npm run ai:eval:local
 *   EVAL_MODEL=llama3.2:3b npm run ai:eval:local
 *
 * It executes the SANITIZED evaluation scenarios (no production data) against a
 * configured Ollama model — sequentially (no CPU overload), one warm-up for
 * cold-start latency, per-scenario timeout from config, NO retry on timeout
 * (Ollama policy). It scores each scenario deterministically (lib/ai/eval), writes
 * a JSON artifact to the gitignored `eval-results/`, and prints a sanitized table.
 *
 * Security: model is chosen from an ALLOWLIST via env (no arbitrary model); the
 * Ollama base URL comes from trusted config (env/default), never user argv; no
 * secrets or full prompts are printed; answers come from sanitized fixtures.
 *
 * Optional env: EVAL_NUM_PREDICT (default 512), EVAL_LIMIT (cap scenarios; 0=all),
 * OLLAMA_BASE_URL, OLLAMA_REQUEST_TIMEOUT_MS, OLLAMA_THINKING.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvalCases } from "@/lib/ai/eval/harness";
import { buildMessages } from "@/lib/copilot/prompt";
import { detectSkill, wantsEnglish } from "@/lib/copilot/skills";
import { buildScorecard, type Scorecard } from "@/lib/ai/eval/evaluators";
import { assertAllowedEvalModel } from "@/lib/ai/eval/model-allowlist";
import { generateAI } from "@/lib/ai/provider";
import type { AIEnv } from "@/lib/ai/config";

function pickModel(): string {
  const fromEnv = (process.env.EVAL_MODEL ?? "").trim();
  const argIdx = process.argv.indexOf("--model");
  const fromArg = argIdx >= 0 ? (process.argv[argIdx + 1] ?? "").trim() : "";
  return assertAllowedEvalModel(fromEnv || fromArg);
}

function avg(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n));
  return xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null;
}

describe("local model evaluation (live Ollama)", () => {
  it("evaluates the configured EVAL_MODEL", async () => {
    const model = pickModel();
    const numPredict = Number(process.env.EVAL_NUM_PREDICT ?? "512");
    const limit = Number(process.env.EVAL_LIMIT ?? "0");

    const env: AIEnv = {
      AI_PROVIDER: "ollama",
      AI_COPILOT_ENABLED: "true",
      AI_LOCAL_PROVIDER_ENABLED: "true",
      OLLAMA_MODEL: model,
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
      OLLAMA_THINKING: process.env.OLLAMA_THINKING ?? "false",
      OLLAMA_NUM_PREDICT: String(numPredict),
      OLLAMA_REQUEST_TIMEOUT_MS: process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? "175000",
    };

    // Warm-up — measures cold-start latency (model load). Best-effort.
    let coldStartMs: number | null = null;
    try {
      const t0 = Date.now();
      await generateAI({ systemPrompt: "Réponds en un mot.", userPrompt: "Bonjour" }, { ...env, OLLAMA_NUM_PREDICT: "16" });
      coldStartMs = Date.now() - t0;
    } catch {
      coldStartMs = null;
    }

    const now = new Date("2099-02-01T00:00:00.000Z");
    let cases = buildEvalCases(now);
    if (limit > 0) cases = cases.slice(0, limit);

    const scorecards: Scorecard[] = [];
    const rows: Array<Scorecard & { answerPreview: string; errorCode: string | null }> = [];

    for (const c of cases) {
      const messages = buildMessages(c.context, c.prompt, { skill: detectSkill(c.prompt), english: wantsEnglish(c.prompt) });
      const systemPrompt = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const userPrompt = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");

      let text = "";
      let latencyMs: number | null = null;
      let completionTokens: number | null = null;
      let promptTokens: number | null = null;
      let errored = false;
      let errorCode: string | null = null;
      try {
        const t0 = Date.now();
        const r = await generateAI({ systemPrompt, userPrompt }, env);
        latencyMs = Date.now() - t0;
        text = r.text;
        completionTokens = r.usage?.completionTokens ?? null;
        promptTokens = r.usage?.promptTokens ?? null;
      } catch (err) {
        errored = true;
        errorCode = (err as { code?: string })?.code ?? "error";
      }

      const sc = buildScorecard({
        scenario: c.name,
        output: text,
        expectation: c.expectation,
        requiredFacts: c.scoring.requiredFacts,
        forbiddenFacts: c.scoring.forbiddenFacts,
        allowedIds: c.scoring.allowedIds,
        categories: c.scoring.categories,
        latencyMs,
        completionTokens,
        promptTokens,
        numPredict,
        errored,
      });
      scorecards.push(sc);
      rows.push({ ...sc, errorCode, answerPreview: text.replace(/\s+/g, " ").slice(0, 300) });
    }

    const warm = scorecards.filter((s) => !s.errored && s.latencyMs != null);
    const latencies = warm.map((s) => s.latencyMs as number).sort((a, b) => a - b);
    const summary = {
      model,
      ollamaVersion: process.env.OLLAMA_VERSION ?? null,
      coldStartMs,
      numPredict,
      scenarios: scorecards.length,
      avgGroundedness: avg(scorecards.map((s) => s.groundedness)),
      avgFrenchQuality: avg(scorecards.map((s) => s.frenchQuality)),
      avgInstructionFollowing: avg(scorecards.map((s) => s.instructionFollowing)),
      safetyFailures: scorecards.filter((s) => !s.safetyPass).length,
      hiddenLeakFailures: scorecards.filter((s) => !s.hiddenLeakPass).length,
      injectionFailures: scorecards.filter((s) => !s.injectionResistPass).length,
      reasoningLeakCount: scorecards.filter((s) => !s.reasoningLeakPass).length,
      truncationCount: scorecards.filter((s) => !s.truncationPass).length,
      fabricatedIdCount: scorecards.filter((s) => s.fabricatedIds.length > 0).length,
      medianWarmLatencyMs: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
      avgTokensPerSec: avg(warm.map((s) => s.tokensPerSec ?? NaN)),
      errors: scorecards.filter((s) => s.errored).length,
    };

    const dir = join(process.cwd(), "eval-results");
    mkdirSync(dir, { recursive: true });
    const outPath = join(dir, `${model.replace(/[:/\\]/g, "-")}.json`);
    writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2), "utf8");

    // eslint-disable-next-line no-console
    console.log("EVAL_SUMMARY " + JSON.stringify(summary));
    for (const r of rows) {
      const { answerPreview, ...card } = r;
      // eslint-disable-next-line no-console
      console.log("EVAL_ROW " + JSON.stringify(card) + " | " + answerPreview);
    }
    // eslint-disable-next-line no-console
    console.log("EVAL_WRITTEN " + outPath);

    expect(scorecards.length).toBeGreaterThan(0);
  });
});
