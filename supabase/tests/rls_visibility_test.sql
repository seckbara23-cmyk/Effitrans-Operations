-- RLS regression test — Visibility scoping (Phase 1.7). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the own/assigned visibility model on operational_file + task:
--   * manager (OPS_SUPERVISOR, file/task:read:all) sees ALL tenant-A files/tasks,
--     but NOT tenant B (isolation)
--   * COORDINATOR (assigned) sees only the dossier they coordinate + its tasks,
--     not unrelated ones
--   * CHIEF_OF_TRANSIT (assigned) sees the task assigned to them AND its dossier,
--     not unrelated dossiers/tasks
-- Expected per check: see the final assertion (all must hold or it raises).
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Users: U1 manager (read:all), U2 coordinator, U3 chief-of-transit (assignee).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'mgr@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'coord@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'transit@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'mgr@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'coord@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', 'transit@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000f1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000f2'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-0000000000f3'::uuid, 'CHIEF_OF_TRANSIT')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- Clients (operational_file.client_id is NOT NULL).
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- fileX: coordinated by U2.  fileY: unrelated owners, but has a task for U3.
-- fileZ: tenant B (isolation).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95001', 'IMP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000f2'),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95002', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null),
  ('00000000-0000-0000-0000-00000000fe0b', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-95003', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null)
on conflict (id) do nothing;

-- taskX on fileX (unassigned -> visible to U2 via file).  taskY on fileY assigned to U3.
insert into public.task (id, tenant_id, file_id, title, assigned_to) values
  ('00000000-0000-0000-0000-00000000ae01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fe01', 'Task X', null),
  ('00000000-0000-0000-0000-00000000ae02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fe02', 'Task Y', '00000000-0000-0000-0000-0000000000f3')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  u1_fx int; u1_fy int; u1_fz int; u1_tx int; u1_ty int;
  u2_fx int; u2_fy int; u2_tx int; u2_ty int;
  u3_fx int; u3_fy int; u3_tx int; u3_ty int;
begin
  perform set_config('role', 'authenticated', true);

  -- U1 manager (read:all): sees all tenant-A files/tasks, not tenant B.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f1','role','authenticated')::text, true);
  select count(*) into u1_fx from public.operational_file where id='00000000-0000-0000-0000-00000000fe01';
  select count(*) into u1_fy from public.operational_file where id='00000000-0000-0000-0000-00000000fe02';
  select count(*) into u1_fz from public.operational_file where id='00000000-0000-0000-0000-00000000fe0b';
  select count(*) into u1_tx from public.task where id='00000000-0000-0000-0000-00000000ae01';
  select count(*) into u1_ty from public.task where id='00000000-0000-0000-0000-00000000ae02';

  -- U2 coordinator of fileX: sees fileX + its task, not fileY/taskY.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f2','role','authenticated')::text, true);
  select count(*) into u2_fx from public.operational_file where id='00000000-0000-0000-0000-00000000fe01';
  select count(*) into u2_fy from public.operational_file where id='00000000-0000-0000-0000-00000000fe02';
  select count(*) into u2_tx from public.task where id='00000000-0000-0000-0000-00000000ae01';
  select count(*) into u2_ty from public.task where id='00000000-0000-0000-0000-00000000ae02';

  -- U3 assignee of taskY: sees taskY + fileY (task grants file), not fileX/taskX.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f3','role','authenticated')::text, true);
  select count(*) into u3_fx from public.operational_file where id='00000000-0000-0000-0000-00000000fe01';
  select count(*) into u3_fy from public.operational_file where id='00000000-0000-0000-0000-00000000fe02';
  select count(*) into u3_tx from public.task where id='00000000-0000-0000-0000-00000000ae01';
  select count(*) into u3_ty from public.task where id='00000000-0000-0000-0000-00000000ae02';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_fileX', u1_fx), ('mgr_fileY', u1_fy), ('mgr_fileB', u1_fz),
    ('mgr_taskX', u1_tx), ('mgr_taskY', u1_ty),
    ('coord_fileX', u2_fx), ('coord_fileY', u2_fy), ('coord_taskX', u2_tx), ('coord_taskY', u2_ty),
    ('transit_fileX', u3_fx), ('transit_fileY', u3_fy), ('transit_taskX', u3_tx), ('transit_taskY', u3_ty);

  if u1_fx<>1 or u1_fy<>1 or u1_fz<>0 or u1_tx<>1 or u1_ty<>1
     or u2_fx<>1 or u2_fy<>0 or u2_tx<>1 or u2_ty<>0
     or u3_fx<>0 or u3_fy<>1 or u3_tx<>0 or u3_ty<>1 then
    raise exception 'RLS VISIBILITY FAIL: mgr(fx=% fy=% fb=% tx=% ty=%) coord(fx=% fy=% tx=% ty=%) transit(fx=% fy=% tx=% ty=%)',
      u1_fx,u1_fy,u1_fz,u1_tx,u1_ty, u2_fx,u2_fy,u2_tx,u2_ty, u3_fx,u3_fy,u3_tx,u3_ty;
  end if;
end $$;

select * from _r order by check_name;
rollback;
