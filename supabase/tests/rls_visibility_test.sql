-- RLS regression test — Visibility scoping (Phase 1.7). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the visibility model on operational_file + task against a REAL database:
--   * manager (OPS_SUPERVISOR, file/task:read:all) sees ALL tenant-A files/tasks,
--     but NOT tenant B (isolation)
--   * COORDINATOR (file:read:all, ratified 2026-10-01) sees EVERY tenant-A
--     dossier — the one it coordinates, one it has no relationship with at all,
--     and the closed and cancelled ones — but NOT tenant B
--   * tenant B's OWN Coordinator sees every tenant-B dossier and ZERO tenant-A
--     dossiers -- the contract is per-tenant and symmetric, not a tenant-A rule
--   * CHIEF_OF_TRANSIT, which holds NO file:read:all, stays relationship-scoped:
--     the task assigned to it and that task's dossier, nothing else
--
-- WHAT CHANGED HERE, AND WHY (COORDINATOR-TENANT-VISIBILITY-01).
--
-- This file used to assert `coord_fileY = 0` — that a Coordinator must NOT see a
-- dossier it was not personally attached to. That premise was ratified away on
-- 2026-10-01 after production disproved it: `user_readable_file_ids` returned
-- ZERO rows for coordonateur.demo@effitrans.sn while tenant A held fourteen
-- dossiers, because every ground except `file:read:all` asks "is this dossier
-- attached to you PERSONALLY?" and the control tower is attached to none of them
-- until it has already worked on one. The rule is now: assignment and custody
-- decide what a Coordinator may ACT ON; they do not decide what it may SEE.
--
-- So the old expectation is INVERTED rather than deleted, and the thing it was
-- really protecting — that a role WITHOUT tenant-wide read stays narrow — is
-- proven by U3 below instead. That is the assertion that must never flip, and it
-- is now carried by a role for which it is still true.
--
-- WHY TENANT B GETS A FULL ROLE HERE. The ratified contract is platform-wide:
-- EVERY tenant's Coordinator reads that tenant and only that tenant. The
-- migration is keyed on `r.code = 'COORDINATOR'` with no tenant filter, and
-- `provision_tenant` materializes the same template for a new tenant, so tenant
-- B's role row is given the permissions a provisioned Coordinator actually holds
-- rather than an empty role that would prove nothing either way.
--
-- SEE ≠ ACT is NOT asserted here. RLS governs SELECT; execution authority lives
-- in the server actions and is asserted in tests/coordinator-tenant-visibility-01.
--
-- Expected per check: see the final assertion (all must hold or it raises).
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Tenant B is a provisioned tenant in its own right: it needs its own
-- COORDINATOR role row, carrying the permissions provision_tenant would give it.
insert into public.role (id, tenant_id, code, label_fr)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 'COORDINATOR', 'Coordinateur')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:read:all', 'task:read')
where r.tenant_id = '00000000-0000-0000-0000-0000000000b2' and r.code = 'COORDINATOR'
on conflict do nothing;

-- Users: U1 manager (read:all), U2 coordinator, U3 chief-of-transit (assignee),
-- U4 tenant-B coordinator.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'mgr@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'coord@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'transit@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'coordb@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'mgr@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'coord@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', 'transit@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000b2', 'coordb@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000f1'::uuid, 'OPS_SUPERVISOR',   '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000000f2'::uuid, 'COORDINATOR',      '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000000f3'::uuid, 'CHIEF_OF_TRANSIT', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000000f4'::uuid, 'COORDINATOR',      '00000000-0000-0000-0000-0000000000b2'::uuid)
) as u(uid, code, tid)
join public.role r on r.code = u.code and r.tenant_id = u.tid
on conflict do nothing;

-- Clients (operational_file.client_id is NOT NULL).
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- fileX: coordinated by U2.  fileY: unrelated owners, but has a task for U3.
-- fileW / fileV: tenant A, terminal lifecycle states, NO relationship to anyone —
--   the archive case the ratified rule says must stay readable.
-- fileZ: tenant B (isolation).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id, status) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95001', 'IMP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000f2', 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95002', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null, 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000fe03', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95004', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null, 'CLOSED'),
  ('00000000-0000-0000-0000-00000000fe04', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95005', 'IMP', '00000000-0000-0000-0000-00000000c1a0', null, 'CANCELLED'),
  ('00000000-0000-0000-0000-00000000fe0b', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-95003', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null, 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000fe0c', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-95006', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null, 'CLOSED')
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
  u2_fx int; u2_fy int; u2_fz int; u2_fw int; u2_fv int; u2_tx int; u2_ty int;
  u3_fx int; u3_fy int; u3_fw int; u3_fv int; u3_tx int; u3_ty int;
  u4_b1 int; u4_b2 int; u4_a_all int;
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

  -- U2 COORDINATOR: tenant-wide. fileX (coordinated), fileY (NO relationship at
  -- all — this is the assertion the ratified rule inverted), fileW CLOSED and
  -- fileV CANCELLED (lifecycle state is not a visibility rule), and tenant B
  -- still denied. taskY follows as a DERIVED read: can_read_task admits a task
  -- whose file_id is readable, so no second grant was needed or made.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f2','role','authenticated')::text, true);
  select count(*) into u2_fx from public.operational_file where id='00000000-0000-0000-0000-00000000fe01';
  select count(*) into u2_fy from public.operational_file where id='00000000-0000-0000-0000-00000000fe02';
  select count(*) into u2_fw from public.operational_file where id='00000000-0000-0000-0000-00000000fe03';
  select count(*) into u2_fv from public.operational_file where id='00000000-0000-0000-0000-00000000fe04';
  select count(*) into u2_fz from public.operational_file where id='00000000-0000-0000-0000-00000000fe0b';
  select count(*) into u2_tx from public.task where id='00000000-0000-0000-0000-00000000ae01';
  select count(*) into u2_ty from public.task where id='00000000-0000-0000-0000-00000000ae02';

  -- U3 assignee of taskY, holding NO file:read:all: sees taskY + fileY (the task
  -- grants the file) and NOTHING else — not fileX, and not the terminal dossiers
  -- the Coordinator now reaches. This is the narrow-by-default rule, and it must
  -- never flip.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f3','role','authenticated')::text, true);
  select count(*) into u3_fx from public.operational_file where id='00000000-0000-0000-0000-00000000fe01';
  select count(*) into u3_fy from public.operational_file where id='00000000-0000-0000-0000-00000000fe02';
  select count(*) into u3_fw from public.operational_file where id='00000000-0000-0000-0000-00000000fe03';
  select count(*) into u3_fv from public.operational_file where id='00000000-0000-0000-0000-00000000fe04';
  select count(*) into u3_tx from public.task where id='00000000-0000-0000-0000-00000000ae01';
  select count(*) into u3_ty from public.task where id='00000000-0000-0000-0000-00000000ae02';

  -- U4 tenant-B COORDINATOR: the SAME contract, in its own tenant. Every B
  -- dossier (including the CLOSED one) and not one row of tenant A. This is the
  -- symmetric half -- the rule is per-tenant, not a tenant-A exception.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f4','role','authenticated')::text, true);
  select count(*) into u4_b1 from public.operational_file where id='00000000-0000-0000-0000-00000000fe0b';
  select count(*) into u4_b2 from public.operational_file where id='00000000-0000-0000-0000-00000000fe0c';
  select count(*) into u4_a_all from public.operational_file
   where tenant_id='00000000-0000-0000-0000-000000000001';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('mgr_fileX', u1_fx), ('mgr_fileY', u1_fy), ('mgr_fileB', u1_fz),
    ('mgr_taskX', u1_tx), ('mgr_taskY', u1_ty),
    ('coord_fileX', u2_fx), ('coord_fileY_unrelated', u2_fy),
    ('coord_fileW_closed', u2_fw), ('coord_fileV_cancelled', u2_fv),
    ('coord_fileB_other_tenant', u2_fz), ('coord_taskX', u2_tx), ('coord_taskY', u2_ty),
    ('transit_fileX', u3_fx), ('transit_fileY', u3_fy),
    ('transit_fileW_closed', u3_fw), ('transit_fileV_cancelled', u3_fv),
    ('transit_taskX', u3_tx), ('transit_taskY', u3_ty),
    ('coordB_sees_own_tenant', u4_b1 + u4_b2), ('coordB_sees_tenant_A', u4_a_all);

  if u1_fx<>1 or u1_fy<>1 or u1_fz<>0 or u1_tx<>1 or u1_ty<>1
     or u2_fx<>1 or u2_fy<>1 or u2_fw<>1 or u2_fv<>1 or u2_fz<>0 or u2_tx<>1 or u2_ty<>1
     or u3_fx<>0 or u3_fy<>1 or u3_fw<>0 or u3_fv<>0 or u3_tx<>0 or u3_ty<>1
     or u4_b1<>1 or u4_b2<>1 or u4_a_all<>0 then
    raise exception 'RLS VISIBILITY FAIL: mgr(fx=% fy=% fb=% tx=% ty=%) coord(fx=% fy=% fw=% fv=% fb=% tx=% ty=%) transit(fx=% fy=% fw=% fv=% tx=% ty=%) coordB(b1=% b2=% seesA=%)',
      u1_fx,u1_fy,u1_fz,u1_tx,u1_ty,
      u2_fx,u2_fy,u2_fw,u2_fv,u2_fz,u2_tx,u2_ty,
      u3_fx,u3_fy,u3_fw,u3_fv,u3_tx,u3_ty,
      u4_b1,u4_b2,u4_a_all;
  end if;
end $$;

select * from _r order by check_name;
rollback;
