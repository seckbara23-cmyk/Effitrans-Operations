# Phase 3.4F-1 — Provider-neutral AI for the Operations Copilot

**Status:** implemented. The Copilot's model backend is now provider-neutral
(OpenAI / Ollama / vLLM). **Backward compatible:** with `AI_PROVIDER` unset the
existing OpenAI configuration (`OPENAI_API_KEY` / `OPENAI_COPILOT_MODEL`) drives
an OpenAI backend exactly as in Phase 3.1A — no behaviour change. Decision:
**DEC-B27**. This phase does **not** train/fine-tune a model, add RAG/a vector
DB, enable AI actions, or weaken the read-only, permission-filtered Copilot.

## Existing Copilot architecture (unchanged)

- `lib/copilot/context.ts` — permission-filtered, read-only dossier snapshot
  (tenant isolation + per-section `*:read` gating inherited from the shared
  services; a section the caller can't read is `included:false`).
- `lib/copilot/prompt.ts` — pure serializer + `[system, user]` message builder;
  restates the read-only + "answer only from the brief" rules.
- `app/api/copilot/route.ts` — auth → `file:read` → build context → generate.

## Provider abstraction introduced

`lib/ai/*` — the Copilot calls the abstraction, never a concrete provider:

- `types.ts` — `AIProvider` interface (`generate` + `healthCheck`), `AIError`
  (+ `retriable`), the secret-free `AIErrorCode` set, generate/health/usage types.
- `config.ts` — **pure** env resolution (`resolveAIConfig`, backward compatible),
  flags (`aiCopilotEnabled`, `aiLocalProviderEnabled`), hosting (`isHostedProduction`
  = `VERCEL=1`), production-safety validation (`validateAIConfig`), `AI_LIMITS`,
  `baseUrlHost`, explicit `resolveFallbackConfig`.
- `openai-compatible.ts` — shared `/v1/chat/completions` transport + classifier
  (OpenAI **and** vLLM). Text-only body — **never** `tools`/`functions`.
- `openai-provider.ts`, `vllm-provider.ts`, `ollama-provider.ts` — the three
  providers. Ollama uses its **native** `POST /api/chat` (isolated mapping:
  `ollamaRequestBody` / `classifyOllama`; `GET /api/tags` health).
- `provider.ts` — `getAIProvider` (select + flag gate + safety), `generateAI`
  (prompt cap → one bounded retry → **explicit** fallback → response truncation).
- `health.ts` — secret-free admin status snapshot.
- `log.ts` — one secret-free diagnostic line per attempt (`ai.request`): provider,
  model, host, credential-present bool, HTTP status, outcome, code. **Never** the
  key/Authorization header, the prompt, or dossier content.
- `lib/copilot/engine.ts` — maps `AIError` → the stable `CopilotError` contract
  (codes + HTTP status + French messages) the route already returns.

## Configuration contract

| Var | Meaning | Default |
|---|---|---|
| `AI_PROVIDER` | `openai` \| `ollama` \| `vllm` | `openai` |
| `AI_MODEL` | model name (supplied, never hard-coded) | `gpt-4o-mini` (openai); `qwen3:8b` (ollama, via `OLLAMA_MODEL`→`AI_MODEL`→default); **required** for vllm |
| `AI_BASE_URL` | provider API base | openai: `https://api.openai.com/v1`; ollama: `http://127.0.0.1:11434` (via `OLLAMA_BASE_URL`→`AI_BASE_URL`→default); vllm: **required** |

> **Follow-up (Ollama focus):** the `ollama` provider also accepts provider-specific
> `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_REQUEST_TIMEOUT_MS` (layered above the
> generic `AI_*`), defaults to `qwen3:8b` on `127.0.0.1:11434` with a 120 s timeout,
> and its health check distinguishes reachable / model-present / model-missing. See
> [SETUP.md §7](SETUP.md).
| `AI_API_KEY` | key / bearer token | falls back to `OPENAI_API_KEY` for openai |
| `AI_COPILOT_ENABLED` | master switch | unset ⇒ enabled (prod unchanged); `false` disables |
| `AI_LOCAL_PROVIDER_ENABLED` | enable ollama/vllm | `false` (**dark by default**) |
| `AI_FALLBACK_PROVIDER/MODEL/BASE_URL/API_KEY` | explicit fallback | none (no silent paid fallback) |
| `AI_BASE_URL_ALLOWLIST` / `AI_ALLOW_INSECURE_HTTP` / `AI_ALLOW_NO_AUTH` | prod safety (hosted only) | off |

## Ollama behaviour (local Qwen pilot)

Native `POST /api/chat` (`stream:false`, `options.temperature` / `num_predict`),
text-only. A refused connection → `provider_unavailable` (precise admin signal).
Health = `GET /api/tags`. Dark until `AI_LOCAL_PROVIDER_ENABLED=true`.

## vLLM behaviour (private production Qwen/Llama)

OpenAI-compatible `POST {base}/chat/completions` (same transport as OpenAI). A
bearer token is sent when `AI_API_KEY` is set; production requires the remote
endpoint be HTTPS + authenticated (enforced by config validation).

## Security controls

Read-only preserved (no tools, no function-calling, no DB writes, no task/email,
no autonomous actions — the body carries only system+user text). Added: request
timeout (30 s, cap 60 s) + one bounded retry; max prompt (`24 000` chars) and max
response (`20 000` chars, truncated); bearer auth for private endpoints; **hosted
(Vercel) production rejects** localhost base URLs, plain-HTTP remote endpoints,
unauthenticated remote private endpoints, and off-allowlist hosts (each with an
explicit approval override for internal-network deployments); safe error
classification; **secret-free logs** (no key/Authorization/prompt/dossier content).
Keys never reach the browser (`server-only`, never `NEXT_PUBLIC_`).

## Model policy

No speculative Qwen/Llama version is hard-coded — `AI_MODEL` supplies it. Recommended
categories (confirm each via the evaluation harness before use):

- **Small** (testing / low-resource): a small Qwen instruct model.
- **Mid** (pilot): a mid-size Qwen instruct model.
- **Large** (production reasoning): a larger Qwen/Llama instruct model on GPU.

Do not claim a model is suitable until it passes Effitrans evaluation.

## Evaluation harness

`lib/ai/eval/*` — deterministic cases over **sanitized** fixtures (no production
client data): summarize, missing docs, next step, risk explanation, client-update
draft, handoff note, insufficient info, hidden finance, hidden customs, prompt
injection, prohibited action. Pure evaluators score groundedness, hidden-section
leaks, French quality, instruction following, output length, and prohibited-action
claims; `runEvaluation` drives an injected generate fn (a real provider in a pilot,
a stub in tests) so providers can be compared reproducibly.

## Admin health visibility

`GET /api/ai/health` (admin-only, `admin:config:manage`) — secret-free: configured
provider/model, base URL **host only**, credential-present bool, flags, and a live
health probe run in the current request. Never returns secrets. `GET /api/copilot`
still returns `{ configured, provider, model, apiKeyPresent }`.

## Ollama local pilot

1. Install Ollama on an approved machine.
2. `ollama pull <approved-qwen-model>`.
3. `ollama serve` (default `http://127.0.0.1:11434`).
4. Confirm the endpoint (`GET /api/tags`).
5. Configure locally: `AI_PROVIDER=ollama`, `OLLAMA_MODEL=qwen3:8b`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `AI_LOCAL_PROVIDER_ENABLED=true`.
6. Run the evaluation harness against it.
7. **Never** expose the Ollama port to the public internet.
8. Any remote use goes behind a reverse proxy with auth, TLS and firewall rules.

**Vercel cannot reach an office `localhost`** — a hosted deployment pointed at
`localhost` is rejected (`unsafe_config`). Local providers are for a machine that
runs the app locally, or a private HTTPS endpoint (vLLM) reachable from Vercel.

## vLLM production topology

`Vercel app → HTTPS private AI endpoint → authenticated reverse proxy → vLLM →
Qwen/Llama → GPU server`. Requirements: TLS, auth (bearer via `AI_API_KEY` +
`AI_BASE_URL_ALLOWLIST`), IP/rate controls, health checks, secret-free logging,
GPU monitoring, restart policy, model warm-up, documented capacity assumptions,
and a backup-provider strategy (explicit `AI_FALLBACK_*` only).

## Feature flags & rollout

`AI_COPILOT_ENABLED` (unset ⇒ enabled, backward compatible), `AI_LOCAL_PROVIDER_ENABLED=false`
(dark). Existing non-AI dossier functionality is unaffected when AI is disabled.
Rollout: keep OpenAI in prod → pilot Ollama+Qwen locally via the harness → stand up
a private vLLM endpoint → point `AI_PROVIDER=vllm` with allowlist+auth after eval.

## Validation

`npm run typecheck` ✅ · `npm test` ✅ · `npm run build` ✅. Existing Copilot tests
carried forward as `tests/copilot-engine.test.ts` (OpenAI backward-compat behaviour).
Live provider smoke tests (OpenAI backward-compat, Ollama local) are run where a key
/ a local Ollama is available.
