# Phase 7.4A — Document Intelligence architecture & decisions

A provider-neutral foundation for classifying logistics documents, extracting candidate
fields, validating them, and applying **only human-approved** values through the existing
domain services. AI/OCR output are SUGGESTIONS — never automatic operational writes.

## Architecture audit (reuse / extend / new)

| Concern | Found | Decision |
|---|---|---|
| Document store | `document` (versioned, `type_code`→`document_type`, RLS `document:read`+`can_read_file`, tenant trigger) | **Reuse** — no second document store |
| File storage | private `documents` bucket (26 MB, MIME pdf/jpeg/png/docx/xlsx), server-mediated signed URLs | **Reuse** |
| Permissions | `document:create/read/update/approve/delete` + domain perms (`transport:update`, `customs:*`, finance) | **Reuse** — no broad "ai:*" permission |
| Deterministic validators | `lib/shipping/intelligence/validators` (ISO 6346/IMO/MMSI/UN/LOCODE/coord), `lib/air/intelligence/validators` (IATA/ICAO) | **Reuse** |
| AI provider abstraction | `lib/ai/*` (provider-neutral, dark-by-default) | **Mirror the pattern** (own doc-intel providers) |
| PDF text / OCR library | **NONE** (deps: leaflet, qrcode only) | text extraction is MANUAL/stub in 7.4A |
| Job queue / worker / cron | **NONE** | **synchronous, operator-triggered** MVP (honest) |
| Apply targets | shipping (`updateBookingBl`), air (`updateAwb`), customs (read-only), finance (invoice) | apply **only** through existing domain actions |

## Persistence decision — Option B (two satellite tables)

`document_intelligence_job` + `document_candidate_field`. Rejected: additive columns on
`document` (extraction is multi-attempt × multi-field, not 1:1) and the full 5-table model
(`document_extraction`/`document_review`/`document_field_application` collapse into
job + candidate + the append-only `audit_log`).

- **`document_intelligence_job`** — one row per extraction attempt, tied to an IMMUTABLE
  source version (`document_id`, `document_version`, `storage_path`, `mime_type`, `byte_size`,
  `page_count`, `checksum` nullable until a file-reading provider computes it). Holds the
  declared/predicted class + classification confidence, the lifecycle `status`, the
  `extraction_method`/`provider_code`, a normalized `extracted_text` (bounded, optional), a
  `failure_category`, and `job_version` for compare-and-set. Repeated extraction ⇒ a NEW job;
  a replaced file ⇒ a new job (the old job stays attached to the old version).
- **`document_candidate_field`** — one row per extracted field: `field_key` (allowlisted per
  class), displayed + normalized value, `confidence` (HIGH/MEDIUM/LOW/UNKNOWN), `page`,
  bounded `evidence`, `validation_status`, `reconciliation_status`, `review_decision`
  (PENDING/APPROVED/REJECTED/EDITED/IGNORED), `edited_value`, `reviewer`/`reviewed_at`,
  `application_target`, `application_result`, `applied_at`. Partial approval + partial
  application live here; application HISTORY is the append-only audit log.

RLS: both inherit dossier visibility (`document:read` + `can_read_file` via the parent
document's file). Writes are service-role + permission-gated in server actions.

## Job lifecycle (state machine)

`QUEUED → CLASSIFYING → EXTRACTING_TEXT → EXTRACTING_FIELDS → VALIDATING →
READY_FOR_REVIEW → (PARTIALLY_APPROVED) → APPROVED → APPLIED`, with `FAILED` and `CANCELLED`.
Explicit transitions (`lib/docintel/lifecycle.ts`); terminal = APPLIED/FAILED/CANCELLED;
compare-and-set on `job_version`; provider failure (`failure_category`) is distinct from
validation failure; an application failure never erases approved review decisions (they
persist on the candidate rows).

**Execution is SYNCHRONOUS + operator-triggered** — there is no durable queue/worker, so we
do not simulate one. The operator creates the job, then triggers extraction; status is
honest (`QUEUED` until run). Durable async processing is a later phase, gated on an approved
OCR/LLM provider.

## Provider architecture (all behind interfaces; no vendor SDK in app/client code)

`DocumentClassifier`, `TextExtractionProvider`, `StructuredExtractionProvider` — with a
`ManualTextProvider` (operator-provided text), a deterministic schema-bound structured
extractor, and honest STUBS (`LOCAL_PDF_TEXT` → `text_unavailable` since no parser exists,
`OCR`/`LLM` → `not_configured`). Shared result vocabulary: SUCCESS / NOT_CONFIGURED /
UNSUPPORTED_FILE / UNSUPPORTED_DOCUMENT / TOO_LARGE / TIMEOUT / RATE_LIMITED / PROVIDER_ERROR
/ INVALID_RESPONSE / VALIDATION_FAILED. No raw provider error reaches the client. See
provider-readiness.md — no live provider is configured; nothing is fabricated.

## Safety

Document content is treated as UNTRUSTED DATA, never instructions (prompt-injection defense
is a first-class part of the LLM contract, unused until a provider is approved). No
suggestion applies without an explicit review-and-apply action; apply routes through the
domain service that owns the invariant (shipping/air/customs/finance), re-checks the
target-domain permission per field, reloads the current value, and rejects a stale candidate
(CAS). Audit carries safe metadata only — never extracted text, values, or evidence.
