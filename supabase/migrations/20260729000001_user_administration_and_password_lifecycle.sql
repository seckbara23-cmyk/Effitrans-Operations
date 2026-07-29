-- 20260729000001_user_administration_and_password_lifecycle.sql
-- Effitrans Operations Platform — granular user administration + STAFF password lifecycle.
-- ---------------------------------------------------------------------------
-- FORWARD-ONLY, idempotent. Adds 7 permissions, grants them, and adds 3 additive
-- columns to app_user. Revokes nothing. Drops nothing. Backfills no password date.
--
-- ===========================================================================
-- 1. WHY GRANULAR PERMISSIONS
-- ===========================================================================
-- Every user-administration capability was gated by ONE permission,
-- `admin:users:manage`: create, suspend, archive, restore, resend the welcome
-- link, and read the directory. A role could be given the ability to LOOK at the
-- staff directory only by also being given the ability to create and archive
-- users. There was no way to express "may view users" or "may reset a password"
-- as separate authorities, so in practice only SYSTEM_ADMIN could hold any of it.
--
-- Regenerating a temporary password is the most sensitive act in this module —
-- it invalidates a live credential and mints a new one — and it deserves a
-- permission of its own rather than riding on the same token as "list users".
--
-- The family, all `module:action[:scope]` per the enforced convention (which
-- permits [a-z_] only — hence reset_password / temp_password, not hyphens):
--
--   admin:users:read            read the staff directory
--   admin:users:create          create a staff user
--   admin:users:update          edit name / status / role assignments
--   admin:users:disable         suspend, archive and restore
--   admin:users:reset_password  send the secure password-reset email
--   admin:users:temp_password   generate a temporary password (invalidates the
--                               user's current one immediately)
--   admin:users:unlock          lift an auth ban / unlock an account
--
-- `admin:users:manage` is NOT removed. It stays in the catalogue and stays
-- granted, as a DEPRECATED COMPATIBILITY permission: every server action accepts
-- the granular code OR the umbrella, so a tenant whose grants have not yet been
-- migrated keeps working. Nothing is revoked by this migration; the umbrella is
-- retired in a later, separate change once every tenant holds the granular set.
--
-- ===========================================================================
-- 2. WHY STAFF PASSWORD-LIFECYCLE COLUMNS
-- ===========================================================================
-- `must_change_password` existed ONLY on client_user — the customer portal. A
-- staff member issued a temporary password could keep using it forever: nothing
-- forced a change, nothing expired, and nothing recorded when the password last
-- changed. So the admin directory could not answer "when did this person last
-- change their password?" — the question the Password Management panel exists to
-- answer — and a temporary credential shared over WhatsApp stayed valid
-- indefinitely.
--
-- Three additive columns close that, mirroring the portal contract staff never
-- received:
--
--   password_changed_at       when the password was last changed. NOT backfilled
--                             — see (3).
--   must_change_password      the login gate forces a change before the app is
--                             reachable.
--   temp_password_expires_at  when a temporary password stops being accepted.
--                             NULL means "no temporary password outstanding",
--                             which is the state of every existing user.
--
-- ===========================================================================
-- 3. DELIBERATELY NOT BACKFILLED
-- ===========================================================================
-- `password_changed_at` is left NULL for every existing user. The platform does
-- not know when they last changed their password — GoTrue does not expose it and
-- inventing `now()` would assert a change that never happened, making a
-- five-year-old password look like today's. The UI renders NULL as « inconnue »
-- and says so. An honest unknown beats a manufactured fact.
--
-- `must_change_password` defaults to FALSE so this migration locks nobody out:
-- no existing session is interrupted, no existing user is forced through a
-- change screen they were never told about. The flag is only ever set by an
-- explicit administrative act (generating a temporary password).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE PERMISSION CATALOGUE
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('admin:users:read',           'admin', 'read',           'all',
   'Read the staff user directory'),
  ('admin:users:create',         'admin', 'create',         'all',
   'Create a staff user'),
  ('admin:users:update',         'admin', 'update',         'all',
   'Edit a staff user (name, status, role assignments)'),
  ('admin:users:disable',        'admin', 'disable',        'all',
   'Suspend, archive and restore a staff user'),
  ('admin:users:reset_password', 'admin', 'reset_password', 'all',
   'Send a staff user the secure password-reset email'),
  ('admin:users:temp_password',  'admin', 'temp_password',  'all',
   'Generate a temporary password, invalidating the user''s current one'),
  ('admin:users:unlock',         'admin', 'unlock',         'all',
   'Unlock a staff account (lift an authentication ban)')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. GRANTS — SYSTEM_ADMIN ONLY, ACROSS EVERY EXISTING TENANT
-- ---------------------------------------------------------------------------
-- Deliberately NOT filtered by tenant_id: this is a BACKFILL of capabilities
-- SYSTEM_ADMIN already exercises through the umbrella, so it must reach every
-- tenant provisioned so far. New tenants receive it from the role templates,
-- kept in parity by tests/user-administration.test.ts.
--
-- Ratified 2026-07-29: SYSTEM_ADMIN and nobody else at this stage. HR_OFFICER
-- was considered for admin:users:read and explicitly deferred — the staff
-- REGISTRY (public.employee, hr:read) is a different dataset from the LOGIN
-- directory, and conflating them would hand HR a view of authentication state
-- it has no business need for. Widening later is one INSERT; narrowing after
-- the fact is a revocation, which is why this starts closed.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in (
  'admin:users:read',
  'admin:users:create',
  'admin:users:update',
  'admin:users:disable',
  'admin:users:reset_password',
  'admin:users:temp_password',
  'admin:users:unlock'
)
where r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. STAFF PASSWORD LIFECYCLE (additive columns on app_user)
-- ---------------------------------------------------------------------------
alter table public.app_user
  add column if not exists password_changed_at      timestamptz,
  add column if not exists must_change_password     boolean not null default false,
  add column if not exists temp_password_expires_at timestamptz;

comment on column public.app_user.password_changed_at is
  'When this user last changed their password. NULL = unknown (never backfilled — '
  'GoTrue does not expose the historical value and inventing one would be a lie). '
  'Set by the forced-change flow and by any completed password reset.';

comment on column public.app_user.must_change_password is
  'Forces the staff login gate to route this user to /auth/change-password before '
  'any application route renders. Set ONLY by an administrative temporary-password '
  'generation; cleared ONLY by the user completing the change.';

comment on column public.app_user.temp_password_expires_at is
  'When an outstanding TEMPORARY password stops being accepted. NULL = no '
  'temporary password outstanding. An expired value denies the session and the '
  'administrator must generate a new temporary password — it is never auto-renewed.';

-- The forced-change gate reads this on every authenticated staff request, and
-- the directory reads it per row; a partial index keeps the flagged set cheap
-- to find without carrying every user.
create index if not exists idx_app_user_must_change_password
  on public.app_user (tenant_id)
  where must_change_password;

-- ---------------------------------------------------------------------------
-- 4. THE UMBRELLA IS DEPRECATED, NOT REMOVED
-- ---------------------------------------------------------------------------
-- No revoke, no delete. Existing SYSTEM_ADMIN roles keep admin:users:manage and
-- every action honours it as a fallback, so a tenant that has not yet received
-- the grants above is never locked out of its own user administration.
update public.permission
set description = 'DEPRECATED umbrella — superseded by admin:users:read/create/update/'
                  'disable/reset_password/temp_password/unlock. Still honoured as a '
                  'compatibility fallback by every user action. Do not grant to new roles.'
where code = 'admin:users:manage';

-- ---------------------------------------------------------------------------
-- 5. RLS — UNCHANGED, DELIBERATELY
-- ---------------------------------------------------------------------------
-- app_user carries exactly one policy, app_user_select_self (SELECT). There is
-- no UPDATE policy, so a user cannot clear their own must_change_password flag
-- through the anon-key REST API: only the service-role path (the completion
-- action, which requires an authenticated session for that same id) can write
-- it. The new columns are readable by the user themselves through the existing
-- self-select policy, which is exactly what the login gate needs.
