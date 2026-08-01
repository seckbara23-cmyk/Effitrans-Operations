-- 20260801000001_hr_organization_foundation.sql
-- Effitrans HR Platform — HR-1: Organization Foundation (frozen architecture HR-0F).
-- ---------------------------------------------------------------------------
-- ADDITIVE ONLY. No existing table is altered destructively; the one ALTER-adjacent
-- change is a new TRIGGER on public.employee (number immutability — a hardening
-- item named by HR-0R). Everything ships DARK:
--
--   * the two new permission codes are CATALOG ROWS GRANTED TO NO ROLE — the
--     FIN-AGING-2 idiom. HRQ-D2 (ceiling 9 → 11) is NOT yet ratified; activation
--     is one INSERT in a later grant migration. Until then the configuration
--     workspace denies everyone by construction.
--   * org tables start EMPTY (B2 — the tenant's real structure — is a pending
--     management answer; the wizard is the permanent entry point for it).
--   * the import pipeline stops at READY. Nothing applies staged rows to real
--     tables in HR-1 (activation gated by HRQ-A4 among others).
--
-- Two hierarchies, never conflated (ratified addendum §5): platform navigation
-- (fixed 4-code registry, WES-3) is NOT this. hr_org_unit is the tenant's real
-- employer structure; Company is the organization row itself.
-- ===========================================================================

-- ===========================================================================
-- 1. PERMISSIONS — catalog only, granted to NOBODY (B1 pause, stated above)
-- ===========================================================================
insert into public.permission (code, module, action, scope, description) values
  ('hr:config:manage',  'hr', 'config_manage',  'all',
   'Administrer la configuration RH (centre de configuration / assistant)'),
  ('hr:sensitive:read', 'hr', 'sensitive_read', 'all',
   'Consulter les données RH sensibles (réservé — activé par ratification HRQ-D2)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. hr_configuration — one row per tenant; DRAFT → ACTIVE. The permanent
--    configuration record the wizard edits (never a one-time setup).
--    Vocabularies are CONFIGURATION with ratified seeds:
--      * employment_kinds — HRQ-ID1 seed (EMPLOYEE first; the rest pending)
--      * termination_reasons — HRQ-D1 (empty until ratified; engine-agnostic)
-- ===========================================================================
create table if not exists public.hr_configuration (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id) unique,
  status                    text not null default 'DRAFT'
                              check (status in ('DRAFT', 'ACTIVE')),
  -- Employee numbering (engine EXISTS: employee_counter + next_employee_number).
  -- HR-1 configures; it never re-numbers (immutability trigger below).
  employee_number_keep_existing boolean not null default true,
  employee_number_prefix    text,
  employment_kinds          jsonb not null default '["EMPLOYEE"]'::jsonb,
  termination_reasons       jsonb not null default '[]'::jsonb,
  activated_by              uuid references public.app_user (id),
  activated_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

drop trigger if exists trg_hr_configuration_updated_at on public.hr_configuration;
create trigger trg_hr_configuration_updated_at before update on public.hr_configuration
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. hr_org_unit — the tenant-configurable employer structure.
--    Company = the organization row; four unit kinds below it, strictly
--    descending (trigger). canonical_department is a NULLABLE interop mapping
--    to the fixed 4-code platform registry — cross-cutting units map to nothing.
--    Flag-inactive, never deleted once referenced (is_active).
-- ===========================================================================
create table if not exists public.hr_org_unit (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  parent_id             uuid references public.hr_org_unit (id),
  unit_kind             text not null
                          check (unit_kind in ('BUSINESS_UNIT', 'DEPARTMENT', 'SECTION', 'TEAM')),
  name                  text not null,
  code                  text,
  canonical_department  text
                          check (canonical_department is null or canonical_department in
                                 ('OPERATIONS', 'TRANSIT', 'FINANCE', 'HUMAN_RESOURCES')),
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists uq_hr_org_unit_code
  on public.hr_org_unit (tenant_id, code) where code is not null;
create index if not exists idx_hr_org_unit_tenant_parent
  on public.hr_org_unit (tenant_id, parent_id);

drop trigger if exists trg_hr_org_unit_updated_at on public.hr_org_unit;
create trigger trg_hr_org_unit_updated_at before update on public.hr_org_unit
  for each row execute function public.set_updated_at();

-- Kind order must STRICTLY DESCEND along the parent chain (ratified §5): a
-- parent's kind must rank ABOVE the child's. Roots are allowed for any kind
-- (a small tenant may have departments and no business units). Depth beyond
-- the four kinds is impossible by construction. Same-tenant parentage enforced.
create or replace function public.hr_org_unit_check_parent()
returns trigger
language plpgsql
as $$
declare
  parent_kind text;
  parent_tenant uuid;
  rank_child int;
  rank_parent int;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'une unité ne peut pas être son propre parent';
  end if;
  select unit_kind, tenant_id into parent_kind, parent_tenant
    from public.hr_org_unit where id = new.parent_id;
  if parent_kind is null then
    raise exception 'unité parente introuvable';
  end if;
  if parent_tenant <> new.tenant_id then
    raise exception 'l''unité parente appartient à une autre organisation';
  end if;
  rank_child  := array_position(array['BUSINESS_UNIT','DEPARTMENT','SECTION','TEAM'], new.unit_kind);
  rank_parent := array_position(array['BUSINESS_UNIT','DEPARTMENT','SECTION','TEAM'], parent_kind);
  if rank_parent >= rank_child then
    raise exception 'hiérarchie invalide : % ne peut pas être rattaché à %', new.unit_kind, parent_kind;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hr_org_unit_parent on public.hr_org_unit;
create trigger trg_hr_org_unit_parent before insert or update on public.hr_org_unit
  for each row execute function public.hr_org_unit_check_parent();

-- ===========================================================================
-- 4. hr_position — the job-title catalog (ONE entity: "position" and "job
--    title" are the same catalog per the freeze; instantiation per employee is
--    employee_assignment). Flag-inactive, never deleted.
-- ===========================================================================
create table if not exists public.hr_position (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  title       text not null,
  code        text,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, title)
);

drop trigger if exists trg_hr_position_updated_at on public.hr_position;
create trigger trg_hr_position_updated_at before update on public.hr_position
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 5. hr_work_location — physical sites (a « branch » in the physical sense;
--    the organizational sense is a BUSINESS_UNIT — frozen Audit 2).
-- ===========================================================================
create table if not exists public.hr_work_location (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  name       text not null,
  city       text,
  country    text not null default 'SN',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

drop trigger if exists trg_hr_work_location_updated_at on public.hr_work_location;
create trigger trg_hr_work_location_updated_at before update on public.hr_work_location
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 6. employee_assignment — dated placement (unit, position, manager, location,
--    kind). ONE open PRIMARY row per employee; history by append-and-close
--    (close = set effective_to; rows are never deleted). Materializes the
--    reporting structure: manager_employee_id is the single management line —
--    display/organizational only, it grants no data access (DEC-B63).
--    Dotted-line reporting is HRQ-OD2 — deliberately NOT a column here.
-- ===========================================================================
create table if not exists public.employee_assignment (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  employee_id          uuid not null references public.employee (id),
  org_unit_id          uuid references public.hr_org_unit (id),
  position_id          uuid references public.hr_position (id),
  work_location_id     uuid references public.hr_work_location (id),
  manager_employee_id  uuid references public.employee (id),
  assignment_kind      text not null default 'PRIMARY'
                         check (assignment_kind in ('PRIMARY', 'ACTING', 'TEMPORARY')),
  effective_from       date not null default current_date,
  effective_to         date,
  note                 text,
  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  constraint assignment_not_own_manager
    check (manager_employee_id is null or manager_employee_id <> employee_id),
  constraint assignment_dates_ordered
    check (effective_to is null or effective_to >= effective_from)
);

create unique index if not exists uq_employee_open_primary_assignment
  on public.employee_assignment (employee_id)
  where effective_to is null and assignment_kind = 'PRIMARY';
create index if not exists idx_assignment_tenant_unit
  on public.employee_assignment (tenant_id, org_unit_id);

-- ===========================================================================
-- 7. hr_employee_event — the Employee Timeline ledger (ratified §7).
--    Append-only via the WES-9 prevent_mutation idiom. C3 values NEVER appear
--    in payloads (a salary revision is kind + date, never the amount).
--    HR-1 ships the foundation; domain writes begin emitting in HR-2.
-- ===========================================================================
create table if not exists public.hr_employee_event (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  employee_id uuid not null references public.employee (id),
  event_kind  text not null,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references public.app_user (id),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_hr_event_employee
  on public.hr_employee_event (tenant_id, employee_id, occurred_at desc);

drop trigger if exists trg_hr_employee_event_immutable on public.hr_employee_event;
create trigger trg_hr_employee_event_immutable
  before update or delete on public.hr_employee_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 8. EMPLOYEE NUMBER IMMUTABILITY — the HR-0R hardening item. The matricule is
--    an identity fact; once minted it never changes (renumbering policy is a
--    B2/configuration question and would be a NEW governed mechanism, never an
--    UPDATE). UPDATE-only trigger: OLD and NEW are both defined (the WES-9A
--    DELETE-trigger trap does not apply).
-- ===========================================================================
create or replace function public.employee_number_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.employee_number is distinct from old.employee_number then
    raise exception 'le matricule % est immuable', old.employee_number;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employee_number_immutable on public.employee;
create trigger trg_employee_number_immutable before update on public.employee
  for each row execute function public.employee_number_immutable();

-- ===========================================================================
-- 9. IMPORT FOUNDATION — staging ONLY (Upload → Stage → Mapping → Validation
--    → Preview → Maker-Checker → READY, and STOP). The generalized pipeline
--    (addendum §3), shaped on the proven FIN-AGING-2 tables. No hr_* row is
--    ever created FROM a batch in HR-1 — there is deliberately no
--    "applied/accepted" state and no created_* column to hold one.
--    Staging `raw` retention is HRQ-A4 (legal) — activation-blocking, not
--    schema-blocking.
-- ===========================================================================
create table if not exists public.hr_import_batch (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  batch_number       text not null,
  import_kind        text not null
                       check (import_kind in ('ORG_UNITS', 'POSITIONS', 'WORK_LOCATIONS')),
  source_filename    text,
  source_file_sha256 text,
  status             text not null default 'STAGED'
                       check (status in ('STAGED', 'VALIDATED', 'SUBMITTED', 'READY', 'REJECTED', 'CANCELLED')),
  mapping            jsonb not null default '{}'::jsonb,
  row_count          int not null default 0,
  error_count        int not null default 0,
  prepared_by        uuid references public.app_user (id),
  prepared_at        timestamptz not null default now(),
  submitted_by       uuid references public.app_user (id),
  submitted_at       timestamptz,
  approved_by        uuid references public.app_user (id),
  approved_at        timestamptz,
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, batch_number),
  -- Maker-checker is STRUCTURAL: the approver must differ from the submitter.
  constraint hr_batch_approver_differs
    check (approved_by is null or submitted_by is null or approved_by <> submitted_by),
  -- READY is unreachable without an approval on record.
  constraint hr_batch_ready_requires_approval
    check (status <> 'READY' or approved_by is not null)
);

drop trigger if exists trg_hr_import_batch_updated_at on public.hr_import_batch;
create trigger trg_hr_import_batch_updated_at before update on public.hr_import_batch
  for each row execute function public.set_updated_at();

create table if not exists public.hr_import_staging_row (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  batch_id          uuid not null references public.hr_import_batch (id) on delete cascade,
  source_row_number int not null,
  raw               jsonb not null,
  parsed            jsonb,
  status            text not null default 'PENDING'
                      check (status in ('PENDING', 'VALID', 'REJECTED')),
  unique (batch_id, source_row_number)
);

create index if not exists idx_hr_staging_batch on public.hr_import_staging_row (batch_id);

create table if not exists public.hr_import_error (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  batch_id       uuid not null references public.hr_import_batch (id) on delete cascade,
  staging_row_id uuid references public.hr_import_staging_row (id) on delete cascade,
  field          text,
  code           text not null,
  message_fr     text not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_hr_import_error_batch on public.hr_import_error (batch_id);

-- ===========================================================================
-- 10. RLS — uniform idiom: SELECT-only to tenant staff holding the gate;
--     ALL writes via service-role actions in lib/hr. No portal policies.
--     SYSTEM_ADMIN holds no hr:* (DEC-B25), so it reads none of this.
-- ===========================================================================
alter table public.hr_configuration     enable row level security;
alter table public.hr_org_unit          enable row level security;
alter table public.hr_position          enable row level security;
alter table public.hr_work_location     enable row level security;
alter table public.employee_assignment  enable row level security;
alter table public.hr_employee_event    enable row level security;
alter table public.hr_import_batch      enable row level security;
alter table public.hr_import_staging_row enable row level security;
alter table public.hr_import_error      enable row level security;

drop policy if exists hr_configuration_select on public.hr_configuration;
create policy hr_configuration_select on public.hr_configuration
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_org_unit_select on public.hr_org_unit;
create policy hr_org_unit_select on public.hr_org_unit
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_position_select on public.hr_position;
create policy hr_position_select on public.hr_position
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_work_location_select on public.hr_work_location;
create policy hr_work_location_select on public.hr_work_location
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists employee_assignment_select on public.employee_assignment;
create policy employee_assignment_select on public.employee_assignment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_employee_event_select on public.hr_employee_event;
create policy hr_employee_event_select on public.hr_employee_event
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

-- Staging is HR working data, not directory data: readable by hr:manage only.
drop policy if exists hr_import_batch_select on public.hr_import_batch;
create policy hr_import_batch_select on public.hr_import_batch
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:manage'));

drop policy if exists hr_import_staging_row_select on public.hr_import_staging_row;
create policy hr_import_staging_row_select on public.hr_import_staging_row
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:manage'));

drop policy if exists hr_import_error_select on public.hr_import_error;
create policy hr_import_error_select on public.hr_import_error
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:manage'));

grant select on public.hr_configuration,     public.hr_org_unit,
                public.hr_position,          public.hr_work_location,
                public.employee_assignment,  public.hr_employee_event,
                public.hr_import_batch,      public.hr_import_staging_row,
                public.hr_import_error
  to authenticated;

-- ===========================================================================
-- 11. NO GRANTS, NO SEEDS — restated so nobody "fixes" it. hr:config:manage
--     and hr:sensitive:read are granted to no role until HRQ-D2 is ratified
--     (activation = one INSERT in a grant migration). Org tables stay empty
--     until the tenant's structure answers (B2) arrive through the wizard.
-- ===========================================================================
