-- 20260613000001_create_foundation_tables.sql
-- Effitrans Operations Platform — FOUNDATION tables (Wave 2)
-- Tasks: S0-DB-2 (organization), S0-DB-3 (audit_log), S0-AUTH-2 (app_user).
-- Decisions: DEC-A06 (Supabase), DEC-A12 (SQL migrations), DEC-C01 (tenant_id + RLS).
--
-- SCOPE GUARD: foundation only. NO operational_file / document / customs /
-- workflow / transport / notification tables. No file numbering, expiry engine,
-- portal, or business-domain logic. Full business RLS is deferred to Wave 3+.

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid()

-- Generic helper functions --------------------------------------------------

-- Maintain updated_at on row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Hard append-only guard: block UPDATE/DELETE for ALL roles (incl. service role).
create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table: % is not permitted on %', tg_op, tg_table_name;
end;
$$;

-- organization (tenant root) ------------------------------------------------
create table public.organization (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  country         text,
  storage_region  text,                 -- PROVISIONAL per BLK-9 (DEC-A06)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_organization_updated_at
  before update on public.organization
  for each row execute function public.set_updated_at();

-- app_user (profile, 1:1 with auth.users; DEC-B16 default) -------------------
create table public.app_user (
  id              uuid primary key references auth.users (id) on delete cascade,
  tenant_id       uuid not null references public.organization (id),
  email           text not null,
  name            text,
  status          text not null default 'active'
                    check (status in ('active', 'inactive')),
  is_system_admin boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_app_user_tenant on public.app_user (tenant_id);
create unique index uq_app_user_email_per_tenant on public.app_user (tenant_id, email);

-- Enforce a single System Admin per tenant (DEC-B12 governance).
create unique index uq_app_user_single_admin
  on public.app_user (tenant_id)
  where is_system_admin;

create trigger trg_app_user_updated_at
  before update on public.app_user
  for each row execute function public.set_updated_at();

-- audit_log (APPEND-ONLY) ----------------------------------------------------
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid references public.organization (id),
  actor_id        uuid references public.app_user (id),
  action          text not null,
  entity          text,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  override_reason text,
  occurred_at     timestamptz not null default now()
);

create index idx_audit_log_tenant on public.audit_log (tenant_id);
create index idx_audit_log_occurred_at on public.audit_log (occurred_at);
create index idx_audit_log_entity on public.audit_log (entity, entity_id);

-- Append-only by design: UPDATE and DELETE are hard-blocked for everyone.
create trigger trg_audit_log_no_update
  before update on public.audit_log
  for each row execute function public.prevent_mutation();
create trigger trg_audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.prevent_mutation();

-- RLS baseline (safe + minimal — NOT full business RLS) ----------------------
-- Enabling RLS with no permissive write policy denies anon/authenticated writes
-- by default. Foundation writes (provisioning, audit inserts) run server-side
-- via the service role, which bypasses RLS, until per-request tenant/role
-- context is wired in Wave 3 (AUTH-3 / RLS-1).
alter table public.organization enable row level security;
alter table public.app_user     enable row level security;
alter table public.audit_log    enable row level security;

-- A user may read their own profile.
create policy app_user_select_self
  on public.app_user for select
  to authenticated
  using (id = auth.uid());

-- A user may read their own organization.
create policy organization_select_own
  on public.organization for select
  to authenticated
  using (id = (select u.tenant_id from public.app_user u where u.id = auth.uid()));

-- A user may read audit rows for their own tenant.
create policy audit_log_select_own_tenant
  on public.audit_log for select
  to authenticated
  using (tenant_id = (select u.tenant_id from public.app_user u where u.id = auth.uid()));
