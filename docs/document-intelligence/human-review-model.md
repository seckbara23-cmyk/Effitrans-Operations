# Document Intelligence — Human Review Model

**Phase 7.4A.** Core principle, verbatim from the brief:

> **AI and OCR output are suggestions, not authoritative operational facts.**

No AI/OCR-derived value updates any record without an explicit, authorized
review-and-apply action by a human. There is no Document → AI → automatic operational write
path anywhere in the platform.

## The job lifecycle

A `document_intelligence_job` moves through an explicit state machine
([`lib/docintel/lifecycle.ts`](../../lib/docintel/lifecycle.ts)):

```
QUEUED → CLASSIFYING → CLASSIFIED → EXTRACTING → EXTRACTED
       → READY_FOR_REVIEW → PARTIALLY_APPROVED → APPROVED → APPLIED
(any non-terminal) → FAILED | CANCELLED
```

Terminal states are `APPLIED`, `FAILED`, `CANCELLED`. Transitions are validated
(`validateJobTransition`) — an invalid or from-terminal transition is rejected with a reason.
A partial unique index guarantees at most one *active* job per document.

## Field-level review

Each candidate field ([`document_candidate_field`](../../supabase/migrations/20260716000007_document_intelligence.sql))
carries its own decision, independent of every other field:

| Attribute | Values | Meaning |
|-----------|--------|---------|
| `confidence` | `HIGH` / `MEDIUM` / `LOW` / `UNKNOWN` | Deterministic extraction is never `HIGH` — a rule matched, a human still decides. |
| `validation_status` | `VALID` / `INVALID_FORMAT` / `MISSING_REQUIRED_CONTEXT` / … | Deterministic validator verdict. |
| `reconciliation_status` | `AGREEMENT` / `CONFLICT` / `MISSING` / `NONE` | vs. the operational fact, if any. |
| `review_decision` | `PENDING` / `APPROVED` / `REJECTED` / `EDITED` / `IGNORED` | The human's call. Default `PENDING`. |

`reviewField()` records the decision. An `EDITED` value is **re-validated** through the field's
schema `kind` before it can be approved — a human edit is held to the same deterministic
standard as an extracted value. Approving/deciding fields advances the job to
`PARTIALLY_APPROVED` and then `APPROVED` when nothing is left pending.

## Batch approval is deliberately conservative

`isBatchApprovable()` returns true **only** for a field that is `HIGH` confidence **and**
`VALID` **and** in `AGREEMENT`. Anything `MEDIUM`/`LOW`/`UNKNOWN`, anything not `VALID`, and
**anything in `CONFLICT`** must be reviewed one by one. Because deterministic extraction never
emits `HIGH`, batch approval is effectively unavailable until a validated high-confidence
provider exists — the safe default.

## Applying approved values

`applyFields()` is the only write path, and it:

1. requires the caller's `document:read` and resolves the operational shipment from the file;
2. routes **every** value through the owning domain service — `updateBookingBl` (ocean) or
   `updateAwb` (air) — which independently re-check `transport:update`. There is no
   free-form table write to `shipment`, `customs_record`, or `invoice` (asserted by test);
3. verifies the **source is still current**: `document.version === job.document_version`, else
   the value is `document_changed` and a fresh job is required (stale-source guard);
4. records a per-field `application_result`: `APPLIED` / `FAILED` / `SKIPPED` / `UNSUPPORTED` /
   `STALE`. Application is partial-safe — one field failing never corrupts another.
5. sets the job to `APPLIED` only when nothing remains to apply.

A field with no `applyTarget` is `UNSUPPORTED` for application by construction — it is
decision-support only and can never be written.

## Provenance

Every candidate preserves where it came from: `provider_code`, `extraction_method`, `page`,
bounded `evidence`, the displayed vs. normalized value, and — post-review — `reviewed_by`,
`reviewed_at`, `edited_value`, `application_target`, `application_result`, `applied_at`. The
chain from source text to applied operational value is fully reconstructable.

## Audit

Review and apply emit audit events (`DOCUMENT_REVIEW_COMPLETED`, `DOCUMENT_FIELD_APPLIED`,
`DOCUMENT_FIELD_APPLICATION_FAILED`, …) carrying **safe metadata only** — never document text,
extracted values, PII, credentials, or raw provider responses. See
[security-and-privacy.md](./security-and-privacy.md).
