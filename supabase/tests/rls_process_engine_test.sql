-- RLS regression test — Official process engine (Phase 5.0B). Non-destructive.
-- ---------------------------------------------------------------------------
-- Proves the three new tables (process_instance, process_step_execution,
-- process_handoff) are tenant-isolated and dossier-scoped, and that the DB
-- triggers make cross-tenant process data impossible even for the service role.
--
-- READ isolation (RLS):
--   * OPS_SUPERVISOR tenant-A (file:read:all + process:read) sees A's process
--     rows and NOT tenant B's
--   * COORDINATOR tenant-A sees only the dossier they coordinate
--   * SYSTEM_ADMIN of tenant B sees only B — a tenant admin never crosses tenants
--   * DRIVER (no process:read) sees NOTHING
--   * a portal/platform identity (no app_user row => auth_tenant_id() is null)
--     sees NOTHING — platform admins get no implicit tenant process access
--
-- WRITE integrity (triggers, service-role proof):
--   * a process_instance whose tenant != its dossier's tenant is rejected
--   * a handoff whose sender belongs to another tenant is rejected
--   * a step execution whose reviewer belongs to another tenant is rejected
--
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Tenant B needs its own roles (seed only provisions tenant A).
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
values ('00000000-0000-0000-0000-0000000000b2', 'SYSTEM_ADMIN', 'Administrateur', 'System Administrator', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('process:read', 'file:read', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-0000000000b2' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000be001', 'pe-ops@test.local'),
  ('00000000-0000-0000-0000-0000000be002', 'pe-coord@test.local'),
  ('00000000-0000-0000-0000-0000000be003', 'pe-admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000be004', 'pe-driver@test.local'),
  ('00000000-0000-0000-0000-0000000be005', 'pe-outsider@test.local')
on conflict (id) do nothing;

-- pe05 deliberately gets NO app_user row: it stands in for a portal user / platform
-- admin, i.e. an authenticated identity with no tenant membership.
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000be001', '00000000-0000-0000-0000-000000000001', 'pe-ops@test.local'),
  ('00000000-0000-0000-0000-0000000be002', '00000000-0000-0000-0000-000000000001', 'pe-coord@test.local'),
  ('00000000-0000-0000-0000-0000000be003', '00000000-0000-0000-0000-0000000000b2', 'pe-admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000be004', '00000000-0000-0000-0000-000000000001', 'pe-driver@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000be001'::uuid, 'OPS_SUPERVISOR', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000be002'::uuid, 'COORDINATOR',    '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000be003'::uuid, 'SYSTEM_ADMIN',   '00000000-0000-0000-0000-0000000000b2'::uuid),
  ('00000000-0000-0000-0000-0000000be004'::uuid, 'DRIVER',         '00000000-0000-0000-0000-000000000001'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000bec01', '00000000-0000-0000-0000-000000000001', 'PE Client A'),
  ('00000000-0000-0000-0000-0000000bec02', '00000000-0000-0000-0000-0000000000b2', 'PE Client B')
on conflict (id) do nothing;

-- fileX coordinated by pe02; fileY unrelated (tenant A); fileZ tenant B.
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-0000000bef01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-0000000bec01', '00000000-0000-0000-0000-0000000be002'),
  ('00000000-0000-0000-0000-0000000bef02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96002', 'IMP', '00000000-0000-0000-0000-0000000bec01', null),
  ('00000000-0000-0000-0000-0000000bef03', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-96003', 'IMP', '00000000-0000-0000-0000-0000000bec02', null)
on conflict (id) do nothing;

insert into public.process_instance (id, tenant_id, file_id) values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000bef01'),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000bef02'),
  ('00000000-0000-0000-0000-0000000b1003', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000bef03')
on conflict (id) do nothing;

insert into public.process_step_execution (id, tenant_id, process_instance_id, step_key, step_number, state) values
  ('00000000-0000-0000-0000-0000000b5001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1001', 'customs_preparation', 6, 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000b5003', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000b1003', 'customs_preparation', 6, 'ACTIVE')
on conflict (id) do nothing;

insert into public.process_handoff (id, tenant_id, process_instance_id, from_step_key, to_step_key, sent_by, dedup_key) values
  ('00000000-0000-0000-0000-0000000b8001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1001', 'am_dossier_opening', 'coordinator_reception', '00000000-0000-0000-0000-0000000be001', 'pei01:am->coord:1'),
  ('00000000-0000-0000-0000-0000000b8003', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000b1003', 'am_dossier_opening', 'coordinator_reception', '00000000-0000-0000-0000-0000000be003', 'pei03:am->coord:1')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------- READ RLS ----
do $$
declare
  ops_a int; ops_b int; ops_step_a int; ops_step_b int; ops_ho_a int; ops_ho_b int;
  coord_x int; coord_y int;
  adminb_a int; adminb_b int;
  driver_any int; outsider_any int;
begin
  perform set_config('role', 'authenticated', true);

  -- OPS_SUPERVISOR (tenant A, file:read:all + process:read)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000be001','role','authenticated')::text, true);
  select count(*) into ops_a from public.process_instance where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into ops_b from public.process_instance where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  select count(*) into ops_step_a from public.process_step_execution where id = '00000000-0000-0000-0000-0000000b5001';
  select count(*) into ops_step_b from public.process_step_execution where id = '00000000-0000-0000-0000-0000000b5003';
  select count(*) into ops_ho_a from public.process_handoff where id = '00000000-0000-0000-0000-0000000b8001';
  select count(*) into ops_ho_b from public.process_handoff where id = '00000000-0000-0000-0000-0000000b8003';

  -- COORDINATOR (tenant A, no file:read:all) — only the dossier they coordinate.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000be002','role','authenticated')::text, true);
  select count(*) into coord_x from public.process_instance where id = '00000000-0000-0000-0000-0000000b1001';
  select count(*) into coord_y from public.process_instance where id = '00000000-0000-0000-0000-0000000b1002';

  -- SYSTEM_ADMIN of tenant B — sees B, never A.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000be003','role','authenticated')::text, true);
  select count(*) into adminb_a from public.process_instance where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into adminb_b from public.process_instance where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  -- DRIVER — holds no process:read.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000be004','role','authenticated')::text, true);
  select count(*) into driver_any from public.process_instance;

  -- Portal / platform identity — authenticated but with no app_user row, so
  -- auth_tenant_id() is null and every policy fails closed.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000be005','role','authenticated')::text, true);
  select count(*) into outsider_any from public.process_instance;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('ops_instances_A', ops_a), ('ops_instances_B', ops_b),
    ('ops_step_A', ops_step_a), ('ops_step_B', ops_step_b),
    ('ops_handoff_A', ops_ho_a), ('ops_handoff_B', ops_ho_b),
    ('coord_ownfile', coord_x), ('coord_otherfile', coord_y),
    ('tenantB_admin_sees_A', adminb_a), ('tenantB_admin_sees_B', adminb_b),
    ('driver_sees_any', driver_any), ('no_tenant_identity_sees_any', outsider_any);

  if ops_a < 2 or ops_b <> 0 or ops_step_a <> 1 or ops_step_b <> 0
     or ops_ho_a <> 1 or ops_ho_b <> 0
     or coord_x <> 1 or coord_y <> 0
     or adminb_a <> 0 or adminb_b <> 1
     or driver_any <> 0 or outsider_any <> 0 then
    raise exception 'RLS PROCESS FAIL: ops(A=% B=% stepA=% stepB=% hoA=% hoB=%) coord(x=% y=%) adminB(A=% B=%) driver=% outsider=%',
      ops_a, ops_b, ops_step_a, ops_step_b, ops_ho_a, ops_ho_b,
      coord_x, coord_y, adminb_a, adminb_b, driver_any, outsider_any;
  end if;
end $$;

-- ------------------------------------------------- WRITE INTEGRITY (triggers) ----
-- These run as the table owner (service-role equivalent). They must STILL fail:
-- the tenant-integrity triggers are the backstop for a buggy server action.
do $$
declare
  blocked_instance boolean := false;
  blocked_handoff  boolean := false;
  blocked_reviewer boolean := false;
begin
  -- 1. instance tenant must equal the dossier's tenant (cross-tenant file_id).
  begin
    insert into public.process_instance (tenant_id, file_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000bef03');
  exception when others then
    blocked_instance := true;
  end;

  -- 2. handoff sender must belong to the handoff's tenant.
  begin
    insert into public.process_handoff
      (tenant_id, process_instance_id, from_step_key, to_step_key, sent_by, dedup_key)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1001',
            'am_dossier_opening', 'coordinator_reception',
            '00000000-0000-0000-0000-0000000be003', 'cross-tenant-sender');
  exception when others then
    blocked_handoff := true;
  end;

  -- 3. a reviewer (checker) from another tenant must be rejected.
  begin
    insert into public.process_step_execution
      (tenant_id, process_instance_id, step_key, step_number, state, reviewed_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b1001',
            'transit_validation', 7, 'APPROVED', '00000000-0000-0000-0000-0000000be003');
  exception when others then
    blocked_reviewer := true;
  end;

  insert into _r values
    ('blocked_cross_tenant_instance', blocked_instance::int),
    ('blocked_cross_tenant_handoff_sender', blocked_handoff::int),
    ('blocked_cross_tenant_reviewer', blocked_reviewer::int);

  if not blocked_instance or not blocked_handoff or not blocked_reviewer then
    raise exception 'PROCESS TENANT-INTEGRITY FAIL: instance=% handoff=% reviewer=%',
      blocked_instance, blocked_handoff, blocked_reviewer;
  end if;
end $$;

select * from _r order by check_name;
rollback;
