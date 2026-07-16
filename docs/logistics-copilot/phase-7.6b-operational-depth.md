# Logistics Copilot — Phase 7.6B: Operational Depth & Conversational UX

Extends the 7.6A Copilot with deeper deterministic operational intelligence, session-only
conversational UX, and a provider-operations layer — **preserving** the provider-neutral
architecture (`runCopilot` → `lib/ai`) and the strictly read-only contract. No mutation path, no
autonomous action, no tool execution. Every recommendation stays deterministic and evidence-first.

## Architecture (reuse, never duplicate)

- **AI stack unchanged.** `lib/ai/**` and `runCopilot` are untouched. Token/latency visibility comes
  from an **additive** sibling in the shared engine — `runCopilotDetailed` — which reuses the same
  `generateAI` path and the same `CopilotError` mapping and returns `{ text, provider, model,
  latencyMs, usage }`. Still text-only, no tools, provider-neutral (OpenAI / Azure OpenAI / Ollama /
  vLLM all work by configuration).
- **Readers reused.** The Command Center, customs `listDeclarations`, `getFinanceQueue`, the
  `assessRisk` risk engine, the `document_type` requirements catalog, and the Document-Intelligence
  tables — composed, never re-implemented.

## Part 2-3 — Portfolio risk (`lib/logistics/copilot/risk.ts`, pure)

A **projection** over the already-gathered bounded signals (customs block, delay alert, overdue
invoice, missing required doc), **not** a new authoritative state. For each file appearing in a
signal it assembles a `RiskInput` and reuses `assessRisk`; files without a concrete signal are **not**
surfaced (missing ≠ low risk). Each row is flagged `hasUnknown` because per-file SLA/lifecycle are not
evaluated at portfolio scope — the score is a documented floor, not an exhaustive assessment. The
**RISK_SHIPMENT** card stands alone without the LLM.

## Part 4 — Overdue invoices (finance-gated)

The context reads `getFinanceQueue().filter(overdue)` **only** when the caller holds `finance:read`,
enriching each with `daysOverdue` (via `overdueDays`) and payment state. Without finance visibility,
Finance is marked `unavailable` and **no** invoice value, count, or card is produced (Missing ≠ "no
overdue invoices").

## Part 5-6 — Required documents vs OCR review (`readers.ts`)

`readMissingRequiredDocs` distinguishes **required-and-MISSING**, **required-and-EXPIRED**, and
uploaded-but-**AWAITING_REVIEW** from the `document_type.required_for` catalog + file documents
(batched, no N+1). `readDocIntelJobs` adds a **safe** Document-Intelligence projection — job state,
`OCR_REQUIRED`, failure category, unresolved-conflict count, candidate count — and **never** selects
extracted values, text, evidence excerpts, or parser errors. The **MISSING_DOCUMENT** card's finding
explicitly separates required-doc issues from the OCR review queue.

## Part 7 — Customer notification (grounded, recommendation-only)

`notifyOpportunities` are derived from real events (imminent arrival, customs hold/release). The card
is a **suggestion** — no communication is sent, and **no customer email/phone** is ever placed in the
context or shown to the model. The operator is directed to verify the portal and act manually.

## Part 8 — Context budgeting (`budget.ts`, pure)

An allowlisted keyword classifier (`classifyQuestion`) picks a question class; `moduleCaps` allocates
a per-module record cap that gives prioritized modules the full cap and trims others — but **never**
empties a requested module (minor cap > 0). The serialized brief is capped (`capSerialized`) and
truncation is **disclosed** in the context, the prompt, and the panel. **The LLM never chooses what
runs** — classification is deterministic and server-side.

## Parts 9-13 — Conversational & UX layer (panel)

Session-only conversation history (React state; lost on refresh; **no** DB, localStorage, or
sessionStorage; bounded turns/chars; "Nouvelle conversation" clears it). Auth-aware suggested prompts
(finance prompt hidden without `finance:read`). An expandable per-card **evidence panel** (safe
fields only — see [evidence-and-links.md](./evidence-and-links.md)). Server-built drill-down links.
Controlled **export** (copy / plain-text download of the visible, authorized result; a safe filename;
audited by type + count only).

## Parts 14-15 — Provider operations & usage visibility

- **Preview test mode** through the existing `lib/ai` provider — see
  [openai-preview-runbook.md](./openai-preview-runbook.md). Kill switch, model/context/timeout limits,
  and safe fallbacks are inherited from the AI layer; no OpenAI activation in Production by code.
- **Rate limiting** (`usage.ts`) over the existing `audit_log` (no new table): per-user (1 min) and
  per-tenant (24 h), env-configurable, with a deterministic fallback on limit.
- **Usage visibility** (`GET /api/logistics/copilot/usage`, admin-gated `audit:read:all`): request
  count, outcomes (answered / fallback / failed / export), average duration, and **token totals where
  present** — never a prompt, an answer, or a fabricated cost.

## Route flow (`/api/logistics/copilot`)

gate `logistics:copilot:read` → rate-limit (→ deterministic fallback) → build budgeted context →
deterministic cards → `runCopilotDetailed` (grounded + bounded history) → **safe audit** (provider,
model, modules available/unavailable, counts, truncated, recommendation kinds, duration, **tokens**,
outcome) → JSON. Any provider failure or rate-limit returns the deterministic summary + cards (the UI
never fails).

## Guardrails, permissions, audit — see companion docs

Guardrails ([guardrails.md](./guardrails.md)) extended: document content is data not instructions;
never infer live position from stale data; never expose unauthorized fields; no chain-of-thought.
Permission model unchanged (`logistics:copilot:read` + per-domain gates; no new grants). Audit is
metadata-only. Full acceptance in [phase-7.6b-acceptance.md](./phase-7.6b-acceptance.md).
