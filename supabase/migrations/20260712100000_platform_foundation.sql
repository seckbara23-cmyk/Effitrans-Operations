-- 20260712100000_platform_foundation.sql
-- Effitrans Operations Platform — PHASE 4.0B-1: Platform administration boundary.
-- ---------------------------------------------------------------------------
-- Introduces a THIRD identity class (platform_admin) that is STRICTLY separate
-- from the tenant identities (app_user / client_user):
--   * platform_admin has NO tenant_id — it is NOT a tenant user.
--   * a tenant SYSTEM_ADMIN is NEVER a platform admin, and vice versa.
--   * no implicit inheritance in either direction; RLS is not weakened.
--
-- Platform RBAC (the platform:* namespace) is resolved in APPLICATION CODE from a
-- fixed role→permission map (lib/platform/roles.ts). Platform administration is a
-- small, operator-controlled surface, so it needs no second DB permission catalog
-- and must never reuse the tenant `permission` / `role_permission` tables.
--
-- SCOPE GUARD (4.0B-1): platform identity + audit attribution ONLY. No company
-- metadata, no branding, no platform routes/services (4.0B-3 / 4.0B-4).
-- Additive + forward-only + idempotent; no destructive backfill; no RLS weakening.

-- platform_admin (platform identity — NO tenant_id) --------------------------
create table if not exists public.platform_admin (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  name          text,
  platform_role text not null
                  check (platform_role in
                    ('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'PLATFORM_BILLING', 'PLATFORM_READ_ONLY')),
  status        text not null default 'active'
                  check (status in ('active', 'inactive')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_platform_admin_status on public.platform_admin (status);

create trigger trg_platform_admin_updated_at
  before update on public.platform_admin
  for each row execute function public.set_updated_at();

-- audit_log: attribute platform.* actions to a platform_admin (additive; mirrors
-- the existing additive client_user_id column). When a platform.* event sets
-- tenant_id, it references the TARGET tenant being administered.
alter table public.audit_log
  add column if not exists platform_actor_id uuid references public.platform_admin (id);

create index if not exists idx_audit_log_platform_actor
  on public.audit_log (platform_actor_id);

-- Helper: is the caller an ACTIVE platform admin? SECURITY INVOKER so the
-- platform_admin RLS still applies (the caller only ever sees their own row).
create or replace function public.auth_is_platform_admin()
returns boolean
language sql
stable
security invoker
as $$
  select exists (
    select 1 from public.platform_admin pa
    where pa.id = auth.uid() and pa.status = 'active'
  );
$$;

-- RLS: a platform admin may read ONLY their own row. Cross-admin listing and all
-- writes run via the service role (operator-controlled). NO tenant user can read
-- platform_admin — they are never the row's auth.uid(). The table has no
-- tenant_id and is intentionally outside tenant RLS entirely.
alter table public.platform_admin enable row level security;

create policy platform_admin_select_self
  on public.platform_admin for select
  to authenticated
  using (id = auth.uid());

-- Read-only grant for authenticated (RLS still restricts to the caller's own
-- row); NO write policy — platform user/role management runs via the service role.
grant select on public.platform_admin to authenticated;
grant execute on function public.auth_is_platform_admin() to authenticated;
