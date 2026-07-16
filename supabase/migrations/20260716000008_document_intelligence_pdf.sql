-- 20260716000008_document_intelligence_pdf.sql
-- Effitrans Operations Platform — PHASE 7.4B: local searchable-PDF text extraction.
--
-- Additive ONLY. The 7.4B parser extracts the EMBEDDED text layer of searchable PDFs
-- entirely locally (no OCR, no LLM, no external call). A scanned / image-only PDF has no
-- text layer to extract, so the job terminates with a distinct, honest outcome: OCR_REQUIRED.
--
-- This migration widens the failure_category vocabulary to admit OCR_REQUIRED. No table,
-- column, RLS policy, or permission is added. Nothing here writes an operational record.

alter table public.document_intelligence_job
  drop constraint document_intelligence_job_failure_category_check;

alter table public.document_intelligence_job
  add constraint document_intelligence_job_failure_category_check
  check (failure_category is null or failure_category in
    ('NOT_CONFIGURED','UNSUPPORTED_FILE','UNSUPPORTED_DOCUMENT','TOO_LARGE','TIMEOUT',
     'RATE_LIMITED','PROVIDER_ERROR','INVALID_RESPONSE','VALIDATION_FAILED','OCR_REQUIRED'));
