-- 20260724000002_hr_employee_registry.sql
-- Effitrans Operations Platform — PHASE HR-1: Employee Registry.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Introduces the Human Resources bounded context ratified in the HR-0
-- audit (docs/hr/hr-0-architecture-audit.md; decisions DEC-B23..B27):
--   * two permissions — hr:read (directory + employment data) and hr:manage
--     (create/update/lifecycle/account-link) — module 'hr';
--   * the HR_OFFICER tenant role (the 25th), mapped to the HUMAN_RESOURCES
--     canonical department (mapping is metadata in lib/organization/
--     departments.ts — never stored as a column, never grants authorization);
--   * public.employee — the EMPLOYMENT RECORD, deliberately SEPARATE from the
--     authentication identity (auth.users), tenant membership (app_user), and
--     org metadata (departments registry). An employee MAY exist with no login
--     (DEC-B23); the optional link to app_user is tenant-matched, at most 1:1,
--     grants nothing, and unlinking deletes nothing.
--   * employee_counter + next_employee_number() — per-tenant×year matricules.
--
-- DELIBERATELY ABSENT FOREVER (DEC-B27): salary/compensation, national ID /
-- passport, date of birth / gender / marital status, medical data. Those belong
-- to separately-restricted future domains (compensation → HR-7 behind
-- hr:compensation:*; documents → HR-2 in a dedicated private bucket).
--
-- SYSTEM_ADMIN RECEIVES NO hr:* PERMISSION (DEC-B25) — a deliberate exception to
-- the platform's full-admin grant convention: SYSTEM_ADMIN administers ACCOUNTS
-- (/users), not PEOPLE. The RLS below therefore returns ZERO employee rows to a
-- SYSTEM_ADMIN who lacks hr:read (proved by supabase/tests/rls_hr_employee_test.sql).
--
-- Clean-replay safe: the role insert is a guarded backfill and grants are
-- select-driven (they match zero rows on an empty DB, where supabase/seed.sql
-- owns creation); on production (tenant 00000000-…-0001 present) they materialize.
-- NO storage bucket, NO second table beyond employee + its counter, NO existing
-- role/permission/grant modified.

-- ===========================================================================
-- 1. Permission catalog (GLOBAL reference data — no tenant).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:read',   'hr', 'read',   'all', 'Consulter le registre du personnel (annuaire et données d''emploi)'),
  ('hr:manage', 'hr', 'manage', 'all', 'Gérer le personnel : création, modification, cycle de vie, liaison de compte')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Matricule counter (INTERNAL — numbering only; locked down, no RLS
--    policies/grants). Mirrors public.file_counter.
-- ===========================================================================
create table public.employee_counter (
  tenant_id uuid not null references public.organization (id),
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.employee_counter enable row level security;
-- No policies, no grants: only the security-definer function / service role writes it.

-- Concurrency-safe next matricule. ON CONFLICT ... RETURNING locks the row so
-- concurrent callers serialize; gaps are allowed (a consumed number is never
-- reused). Format: EMP-{YEAR}-{4-digit sequence}, e.g. EMP-2026-0001.
create or replace function public.next_employee_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into public.employee_counter (tenant_id, year, next_seq)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year)
    do update set next_seq = employee_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'EMP-' || v_year::text || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

revoke execute on function public.next_employee_number(uuid) from public;
grant execute on function public.next_employee_number(uuid) to service_role;

-- ===========================================================================
-- 3. employee — the employment record.
-- ===========================================================================
create table public.employee (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  employee_number        text not null,

  -- Optional link to a platform account. NULL for employees with no login
  -- (DEC-B23). Tenant-match + one-employee-per-account enforced below. Linking
  -- grants NO role/permission; unlinking (ON DELETE SET NULL) deletes nothing.
  linked_app_user_id     uuid references public.app_user (id) on delete set null,

  -- Person. Names are the only mandatory identity; contacts are optional.
  first_name             text not null,
  last_name              text not null,
  preferred_name         text,
  professional_email     text,
  personal_email         text,
  professional_phone     text,
  personal_phone         text,
  emergency_contact_name text,
  emergency_contact_phone text,

  -- Employment. department is a CANONICAL code (metadata, not authorization);
  -- job_title is HR-owned free text (distinct from the Brand Center's).
  department             text not null check (department in
                           ('OPERATIONS', 'TRANSIT', 'FINANCE', 'HUMAN_RESOURCES')),
  job_title              text,
  -- Display-only reporting line in HR-1 (grants no access; manager access to
  -- direct reports is deferred to HR-3+). Self-reference disallowed.
  manager_employee_id    uuid references public.employee (id) on delete set null,
  work_location          text,
  -- Vocabulary PROVISIONAL pending Senegal legal review (DEC-B27); the CHECK is
  -- widenable additively without data migration.
  employment_type        text check (employment_type is null or employment_type in
                           ('CDI', 'CDD', 'STAGE', 'JOURNALIER', 'PRESTATAIRE', 'AUTRE')),
  hire_date              date,
  probation_end_date     date,
  termination_date       date,
  termination_reason     text,

  -- Employment lifecycle (DEC-B26). Pure transition table lives in lib/hr/
  -- lifecycle.ts; rehire creates a NEW record (TERMINATED never returns to ACTIVE).
  status                 text not null default 'DRAFT' check (status in
                           ('DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'ARCHIVED')),

  created_by             uuid references public.app_user (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint employee_not_own_manager check (manager_employee_id is null or manager_employee_id <> id)
);

create index idx_employee_tenant_status on public.employee (tenant_id, status);
create index idx_employee_tenant_dept   on public.employee (tenant_id, department);
create unique index uq_employee_number  on public.employee (tenant_id, employee_number);
-- One employee per platform account (the account may be linked to at most one
-- employee). Partial: many employees may have NO account.
create unique index uq_employee_linked_user on public.employee (linked_app_user_id)
  where linked_app_user_id is not null;
create index idx_employee_manager on public.employee (manager_employee_id)
  where manager_employee_id is not null;

create trigger trg_employee_updated_at before update on public.employee
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. Tenant integrity — defense-in-depth (mirrors the engine/finance triggers):
--    the linked account, the manager, and the creator must all share the row's
--    tenant. Makes cross-tenant links structurally impossible even under a bug.
-- ===========================================================================
create or replace function public.enforce_employee_tenant()
returns trigger language plpgsql as $$
declare
  t uuid;
begin
  if new.linked_app_user_id is not null then
    select tenant_id into t from public.app_user where id = new.linked_app_user_id;
    if t is distinct from new.tenant_id then
      raise exception 'employee linked account belongs to another tenant';
    end if;
  end if;
  if new.manager_employee_id is not null then
    select tenant_id into t from public.employee where id = new.manager_employee_id;
    if t is distinct from new.tenant_id then
      raise exception 'employee manager belongs to another tenant';
    end if;
  end if;
  if new.created_by is not null then
    select tenant_id into t from public.app_user where id = new.created_by;
    if t is distinct from new.tenant_id then
      raise exception 'employee creator belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_employee_tenant before insert or update on public.employee
  for each row execute function public.enforce_employee_tenant();

-- ===========================================================================
-- 5. RLS — SELECT-only for tenant staff holding hr:read. NO portal policy
--    (customers never read HR). NO grant to SYSTEM_ADMIN without hr:read
--    (DEC-B25). All writes go through the service-role actions in lib/hr.
-- ===========================================================================
alter table public.employee enable row level security;

create policy employee_select on public.employee
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('hr:read')
  );

grant select on public.employee to authenticated;

-- ===========================================================================
-- 6. HR_OFFICER role for the Effitrans tenant. Guarded backfill (no-op on an
--    empty database — seed.sql creates it there).
-- ===========================================================================
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', 'HR_OFFICER', 'Chargé RH', 'HR Officer', true
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- ===========================================================================
-- 7. HR_OFFICER grants — LEAST PRIVILEGE. Own profile (baseline) · hr:read +
--    hr:manage (the HR module) · messaging:read + messaging:send (staff can
--    message, matching every operational role; NO department inbox scope).
--    Deliberately NOT: admin:*, finance:*, process:*, any :delete authority.
--    NO hr:* is granted to SYSTEM_ADMIN or any other role (DEC-B25).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'hr:read', 'hr:manage',
                'messaging:read', 'messaging:send')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
