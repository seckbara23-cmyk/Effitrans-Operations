# Logistics Copilot — OpenAI Preview Runbook

**Phase 7.6B, Part 14.** How to exercise the Logistics Copilot against a **personal OpenAI account**
in local development and **Vercel Preview only** — through the existing provider-neutral `lib/ai`
layer, with **no direct provider calls** and **no Production activation by code**. Switching to Azure
OpenAI, Ollama, or vLLM later is pure configuration.

## Environment variables (existing — do not invent new AI config names)

All resolved by [`lib/ai/config.ts`](../../lib/ai/config.ts). Server-only; never exposed to the client.

| Variable | Purpose | Preview value (example) |
|----------|---------|-------------------------|
| `AI_PROVIDER` | provider selector (`openai` \| `ollama` \| `vllm`) | `openai` |
| `AI_MODEL` | model id | `gpt-4o-mini` |
| `AI_API_KEY` | server-only key (your personal OpenAI key **on Preview only**) | `sk-…` |
| `AI_BASE_URL` | override endpoint (optional) | *(unset → api.openai.com)* |
| `AI_COPILOT_ENABLED` | **global kill switch** — `false` disables all copilots | `true` |
| `AI_LOCAL_PROVIDER_ENABLED` | allow local providers (dark by default) | *(unset)* |
| `COPILOT_USER_RATE_PER_MIN` | per-user rate limit (default 12) | `12` |
| `COPILOT_TENANT_RATE_PER_DAY` | per-tenant daily cap (default 2000) | `500` |

Backward-compatible aliases still work: `OPENAI_API_KEY`, `OPENAI_COPILOT_MODEL`. Hosted-safety
validation (`validateAIConfig`) rejects unsafe hosted config (localhost on Vercel, plain HTTP,
no-auth private endpoints, off-allowlist hosts).

## Limits (from `AI_LIMITS`)

Prompt cap 24 000 chars · response cap 20 000 chars · default timeout 30 s (clamped ≤ 180 s) ·
default max output tokens 1 024 · temperature 0.2. The Copilot context is additionally budget-capped
to ~12 000 serialized chars (see [context-budgeting.md](./context-budgeting.md)).

## Setup — Vercel Preview (recommended)

1. Vercel → Project → Settings → Environment Variables → scope **Preview** (not Production):
   set `AI_PROVIDER=openai`, `AI_MODEL=gpt-4o-mini`, `AI_API_KEY=<your key>`, `AI_COPILOT_ENABLED=true`.
2. Deploy a Preview branch. Sign in as an authorized logistics operator.
3. Open the Command Center (`/departments/transport`) → the Copilot panel → ask a question.
4. Confirm `GET /api/logistics/copilot` reports `configured: true` and the expected provider/model
   (no secret is returned).

## Setup — local development

`.env.local`: `AI_PROVIDER=openai`, `AI_MODEL=gpt-4o-mini`, `AI_API_KEY=<your key>`. Or run a local
model: `AI_PROVIDER=ollama`, `AI_MODEL=qwen3:8b`, `AI_LOCAL_PROVIDER_ENABLED=true`.

## Kill switch & fallback

- **Kill switch:** set `AI_COPILOT_ENABLED=false` (or remove the key). The provider is not called; the
  route returns the **deterministic cards + summary** (the UI never fails).
- **Fallbacks (safe, deterministic):** timeout, rate-limit, quota, invalid response, and provider-
  unavailable all resolve to the deterministic summary + cards, with a safe French notice — never a
  raw provider error, never a UI crash.

## Production

**Do not** set OpenAI credentials on the Production environment as part of this phase. Production
activation is an explicit operational decision (its own environment-variable change + rate-limit
review), not a code change. With no credentials, Production runs the deterministic Copilot.

## Usage & cost

`GET /api/logistics/copilot/usage` (admin, `audit:read:all`) reports request counts, outcomes, average
duration, and **token totals where present** — never a prompt, an answer, or a fabricated cost. If a
priced contract is not configured, token usage is shown instead of a currency amount.
