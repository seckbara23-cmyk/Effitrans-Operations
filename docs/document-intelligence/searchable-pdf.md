# Document Intelligence — Local Searchable-PDF Extraction

**Phase 7.4B.** Turns the `local_pdf_text` provider from a stub into a real, **entirely local**
extractor for PDFs that already contain a searchable text layer. Nothing about the 7.4A safety
model changes: extracted values remain **suggestions**, applied only after explicit human review
through the existing domain services.

## What it does (and only this)

```
Existing PDF (in the private documents bucket)
 → validate MIME = application/pdf, document version, size
 → download bytes server-side, compute SHA-256 checksum
 → extract the EMBEDDED text layer locally (pdf-parse), page by page
 → preserve page boundaries (\f-delimited stored text; page number per field)
 → deterministic FR/EN classification (a suggestion; declared class stays authoritative)
 → deterministic candidate-field extraction (BL / booking / MAWB / HAWB + review-only fields)
 → validate + reconcile + bounded evidence
 → human review  →  apply ONLY explicitly approved fields
```

The four — and only four — fields that can update an operational record remain `bl_number`,
`booking_reference`, `mawb`, `hawb`, and they continue to flow through `updateBookingBl()` /
`updateAwb()` (which re-check `transport:update`). No new writable field, no free-form table
write, no auto-apply.

## Hard boundaries (unchanged from the brief)

The platform does **not**, in 7.4B: add OCR · call an LLM · send documents externally ·
auto-apply extracted values · create generic database updates · expand the four writable fields ·
claim scanned-PDF support. The document bytes never leave the server; the parser
([`lib/docintel/pdf/parser.ts`](../../lib/docintel/pdf/parser.ts)) is `server-only`, makes no
network call, and uses a pure-Node library (`pdf-parse`, kept external to the bundle).

## Scanned / image-only PDFs → `OCR_REQUIRED`

A scanned or image-only PDF has no text layer to extract. Rather than fabricate text or silently
succeed, the job terminates as `FAILED` with `failure_category = OCR_REQUIRED`
(migration [`20260716000008`](../../supabase/migrations/20260716000008_document_intelligence_pdf.sql)).
The review studio surfaces this honestly and points the operator to manual text entry. We never
claim to have read a scanned page.

The decision is made in the **pure** assessor
([`lib/docintel/pdf/assess.ts`](../../lib/docintel/pdf/assess.ts)): if the total non-whitespace
character count across all pages is below `MIN_TEXT_CHARS_SEARCHABLE`, the outcome is
`OCR_REQUIRED`.

## Limits (enforced, not assumed)

`PDF_LIMITS` in the pure assessor / parser:

| Limit | Value | Behaviour on breach |
|-------|-------|---------------------|
| `MAX_BYTES` | 25 MiB | `TOO_LARGE` (checked before parsing) |
| `MAX_PAGES` | 100 | `TOO_LARGE` |
| `MAX_TEXT_CHARS` | 200 000 | text truncated at a page boundary (`truncated: true`), never silently dropped |
| `MIN_TEXT_CHARS_SEARCHABLE` | 24 | below ⇒ `OCR_REQUIRED` |
| `TIMEOUT_MS` | 15 000 | `TIMEOUT` (parse raced against a timer) |

Every failure maps to a **closed** `failure_category` vocabulary — a raw library error never
reaches the client.

## Deterministic classification

[`lib/docintel/classify-text.ts`](../../lib/docintel/classify-text.ts) is a rule-based FR/EN
keyword classifier — **no model, no AI**. A keyword match is suggestive, so confidence tops out
at `MEDIUM`; nothing matched ⇒ `UNKNOWN` (never a guess). Its result is fed to `classifyDocument`
as a *prediction*: the operator-declared class stays authoritative, and a disagreement only
raises a review conflict banner — it never changes the class. Document language (FR / EN /
BILINGUAL / UNKNOWN) is detected from marker-word density, never assumed.

## Provenance

Each candidate field carries the **page** it was found on (first occurrence wins) plus a bounded
evidence excerpt. The job stores `page_count`, the `\f`-delimited page-preserving `extracted_text`
(bounded), the source `checksum`, `provider_code = local_pdf_text`, and
`extraction_method = pdf_text_layer`. The chain from source page → candidate → applied value is
reconstructable.

## Why `pdf-parse`

Node 20 (the CI/runtime baseline) predates `Promise.withResolvers`, which pdf.js v4 requires.
`pdf-parse` is a pure-Node library that bundles its own pdf.js and works on any Node version, with
no native `canvas` dependency (text extraction needs no rendering). It is imported dynamically
from its inner module (`pdf-parse/lib/pdf-parse.js`) to bypass the package's debug-mode test-file
read, and declared in `next.config.mjs` under `serverComponentsExternalPackages` so it is required
at runtime from `node_modules` and never traced into a client/edge bundle.

## Verification

- Pure unit tests for the assessor (limits + scanned detection + truncation), the FR/EN
  classifier (confidence never `HIGH`, `UNKNOWN` never guessed, language detection), and page
  provenance — [`tests/document-intelligence-pdf.test.ts`](../../tests/document-intelligence-pdf.test.ts).
- Structural tests: parser is `server-only` + no network + dynamic inner import + timeout/size
  limits; the action validates version/checksum, classifies deterministically, stamps the local
  provider, routes scanned PDFs to `OCR_REQUIRED`, and still applies only via the domain services.
- The CI RLS test asserts `failure_category = OCR_REQUIRED` is accepted (migration applied).
