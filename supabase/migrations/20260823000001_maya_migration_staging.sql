-- ===========================================================================
-- MAYA-P0.5-C — MAYA migration staging foundation.
-- ---------------------------------------------------------------------------
-- Prepares the platform to RECEIVE, VALIDATE and RECONCILE future MAYA
-- exports. It does NOT import anything: the pipeline ends at human review.
--
--     MAYA offline export  →  RAW STAGING  →  NORMALISATION  →  VALIDATION
--                          →  READY / READY_WITH_WARNINGS / REJECTED  →  STOP
--
-- THE APPLY PATH DOES NOT EXIST, AND ITS ABSENCE IS STRUCTURAL, NOT POLICY:
--   * `maya_import_row` has NO column that could hold a created dossier
--     (contrast public.legacy_import_staging_row.created_invoice_id, which
--     exists precisely because THAT pipeline applies);
--   * `maya_import_batch` has no applied_at / applied_by;
--   * nothing here references public.operational_file or public.shipment.
--   Tests pin all three.
--
-- REUSE (MAYA-P0.5-A §2.11 + the HR precedent). This is the THIRD instance of
-- one established pattern — batch + verbatim staging rows + issue list, with
-- a sha256 of the source artifact and per-batch row uniqueness. It is not a
-- new framework:
--   * public.legacy_import_* (FIN-AGING) could not be extended: its staging
--     row is invoice-shaped and CHECK-bound to public.invoice;
--   * public.hr_import_* set the precedent that a new domain gets its own
--     tables on the same pattern rather than overloading another domain's.
--
-- AUTHORITY: `admin:config:manage`, which already exists and is already held
-- by SYSTEM_ADMIN. No new role, no new permission, no grant migration.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. maya_import_batch — one immutable migration batch per source artifact.
-- ---------------------------------------------------------------------------
create table if not exists public.maya_import_batch (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  batch_number          text not null,

  -- Source identity of the ARTEFACT (never a live connection: MAYA is read
  -- offline, and this platform has no MAYA client).
  source_system         text not null default 'MAYA' check (source_system = 'MAYA'),
  source_artifact       text,
  source_artifact_sha256 text,
  -- Only when the export itself carries it; never invented from clock time.
  source_extracted_at   timestamptz,

  status                text not null default 'STAGED'
                          check (status in ('STAGED', 'READY', 'READY_WITH_WARNINGS',
                                            'REJECTED', 'CANCELLED')),

  -- Reconciliation counters. `row_count` is what the artefact contained;
  -- the four outcome counters PARTITION it once validation has run.
  row_count             int not null default 0 check (row_count >= 0),
  valid_count           int not null default 0 check (valid_count >= 0),
  warning_count         int not null default 0 check (warning_count >= 0),
  rejected_count        int not null default 0 check (rejected_count >= 0),
  duplicate_count       int not null default 0 check (duplicate_count >= 0),
  -- An OVERLAY, not a partition member: a row with an unresolved client or
  -- parent reference is counted here AND in warning_count.
  unresolved_count      int not null default 0 check (unresolved_count >= 0),

  prepared_by           uuid references public.app_user (id),
  prepared_at           timestamptz not null default now(),
  reviewed_by           uuid references public.app_user (id),
  reviewed_at           timestamptz,
  review_note           text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (tenant_id, batch_number),

  -- NO SILENT LOSS, enforced by the database rather than by a report: once a
  -- batch reaches an outcome, every source row must be accounted for in
  -- exactly one of the four buckets.
  constraint maya_batch_reconciles check (
    status in ('STAGED', 'CANCELLED')
    or row_count = valid_count + warning_count + rejected_count + duplicate_count
  ),
  -- The unresolved overlay can never exceed the rows it overlays.
  constraint maya_batch_unresolved_within_warnings check (unresolved_count <= warning_count)
);

drop trigger if exists trg_maya_batch_updated_at on public.maya_import_batch;
create trigger trg_maya_batch_updated_at before update on public.maya_import_batch
  for each row execute function public.set_updated_at();

create index if not exists idx_maya_batch_tenant_status
  on public.maya_import_batch (tenant_id, status);

-- ---------------------------------------------------------------------------
-- 2. maya_import_row — one MAYA source record, preserved VERBATIM plus the
--    normalised candidates. Candidates are all nullable: a row that cannot be
--    normalised is still staged, still counted, and still reviewable.
-- ---------------------------------------------------------------------------
create table if not exists public.maya_import_row (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.organization (id),
  batch_id                uuid not null references public.maya_import_batch (id) on delete cascade,

  source_row_number       int not null,
  -- ---- lineage: enough to populate operational_file.legacy_reference
  --      deterministically in a future, separately ratified apply phase.
  source_table            text not null,
  source_record_id        text,
  source_dossier_reference text,
  source_parent_reference text,
  -- Deterministic identity of the row's CONTENT. Computed by a pure function
  -- (lib/maya/staging/identity.ts) so the same export always yields the same
  -- hash — the basis for duplicate detection within and across batches.
  -- NOT unique: a duplicate must be STAGED and COUNTED, never silently
  -- dropped, or reconciliation would lose it.
  source_row_hash         text not null,

  -- ---- verbatim payload
  raw                     jsonb not null,

  -- ---- normalised candidates (nullable throughout)
  source_type_label       text,
  normalized_direction    text check (normalized_direction is null
                            or normalized_direction in ('IMP', 'EXP', 'TRP', 'HND')),
  normalized_mode         text check (normalized_mode is null
                            or normalized_mode in ('SEA', 'AIR', 'ROAD', 'MULTIMODAL')),
  normalized_cargo_form   text check (normalized_cargo_form is null
                            or normalized_cargo_form in ('CONTAINER', 'BULK', 'PARCEL', 'GROUPAGE')),
  normalized_regime       text,
  -- UNRESOLVED is the honest outcome for REMISES DOCUMENTAIRES / AUTRES
  -- DOSSIERS (MAYA-0 could not decompose them) and for any label the
  -- taxonomy does not recognise. It is never an error.
  taxonomy_resolution     text not null default 'UNKNOWN'
                            check (taxonomy_resolution in ('RESOLVED', 'UNRESOLVED', 'UNKNOWN')),

  client_reference_raw    text,
  client_name_raw         text,
  -- A READ-ONLY match used by validation. Matching creates nothing.
  matched_client_id       uuid references public.client (id),

  opening_date            date,
  vessel_or_flight        text,
  bl_awb_ref              text,
  origin_raw              text,
  destination_raw         text,

  goods_description       text,
  goods_nature            text,
  supplier_name           text,
  cargo_quantity          numeric(14, 3),
  cargo_quantity_unit     text,
  net_weight_kg           numeric(14, 3),
  gross_weight_kg         numeric(14, 3),
  volume_m3               numeric(14, 3),
  package_count           integer,
  container_count         integer,
  container_numbers       jsonb,

  declaration_reference   text,
  warehouse_entry_date    date,
  processing_due_date     date,
  delivery_reference      text,

  parent_resolution       text not null default 'NONE'
                            check (parent_resolution in ('NONE', 'IN_BATCH', 'EXISTING_DOSSIER', 'UNRESOLVED')),

  status                  text not null default 'PENDING'
                            check (status in ('PENDING', 'VALID', 'WARNING', 'REJECTED', 'DUPLICATE')),

  created_at              timestamptz not null default now(),

  unique (batch_id, source_row_number)
);

create index if not exists idx_maya_row_batch_status
  on public.maya_import_row (batch_id, status);
create index if not exists idx_maya_row_hash
  on public.maya_import_row (tenant_id, source_row_hash);
create index if not exists idx_maya_row_dossier_ref
  on public.maya_import_row (tenant_id, source_dossier_reference)
  where source_dossier_reference is not null;

-- ---------------------------------------------------------------------------
-- 3. maya_import_issue — every validation finding, severity-tagged.
-- ---------------------------------------------------------------------------
create table if not exists public.maya_import_issue (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  batch_id     uuid not null references public.maya_import_batch (id) on delete cascade,
  row_id       uuid references public.maya_import_row (id) on delete cascade,
  severity     text not null check (severity in ('WARNING', 'ERROR')),
  code         text not null,
  field        text,
  message_fr   text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_maya_issue_batch on public.maya_import_issue (batch_id, severity);
create index if not exists idx_maya_issue_row on public.maya_import_issue (row_id);

-- ---------------------------------------------------------------------------
-- 4. Tenant integrity — a child's tenant must equal its batch's (mirrors the
--    enforce_shipment_tenant / staging-row idiom already in the schema).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_maya_child_tenant()
returns trigger language plpgsql as $$
declare
  parent_tenant uuid;
begin
  select tenant_id into parent_tenant
    from public.maya_import_batch where id = new.batch_id;
  if parent_tenant is null then
    raise exception 'migration batch not found';
  end if;
  if parent_tenant is distinct from new.tenant_id then
    raise exception 'migration staging row belongs to another tenant than its batch';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_maya_row_tenant on public.maya_import_row;
create trigger trg_maya_row_tenant before insert or update on public.maya_import_row
  for each row execute function public.enforce_maya_child_tenant();

drop trigger if exists trg_maya_issue_tenant on public.maya_import_issue;
create trigger trg_maya_issue_tenant before insert or update on public.maya_import_issue
  for each row execute function public.enforce_maya_child_tenant();

-- ---------------------------------------------------------------------------
-- 5. RLS — READ ONLY for administrators holding `admin:config:manage`; every
--    write goes through the service-role server actions. Mirrors the
--    legacy_import_* / hr_import_* policies exactly.
-- ---------------------------------------------------------------------------
alter table public.maya_import_batch enable row level security;
alter table public.maya_import_row   enable row level security;
alter table public.maya_import_issue enable row level security;

drop policy if exists maya_batch_select on public.maya_import_batch;
create policy maya_batch_select on public.maya_import_batch
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));

drop policy if exists maya_row_select on public.maya_import_row;
create policy maya_row_select on public.maya_import_row
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));

drop policy if exists maya_issue_select on public.maya_import_issue;
create policy maya_issue_select on public.maya_import_issue
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('admin:config:manage'));

grant select on public.maya_import_batch to authenticated;
grant select on public.maya_import_row   to authenticated;
grant select on public.maya_import_issue to authenticated;

comment on table public.maya_import_batch is
  'MAYA-P0.5-C — a MAYA migration staging batch. Review-only: there is no '
  'apply path in this phase, and no column that could record one.';
comment on column public.maya_import_row.source_row_hash is
  'Deterministic content identity from lib/maya/staging/identity.ts. NOT '
  'unique: a duplicate is staged and counted, never dropped.';
comment on column public.maya_import_row.taxonomy_resolution is
  'RESOLVED — the four dimensions were derived. UNRESOLVED — a MAYA type '
  'MAYA-0 deliberately did not decompose (REMISES DOCUMENTAIRES, AUTRES '
  'DOSSIERS). UNKNOWN — the label is not in the registry. None is an error.';

-- ---------------------------------------------------------------------------
-- 6. Assertions — including the ones that prove what this phase must NOT have.
-- ---------------------------------------------------------------------------
do $assert$
declare v_n int;
begin
  -- 6a. The three tables exist, with RLS enabled on all of them.
  if to_regclass('public.maya_import_batch') is null
     or to_regclass('public.maya_import_row') is null
     or to_regclass('public.maya_import_issue') is null then
    raise exception 'MAYA-P0.5-C: staging tables missing';
  end if;

  select count(*) into v_n from pg_class
   where oid in ('public.maya_import_batch'::regclass, 'public.maya_import_row'::regclass,
                 'public.maya_import_issue'::regclass)
     and relrowsecurity;
  if v_n <> 3 then
    raise exception 'MAYA-P0.5-C: RLS is not enabled on all three staging tables (%)', v_n;
  end if;

  -- 6b. THE APPLY PATH DOES NOT EXIST. No staging column may reference the
  --     operational tables, and no batch column may record an application.
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('maya_import_batch', 'maya_import_row', 'maya_import_issue')
     and (column_name like '%applied%' or column_name like '%created_file%'
          or column_name like '%operational_file%' or column_name like '%shipment%');
  if v_n <> 0 then
    raise exception 'MAYA-P0.5-C: a staging column suggests an apply path (% found)', v_n;
  end if;

  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class r on r.oid = c.confrelid
   where c.contype = 'f'
     and t.relname in ('maya_import_batch', 'maya_import_row', 'maya_import_issue')
     and r.relname in ('operational_file', 'shipment', 'process_instance', 'invoice');
  if v_n <> 0 then
    raise exception 'MAYA-P0.5-C: staging references an operational table (% FKs)', v_n;
  end if;

  -- 6c. Tenant guards installed.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.maya_import_row'::regclass
                   and tgname = 'trg_maya_row_tenant' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.maya_import_issue'::regclass
                      and tgname = 'trg_maya_issue_tenant' and not tgisinternal) then
    raise exception 'MAYA-P0.5-C: tenant guard trigger missing';
  end if;

  -- 6d. UNTOUCHED — this phase adds no permission and no role.
  select count(*) into v_n from public.permission where code like 'maya%';
  if v_n <> 0 then
    raise exception 'MAYA-P0.5-C: a MAYA-specific permission was created';
  end if;
  select count(*) into v_n from public.role where code like 'MAYA%';
  if v_n <> 0 then
    raise exception 'MAYA-P0.5-C: a MAYA-specific role was created';
  end if;

  -- 6e. UNTOUCHED — P0.5-B's dossier contract and the numbering behaviour.
  if to_regprocedure('public.next_file_number(uuid,text)') is null
     or to_regprocedure('public.next_file_number(uuid,text,uuid)') is null then
    raise exception 'MAYA-P0.5-C: a next_file_number overload disappeared';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.operational_file'::regclass
                   and tgname = 'trg_operational_file_parent' and not tgisinternal) then
    raise exception 'MAYA-P0.5-C: the P0.5-B parent guard disappeared';
  end if;
end
$assert$;
