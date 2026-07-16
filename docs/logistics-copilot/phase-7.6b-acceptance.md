# Logistics Copilot — Phase 7.6B Acceptance

**Status: COMPLETE.** All three approved slices (Parts 2-15) delivered as one cohesive phase. The
Copilot combines deeper operational intelligence, conversational usability, and provider operations —
while remaining provider-neutral, strictly read-only, and fully compatible with OpenAI / Azure OpenAI
/ Ollama / other providers.

## Definition of Done

| DoD item | Status | Evidence |
|----------|:------:|----------|
| Portfolio risk from real bounded facts | ✓ | `risk.ts` reuses `assessRisk`; only signalled files surfaced; `hasUnknown` |
| Overdue invoices only for authorized users | ✓ | context reads finance only with `finance:read`; else Finance `unavailable` |
| Missing required documents ≠ review queues | ✓ | `readMissingRequiredDocs` (MISSING/EXPIRED/AWAITING) vs `readDocIntelJobs` |
| Document-Intelligence evidence safe & useful | ✓ | states/counts/OCR_REQUIRED/conflicts; never values/text |
| Customer-notification recommendations grounded | ✓ | derived from arrivals/customs; suggestion only; no contact values |
| Context budgeting deterministic & bounded | ✓ | `classifyQuestion` + `moduleCaps` + `capSerialized`; truncation disclosed |
| Conversational history session-only | ✓ | panel React state; no DB/localStorage; clear control; bounded |
| Evidence & deep links available | ✓ | expandable evidence panel; server-built links; model makes no URL |
| Visible responses exportable safely | ✓ | copy / plain-text download; audit type+count only |
| OpenAI testable via Preview through the provider | ✓ | runbook; existing env vars; kill switch; no Production activation |
| Deterministic fallback operational | ✓ | provider failure + rate-limit → deterministic cards+summary, HTTP 200 |
| No mutation path | ✓ | read-only module graph (asserted); provider text-only |
| Tenant + module permission boundaries proven | ✓ | route gate + per-domain gates; role-templates parity + DRIVER invariant |
| Tests / typecheck / build / RLS / CI | ✓ | see below |

## Reuse (no duplication)

Unchanged: `lib/ai/**`, `runCopilot`. **Additive** only: `runCopilotDetailed` (usage/latency, same
`generateAI` path). Reused readers: Command Center, `listDeclarations`, `getFinanceQueue`,
`assessRisk`, the `document_type` catalog, and the Document-Intelligence tables. No risk / invoice /
document-readiness calculation was re-implemented.

## Audit proof (metadata only)

`LOGISTICS_COPILOT_QUERY` records provider, model, modules available/unavailable, context counts,
truncated flag, recommendation kinds, duration, **token usage**, outcome (`answered` / `fallback` /
`rate_limited` / `export`). It never records the prompt, the answer, the conversation history,
evidence contents, customer names, financial values, document contents, or credentials.

## Verification

- **Typecheck** (`tsc --noEmit`, tests included): clean.
- **Tests**: `npx vitest run` → **126 files, 2109 passing**, incl.
  [`tests/logistics-copilot-depth.test.ts`](../../tests/logistics-copilot-depth.test.ts) (portfolio
  risk, invoices, documents, customer-notification, context budgeting, route rate-limit + detailed
  usage + safe audit + fallback, engine additive call, usage/export endpoints, panel session-only +
  export, context permission-degradation) and the updated 7.6A suite; plus the `role-templates`
  parity, DRIVER-invariant, and service-role tenant-scope guards.
- **Build**: `next build` → compiled; `/api/logistics/copilot`, `/api/logistics/copilot/export`,
  `/api/logistics/copilot/usage`, and the Command Center panel emitted. No AI provider code in the
  client bundle (panel POSTs only).
- **RLS / CI**: no new tables or RLS; the full RLS suite and both CI jobs stay green.

## Acceptance scenario (test/staging data only)

Sign in as an authorized operator → ask "what needs attention" → deterministic cards → inspect
evidence → open related records → follow-up (session history) → request delayed shipments → request
missing documents → request overdue invoices **with** finance permission (values shown) and **without**
(Finance marked unavailable, no values) → simulate provider timeout → deterministic fallback → export
the visible summary → confirm no operation was modified. All satisfied.

## Remaining work for Phase 7.7A

- Per-record risk enrichment (per-file SLA/lifecycle in the portfolio risk pass) to remove
  `hasUnknown` where data is available.
- A reliable per-file "already notified" join for customer-notification (portal cross-check).
- Optional admin usage dashboard UI (beyond the endpoint + panel strip) and a priced cost model once a
  provider pricing contract is configured.
- Optional Production enablement decision (env + rate-limit review), and Azure OpenAI provider
  validation through the same `lib/ai` interface.
