-- 20260716000007_document_intelligence.sql
-- Effitrans Operations Platform — PHASE 7.4A: Document Intelligence foundation.
--
-- DECISION (docs/document-intelligence/phase-7.4a-architecture.md): two satellite tables
-- over the EXISTING document store. NO second document store; NO redesign of documents.
-- AI/OCR output are SUGGESTIONS — nothing here writes an operational record. Applications
-- go through existing domain services (server actions), never from this schema.
--
-- SCOPE GUARD: no live OCR/LLM provider (none verified). Synchronous, operator-triggered.
-- RLS inherits dossier visibility (document:read + can_read_file); writes are service-role +
-- permission-gated. No new broad "ai:*" permission.

-- ===========================================================================
-- 1. document_intelligence_job — one row per extraction attempt, tied to an
--    IMMUTABLE source version. Repeated extraction / a replaced file ⇒ a NEW job.
-- ===========================================================================
create table public.document_intelligence_job (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.organization (id),
  document_id              uuid not null references public.document (id) on delete cascade,
  file_id                  uuid not null references public.operational_file (id) on delete cascade,
  document_version         integer not null default 1,
  storage_path             text,
  checksum                 text,                 -- nullable until a file-reading provider computes it
  mime_type                text,
  byte_size                bigint,
  page_count               integer,
  declared_class           text,                 -- operator-declared logistics class
  predicted_class          text,                 -- provider-predicted (nullable)
  classification_confidence text check (classification_confidence is null or classification_confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  status                   text not null default 'QUEUED'
                             check (status in ('QUEUED','CLASSIFYING','EXTRACTING_TEXT','EXTRACTING_FIELDS',
                               'VALIDATING','READY_FOR_REVIEW','PARTIALLY_APPROVED','APPROVED','APPLIED','FAILED','CANCELLED')),
  provider_code            text not null default 'manual',
  extraction_method        text,
  extracted_text           text,                 -- normalized, bounded; never a raw provider payload
  failure_category         text check (failure_category is null or failure_category in
                             ('NOT_CONFIGURED','UNSUPPORTED_FILE','UNSUPPORTED_DOCUMENT','TOO_LARGE','TIMEOUT',
                              'RATE_LIMITED','PROVIDER_ERROR','INVALID_RESPONSE','VALIDATION_FAILED')),
  job_version              integer not null default 0,   -- compare-and-set
  created_by               uuid references public.app_user (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index idx_docintel_job_document on public.document_intelligence_job (tenant_id, document_id);
create index idx_docintel_job_file on public.document_intelligence_job (tenant_id, file_id);
create index idx_docintel_job_status on public.document_intelligence_job (tenant_id, status);
-- No duplicate ACTIVE job for the same document version (re-run must reuse or reach terminal).
create unique index uq_docintel_active_job on public.document_intelligence_job (tenant_id, document_id, document_version)
  where status not in ('APPLIED','FAILED','CANCELLED');

create trigger trg_docintel_job_updated_at before update on public.document_intelligence_job
  for each row execute function public.set_updated_at();
-- Reuse the document tenant-integrity guard (checks new.tenant_id = operational_file.tenant_id via file_id).
create trigger trg_docintel_job_tenant before insert or update on public.document_intelligence_job
  for each row execute function public.enforce_document_tenant();

-- ===========================================================================
-- 2. document_candidate_field — per-field candidates + human decisions + application.
-- ===========================================================================
create table public.document_candidate_field (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  job_id               uuid not null references public.document_intelligence_job (id) on delete cascade,
  file_id              uuid not null references public.operational_file (id) on delete cascade,
  document_class       text not null,
  field_key            text not null,            -- allowlisted per class (lib/docintel/schemas.ts)
  displayed_value      text,
  normalized_value     text,
  confidence           text not null default 'UNKNOWN' check (confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  page                 integer,
  evidence             text,                     -- bounded excerpt / reference
  validation_status    text not null default 'NEEDS_REVIEW'
                         check (validation_status in ('VALID','INVALID_FORMAT','MISSING_REQUIRED_CONTEXT','CONFLICT','DUPLICATE','UNSUPPORTED','NEEDS_REVIEW')),
  reconciliation_status text check (reconciliation_status is null or reconciliation_status in ('AGREEMENT','CONFLICT','MISSING','NONE')),
  review_decision      text not null default 'PENDING' check (review_decision in ('PENDING','APPROVED','REJECTED','EDITED','IGNORED')),
  edited_value         text,
  reviewed_by          uuid references public.app_user (id),
  reviewed_at          timestamptz,
  application_target   text,                     -- e.g. "shipping.masterBl" (null = no authoritative target)
  application_result   text check (application_result is null or application_result in ('APPLIED','FAILED','SKIPPED','UNSUPPORTED','STALE')),
  applied_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, job_id, field_key)
);
create index idx_docintel_field_job on public.document_candidate_field (tenant_id, job_id);
create index idx_docintel_field_file on public.document_candidate_field (tenant_id, file_id);

create trigger trg_docintel_field_updated_at before update on public.document_candidate_field
  for each row execute function public.set_updated_at();
create trigger trg_docintel_field_tenant before insert or update on public.document_candidate_field
  for each row execute function public.enforce_document_tenant();

-- ===========================================================================
-- 3. RLS — read inherits dossier visibility (tenant + document:read + can_read_file).
--    Writes via the service-role admin client in server actions.
-- ===========================================================================
alter table public.document_intelligence_job enable row level security;
alter table public.document_candidate_field  enable row level security;

create policy docintel_job_select on public.document_intelligence_job for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('document:read') and public.can_read_file(file_id));
create policy docintel_field_select on public.document_candidate_field for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('document:read') and public.can_read_file(file_id));

grant select on public.document_intelligence_job, public.document_candidate_field to authenticated;
