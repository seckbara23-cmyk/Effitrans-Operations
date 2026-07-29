-- 20260729000002_aging_balance_foundation.sql
-- Effitrans Operations Platform — FIN-AGING-2: AR schema and security foundation.
-- ---------------------------------------------------------------------------
-- FORWARD-ONLY, idempotent, DARK. Creates the Aging Balance report lifecycle,
-- its immutable snapshot, the template-version registry, artifact metadata, the
-- legacy import pipeline, and eleven granular permissions granted to NOBODY
-- beyond the ratified matrix. No route, no renderer, no production application.
--
-- ===========================================================================
-- 0. WHAT THIS DELIBERATELY DOES NOT CREATE
-- ===========================================================================
-- No second invoice, payment, allocation, dispute, client, dossier or audit
-- system. The canonical receivable stays `public.invoice`; collection notes stay
-- in `collection_follow_up`; disputes stay on `invoice.disputed_at`; every
-- privileged act still writes to `audit_log`.
--
-- ONE EXCEPTION, and it is structural rather than preferential: report artifacts
-- do NOT reuse `public.document`. That table is dossier-scoped — `document.file_id`
-- is NOT NULL and its whole model (versions, review, expiry, per-file uniqueness)
-- is about a dossier's paperwork. An Aging Balance belongs to a tenant and a
-- reporting date, not to a dossier, so storing it there would mean relaxing a
-- second NOT NULL and inventing a dossier for every report. `aging_report_artifact`
-- therefore applies the SAME discipline the official-invoice artifact established
-- in UAT-2B — one row per (report, format), content hash, renderer version,
-- delete protection — to an object `document` structurally cannot hold.
--
-- ===========================================================================
-- 1. Q-08 — A DOSSIER IS MANDATORY FOR PLATFORM INVOICES, NOT FOR LEGACY ONES
-- ===========================================================================
-- Effitrans' receivables predate the platform: the reference balance âgée carries
-- invoices ~2 500 days old. Those have no operational dossier and never will, and
-- the ratified decision is explicit — do not fabricate dossiers to satisfy a NOT
-- NULL, and do not build a parallel receivable ledger either.
--
-- So `invoice.file_id` becomes nullable, and a CHECK restores the guarantee where
-- it actually belongs: a PLATFORM_NATIVE invoice must have a dossier; an
-- OPENING_IMPORT invoice must have a dossier OR a preserved external reference.
-- The constraint is strictly STRONGER than the old NOT NULL for everything the
-- platform creates, because `provenance` defaults to PLATFORM_NATIVE: every
-- existing code path is still forced to supply a dossier, and no legacy row can
-- exist until the FIN-AGING-4 import creates one.
-- ===========================================================================

alter table public.invoice
  add column if not exists provenance text not null default 'PLATFORM_NATIVE',
  add column if not exists legacy_file_reference text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_provenance_check') then
    alter table public.invoice add constraint invoice_provenance_check
      check (provenance in ('PLATFORM_NATIVE', 'OPENING_IMPORT'));
  end if;
end $$;

alter table public.invoice alter column file_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_dossier_or_legacy_reference') then
    alter table public.invoice add constraint invoice_dossier_or_legacy_reference check (
      (provenance = 'PLATFORM_NATIVE' and file_id is not null)
      or
      (provenance = 'OPENING_IMPORT' and (file_id is not null or legacy_file_reference is not null))
    );
  end if;
end $$;

comment on column public.invoice.provenance is
  'PLATFORM_NATIVE (default) — issued by this platform against an operational '
  'dossier. OPENING_IMPORT — a legacy receivable that predates the platform, '
  'accepted through an audited import batch. Never rewritten by reconciliation.';

comment on column public.invoice.legacy_file_reference is
  'The external dossier reference carried from the source workbook when no '
  'platform dossier matched. PRESERVED FOREVER, including after the invoice is '
  'later linked to a real dossier — it is how the row is traced to its origin.';

-- The tenant-match trigger is shared with billing_charge and raises when the
-- looked-up file tenant is NULL. A dossier-less invoice would therefore be
-- rejected by an integrity check that has nothing to say about it. The guard
-- below changes nothing for billing_charge (its file_id is still NOT NULL) and
-- nothing for platform invoices; it only stops the check firing on a row that
-- legitimately has no file. Cross-tenant linkage stays impossible: if a file IS
-- given, its tenant must still match.
create or replace function public.enforce_finance_file_tenant()
returns trigger language plpgsql as $$
declare f_tenant uuid;
begin
  if new.file_id is null then
    return new; -- no dossier to match against (OPENING_IMPORT); CHECK governs legality
  end if;
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'finance tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;

create index if not exists idx_invoice_provenance
  on public.invoice (tenant_id, provenance) where provenance <> 'PLATFORM_NATIVE';

-- ===========================================================================
-- 2. TEMPLATE VERSION REGISTRY
-- ===========================================================================
-- A snapshot pins its template version so a later template change cannot
-- retroactively alter a report that was already finalized and shared.
create table if not exists public.aging_template_version (
  id            uuid primary key default gen_random_uuid(),
  -- NULL = platform-wide template available to every tenant.
  tenant_id     uuid references public.organization (id),
  code          text not null,
  version       int  not null check (version >= 1),
  title_fr      text not null,
  renderer_key  text not null,
  -- Labels, palette, column widths, bucket-scheme id: the workbook's constants
  -- as DATA, so a v2 is a row rather than a code change.
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  created_by    uuid references public.app_user (id),
  created_at    timestamptz not null default now()
);

create unique index if not exists uq_aging_template_code_version
  on public.aging_template_version (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code, version);

-- ===========================================================================
-- 3. THE REPORT AND ITS LIFECYCLE
-- ===========================================================================
create table if not exists public.aging_report (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  report_number     text not null,
  reporting_date    date not null,                       -- la date d'arrêté
  currency          text not null default 'XOF',
  status            text not null default 'DRAFT'
                      check (status in ('DRAFT', 'VALIDATED', 'FINAL', 'SUPERSEDED', 'CANCELLED')),
  template_id       uuid not null references public.aging_template_version (id),
  -- Everything needed to reproduce the figures, pinned at snapshot time.
  engine_version    text not null,
  bucket_scheme     text not null,
  risk_scheme       text not null,
  filters           jsonb not null default '{}'::jsonb,
  prepared_by       uuid references public.app_user (id),
  prepared_at       timestamptz,
  validated_by      uuid references public.app_user (id),
  validated_at      timestamptz,
  finalized_by      uuid references public.app_user (id),
  finalized_at      timestamptz,
  superseded_by_id  uuid references public.aging_report (id),
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, report_number),
  -- MAKER-CHECKER, structurally. Not a convention someone remembers: the row
  -- cannot exist with the same person on both sides.
  constraint aging_report_validator_differs check (validated_by is null or validated_by <> prepared_by),
  constraint aging_report_finalizer_differs check (finalized_by is null or finalized_by <> prepared_by)
);

-- At most ONE live FINAL per (tenant, arrêté, currency). A re-issue must
-- explicitly SUPERSEDE its predecessor rather than quietly coexist with it —
-- two live "final" balances for the same date is how a company ends up citing
-- different numbers to its auditor and its bank.
create unique index if not exists uq_aging_report_one_final
  on public.aging_report (tenant_id, reporting_date, currency)
  where status = 'FINAL';

create index if not exists idx_aging_report_tenant_date
  on public.aging_report (tenant_id, reporting_date desc);

drop trigger if exists trg_aging_report_updated_at on public.aging_report;
create trigger trg_aging_report_updated_at before update on public.aging_report
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. THE IMMUTABLE SNAPSHOT — ONE dataset, five renderings
-- ===========================================================================
-- Deliberately NOT five stored tab datasets. Storing the dashboard, the client
-- analysis and the chart series separately would let them drift apart, and a
-- balance sheet whose tabs disagree is worse than one that is merely late.
-- The rows below ARE the report; every tab is a projection the engine derives
-- from them, cross-checked against `totals` on render.
create table if not exists public.aging_report_row (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  report_id             uuid not null references public.aging_report (id) on delete restrict,
  -- Source identity, kept so a figure can always be traced to its receivable.
  source_invoice_id     uuid references public.invoice (id),
  invoice_number        text not null,
  issue_date            date not null,
  due_date              date not null,
  dossier_reference     text,
  legacy_file_reference text,
  client_id             uuid references public.client (id),
  -- Copied, not joined: renaming a client must not rewrite a finalized report.
  client_name           text not null,
  original_amount       numeric(14,2) not null,
  outstanding           numeric(14,2) not null check (outstanding > 0),
  days_overdue          int  not null,
  bucket                text not null,
  risk                  text not null,
  disputed              boolean not null default false,
  comment               text,
  row_order             int  not null,
  unique (report_id, source_invoice_id),
  unique (report_id, row_order)
);

create index if not exists idx_aging_row_report on public.aging_report_row (report_id);
create index if not exists idx_aging_row_invoice on public.aging_report_row (tenant_id, source_invoice_id);

-- Aggregates + KPI cards + chart series as computed at snapshot time. Stored so
-- a finalized report can PROVE its own consistency later: the renderer
-- recomputes from the rows and compares against this.
create table if not exists public.aging_report_totals (
  report_id   uuid primary key references public.aging_report (id) on delete restrict,
  tenant_id   uuid not null references public.organization (id),
  kpis        jsonb not null,
  buckets     jsonb not null,
  clients     jsonb not null,
  charts      jsonb not null,
  exclusions  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ===========================================================================
-- 5. GENERATED ARTIFACTS (UAT-2B discipline, report-scoped)
-- ===========================================================================
create table if not exists public.aging_report_artifact (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.organization (id),
  report_id       uuid not null references public.aging_report (id) on delete restrict,
  format          text not null check (format in ('XLSX', 'PDF')),
  storage_path    text not null,
  content_sha256  text not null,
  byte_size       bigint,
  renderer_key    text not null,
  rendered_by     uuid references public.app_user (id),
  rendered_at     timestamptz not null default now(),
  -- Rendered ONCE per format. A re-download streams the same bytes rather than
  -- re-rendering, so the hash a recipient was given stays the hash they can check.
  unique (report_id, format)
);

-- ===========================================================================
-- 6. SECURE EXTERNAL SHARING — FINAL ONLY
-- ===========================================================================
create table if not exists public.aging_report_share (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  artifact_id        uuid not null references public.aging_report_artifact (id) on delete restrict,
  -- The token is never stored in clear (the /card/[token] discipline).
  token_hash         text not null unique,
  recipient_email    text,
  password_hash      text,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  revoked_by         uuid references public.app_user (id),
  download_count     int not null default 0,
  last_downloaded_at timestamptz,
  created_by         uuid references public.app_user (id),
  created_at         timestamptz not null default now()
);

create index if not exists idx_aging_share_artifact on public.aging_report_share (artifact_id);

-- Only a FINAL report may leave the building. Enforced in the database, not
-- only in the action that creates the link, because "we check it in the UI" is
-- how a draft balance reaches a bank.
create or replace function public.enforce_aging_share_final_only()
returns trigger language plpgsql as $$
declare v_status text;
begin
  select r.status into v_status
    from public.aging_report_artifact a
    join public.aging_report r on r.id = a.report_id
   where a.id = new.artifact_id;
  if v_status is distinct from 'FINAL' then
    raise exception 'aging share refused: report status is %, only FINAL may be shared externally', coalesce(v_status, 'unknown');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aging_share_final_only on public.aging_report_share;
create trigger trg_aging_share_final_only before insert on public.aging_report_share
  for each row execute function public.enforce_aging_share_final_only();

-- ===========================================================================
-- 7. LEGACY IMPORT PIPELINE
-- ===========================================================================
-- Staging exists so nothing enters the ledger unvalidated, and so a rejected row
-- leaves a trace instead of vanishing.
create table if not exists public.legacy_import_batch (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  batch_number        text not null,
  source_filename     text,
  source_file_sha256  text,
  status              text not null default 'STAGED'
                        check (status in ('STAGED', 'VALIDATED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  row_count           int not null default 0,
  prepared_by         uuid references public.app_user (id),
  prepared_at         timestamptz not null default now(),
  approved_by         uuid references public.app_user (id),
  approved_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, batch_number),
  -- The actor approving a batch must differ from the one who prepared it.
  constraint legacy_batch_approver_differs check (approved_by is null or approved_by <> prepared_by)
);

drop trigger if exists trg_legacy_batch_updated_at on public.legacy_import_batch;
create trigger trg_legacy_batch_updated_at before update on public.legacy_import_batch
  for each row execute function public.set_updated_at();

create table if not exists public.legacy_import_staging_row (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  batch_id              uuid not null references public.legacy_import_batch (id) on delete cascade,
  -- Original source position and payload, preserved verbatim for traceability.
  source_row_number     int not null,
  raw                   jsonb not null,
  -- Parsed candidates (nullable: a row may fail before parsing completes).
  invoice_number        text,
  issue_date            date,
  due_date              date,
  client_id             uuid references public.client (id),
  client_name_raw       text,
  dossier_reference_raw text,
  matched_file_id       uuid references public.operational_file (id),
  currency              text,
  outstanding           numeric(14,2),
  status                text not null default 'PENDING'
                          check (status in ('PENDING', 'VALID', 'REJECTED', 'ACCEPTED')),
  -- Set only once the row becomes a real receivable.
  created_invoice_id    uuid references public.invoice (id),
  unique (batch_id, source_row_number),
  -- A rejected row must never carry a receivable. The pipeline's whole purpose.
  constraint staging_rejected_creates_nothing
    check (status <> 'REJECTED' or created_invoice_id is null),
  constraint staging_accepted_has_invoice
    check (status <> 'ACCEPTED' or created_invoice_id is not null)
);

create index if not exists idx_staging_batch on public.legacy_import_staging_row (batch_id);
create index if not exists idx_staging_tenant_status on public.legacy_import_staging_row (tenant_id, status);

-- Deterministic duplicate detection: one invoice number per tenant may be
-- staged once per batch, and the canonical `invoice` table's own
-- unique (tenant_id, invoice_number) refuses a duplicate at acceptance.
create unique index if not exists uq_staging_invoice_number_per_batch
  on public.legacy_import_staging_row (batch_id, invoice_number)
  where invoice_number is not null;

create table if not exists public.legacy_import_error (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  batch_id     uuid not null references public.legacy_import_batch (id) on delete cascade,
  staging_row_id uuid references public.legacy_import_staging_row (id) on delete cascade,
  field        text,
  code         text not null,
  message_fr   text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_import_error_batch on public.legacy_import_error (batch_id);

-- ===========================================================================
-- 8. RECONCILIATION — linking a legacy receivable to a real dossier, later
-- ===========================================================================
-- Append-only history. The link may change; the origin never does.
create table if not exists public.legacy_receivable_link (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  invoice_id            uuid not null references public.invoice (id) on delete cascade,
  previous_file_id      uuid references public.operational_file (id),
  new_file_id           uuid not null references public.operational_file (id),
  -- Copied at link time so the trail survives even if the column is later reused.
  preserved_legacy_reference text,
  linked_by             uuid references public.app_user (id),
  linked_at             timestamptz not null default now(),
  note                  text
);

create index if not exists idx_legacy_link_invoice on public.legacy_receivable_link (invoice_id);

drop trigger if exists trg_legacy_link_no_update on public.legacy_receivable_link;
create trigger trg_legacy_link_no_update before update on public.legacy_receivable_link
  for each row execute function public.prevent_mutation();
drop trigger if exists trg_legacy_link_no_delete on public.legacy_receivable_link;
create trigger trg_legacy_link_no_delete before delete on public.legacy_receivable_link
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 9. IMMUTABILITY — a finalized report is evidence, not a working document
-- ===========================================================================
-- Once VALIDATED, the snapshot rows are frozen: the numbers a validator signed
-- must be the numbers a reader sees. Later payments produce a NEW report that
-- supersedes this one; they never edit it.
-- NOTE ON `NEW` IN A DELETE TRIGGER: PL/pgSQL leaves NEW UNASSIGNED for DELETE,
-- so `coalesce(new.report_id, old.report_id)` does not evaluate to old — it
-- raises "record \"new\" is not assigned yet". The branch below is therefore
-- required, not stylistic; the same applies to returning a row.
create or replace function public.enforce_aging_snapshot_immutable()
returns trigger language plpgsql as $$
declare
  v_status text;
  v_report uuid;
begin
  if tg_op = 'DELETE' then v_report := old.report_id; else v_report := new.report_id; end if;

  select status into v_status from public.aging_report where id = v_report;
  if v_status is not null and v_status <> 'DRAFT' then
    raise exception 'aging snapshot is immutable: report is %, rows may only change while DRAFT', v_status;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_aging_row_immutable on public.aging_report_row;
create trigger trg_aging_row_immutable before insert or update or delete on public.aging_report_row
  for each row execute function public.enforce_aging_snapshot_immutable();

drop trigger if exists trg_aging_totals_immutable on public.aging_report_totals;
create trigger trg_aging_totals_immutable before insert or update or delete on public.aging_report_totals
  for each row execute function public.enforce_aging_snapshot_immutable();

-- Lifecycle legality + terminal immutability of the report row itself.
create or replace function public.enforce_aging_report_lifecycle()
returns trigger language plpgsql as $$
declare legal boolean;
begin
  if old.status = new.status then
    -- No transition. A FINAL/SUPERSEDED/CANCELLED report accepts no edits at all.
    if old.status in ('FINAL', 'SUPERSEDED', 'CANCELLED')
       and (new.reporting_date is distinct from old.reporting_date
            or new.currency is distinct from old.currency
            or new.template_id is distinct from old.template_id
            or new.engine_version is distinct from old.engine_version
            or new.bucket_scheme is distinct from old.bucket_scheme
            or new.risk_scheme is distinct from old.risk_scheme
            or new.prepared_by is distinct from old.prepared_by
            or new.validated_by is distinct from old.validated_by
            or new.finalized_by is distinct from old.finalized_by) then
      raise exception 'aging report % is % and may not be modified', old.id, old.status;
    end if;
    return new;
  end if;

  legal := (old.status, new.status) in (
    ('DRAFT', 'VALIDATED'), ('DRAFT', 'CANCELLED'),
    ('VALIDATED', 'FINAL'), ('VALIDATED', 'DRAFT'), ('VALIDATED', 'CANCELLED'),
    ('FINAL', 'SUPERSEDED')
  );
  if not legal then
    raise exception 'illegal aging report transition % -> %', old.status, new.status;
  end if;

  -- Superseding must NAME the successor. A report that quietly became
  -- "superseded" by nothing is an audit dead end.
  if new.status = 'SUPERSEDED' and new.superseded_by_id is null then
    raise exception 'superseding report % requires superseded_by_id', old.id;
  end if;
  if new.status = 'CANCELLED' and coalesce(btrim(new.cancel_reason), '') = '' then
    raise exception 'cancelling report % requires a reason', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aging_report_lifecycle on public.aging_report;
create trigger trg_aging_report_lifecycle before update on public.aging_report
  for each row execute function public.enforce_aging_report_lifecycle();

-- A finalized report is never deleted. Supersede or cancel it.
create or replace function public.prevent_final_aging_report_delete()
returns trigger language plpgsql as $$
begin
  if old.status in ('FINAL', 'SUPERSEDED') then
    raise exception 'aging report % is % and cannot be deleted', old.id, old.status;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_aging_report_no_delete on public.aging_report;
create trigger trg_aging_report_no_delete before delete on public.aging_report
  for each row execute function public.prevent_final_aging_report_delete();

-- Artifacts of a finalized report are evidence too.
create or replace function public.protect_aging_artifact()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.content_sha256 is distinct from old.content_sha256
       or new.storage_path is distinct from old.storage_path
       or new.report_id is distinct from old.report_id
       or new.format is distinct from old.format then
      raise exception 'aging artifact % is immutable', old.id;
    end if;
    return new;
  end if;
  raise exception 'aging artifact % may not be deleted', old.id;
end;
$$;

drop trigger if exists trg_aging_artifact_protect on public.aging_report_artifact;
create trigger trg_aging_artifact_protect before update or delete on public.aging_report_artifact
  for each row execute function public.protect_aging_artifact();

-- A template version that any report pins may not be edited or removed. This is
-- what makes "template changes do not alter existing snapshots" true rather than
-- merely intended.
-- Same NEW-is-unassigned rule as above: deleting an UNPINNED template would
-- otherwise fall through to `coalesce(new, old)` and fail with an error about
-- record assignment rather than succeeding.
create or replace function public.protect_pinned_aging_template()
returns trigger language plpgsql as $$
declare pinned boolean;
begin
  select exists (select 1 from public.aging_report r where r.template_id = old.id) into pinned;

  if tg_op = 'DELETE' then
    if pinned then
      raise exception 'template version % is pinned by an existing report', old.id;
    end if;
    return old;
  end if;

  if pinned
     and (new.config is distinct from old.config
          or new.renderer_key is distinct from old.renderer_key
          or new.version is distinct from old.version
          or new.code is distinct from old.code) then
    raise exception 'template version % is pinned by an existing report and is immutable', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aging_template_protect on public.aging_template_version;
create trigger trg_aging_template_protect before update or delete on public.aging_template_version
  for each row execute function public.protect_pinned_aging_template();

-- ===========================================================================
-- 10. CROSS-TENANT INTEGRITY
-- ===========================================================================
-- Every child row must belong to the same tenant as its parent. Foreign keys
-- alone do not say that, and the service role bypasses RLS.
create or replace function public.enforce_aging_tenant_match()
returns trigger language plpgsql as $$
declare parent_tenant uuid;
begin
  if tg_argv[0] = 'report' then
    select tenant_id into parent_tenant from public.aging_report where id = new.report_id;
  elsif tg_argv[0] = 'artifact' then
    select tenant_id into parent_tenant from public.aging_report_artifact where id = new.artifact_id;
  elsif tg_argv[0] = 'batch' then
    select tenant_id into parent_tenant from public.legacy_import_batch where id = new.batch_id;
  elsif tg_argv[0] = 'invoice' then
    select tenant_id into parent_tenant from public.invoice where id = new.invoice_id;
  end if;
  if new.tenant_id is distinct from parent_tenant then
    raise exception 'aging tenant mismatch (parent=%, given=%)', parent_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_aging_row_tenant on public.aging_report_row;
create trigger trg_aging_row_tenant before insert or update on public.aging_report_row
  for each row execute function public.enforce_aging_tenant_match('report');
drop trigger if exists trg_aging_totals_tenant on public.aging_report_totals;
create trigger trg_aging_totals_tenant before insert or update on public.aging_report_totals
  for each row execute function public.enforce_aging_tenant_match('report');
drop trigger if exists trg_aging_artifact_tenant on public.aging_report_artifact;
create trigger trg_aging_artifact_tenant before insert or update on public.aging_report_artifact
  for each row execute function public.enforce_aging_tenant_match('report');
drop trigger if exists trg_aging_share_tenant on public.aging_report_share;
create trigger trg_aging_share_tenant before insert or update on public.aging_report_share
  for each row execute function public.enforce_aging_tenant_match('artifact');
drop trigger if exists trg_staging_tenant on public.legacy_import_staging_row;
create trigger trg_staging_tenant before insert or update on public.legacy_import_staging_row
  for each row execute function public.enforce_aging_tenant_match('batch');
drop trigger if exists trg_import_error_tenant on public.legacy_import_error;
create trigger trg_import_error_tenant before insert or update on public.legacy_import_error
  for each row execute function public.enforce_aging_tenant_match('batch');
drop trigger if exists trg_legacy_link_tenant on public.legacy_receivable_link;
create trigger trg_legacy_link_tenant before insert on public.legacy_receivable_link
  for each row execute function public.enforce_aging_tenant_match('invoice');

-- A legacy receivable may only be linked to a dossier of its OWN tenant.
create or replace function public.enforce_legacy_link_file_tenant()
returns trigger language plpgsql as $$
declare f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.new_file_id;
  if f_tenant is distinct from new.tenant_id then
    raise exception 'legacy link refused: dossier belongs to tenant %, invoice to %', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_legacy_link_file_tenant on public.legacy_receivable_link;
create trigger trg_legacy_link_file_tenant before insert on public.legacy_receivable_link
  for each row execute function public.enforce_legacy_link_file_tenant();

-- The staging row's matched dossier must likewise be same-tenant.
create or replace function public.enforce_staging_file_tenant()
returns trigger language plpgsql as $$
declare f_tenant uuid;
begin
  if new.matched_file_id is null then return new; end if;
  select tenant_id into f_tenant from public.operational_file where id = new.matched_file_id;
  if f_tenant is distinct from new.tenant_id then
    raise exception 'staging row refused: dossier belongs to tenant %, batch to %', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staging_file_tenant on public.legacy_import_staging_row;
create trigger trg_staging_file_tenant before insert or update on public.legacy_import_staging_row
  for each row execute function public.enforce_staging_file_tenant();

-- ===========================================================================
-- 11. RLS — SELECT-only for `authenticated`, writes via service-role actions
-- ===========================================================================
-- Identical posture to every other finance table: reads are tenant-scoped and
-- permission-gated; there are NO insert/update/delete policies, so writes are
-- only possible through server actions behind assertPermission().
alter table public.aging_template_version    enable row level security;
alter table public.aging_report              enable row level security;
alter table public.aging_report_row          enable row level security;
alter table public.aging_report_totals       enable row level security;
alter table public.aging_report_artifact     enable row level security;
alter table public.aging_report_share        enable row level security;
alter table public.legacy_import_batch       enable row level security;
alter table public.legacy_import_staging_row enable row level security;
alter table public.legacy_import_error       enable row level security;
alter table public.legacy_receivable_link    enable row level security;

create policy aging_template_select on public.aging_template_version
  for select to authenticated
  using ((tenant_id is null or tenant_id = public.auth_tenant_id())
         and public.has_permission('finance:aging:read'));

create policy aging_report_select on public.aging_report
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:read'));

create policy aging_report_row_select on public.aging_report_row
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:read'));

create policy aging_report_totals_select on public.aging_report_totals
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:read'));

create policy aging_report_artifact_select on public.aging_report_artifact
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:read'));

-- Share links carry a token hash and a recipient. Only the roles that may create
-- them may read them, and there is NO anon policy: the public download route
-- resolves a token through the service role with a uniform 404.
create policy aging_report_share_select on public.aging_report_share
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:share'));

create policy legacy_batch_select on public.legacy_import_batch
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:import_stage'));

create policy legacy_staging_select on public.legacy_import_staging_row
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:import_stage'));

create policy legacy_error_select on public.legacy_import_error
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:import_stage'));

create policy legacy_link_select on public.legacy_receivable_link
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:aging:read'));

grant select on
  public.aging_template_version,
  public.aging_report,
  public.aging_report_row,
  public.aging_report_totals,
  public.aging_report_artifact,
  public.aging_report_share,
  public.legacy_import_batch,
  public.legacy_import_staging_row,
  public.legacy_import_error,
  public.legacy_receivable_link
to authenticated;

-- ===========================================================================
-- 12. PERMISSIONS
-- ===========================================================================
-- Ratified codes use a fourth segment (finance:aging:draft:create). The repo's
-- enforced convention is module:action[:scope] — three segments, [a-z_] only
-- (tests/role-templates.test.ts). The compound actions therefore carry an
-- underscore, exactly as admin:users:reset_password did on 2026-07-29. The
-- semantics are the ratified ones; only the separator differs.
insert into public.permission (code, module, action, data_scope, description) values
  ('finance:aging:read',            'finance_aging', 'read',             'all', 'Consulter la balance âgée'),
  ('finance:aging:draft_create',    'finance_aging', 'draft_create',     'all', 'Créer un brouillon de balance âgée'),
  ('finance:aging:draft_update',    'finance_aging', 'draft_update',     'all', 'Modifier un brouillon de balance âgée'),
  ('finance:aging:import_stage',    'finance_aging', 'import_stage',     'all', 'Préparer et valider un import de créances historiques'),
  ('finance:aging:import_approve',  'finance_aging', 'import_approve',   'all', 'Approuver un lot d''import dans le grand livre clients'),
  ('finance:aging:validate',        'finance_aging', 'validate',         'all', 'Valider une balance âgée'),
  ('finance:aging:finalize',        'finance_aging', 'finalize',         'all', 'Finaliser une balance âgée'),
  ('finance:aging:export',          'finance_aging', 'export',           'all', 'Exporter une balance âgée (Excel / PDF)'),
  ('finance:aging:print',           'finance_aging', 'print',            'all', 'Imprimer une balance âgée'),
  ('finance:aging:share',           'finance_aging', 'share',            'all', 'Partager en externe une balance âgée finalisée'),
  ('finance:aging:template_manage', 'finance_aging', 'template_manage',  'all', 'Administrer les modèles de balance âgée')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Grants — ratified matrix, least privilege, no tenant filter (backfill).
--
-- SYSTEM_ADMIN administers the platform; it does NOT approve imports, validate,
-- finalize, or share. Administering a system is not financial signoff authority,
-- and granting it "so an admin can unblock things" is exactly how maker-checker
-- becomes decorative. Technical recovery uses the existing audited override.
-- ---------------------------------------------------------------------------
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:read'
where r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CEO', 'SYSTEM_ADMIN')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:draft_create', 'finance:aging:draft_update')
where r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'DAF', 'SYSTEM_ADMIN')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:import_stage'
where r.code in ('ACCOUNTANT', 'DAF', 'SYSTEM_ADMIN')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:import_approve'
where r.code in ('DAF', 'DGA')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:validate', 'finance:aging:finalize')
where r.code in ('DAF', 'DGA')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:aging:export', 'finance:aging:print')
where r.code in ('FINANCE_OFFICER', 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CEO', 'SYSTEM_ADMIN')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:share'
where r.code in ('DAF', 'DGA')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:aging:template_manage'
where r.code = 'DAF'
on conflict do nothing;

-- ===========================================================================
-- 13. NO COMPATIBILITY FALLBACK
-- ===========================================================================
-- Deliberately none. The admin:users:* split needed one because it NARROWED an
-- existing capability that tenants already exercised — without a fallback a
-- deploy would have locked administrators out between ship and migrate. Nothing
-- here narrows anything: the Aging Balance does not exist yet, so no role can be
-- locked out of it, and no broader legacy finance permission (finance:read,
-- finance:validate, …) is accepted as a substitute.
--
-- That matters most for the four authorities the ratification protects —
-- validate, finalize, import_approve and share. A fallback to finance:validate
-- would have handed finalization to every FINANCE_OFFICER by accident. There is
-- no such path: those four codes are the ONLY way in.
comment on column public.aging_report.status is
  'DRAFT -> VALIDATED -> FINAL, with FINAL -> SUPERSEDED for a re-issue. '
  'VALIDATED may return to DRAFT for correction. CANCELLED requires a reason. '
  'Rows and totals freeze at VALIDATED; FINAL and SUPERSEDED reports cannot be '
  'deleted. Later payments produce a NEW report, never an edit to a signed one.';
