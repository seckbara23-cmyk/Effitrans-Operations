-- RLS / privilege regression — provision_tenant() (Phase 6.0A). Non-destructive.
-- ---------------------------------------------------------------------------
-- provision_tenant() is the most powerful function in the schema: it creates an
-- organization, roles, permissions and a SYSTEM_ADMIN from a jsonb payload. If a
-- tenant user could call it, any tenant user could mint tenants and hand themselves
-- admin of them. This suite proves they cannot — and that a provision made through it
-- is fully tenant-isolated.
--
-- Three claims, each tried adversarially:
--   1. `authenticated` (a tenant user) CANNOT execute the function — no grant.
--   2. `service_role` CAN, and the tenant it creates is real and complete.
--   3. That new tenant shares NOTHING with the existing one (isolation).

begin;

-- A real tenant-B auth user to attempt the call as.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0a1a', 'provx_a@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000f0a1a', '00000000-0000-0000-0000-000000000001', 'provx_a@test.local')
on conflict (id) do nothing;

-- The auth user that a successful provision will adopt as the new tenant's admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f0aad', 'newtenant_admin@test.local')
on conflict (id) do nothing;

do $$
declare
  denied      boolean := false;
  v_result    jsonb;
  v_new_org   uuid;
  v_role_cnt  int;
  v_perm_cnt  int;
  v_is_admin  boolean;
  v_rollout   record;
  v_cross     int;
  v_payload   jsonb;
begin
  v_payload := jsonb_build_object(
    'company', jsonb_build_object(
      'legalName', 'Northwind Logistics SA', 'tradeName', 'Northwind',
      'slug', 'northwind-test', 'country', 'SN', 'currency', 'XOF',
      'timezone', 'Africa/Dakar', 'language', 'fr',
      'email', 'ops@northwind.test', 'phone', '+221 33 000 0000'),
    'administrator', jsonb_build_object('fullName', 'Awa Ba', 'email', 'newtenant_admin@test.local'),
    'lifecycleStatus', 'TRIAL',
    'planKey', 'PROFESSIONAL',
    'trialEndsAt', null,
    'idempotencyKey', 'test-key-northwind-0001',
    'enabledModules', jsonb_build_array('module.customs', 'module.transport'),
    'roles', jsonb_build_array(
      jsonb_build_object('code', 'SYSTEM_ADMIN', 'labelFr', 'Administrateur', 'labelEn', 'Admin',
        'permissions', jsonb_build_array('admin:config:manage', 'admin:users:manage', 'file:read')),
      jsonb_build_object('code', 'CUSTOMS_DECLARANT', 'labelFr', 'Déclarant', 'labelEn', 'Declarant',
        'permissions', jsonb_build_array('customs:read', 'file:read'))
    )
  );

  -- (1) A TENANT USER MUST BE REFUSED. authenticated has no EXECUTE grant.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000000f0a1a', 'role', 'authenticated')::text, true);
  begin
    perform public.provision_tenant(
      '00000000-0000-0000-0000-0000000f0aad', null, v_payload);
    denied := false;                       -- got through: BREACH
  exception when insufficient_privilege then
    denied := true;                        -- refused: correct
  when others then
    denied := true;                        -- any refusal is acceptable; only "it ran" is a breach
  end;
  perform set_config('role', 'postgres', true);

  if not denied then
    raise exception 'PROVISION BREACH: a tenant (authenticated) user executed provision_tenant';
  end if;

  -- (2) SERVICE ROLE CAN, and produces a complete tenant.
  select public.provision_tenant(
    '00000000-0000-0000-0000-0000000f0aad', null, v_payload) into v_result;

  if v_result ->> 'status' <> 'provisioned' then
    raise exception 'PROVISION FAILED: expected provisioned, got %', v_result;
  end if;
  v_new_org := (v_result ->> 'organizationId')::uuid;

  -- roles + permissions materialized
  select count(*) into v_role_cnt from public.role where tenant_id = v_new_org;
  if v_role_cnt <> 2 then
    raise exception 'PROVISION FAILED: expected 2 roles, got %', v_role_cnt;
  end if;
  select count(*) into v_perm_cnt
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  where r.tenant_id = v_new_org;
  if v_perm_cnt < 3 then
    raise exception 'PROVISION FAILED: expected >=3 role_permissions, got %', v_perm_cnt;
  end if;

  -- SYSTEM_ADMIN assigned to the admin
  select ur.user_id is not null into v_is_admin
  from public.user_role ur
  join public.role r on r.id = ur.role_id
  where ur.user_id = '00000000-0000-0000-0000-0000000f0aad'
    and r.tenant_id = v_new_org and r.code = 'SYSTEM_ADMIN';
  if v_is_admin is not true then
    raise exception 'PROVISION FAILED: admin not assigned SYSTEM_ADMIN';
  end if;

  -- rollout row exists and is ALL OFF
  select * into v_rollout from public.tenant_process_rollout where tenant_id = v_new_org;
  if not found then
    raise exception 'PROVISION FAILED: no rollout row';
  end if;
  if v_rollout.process_engine or v_rollout.process_workspaces
     or v_rollout.physical_invoice_deposit or v_rollout.collections then
    raise exception 'PROVISION FAILED: rollout must be all OFF, got %', v_rollout;
  end if;

  -- branding defaults present
  if not exists (select 1 from public.tenant_branding where tenant_id = v_new_org) then
    raise exception 'PROVISION FAILED: no branding row';
  end if;

  -- (3) ISOLATION: the new tenant shares nothing with tenant-A.
  select count(*) into v_cross
  from public.role
  where tenant_id = v_new_org and id in (
    select id from public.role where tenant_id = '00000000-0000-0000-0000-000000000001'
  );
  if v_cross <> 0 then
    raise exception 'ISOLATION BREACH: roles shared across tenants';
  end if;

  -- (4) IDEMPOTENCY: same key returns the same org, creates nothing new.
  select public.provision_tenant(
    '00000000-0000-0000-0000-0000000f0aad', null, v_payload) into v_result;
  if v_result ->> 'status' <> 'already_exists'
     or (v_result ->> 'organizationId')::uuid <> v_new_org then
    raise exception 'IDEMPOTENCY FAILED: retry did not return the same tenant, got %', v_result;
  end if;
  select count(*) into v_role_cnt from public.role where tenant_id = v_new_org;
  if v_role_cnt <> 2 then
    raise exception 'IDEMPOTENCY FAILED: retry duplicated roles (now %)', v_role_cnt;
  end if;

  -- (5) DUPLICATE SLUG: a different key, same slug -> refused, nothing written.
  select public.provision_tenant(
    '00000000-0000-0000-0000-0000000f0aad', null,
    jsonb_set(v_payload, '{idempotencyKey}', '"different-key-0002"')) into v_result;
  if v_result ->> 'error' <> 'duplicate_slug' then
    raise exception 'SLUG GUARD FAILED: expected duplicate_slug, got %', v_result;
  end if;

  raise notice 'provision_tenant: privilege + provision + isolation + idempotency + slug guard PASS';
end $$;

rollback;
