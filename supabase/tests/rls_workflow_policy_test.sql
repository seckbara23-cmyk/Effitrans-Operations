-- RLS regression test — versioned workflow policy registry (WES-7). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the guarantees that must hold in the DATABASE, not merely in the action:
--   * a config manager of tenant A sees tenant A's version + the platform default -> 2
--   * a tenant-A user WITHOUT admin:config:manage sees NOTHING                    -> 0
--   * tenant A CANNOT see tenant B's draft or version (isolation)                 -> 0
--   * tenant B likewise cannot see tenant A's                                     -> 0
--   * a PORTAL user sees NOTHING (no portal policy on the table)                  -> 0
--   * a PUBLISHED version's content is IMMUTABLE: UPDATE of document raises       -> raises
--   * a PUBLISHED version cannot be DELETED                                       -> raises
--   * a RETIRED version cannot be reactivated                                     -> raises
--   * EXACTLY ONE ACTIVE version per scope (second ACTIVE raises)                 -> raises
--   * a tenant and the platform may each hold one ACTIVE version simultaneously   -> succeeds
--   * a dossier PINNED to a retired version still reads it after a newer
--     activation (historical reproducibility)                                     -> 1
--   * the activation RPC refuses a version that has not passed validation         -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- Second tenant, with a config-manager role that genuinely holds the permission,
-- so "sees nothing" is isolation and not a missing grant.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d7', 'Test Tenant G1', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000d7', 'SYSTEM_ADMIN', 'Administrateur', 'Administrator', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r join public.permission p on p.code = 'admin:config:manage'
where r.tenant_id = '00000000-0000-0000-0000-0000000000d7' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- W1 = config manager tenant A · W2 = tenant-A staff WITHOUT the permission
-- W3 = config manager tenant G1 · W4 = portal user tenant A
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e5', 'wp-w1@test.local'),
  ('00000000-0000-0000-0000-0000000000e6', 'wp-w2@test.local'),
  ('00000000-0000-0000-0000-0000000000e7', 'wp-w3@test.local'),
  ('00000000-0000-0000-0000-0000000000e8', 'wp-w4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000001', 'wp-w1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000001', 'wp-w2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000d7', 'wp-w3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e5', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e6', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e7', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-0000000000d7' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-000000000001', 'WP Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c8', 'wp-w4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

-- Versions: a platform default (ACTIVE), tenant A's ACTIVE, tenant G1's DRAFT.
insert into public.workflow_policy_version
  (id, tenant_id, version, policy_schema_version, status, document, content_sha256,
   validation_status, activation_reason, activated_at)
values
  ('00000000-0000-0000-0000-00000000fb01', null, 1, 1, 'ACTIVE',
   '{"policySchemaVersion":1}'::jsonb, 'hash-platform-1', 'PASSED', 'seed platform default', now()),
  ('00000000-0000-0000-0000-00000000fb02', '00000000-0000-0000-0000-000000000001', 1, 1, 'ACTIVE',
   '{"policySchemaVersion":1}'::jsonb, 'hash-tenant-a-1', 'PASSED', 'seed tenant A', now()),
  ('00000000-0000-0000-0000-00000000fb03', '00000000-0000-0000-0000-0000000000d7', 1, 1, 'DRAFT',
   '{"policySchemaVersion":1}'::jsonb, 'hash-tenant-g1-1', 'PENDING', null, null)
on conflict (id) do nothing;

-- A dossier PINNED to tenant A's version, for the historical-reproducibility check.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000fb10', '00000000-0000-0000-0000-000000000001',
   'WP-TEST-0001', 'IMP', '00000000-0000-0000-0000-0000000000c8', 'OPENED')
on conflict (id) do nothing;
insert into public.process_instance (id, tenant_id, file_id, policy_version_id, policy_provenance) values
  ('00000000-0000-0000-0000-00000000fb11', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fb10', '00000000-0000-0000-0000-00000000fb02', 'PINNED')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  w1_sees int; w2_sees int; w3_sees_a int; w1_sees_g1 int; w4_sees int;
  immutable_rejected int := 0; delete_rejected int := 0; reactivate_rejected int := 0;
  second_active_rejected int := 0; both_scopes_active int := 0;
  pinned_readable int := 0; unvalidated_activation_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- W1: config manager tenant A — sees tenant A's version AND the platform default.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e5','role','authenticated')::text, true);
  select count(*) into w1_sees from public.workflow_policy_version
   where id in ('00000000-0000-0000-0000-00000000fb01','00000000-0000-0000-0000-00000000fb02');
  -- …and NOT tenant G1's draft.
  select count(*) into w1_sees_g1 from public.workflow_policy_version
   where id = '00000000-0000-0000-0000-00000000fb03';

  -- W2: no admin:config:manage — sees nothing at all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e6','role','authenticated')::text, true);
  select count(*) into w2_sees from public.workflow_policy_version;

  -- W3: config manager of ANOTHER tenant — cannot see tenant A's version.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e7','role','authenticated')::text, true);
  select count(*) into w3_sees_a from public.workflow_policy_version
   where id = '00000000-0000-0000-0000-00000000fb02';

  -- W4: portal user — no portal policy exists on this table.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e8','role','authenticated')::text, true);
  select count(*) into w4_sees from public.workflow_policy_version;

  -- Structural guarantees, as the owner role (RLS is not what enforces these).
  perform set_config('role', 'postgres', true);

  -- A PUBLISHED version's content is immutable.
  begin
    update public.workflow_policy_version
       set document = '{"policySchemaVersion":1,"tampered":true}'::jsonb
     where id = '00000000-0000-0000-0000-00000000fb02';
  exception when others then immutable_rejected := 1;
  end;

  -- A published version cannot be deleted — history stays queryable forever.
  begin
    delete from public.workflow_policy_version where id = '00000000-0000-0000-0000-00000000fb02';
  exception when others then delete_rejected := 1;
  end;

  -- A retired version cannot be reactivated.
  insert into public.workflow_policy_version
    (id, tenant_id, version, policy_schema_version, status, document, content_sha256, validation_status, retired_at)
  values ('00000000-0000-0000-0000-00000000fb04', '00000000-0000-0000-0000-000000000001', 9, 1,
          'RETIRED', '{"policySchemaVersion":1}'::jsonb, 'hash-retired', 'PASSED', now());
  begin
    update public.workflow_policy_version set status = 'ACTIVE'
     where id = '00000000-0000-0000-0000-00000000fb04';
  exception when others then reactivate_rejected := 1;
  end;

  -- EXACTLY ONE ACTIVE per scope: a second ACTIVE for tenant A is rejected.
  begin
    insert into public.workflow_policy_version
      (tenant_id, version, policy_schema_version, status, document, content_sha256, validation_status, activation_reason, activated_at)
    values ('00000000-0000-0000-0000-000000000001', 50, 1, 'ACTIVE',
            '{"policySchemaVersion":1}'::jsonb, 'hash-second-active', 'PASSED', 'should fail', now());
  exception when others then second_active_rejected := 1;
  end;

  -- …but a tenant and the platform may each hold one ACTIVE simultaneously.
  select count(*) into both_scopes_active from public.workflow_policy_version
   where status = 'ACTIVE'
     and id in ('00000000-0000-0000-0000-00000000fb01','00000000-0000-0000-0000-00000000fb02');

  -- HISTORICAL REPRODUCIBILITY: retire tenant A's active version (as a newer
  -- activation would) and confirm the pinned dossier can still read it.
  update public.workflow_policy_version set status = 'RETIRED', retired_at = now()
   where id = '00000000-0000-0000-0000-00000000fb02';
  select count(*) into pinned_readable
    from public.process_instance pi
    join public.workflow_policy_version v on v.id = pi.policy_version_id
   where pi.id = '00000000-0000-0000-0000-00000000fb11';

  -- The activation RPC refuses a version that has not passed validation.
  begin
    perform public.activate_workflow_policy(
      '00000000-0000-0000-0000-00000000fb03', null, 'attempt', 1);
  exception when others then unvalidated_activation_rejected := 1;
  end;

  insert into _r values
    ('w1_config_manager_sees_own_plus_platform', w1_sees),
    ('w1_sees_other_tenant_draft', w1_sees_g1),
    ('w2_no_permission_sees', w2_sees),
    ('w3_cross_tenant_sees', w3_sees_a),
    ('w4_portal_sees', w4_sees),
    ('published_immutable_rejected', immutable_rejected),
    ('published_delete_rejected', delete_rejected),
    ('reactivate_retired_rejected', reactivate_rejected),
    ('second_active_rejected', second_active_rejected),
    ('both_scopes_active', both_scopes_active),
    ('pinned_version_still_readable', pinned_readable),
    ('unvalidated_activation_rejected', unvalidated_activation_rejected);

  if w1_sees<>2 or w1_sees_g1<>0 or w2_sees<>0 or w3_sees_a<>0 or w4_sees<>0
     or immutable_rejected<>1 or delete_rejected<>1 or reactivate_rejected<>1
     or second_active_rejected<>1 or both_scopes_active<>2
     or pinned_readable<>1 or unvalidated_activation_rejected<>1
  then
    raise exception 'RLS WORKFLOW POLICY FAIL: w1=% w1g1=% w2=% w3=% w4=% imm=% del=% react=% second=% both=% pinned=% unvalidated=%',
      w1_sees, w1_sees_g1, w2_sees, w3_sees_a, w4_sees, immutable_rejected, delete_rejected,
      reactivate_rejected, second_active_rejected, both_scopes_active, pinned_readable,
      unvalidated_activation_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
