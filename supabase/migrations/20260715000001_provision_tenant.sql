-- Phase 6.0A — TRANSACTIONAL TENANT PROVISIONING.
-- ===========================================================================
-- provision_tenant() creates a complete, ready-to-use tenant in ONE atomic
-- statement. Either the whole tenant exists afterwards, or none of it does.
--
-- WHY A FUNCTION, AND WHY IT ENDS WHERE IT DOES
--
-- Supabase JS cannot run a multi-statement transaction — that is the reason this
-- codebase uses compare-and-set everywhere instead of SELECT ... FOR UPDATE. The
-- only way to get "no partial tenants" is to do all the relational work inside a
-- single server-side function, so one RPC call is one transaction.
--
-- But the administrator's LOGIN cannot be created here: auth.users is owned by
-- GoTrue and is written through its API, not through SQL we should be inserting
-- into. So the boundary is deliberate and fixed:
--
--   Stage 1 (GoTrue API, in the server action)  create-or-reuse the auth user
--   Stage 2 (THIS function, one transaction)     everything relational
--
-- The function receives the auth user's id (already created/resolved in stage 1)
-- and hangs the whole tenant off it. If anything in here raises, the transaction
-- rolls back and the action compensates the auth user (only if it created it).
--
-- SECURITY
--
-- SECURITY DEFINER so it runs with the definer's rights regardless of caller, but
-- EXECUTE is granted to service_role ONLY and revoked from public/anon/
-- authenticated. A tenant user cannot reach it: not through RLS (service_role
-- bypasses RLS, tenant users are not service_role), and not through a direct RPC
-- (no grant). rls_provision_tenant_test.sql proves the refusal.
--
-- IDEMPOTENCY
--
-- Keyed on `provisioning_key` (the contract's idempotencyKey). A retry with the
-- same key returns the already-provisioned tenant and writes nothing. A different
-- request whose SLUG is already taken is refused with duplicate_slug. Both checks
-- run before any write, so an early return rolls nothing back.
--
-- ROLE CATALOG STAYS IN TYPESCRIPT
--
-- The 23-role template registry lives in lib/platform/role-templates.ts and is
-- proven equivalent to seed.sql by tests/role-templates.test.ts. Rather than copy
-- it into SQL (a second source of truth that would drift), the action serializes
-- the SELECTED templates to jsonb and passes them in `p_input->'roles'`. This
-- function only MATERIALIZES what it is handed. It refuses loudly if a template
-- names a permission code that does not exist — a drift must fail, not silently
-- drop a permission.
-- ===========================================================================

-- Idempotency key on organization. Additive; nullable (legacy rows have none).
alter table public.organization
  add column if not exists provisioning_key text;

create unique index if not exists uq_organization_provisioning_key
  on public.organization (provisioning_key)
  where provisioning_key is not null;

-- ---------------------------------------------------------------------------
-- provision_tenant(p_admin_auth_id, p_platform_actor_id, p_input) -> jsonb
--
-- p_input shape (built and validated in the server action):
--   {
--     "company": { legalName, tradeName, slug, country, currency, timezone,
--                  language, email, phone, ninea, rccm },
--     "administrator": { fullName, email },
--     "lifecycleStatus": "TRIAL" | "ACTIVE",
--     "planKey": "STARTER" | "PROFESSIONAL" | "ENTERPRISE",
--     "trialEndsAt": <iso8601 | null>,
--     "idempotencyKey": "<uuid-ish>",
--     "enabledModules": ["module.customs", ...],   -- for the audit record only
--     "roles": [ { code, labelFr, labelEn, permissions: ["code", ...] }, ... ]
--   }
--
-- Returns jsonb: { status, organizationId, administratorUserId, createdRoles,
--                  createdPermissionCount, enabledModules } on success, or
--                { status: "error", error: "<code>" } for the expected refusals.
-- ---------------------------------------------------------------------------
create or replace function public.provision_tenant(
  p_admin_auth_id    uuid,
  p_platform_actor_id uuid,
  p_input            jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug      text := lower(p_input -> 'company' ->> 'slug');
  v_key       text := p_input ->> 'idempotencyKey';
  v_org_id    uuid;
  v_role      jsonb;
  v_role_id   uuid;
  v_perm_code text;
  v_missing   text;
  v_created_roles text[] := array[]::text[];
  v_perm_count int := 0;
  v_admin_role_id uuid;
  v_existing  public.organization%rowtype;
begin
  if p_admin_auth_id is null then
    return jsonb_build_object('status', 'error', 'error', 'auth_user_creation_failed');
  end if;
  if v_key is null or length(v_key) = 0 then
    return jsonb_build_object('status', 'error', 'error', 'invalid_input');
  end if;

  -- (A) IDEMPOTENT RETRY: same key already provisioned -> return it, write nothing.
  select * into v_existing from public.organization where provisioning_key = v_key;
  if found then
    return jsonb_build_object(
      'status', 'already_exists',
      'organizationId', v_existing.id,
      'administratorUserId', p_admin_auth_id,
      'createdRoles', array[]::text[],
      'createdPermissionCount', 0,
      'enabledModules', coalesce(p_input -> 'enabledModules', '[]'::jsonb)
    );
  end if;

  -- (B) SLUG CONFLICT: a DIFFERENT request already holds this slug.
  if exists (select 1 from public.organization where lower(slug) = v_slug) then
    return jsonb_build_object('status', 'error', 'error', 'duplicate_slug');
  end if;

  -- (C) ADMIN CONFLICT: this auth user already belongs to a tenant. We must not
  -- steal them into a new one (app_user PK is the auth id — one tenant per login).
  if exists (select 1 from public.app_user where id = p_admin_auth_id) then
    return jsonb_build_object('status', 'error', 'error', 'admin_email_conflict');
  end if;

  -- Everything below is the atomic provision. Any raise rolls all of it back.

  -- (1) organization
  insert into public.organization (
    name, legal_name, trade_name, slug, country, currency, timezone, locale,
    plan_key, lifecycle_status, product_profile, onboarding_status,
    branding_complete, trial_started_at, trial_ends_at, provisioning_key
  )
  values (
    coalesce(nullif(p_input -> 'company' ->> 'legalName', ''),
             p_input -> 'company' ->> 'tradeName'),
    p_input -> 'company' ->> 'legalName',
    p_input -> 'company' ->> 'tradeName',
    v_slug,
    p_input -> 'company' ->> 'country',
    coalesce(p_input -> 'company' ->> 'currency', 'XOF'),
    coalesce(p_input -> 'company' ->> 'timezone', 'Africa/Dakar'),
    coalesce(p_input -> 'company' ->> 'language', 'fr'),
    p_input ->> 'planKey',
    coalesce(p_input ->> 'lifecycleStatus', 'TRIAL'),
    'LOGISTICS_COMPANY',
    'pending',                 -- a fresh tenant has onboarding to do (6.0E derives it)
    false,
    case when p_input ->> 'lifecycleStatus' = 'TRIAL' then now() else null end,
    (p_input ->> 'trialEndsAt')::timestamptz,
    v_key
  )
  returning id into v_org_id;

  -- (2) branding defaults (a row so resolveTenantBranding has something to merge)
  insert into public.tenant_branding (tenant_id, display_name, support_email, support_phone)
  values (
    v_org_id,
    coalesce(nullif(p_input -> 'company' ->> 'tradeName', ''),
             p_input -> 'company' ->> 'legalName'),
    nullif(p_input -> 'company' ->> 'email', ''),
    nullif(p_input -> 'company' ->> 'phone', '')
  );

  -- (3) roles + (4) role_permission, materialized from the templates handed in.
  for v_role in select * from jsonb_array_elements(p_input -> 'roles')
  loop
    insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
    values (v_org_id, v_role ->> 'code', v_role ->> 'labelFr', v_role ->> 'labelEn', false)
    returning id into v_role_id;

    v_created_roles := v_created_roles || (v_role ->> 'code');
    if (v_role ->> 'code') = 'SYSTEM_ADMIN' then
      v_admin_role_id := v_role_id;
    end if;

    -- A template permission that does not exist is a registry drift. Fail loudly
    -- rather than silently provisioning a role with fewer rights than intended.
    select pc.code into v_missing
    from jsonb_array_elements_text(v_role -> 'permissions') as pc(code)
    where not exists (select 1 from public.permission p where p.code = pc.code)
    limit 1;
    if v_missing is not null then
      raise exception 'provision_tenant: unknown permission code "%" in role "%"',
        v_missing, v_role ->> 'code';
    end if;

    insert into public.role_permission (role_id, permission_id)
    select v_role_id, p.id
    from public.permission p
    where p.code in (
      select pc.code from jsonb_array_elements_text(v_role -> 'permissions') as pc(code)
    );
    v_perm_count := v_perm_count + (
      select count(*) from jsonb_array_elements_text(v_role -> 'permissions')
    );
  end loop;

  if v_admin_role_id is null then
    raise exception 'provision_tenant: role set did not include SYSTEM_ADMIN';
  end if;

  -- (5) rollout row — ALL FEATURES OFF. A fresh tenant is dark; the platform
  -- super-admin decides when to activate (Phase 5.0E-2A). The table's own defaults
  -- are all false, so an empty insert is the safest possible expression of intent.
  insert into public.tenant_process_rollout (tenant_id) values (v_org_id);

  -- (6) the first administrator's app_user, hung off the stage-1 auth id.
  insert into public.app_user (id, tenant_id, email, name, status, is_system_admin)
  values (
    p_admin_auth_id,
    v_org_id,
    p_input -> 'administrator' ->> 'email',
    p_input -> 'administrator' ->> 'fullName',
    'active',
    true
  );

  -- (7) SYSTEM_ADMIN tenant assignment.
  insert into public.user_role (user_id, role_id, tenant_id)
  values (p_admin_auth_id, v_admin_role_id, v_org_id);

  -- (8) platform audit. tenant_id set (it is a fact about this tenant) AND
  -- platform_actor_id set (the platform admin who provisioned it). NO secret in
  -- the payload — the temporary password/setup link never reaches SQL at all.
  insert into public.audit_log (action, tenant_id, platform_actor_id, entity, entity_id, after)
  values (
    'platform.tenant.provisioned',
    v_org_id,
    p_platform_actor_id,
    'organization',
    v_org_id,
    jsonb_build_object(
      'slug', v_slug,
      'planKey', p_input ->> 'planKey',
      'lifecycleStatus', coalesce(p_input ->> 'lifecycleStatus', 'TRIAL'),
      'createdRoles', v_created_roles,
      'createdPermissionCount', v_perm_count,
      'administratorEmail', p_input -> 'administrator' ->> 'email'
    )
  );

  return jsonb_build_object(
    'status', 'provisioned',
    'organizationId', v_org_id,
    'administratorUserId', p_admin_auth_id,
    'createdRoles', v_created_roles,
    'createdPermissionCount', v_perm_count,
    'enabledModules', coalesce(p_input -> 'enabledModules', '[]'::jsonb)
  );
end;
$$;

-- Lock it down. service_role only; a tenant user has no path to it.
revoke all on function public.provision_tenant(uuid, uuid, jsonb) from public;
revoke all on function public.provision_tenant(uuid, uuid, jsonb) from anon;
revoke all on function public.provision_tenant(uuid, uuid, jsonb) from authenticated;
grant execute on function public.provision_tenant(uuid, uuid, jsonb) to service_role;

comment on function public.provision_tenant(uuid, uuid, jsonb) is
  'Phase 6.0A. Atomically provisions a tenant (org, branding, roles, permissions, dark rollout, first admin, SYSTEM_ADMIN, audit) from a validated jsonb payload. service_role only. Idempotent on provisioning_key.';
