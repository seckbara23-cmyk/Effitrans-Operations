# Logistics Copilot — Phase 7.6A Acceptance

**Foundation delivered:** the full DoD — a read-only, grounded, provider-neutral, audited operational
assistant built as a **sibling** of the Platform Copilot, with **no duplication of the AI framework**.

## Definition of Done

Operational users can:

| DoD item | Status | Evidence |
|----------|:------:|----------|
| Ask logistics questions | ✓ | `/api/logistics/copilot` POST → `runCopilot` (shared engine) |
| Receive grounded recommendations | ✓ | deterministic cards (`lib/logistics/copilot/cards.ts`) — no hallucinated facts |
| See evidence | ✓ | each card cites real records (declaration / invoice / file numbers) with links |
| Understand confidence | ✓ | deterministic HIGH/MEDIUM/LOW per card |
| Navigate to related modules | ✓ | evidence links + module filters in the panel |
| Without modifying operational data | ✓ | read-only at 3 layers; no mutation import (asserted) |
| Everything provider-neutral | ✓ | reuses `lib/ai` via `runCopilot`; never imports a provider |
| Everything audited | ✓ | `LOGISTICS_COPILOT_QUERY`, safe metadata only |
| Everything CI green | ✓ | see below |

## Reuse (no framework duplication)

Reused unchanged: the provider abstraction (`lib/ai`), the engine (`runCopilot`, `CopilotError`,
`getCopilotConfig`), the provider-UX helpers, the AI settings/health page, and the audit log. **New
files only:** `lib/logistics/copilot/{types,context,cards,prompt}.ts`, `app/api/logistics/copilot/
route.ts`, `components/logistics/copilot-panel.tsx`, one audit action, and the permission (migration +
seed + role-templates). Mounted on the Command Center (`/departments/transport`) — the sidebar is a
frozen contract, so no nav item was added.

## Capabilities & cards

Answers the brief’s questions (attention / blocked customs / arrivals this week / delayed flights /
customers to notify / missing documents / overdue invoices / high-risk shipments) and renders the
nine operational cards: Blocked Customs, Delayed Vessel, Late Flight, Missing/Review Document,
Upcoming ETA, Customer Notification Suggested, Overdue Invoice, Risk Shipment, Compliance Warning
(see [recommendation-model.md](./recommendation-model.md)).

## Guardrails, performance, fallback

Read-only / never-invent / never-guess-IDs / never-fabricate-ETAs / never-assume-locations /
Missing ≠ Negative (see [guardrails.md](./guardrails.md)). Context is bounded (page-0, ≤100/domain,
never a full-tenant scan) and permission-degraded. Provider down → deterministic summary, UI never
fails.

## Verification

- **Typecheck** (`tsc --noEmit`, tests included): clean.
- **Tests**: `npx vitest run` → **125 files, 2086 passing**, incl.
  [`tests/logistics-copilot.test.ts`](../../tests/logistics-copilot.test.ts) (card correctness,
  evidence citation, confidence, Missing ≠ Negative, prompt guardrails, route gate + safe audit +
  fallback, read-only module graph, permission wired across all four surfaces) and the
  `role-templates` parity + DRIVER-invariant tests.
- **Build**: `next build` → compiled; `/api/logistics/copilot` route emitted.
- **CI**: permission migration replays cleanly before seed; the `rls-tests` job (migrations + seed)
  and `build` job stay green.

## Remaining work for Phase 7.6B

- Bounded portfolio **risk reader** (`assessRisk` per file over a capped working set) for a true
  “high-risk shipments” card, and a bounded **overdue-invoice** reader.
- Portfolio **missing-required-documents** reader (today’s Missing-Document card is the OCR review
  queue, not missing-required per dossier).
- A **doc-intel evidence list** (identifiers) rather than counts.
- Richer conversational UX (session history in the panel, per-record drill-downs, export), and
  widening the permission to additional operational roles if desired.
