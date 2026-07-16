# Logistics Copilot — Guardrails

**Phase 7.6A.** The Copilot reads, analyzes, and recommends; it never acts. Guardrails are enforced
at three independent layers so a single failure cannot breach them.

## Layer 1 — provider (no action surface exists)

The shared AI abstraction (`lib/ai`) sends **text only** — no tools, no function-calling, no DB
access, no SQL. `runCopilot` passes a system+user prompt in and returns plain text out. There is
**no mechanism** by which the model could mutate anything, regardless of prompt.

## Layer 2 — system prompt (non-overridable)

`buildLogisticsSystemPrompt()` hard-codes, and states as **NON MODIFIABLES**:

- **Read-only** — never creates a shipment, changes a status, edits/submits a declaration, approves
  a document, sends an email, chases a payment, or runs SQL/tools. If an action is useful it is
  prefixed “Action suggérée :” and points to the page where a human can act.
- **Never invent** — answer only from the provided brief.
- **Never guess an identifier** — dossier / BL / AWB / container / declaration / invoice references
  are quoted only if present in the context.
- **Never fabricate an ETA, date, or position** — never assert where a shipment is if not provided.
- **Missing ≠ Negative** — a module not consulted (unauthorized or unavailable) is reported as “not
  included in this snapshot”, never as “nothing to report”.
- **Never present unavailable data as success** — “nothing found in the consulted modules” is
  distinguished from “module not consulted”.
- **Always cite** the source module(s) and the records analyzed (by reference).

## Layer 3 — deterministic grounding (no hallucinated facts)

The operational **cards** are computed deterministically from real rows
([recommendation-model.md](./recommendation-model.md)) — the model narrates, it does not invent the
facts. When the provider is unavailable, the route returns the **deterministic summary** as the
answer, so the UI still shows grounded findings. The context is **bounded** (page-0, ≤100 per
domain; the tenant is never fully scanned) and **permission-degraded** (an unreadable domain is
recorded in `unavailable`, never silently treated as empty).

## What the Copilot never does

Creates shipments · changes statuses · edits declarations · submits customs · sends emails ·
approves documents · deletes anything · writes to operational tables. Its module graph imports only
read services (asserted by test `read-only guarantee — no mutation in the copilot module graph`).
The only write it performs is a **safe audit** metadata row (see [security.md](./security.md)).

## Conversation

Conversational follow-up is allowed within a **session only** — there is no long-term memory and no
persisted conversation. Each request rebuilds the bounded context fresh.
