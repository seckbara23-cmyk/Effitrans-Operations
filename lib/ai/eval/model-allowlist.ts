/**
 * Evaluation model allowlist (Phase 3.4F-2) — PURE, testable.
 * ---------------------------------------------------------------------------
 * The local eval runner accepts a model ONLY from this fixed allowlist (chosen
 * via EVAL_MODEL). No arbitrary model name from user input reaches Ollama.
 */
export const ALLOWED_EVAL_MODELS = ["qwen3:4b", "qwen3:8b", "qwen2.5:3b", "llama3.2:3b"] as const;
export type AllowedEvalModel = (typeof ALLOWED_EVAL_MODELS)[number];

export function isAllowedEvalModel(m: string): m is AllowedEvalModel {
  return (ALLOWED_EVAL_MODELS as readonly string[]).includes(m);
}

/** Validate + normalise a requested model; throws (fail closed) on empty/unknown. */
export function assertAllowedEvalModel(raw: string | undefined): AllowedEvalModel {
  const model = (raw ?? "").trim();
  if (!model) throw new Error("EVAL_MODEL is required (e.g. EVAL_MODEL=qwen3:4b npm run ai:eval:local)");
  if (!isAllowedEvalModel(model)) {
    throw new Error(`Model "${model}" is not in the allowlist: ${ALLOWED_EVAL_MODELS.join(", ")}`);
  }
  return model;
}
