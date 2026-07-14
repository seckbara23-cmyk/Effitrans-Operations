-- ===========================================================================
-- BOOTSTRAP THE FIRST PLATFORM ADMIN — run ONCE, by hand, by the project owner.
-- ===========================================================================
--
-- WHY THIS SCRIPT HAS TO EXIST
--
-- Phase 5.0E-2A made a deliberate security decision: a tenant SYSTEM_ADMIN must not be
-- able to enable their own pilot. So public.tenant_process_rollout has NO insert/update/
-- delete RLS policy and NO write grant for `authenticated`. The only write path is a
-- service-role action gated on `platform:rollout:manage`, which only a
-- PLATFORM_SUPER_ADMIN holds.
--
-- What that phase did NOT ship was any way to CREATE the first platform admin. No
-- migration inserts one; seed.sql does not (it cannot — platform_admin FKs auth.users,
-- and no auth user exists at migration time); the application has no "promote" flow.
--
-- The result is a bootstrap deadlock:
--     only a platform admin can enable a tenant
--   → no platform admin exists
--   → nothing in the system can create one
--   → /platform/rollout is unreachable by every human alive
--   → the tenant can never be enabled.
--
-- That is the root cause of "Tenant Engine = false" with no way to change it.
--
-- Bootstrapping the first super-admin is inherently an OUT-OF-BAND act — it is true of
-- every system shaped like this, and it is a feature, not a gap: the only person who can
-- mint the first platform admin is whoever holds the database. That is you. Which is why
-- this is a script you run in the Supabase SQL editor, and not a button in the app.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN
--
--   1. Sign in to the app at least once with the email below, so an auth.users row
--      exists. (This script promotes an EXISTING user; it cannot create one.)
--   2. Supabase Dashboard → SQL Editor → paste this file.
--   3. Edit the email in the CTE below. Nothing else.
--   4. Run. It is IDEMPOTENT — running it twice changes nothing.
--
-- NOTE: no psql \set here, deliberately. The Supabase SQL editor is not psql and does not
-- understand backslash commands — a script that only works from a terminal is a script
-- that does not work where you are going to run it.
-- ---------------------------------------------------------------------------

begin;

-- Promote the auth user to PLATFORM_SUPER_ADMIN.
--
-- Note what this does NOT do: it does not touch app_user, it does not grant any TENANT
-- role, and it does not give this person access to any tenant's operational data. The
-- platform identity is a separate stack (Phase 4.0B) — a platform admin has no app_user
-- and therefore reads no tenant rows through RLS. They can enable a rollout; they cannot
-- read a dossier.
with target as (
  -- ▼▼▼ EDIT THIS ONE LINE ▼▼▼
  select 'seckbara23@gmail.com'::text as email
  -- ▲▲▲ EDIT THIS ONE LINE ▲▲▲
)
insert into public.platform_admin (id, email, name, platform_role, status)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.email),
       'PLATFORM_SUPER_ADMIN',
       'active'
from auth.users u
join target t on lower(u.email) = lower(t.email)
on conflict (id) do update
  set platform_role = 'PLATFORM_SUPER_ADMIN',
      status        = 'active',
      updated_at    = now();

-- Fail loudly rather than silently doing nothing. A script that "succeeds" without
-- creating the admin is worse than one that errors: you would go looking in the wrong
-- place for the next hour.
do $$
declare
  n int;
begin
  select count(*) into n
  from public.platform_admin
  where status = 'active' and platform_role = 'PLATFORM_SUPER_ADMIN';

  if n = 0 then
    raise exception
      'BOOTSTRAP FAILED: no auth.users row matches that email. Sign in to the app once with it first, then re-run.';
  end if;

  raise notice 'Platform super-admins now active: %', n;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- NEXT STEP
--
-- Sign in again and open /platform/rollout. You can now enable the Effitrans tenant from
-- the UI, which AUDITS the change (platform.rollout.updated, with before/after) — the
-- reason to do it there rather than with raw SQL.
--
-- If you would rather not use the UI, supabase/scripts/enable_tenant_rollout.sql does the
-- same thing directly. It is a break-glass path, not the normal one.
-- ---------------------------------------------------------------------------
