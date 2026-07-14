-- ===========================================================================
-- BOOTSTRAP THE PERMANENT PLATFORM SUPER ADMIN
-- ===========================================================================
--
-- Promotes an EXISTING authenticated user into the platform administration layer as
-- PLATFORM_SUPER_ADMIN — the permanent owner of the SaaS platform.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SCRIPT AND NOT A FEATURE
--
-- Phase 5.0E-2A decided, deliberately, that a tenant SYSTEM_ADMIN must not be able to
-- enable their own pilot: public.tenant_process_rollout has no write RLS policy and no
-- write grant for `authenticated`. The only writer is a service-role action gated on
-- `platform:rollout:manage`, held only by PLATFORM_SUPER_ADMIN.
--
-- Nothing in the schema creates that first platform admin, and nothing should. It cannot
-- come from a migration or from seed.sql — platform_admin FKs auth.users, and no auth
-- user exists when those run. And it must not come from the application: a "promote me"
-- flow is a privilege-escalation endpoint wearing a helpful hat.
--
-- Minting the first super-admin is therefore an OUT-OF-BAND act, performed by whoever
-- holds the database. That is not a gap in the design. It IS the design: the root of
-- trust has to start somewhere outside the system it secures.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES *NOT* DO — and why that is the whole point
--
-- It does not touch public.app_user.
-- It does not touch public.user_role.
-- It does not grant, alter or remove a single TENANT permission.
--
-- PLATFORM identity and TENANT identity are two separate stacks (Phase 4.0B). They share
-- one auth.users row and NOTHING else:
--
--   /platform/*      → gated by getPlatformUser()  → public.platform_admin
--   /dashboard, etc. → gated by requireUser()      → public.app_user + user_role
--
-- There is no inheritance in either direction, by construction. A platform admin cannot
-- read a dossier (they have no app_user, so tenant RLS returns them nothing). A tenant
-- SYSTEM_ADMIN cannot enable a rollout (no write policy, no grant).
--
-- After this script, seckbara23@gmail.com holds BOTH identities simultaneously:
--
--   at /platform            → PLATFORM_SUPER_ADMIN   (from platform_admin)
--   inside the Effitrans tenant → SYSTEM_ADMIN       (from app_user + user_role)
--
-- Two identities, not one merged super-identity. Each route resolves the one it needs and
-- is blind to the other. That separation is what makes the platform layer auditable, and
-- it is the thing this script must not weaken while creating it.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN
--
--   1. The user must already have signed in at least once (an auth.users row must
--      exist). This script PROMOTES an existing user; it never creates one.
--   2. Supabase Dashboard → SQL Editor → paste this file.
--   3. Edit the email in the `target` CTE below. Nothing else.
--   4. Run.
--
-- IDEMPOTENT. Run it as many times as you like: the second run changes nothing, and says
-- so. platform_admin.id is the PRIMARY KEY and equals auth.users.id, so a duplicate row
-- is not merely avoided — it is impossible.
--
-- NO psql BACKSLASH COMMANDS. The Supabase SQL editor is not psql; a script that only
-- works from a terminal does not work where you are going to run it.
-- ===========================================================================

begin;

do $$
declare
  -- ▼▼▼ EDIT THIS ONE LINE ▼▼▼
  target_email  constant text := 'seckbara23@gmail.com';
  -- ▲▲▲ EDIT THIS ONE LINE ▲▲▲

  auth_id       uuid;
  auth_email    text;
  auth_name     text;
  existing_role text;
  clashing_id   uuid;
  was_new       boolean := false;
  tenant_roles  text[];
begin
  -- (1) LOCATE the existing auth user. Never create one.
  select u.id,
         u.email,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.email)
    into auth_id, auth_email, auth_name
  from auth.users u
  where lower(u.email) = lower(target_email);

  -- (2) VERIFY. Fail loudly: a script that "succeeds" without doing anything is worse
  -- than one that errors, because you would spend the next hour looking in the wrong
  -- place.
  if auth_id is null then
    raise exception
      'BOOTSTRAP FAILED: no auth.users row for %. Sign in to the app once with that address, then re-run.',
      target_email;
  end if;

  -- platform_admin.email carries a UNIQUE constraint. If some OTHER auth id already
  -- holds this address, that is a real anomaly (a duplicated account) and must be
  -- surfaced, not silently worked around.
  select pa.id into clashing_id
  from public.platform_admin pa
  where lower(pa.email) = lower(auth_email)
    and pa.id <> auth_id;

  if clashing_id is not null then
    raise exception
      'BOOTSTRAP ABORTED: platform_admin already holds % under a DIFFERENT auth id (%). Resolve the duplicate account first.',
      auth_email, clashing_id;
  end if;

  select pa.platform_role into existing_role
  from public.platform_admin pa where pa.id = auth_id;

  was_new := existing_role is null;

  -- (3) CREATE or CORRECT the platform identity. Keyed on the PRIMARY KEY, which is the
  -- auth id — so this cannot duplicate, however many times it runs.
  insert into public.platform_admin (id, email, name, platform_role, status)
  values (auth_id, auth_email, auth_name, 'PLATFORM_SUPER_ADMIN', 'active')
  on conflict (id) do update
    set email         = excluded.email,
        platform_role = 'PLATFORM_SUPER_ADMIN',
        status        = 'active',
        updated_at    = now();

  -- (4) PROVE the tenant identity was left alone. This is the security claim of the whole
  -- script, so it is asserted rather than assumed: we read the tenant roles back and
  -- print them. If this script ever started touching app_user or user_role, the output
  -- would change and someone would notice.
  select array_agg(r.code order by r.code)
    into tenant_roles
  from public.user_role ur
  join public.role r on r.id = ur.role_id
  where ur.user_id = auth_id;

  -- (5) AUDIT. platform_actor_id is the actor: the admin is, in effect, their own
  -- sponsor — which is precisely the fact worth recording about a root-of-trust event.
  insert into public.audit_log (action, tenant_id, platform_actor_id, entity, entity_id, before, after)
  values (
    'platform.admin.bootstrapped',
    null,                                   -- a platform event belongs to no tenant
    auth_id,
    'platform_admin',
    auth_id,
    jsonb_build_object('platform_role', existing_role, 'existed', not was_new),
    jsonb_build_object(
      'platform_role', 'PLATFORM_SUPER_ADMIN',
      'status', 'active',
      'via', 'bootstrap_platform_super_admin.sql',
      'tenant_roles_preserved', coalesce(tenant_roles, array[]::text[])
    )
  );

  if was_new then
    raise notice 'CREATED platform_admin: % (%) → PLATFORM_SUPER_ADMIN', auth_email, auth_id;
  else
    raise notice 'ALREADY EXISTED (was %): % (%) → PLATFORM_SUPER_ADMIN, unchanged.',
      existing_role, auth_email, auth_id;
  end if;

  raise notice 'TENANT identity untouched. Tenant roles still held: %',
    coalesce(array_to_string(tenant_roles, ', '), '(none)');
end $$;

commit;

-- ===========================================================================
-- VERIFY — the two identities, side by side. They must BOTH be populated, and they must
-- be separate rows in separate tables sharing only the auth id.
-- ===========================================================================
select u.email,
       u.id                                   as auth_user_id,
       pa.platform_role                       as platform_identity,
       pa.status                              as platform_status,
       coalesce(
         (select string_agg(r.code, ', ' order by r.code)
          from public.user_role ur
          join public.role r on r.id = ur.role_id
          where ur.user_id = u.id),
         '(none)'
       )                                      as tenant_identity,
       (au.id is not null)                    as has_app_user
from auth.users u
left join public.platform_admin pa on pa.id = u.id
left join public.app_user       au on au.id = u.id
where lower(u.email) = lower('seckbara23@gmail.com');

-- Expected:
--   platform_identity = PLATFORM_SUPER_ADMIN   (→ /platform/* is now reachable)
--   tenant_identity   = SYSTEM_ADMIN, …        (→ /dashboard, /my-work, /settings/pilot unchanged)
--   has_app_user      = true
--
-- NEXT: sign in again, open /platform/rollout, and enable the Effitrans tenant. That path
-- audits the change properly (platform.rollout.updated, with before/after and the acting
-- admin) — which is why it is preferred over enable_tenant_rollout.sql.
