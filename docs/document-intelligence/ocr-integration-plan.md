# OCR Integration Plan

**Phase 7.4C-0.** Confirms architecture compatibility and defines the **exact** implementation scope for a
future Phase 7.4C — **no OCR is implemented now**. The plan preserves every existing safety boundary:
OCR output is a **suggestion**, applied only after human review through the existing four-field application
path.

## Fit with existing provider interfaces

The platform already defines provider interfaces in
[`lib/docintel/provider.ts`](../../lib/docintel/provider.ts):

- **`TextExtractionProvider`** — `extractText(input) → ProviderResult<{ pages, method, warnings }>`
- **`DocumentClassifier`** — prediction (deterministic FR/EN classifier already fills this role)
- **`StructuredExtractionProvider`** — schema-bound field extraction (deterministic extractor)

**The OCR provider implements `TextExtractionProvider` ONLY.** It converts a scanned/image PDF (or
PNG/JPEG) into page text. It does **not** classify and does **not** extract fields — those stay with the
existing **deterministic** classifier and schema-bound extractor. This keeps OCR and any future LLM
extraction strictly separate (no OCR+LLM in the first pilot).

The `local_pdf_text` (7.4B) and `ocr` (stub) provider codes already exist; 7.4C turns the approved `ocr`
provider from `not_configured` into a real server-only adapter, exactly as 7.4B did for `local_pdf_text`.

## Normalized page-level result (adapter output — no provider object escapes)

**Provider-specific response objects must never escape the adapter.** The adapter maps each vendor's JSON
(Azure polygons/spans, Google `boundingPoly`, AWS `Block`/`Geometry`, Mistral blocks) into ONE normalized
shape (to be added under `lib/docintel/ocr/` in 7.4C):

```
OcrExtractionResult {
  provider:      string          // e.g. "azure-di" | "mistral-ocr"
  model:         string          // provider model/version, pinned (not "latest")
  pageCount:     number
  language:      DocLanguage      // FR | EN | BILINGUAL | UNKNOWN (provider hint, validated)
  warnings:      string[]         // bounded, safe vocabulary — never a raw provider error
  startedAt / completedAt: string // timestamps
  pages: OcrPage[]
}
OcrPage {
  page:        number            // 1-based; page order preserved
  text:        string            // sanitized (control-char stripped), untrusted DATA
  confidence:  number | null     // provider confidence (0–1), null if absent/uncalibrated
  regions:     OcrRegion[]       // bounding regions where available (optional)
}
OcrRegion { text, confidence, box: { x, y, w, h } }  // normalized geometry
```

This maps onto the **existing** persistence with no schema redesign: joined page text → `extracted_text`
(`\f`-delimited, as 7.4B), `pageCount` → `page_count`, per-field `page`/`evidence`/`confidence` on
`document_candidate_field`. Any OCR-specific metadata (provider job id, model/version) would be a small
**additive** migration in 7.4C (mirroring 7.4B's additive `OCR_REQUIRED` migration) — no RLS/permission
change.

## Preserved integration boundary (unchanged)

```
Scanned document
 → approved OCR provider (TextExtractionProvider adapter → OcrExtractionResult, normalized)
 → normalized page text
 → EXISTING deterministic classifier (classifyText, FR/EN — a suggestion)
 → EXISTING schema-bound candidate extractor (deterministicExtractPages — page provenance)
 → EXISTING validators (validate.ts, reconcile.ts)
 → human review (review studio — behavior unchanged)
 → EXISTING four-field application (updateBookingBl / updateAwb only)
```

- The OCR provider **never** writes an operational field.
- The four writable fields (`bl_number`, `booking_reference`, `mawb`, `hawb`) are **not** expanded.
- OCR and LLM extraction are **not** combined in the first pilot.
- Document storage is unchanged (private `documents` bucket; server-mediated).
- OCR text is untrusted **data**, sanitized and evidence-bounded — never an instruction.

## Operational model (no detached promises)

The provider's sync/async nature (see [comparison](./ocr-provider-comparison.md)) drives the wiring. The
platform is **Vercel serverless with no worker tier**, so the plan uses the **existing
`document_intelligence_job` lifecycle** as the real job model — **not** detached background promises.

| Concern | Plan |
|---------|------|
| **Sync provider** (e.g. Mistral `/v1/ocr`, or small docs) | Operator-triggered action submits and returns within the request, within Vercel function limits. Mirrors the 7.4B `extractSearchablePdf` action. |
| **Async provider** (e.g. Azure submit→poll) | Submit stores the provider operation id on the job (`EXTRACTING_TEXT`). Status is advanced by an **explicit** trigger: an operator "refresh" action **or** a scheduled **Vercel Cron** poll — a real, tracked step, never a detached promise. |
| **Retry** | Bounded retries with exponential backoff honoring the provider `retry-after`; manual retry = a **new job** on the (checksum-verified) source. |
| **Timeout** | Per-provider timeout; on breach → `FAILED` / `TIMEOUT` (existing failure vocabulary). |
| **Idempotency** | Existing unique **active-job** index + **CAS** (`job_version`) + **checksum** prevent duplicate processing/writes. |
| **Concurrency** | Per-tenant + global cap on in-flight OCR jobs; respects provider TPS (as low as 1–5 in some EU regions). |
| **Rate limiting** | Token-bucket throttle sized to the provider's confirmed limits. |
| **Cost caps** | Per-tenant monthly page/cost ceiling; when exceeded → OCR disabled for the tenant, fall back to manual (no silent overspend). |
| **Kill switch** | A config flag disables the OCR provider instantly → it reports `not_configured` → pipeline falls back to searchable-PDF + manual. Reuses the existing provider-readiness pattern. |
| **Provider-health monitoring** | Track failure rate + latency; auto-disable on sustained failure; surface status in the readiness UI. |
| **Fallback** | On OCR unavailable/failed → the current `OCR_REQUIRED` + manual-entry path (already shipped in 7.4B). No regression. |
| **Manual retry** | Operator can re-queue a fresh job; stale-source guard applies. |
| **Scanned-document retention** | Minimize: prefer stateless/ZDR endpoints; delete provider-side copies after processing using each provider's deletion mechanism; store only normalized results under existing tenant RLS. |

## Exact implementation scope for Phase 7.4C (gated on approval + a passing evaluation)

1. Run the [evaluation dataset](./ocr-evaluation-dataset.md) against the approved provider's sandbox; confirm thresholds.
2. Add a **server-only** OCR adapter under `lib/docintel/ocr/` implementing `TextExtractionProvider`,
   producing the normalized `OcrExtractionResult`; keep the vendor SDK/HTTPS call **inside** the adapter.
3. Wire the operational model above onto the existing job lifecycle (sync action and/or Cron-driven poll);
   add cost caps, kill switch, health monitoring, and fallback.
4. Additive-only migration for any OCR metadata (provider job id, model/version, confidence) — no RLS or
   permission change; register any new column per existing conventions.
5. Extend the review studio only to **display** OCR provenance (page/confidence/region) — behavior and the
   apply boundary unchanged.
6. Document the **required environment variables** (endpoint, key/credentials, region, model/version) from
   official docs; store as server secrets; never in the client bundle.
7. Tests + RLS test + typecheck + build + CI green, mirroring 7.4A/7.4B.

**Explicitly out of scope for 7.4C:** LLM field extraction, any new writable field, customer-facing OCR,
a chatbot, a second document store, and combining OCR with LLM.
