# Phase 7.4A — Acceptance Report

**OCR & AI Document Intelligence Foundation.** Status: **COMPLETE**.

## Core principle honoured

> AI and OCR output are **suggestions**, not authoritative operational facts.

No Document → AI → automatic operational write path exists. The only write path
(`applyFields`) requires an explicit human approval per field and routes through existing
domain services that re-check `transport:update`.

## Definition of Done

| DoD item | Status | Evidence |
|----------|:------:|----------|
| Classify documents (closed 8-class vocab; declared authoritative) | ✓ | `lib/docintel/classify.ts`, `types.ts` |
| Extract source text (operator-provided) + structured candidate fields | ✓ | `provider.ts` (`ManualTextProvider`), `extract.ts` |
| Deterministic validation (reused validators; AI never replaces it) | ✓ | `validate.ts` |
| Field-level confidence | ✓ | `confidence.ts` (deterministic never `HIGH`) |
| Conflicts identified (vs operational + cross-document) | ✓ | `reconcile.ts` |
| Human review presentation | ✓ | `components/docintel/review-studio.tsx`, review route |
| Apply **only** explicitly approved values, via existing services | ✓ | `actions.ts` `applyFields` → `updateBookingBl`/`updateAwb` |
| Provenance preserved | ✓ | `document_candidate_field` columns + audit |
| Safe audit (no text/values/PII/credentials/raw responses) | ✓ | `lib/audit/events.ts`, test `audit carries no values/text` |
| No fabricated provider/endpoint/env/retention claim | ✓ | stubs `not_configured` + readiness checklists |
| Tenant isolation CI-proven | ✓ | `rls_document_intelligence_test.sql` in `rls-tests` job |
| Tests, typecheck, build, RLS, CI pass | ✓ | see below |

## Scope controls respected

No uncontrolled auto-writes · no customer-facing AI · no chatbot · no live external OCR without
approved contracts · no second document store · no carrier/airline APIs · document content
treated as untrusted data.

## Verification

- **Typecheck** (`tsc --noEmit`, test files included): clean.
- **Unit/structural tests**: `npx vitest run` → **122 files, 2044 tests, all passing**, including
  `tests/document-intelligence.test.ts` (24 tests) covering vocabularies, lifecycle,
  classification, schema allowlist, validators, strict extraction, prompt-injection-as-data,
  cross-document reconciliation, honest provider stubs, confidence/batch-approvability,
  dashboard, and structural guards (apply-via-domain-services, no free-form operational write,
  CAS + stale guard, server-only services, client ships no service role, migration adds no
  permission, no vendor SDK).
- **Build**: `next build` → compiled successfully;
  `/files/[id]/documents/[docId]/intelligence` route emitted.
- **RLS**: `supabase/tests/rls_document_intelligence_test.sql` proves bidirectional tenant
  isolation, no-permission blindness, and write rejection (SELECT-only) — wired into CI.

## What 7.4A deliberately does **not** do

- No PDF text extraction (no parsing library) — operator provides text (`manual` provider).
- No OCR and no LLM extraction — both are honest `not_configured` stubs with readiness
  checklists; nothing is fabricated.
- No background queue/worker — the pipeline is synchronous and operator-triggered.
- Batch approval is effectively unavailable until a validated high-confidence provider exists
  (deterministic extraction never emits `HIGH`).

## Follow-on (7.4B preview)

Approve a real text/structured provider **only** after completing the recorded readiness
checklist against a signed contract + DPA; implement it behind the existing provider interfaces
with no application changes; keep deterministic validation authoritative and the human
review-and-apply gate unchanged.

## Companion documents

- [phase-7.4a-architecture.md](./phase-7.4a-architecture.md)
- [document-schemas.md](./document-schemas.md)
- [provider-readiness.md](./provider-readiness.md)
- [human-review-model.md](./human-review-model.md)
- [security-and-privacy.md](./security-and-privacy.md)
