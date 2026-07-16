# Logistics AI Copilot — Architecture Decision (Phase 7.6A)

## Principle

The Logistics Copilot is an **operational assistant**, not a chatbot: it **reads, analyzes, and
recommends** over the existing logistics domains; **humans stay authoritative**. It never writes.

## Finding: the AI framework already exists — reuse it, never duplicate

An audit of the AI provider abstraction, copilot engine, context builders, prompt system, audit,
permissions, and the two shipped copilots (tenant dossier Operations Copilot + **Platform Copilot,
Phase 6.0F**) shows a mature **three-layer stack**:

- **Layer 1 — provider abstraction** (`lib/ai/**`): provider-neutral (`openai`/`ollama`/`vllm`), no
  vendor SDK (raw `fetch`, no tools/function-calling), `generateAI(input, env)` with config, health,
  hosted-safety validation, bounded retry, and **explicit-only** fallback. **No copilot ever imports a
  provider.**
- **Layer 2 — engine** (`lib/copilot/engine.ts`): `runCopilot(messages: CopilotChatMessage[]) →
  Promise<string>` — the single read-only generate call both copilots reuse; typed `CopilotError`.
- **Layer 3 — instances**: each copilot = its own context builder + prompt + route + UI over the
  shared engine. The **Platform Copilot (6.0F)** is the template: allowlisted aggregates,
  `platform:copilot:read` gate, safe-metadata audit, `runCopilot`, a right-side panel.

**Decision:** build the Logistics Copilot as a **sibling** of the Platform Copilot — new files only,
**no edits to `lib/ai/**` or `lib/copilot/engine.ts`**. Reuse `runCopilot`, the risk engine
(`assessRisk`), the transparency/confidence vocabulary, and the existing bounded domain readers.

## Recommendation model: deterministic cards + LLM narrative

Per the brief ("**No hallucinated facts**", "Return a deterministic operational summary" on provider
failure), structure is computed **deterministically outside the model** (the established pattern —
`transparency.ts`/`risk-engine.ts` already do this):

- A **pure recommendation engine** builds the brief's **operational cards** from the bounded context —
  Blocked Customs · Delayed Vessel · Late Flight · Missing/Review Document · Upcoming ETA · Customer
  Notification Suggested · Overdue Invoice · Risk Shipment · Compliance Warning. Each card carries
  **Finding · Evidence (records with real identifiers) · Confidence · Reasoning · Suggested Action ·
  Source Modules · Timestamp**. These are grounded in actual rows — no model, no fabrication.
- The **LLM (`runCopilot`)** answers conversational questions **grounded in the same serialized
  context**, under hard guardrails. If the provider is unavailable, the route returns the
  **deterministic cards + summary** — the UI never fails.

## Context model — bounded, read-only, allowlisted, permission-degraded

Two layers, page-0 only, **never scan the whole tenant**:

- **Layer A — overview:** `getCommandCenter()` (`lib/logistics/reader.ts`) — cross-modal `headline`
  KPIs, a pre-ranked/deduped `attention` queue (≤12, with file number + client + deep link),
  `upcoming` (≤10), `journey` (≤8), road overdue rows, doc-intel counts. Already bounded, tenant-
  scoped, and **degrades per section** on a missing permission (`Promise.allSettled`).
- **Layer B — evidence (filtered, ≤100, page 0):** `listDeclarations({status: blocked})` (customs
  citations), `listOceanShipments`/`listAirShipments` (delayed vessels/flights with BL/MAWB),
  `getFinanceQueue().filter(overdue)` (invoice citations — **capped** for copilot use), doc-intel
  review counts, and a bounded portfolio-risk pass reusing `assessRisk`.

Every read is `*:read`-gated and tenant-scoped; **Missing ≠ Negative** — an unauthorized/unavailable
section produces **no** false "all clear", only a note that the data was not available.

## Permission — `logistics:copilot:read` (new)

Tenant-side permission (mirrors how `process:read` is granted), added via **migration + `seed.sql` +
`lib/platform/role-templates.ts`** (the parity test `tests/role-templates.test.ts` requires all three
to match). Granted to the **internal operational-staff** role set; **never** to `CLIENT_USER`
(customer portal), `PARTNER_AGENT`, or `DRIVER` (whose permission set is asserted exact in CI).
Platform admins keep the separate Platform Copilot (`platform:copilot:read`); the customer portal
gets **none**.

## Strict boundaries (enforced structurally)

The Copilot never creates shipments, changes statuses, edits declarations, submits customs, sends
emails, approves documents, deletes anything, or writes to operational tables. It imports **only read
services** — no `actions.ts` / `manage-actions.ts` / `notifyCustomer` / mutation path is in its module
graph (asserted by test). The provider layer sends no tools, so there is no mutation surface at all.

## Explainability & guardrails

Every card cites its **source module(s)** and the **records analyzed** (by reference); confidence is
deterministic (HIGH from a concrete identified record, MEDIUM from an aggregate, LOW when partial).
The LLM system prompt (copied from the Platform Copilot guardrails, "NON MODIFIABLES") enforces:
read-only, answer only from the brief, never invent, never guess IDs, never fabricate ETAs, never
assume locations, never summarize unavailable data as success, **Missing ≠ Negative**, conversational
follow-up with **session-only** context (no long-term memory).

## Audit

Add `LOGISTICS_COPILOT_QUERY: "logistics.copilot.query"`; record **safe metadata only** — actor,
tenant, provider, model, modules consulted, recommendation count, duration, outcome. **Never** the
prompt body, the answer, or any secret (mirrors `PLATFORM_COPILOT_QUERY`).

## Performance & fallback

Bounded context (≤100 per domain, page 0, caps disclosed); server components; lazy panel. If the
provider is unavailable → deterministic cards + summary, never a UI failure.

## New files (sibling — no framework duplication)

`lib/logistics/copilot/{types,context,cards,prompt}.ts` · `app/api/logistics/copilot/route.ts` ·
`components/logistics/copilot-panel.tsx` · one audit action · the permission (migration + seed +
role-templates). Mounted on the Command Center (`/departments/transport`) — the sidebar is a frozen
contract, so no nav item is added.

## 7.6A scope vs 7.6B

- **7.6A (foundation):** permission + audit; bounded read-only context; the deterministic
  recommendation-card engine (all 9 kinds) with evidence/confidence/sources; the `runCopilot`-backed
  conversational answer with guardrails + deterministic fallback; the embedded right-side panel
  (suggested prompts, cards, evidence, module filters); tests + 5 docs.
- **7.6B (defer):** richer per-record drill-downs, additional bounded evidence readers (portfolio
  missing-documents, doc-intel evidence list), export, saved views, and any conversational history
  persistence beyond the session.

Exact 7.6A scope confirmed with the product owner before implementation.
