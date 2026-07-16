# Phase 7.4B — Acceptance Report

**Local searchable-PDF text extraction.** Status: **COMPLETE**. Extends 7.4A without weakening
any of its guarantees: extracted values remain suggestions, applied only after explicit human
review through the existing domain services.

## Required outcomes

| Outcome | Status | Evidence |
|---------|:------:|----------|
| Server-only searchable-PDF parser adapter | ✓ | [`lib/docintel/pdf/parser.ts`](../../lib/docintel/pdf/parser.ts) (`import "server-only"`, dynamic inner import of `pdf-parse`) |
| File-size, page-count, text-length, timeout limits | ✓ | `PDF_LIMITS` in [`lib/docintel/pdf/assess.ts`](../../lib/docintel/pdf/assess.ts) + timeout race in the parser |
| Searchable vs scanned detection | ✓ | `assessExtractedPdf` → `OCR_REQUIRED` below `MIN_TEXT_CHARS_SEARCHABLE` |
| Page-level extracted text + provenance | ✓ | per-page capture; `\f`-delimited `extracted_text`; `page` per candidate; `page_count` |
| Deterministic FR/EN classification | ✓ | [`lib/docintel/classify-text.ts`](../../lib/docintel/classify-text.ts) (keyword-based, ≤ MEDIUM, `UNKNOWN` never guessed) |
| BL / booking / MAWB / HAWB extraction | ✓ | schema apply-targets unchanged; page-aware `deterministicExtractPages` |
| Bounded evidence excerpts | ✓ | `boundEvidence` (≤ 200 chars) |
| Completed Human Review Studio | ✓ | [`components/docintel/review-studio.tsx`](../../components/docintel/review-studio.tsx) (PDF-extract button, conflict banner, `OCR_REQUIRED` message) |
| Review queue | ✓ | `getReviewQueueSummary` (7.4A) |
| Logistics Command Center indicators | ✓ | `docIntel` indicator on `/departments/transport` (7.4A) |
| Partial-safe application | ✓ | `applyFields` per-field results (7.4A) |
| Safe audit | ✓ | `DOCUMENT_CLASSIFIED` / `DOCUMENT_EXTRACTION_COMPLETED` — metadata only (class, confidence, language, counts) |
| Real-Postgres tenant-isolation proof | ✓ | [`supabase/tests/rls_document_intelligence_test.sql`](../../supabase/tests/rls_document_intelligence_test.sql) (bidirectional isolation + write rejection + `OCR_REQUIRED` acceptance) |

## Boundaries respected

No OCR · no LLM · no external send (bytes never leave the server) · no auto-apply · no generic
DB updates · the four writable fields are unchanged and still routed through
`updateBookingBl`/`updateAwb` · no scanned-PDF support claimed (scanned ⇒ `OCR_REQUIRED`).

## Changes

- **Dependency**: `pdf-parse` (pure-Node; bundles its own pdf.js; no native `canvas`). Kept
  external via `next.config.mjs` `serverComponentsExternalPackages`.
- **Migration** [`20260716000008`](../../supabase/migrations/20260716000008_document_intelligence_pdf.sql):
  additive — widens `failure_category` to admit `OCR_REQUIRED`. No table, column, RLS policy, or
  permission added.
- **New**: `pdf/assess.ts` (pure), `pdf/parser.ts` (server-only), `classify-text.ts` (pure),
  `deterministicExtractPages` (page provenance), `extractSearchablePdf` action,
  `downloadObject` storage helper.

## Verification

- **Typecheck** (`tsc --noEmit`, tests included): clean.
- **Tests**: `npx vitest run` → **123 files, 2062 passing**, incl.
  [`tests/document-intelligence-pdf.test.ts`](../../tests/document-intelligence-pdf.test.ts)
  (18 tests: assessment limits + scanned detection + truncation, FR/EN classification &
  language, page provenance, provider readiness, and structural guards for the server-only local
  parser + the action's routing/checksum/OCR_REQUIRED path).
- **Build**: `next build` → compiled successfully; `pdf-parse` stays server-external (absent from
  the client bundle).
- **RLS**: the isolation test additionally proves `failure_category = OCR_REQUIRED` is accepted,
  confirming the migration is applied in CI.

## Companion documents

- [searchable-pdf.md](./searchable-pdf.md) — the capability in full
- [provider-readiness.md](./provider-readiness.md) — updated inventory
- [phase-7.4a-acceptance.md](./phase-7.4a-acceptance.md) — the foundation this builds on
