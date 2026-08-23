-- RLS regression — handoff-receiver read visibility (FIN-UAT Failure B).
-- ---------------------------------------------------------------------------
-- Proves the ratified rule and, just as importantly, its LIMITS:
--   1. CHIEF_OF_TRANSIT reads a dossier with a SENT handoff → coordinator_reception
--   2. …but NOT an unrelated dossier, merely for being Transit staff
--   3. an unauthorized role (COURIER) gains nothing from the same handoff
--   4. cross-tenant remains impossible
--   5. a RECEIVED handoff alone no longer grants visibility
--   6. the four pre-existing grounds still work (AM / coordinator / creator /
--      task-assignee / file:read:all)
--   7. stale process_step_execution.assigned_role_code is NOT the authority
-- Non-destructive: BEGIN/ROLLBACK.

begin;

-- Tenant B for isolation.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b9', 'Test Tenant B9', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e001', 'transit9@test.local'),
  ('00000000-0000-0000-0000-00000000e002', 'courier9@test.local'),
  ('00000000-0000-0000-0000-00000000e003', 'transitB9@test.local'),
  ('00000000-0000-0000-0000-00000000e004', 'creator9@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000001', 'transit9@test.local'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000001', 'courier9@test.local'),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-0000000000b9', 'transitB9@test.local'),
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-000000000001', 'creator9@test.local')
on conflict (id) do nothing;

-- Tenant B needs its own CHIEF_OF_TRANSIT role row.
-- `role` has no `name` column: it is (id, tenant_id, code, label_fr, label_en, ...).
insert into public.role (id, tenant_id, code, label_fr)
values ('00000000-0000-0000-0000-00000000e0b1', '00000000-0000-0000-0000-0000000000b9', 'CHIEF_OF_TRANSIT', 'Chef de Transit')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000e001'::uuid, 'CHIEF_OF_TRANSIT', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000e002'::uuid, 'COURIER',          '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000e003'::uuid, 'CHIEF_OF_TRANSIT', '00000000-0000-0000-0000-0000000000b9'::uuid)
) as u(uid, code, tid)
join public.role r on r.code = u.code and r.tenant_id = u.tid
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000c9a01', '00000000-0000-0000-0000-000000000001', 'Client H9'),
  ('00000000-0000-0000-0000-0000000c9b01', '00000000-0000-0000-0000-0000000000b9', 'Client H9B')
on conflict (id) do nothing;

-- F1: handed over (SENT). F2: unrelated. F3: handed over but RECEIVED.
-- F4: tenant B, handed over. F5: created_by the creator (pre-existing ground).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, created_by) values
  ('00000000-0000-0000-0000-00000000f901', '00000000-0000-0000-0000-000000000001', 'EFT-H9-0001', 'IMP', '00000000-0000-0000-0000-0000000c9a01', null),
  ('00000000-0000-0000-0000-00000000f902', '00000000-0000-0000-0000-000000000001', 'EFT-H9-0002', 'IMP', '00000000-0000-0000-0000-0000000c9a01', null),
  ('00000000-0000-0000-0000-00000000f903', '00000000-0000-0000-0000-000000000001', 'EFT-H9-0003', 'IMP', '00000000-0000-0000-0000-0000000c9a01', null),
  ('00000000-0000-0000-0000-00000000f904', '00000000-0000-0000-0000-0000000000b9', 'EFT-H9-0004', 'IMP', '00000000-0000-0000-0000-0000000c9b01', null),
  ('00000000-0000-0000-0000-00000000f905', '00000000-0000-0000-0000-000000000001', 'EFT-H9-0005', 'IMP', '00000000-0000-0000-0000-0000000c9a01', '00000000-0000-0000-0000-00000000e004')
on conflict (id) do nothing;

insert into public.process_instance (id, tenant_id, file_id) values
  ('00000000-0000-0000-0000-0000000091a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f901'),
  ('00000000-0000-0000-0000-0000000091a3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f903'),
  ('00000000-0000-0000-0000-0000000091a4', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-00000000f904')
on conflict (id) do nothing;

-- `sent_by` is NOT NULL: a handoff always records who sent it. The sender here
-- is the creator user, who is deliberately NOT one of the receivers under test.
insert into public.process_handoff (id, tenant_id, process_instance_id, from_step_key, to_step_key, status, sent_by, dedup_key) values
  ('00000000-0000-0000-0000-0000000092a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000091a1', 'am_dossier_opening', 'coordinator_reception', 'SENT',     '00000000-0000-0000-0000-00000000e004', 'h9-1'),
  ('00000000-0000-0000-0000-0000000092a3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000091a3', 'am_dossier_opening', 'coordinator_reception', 'RECEIVED', '00000000-0000-0000-0000-00000000e004', 'h9-3'),
  ('00000000-0000-0000-0000-0000000092a4', '00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000091a4', 'am_dossier_opening', 'coordinator_reception', 'SENT',     '00000000-0000-0000-0000-00000000e003', 'h9-4')
on conflict (id) do nothing;

-- A DELIBERATELY STALE execution row: the pre-ratification role code. If the
-- rule ever keys on this column, case 1 breaks — which is the point.
insert into public.process_step_execution (id, tenant_id, process_instance_id, step_key, state, assigned_role_code)
values ('00000000-0000-0000-0000-0000000093a1', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000091a1', 'coordinator_reception', 'PENDING', 'COORDINATOR')
on conflict (id) do nothing;

do $$
declare
  t_a uuid := '00000000-0000-0000-0000-000000000001';
  t_b uuid := '00000000-0000-0000-0000-0000000000b9';
  u_transit  uuid := '00000000-0000-0000-0000-00000000e001';
  u_courier  uuid := '00000000-0000-0000-0000-00000000e002';
  u_transitB uuid := '00000000-0000-0000-0000-00000000e003';
  u_creator  uuid := '00000000-0000-0000-0000-00000000e004';
  f_sent     uuid := '00000000-0000-0000-0000-00000000f901';
  f_unrel    uuid := '00000000-0000-0000-0000-00000000f902';
  f_received uuid := '00000000-0000-0000-0000-00000000f903';
  f_tenantB  uuid := '00000000-0000-0000-0000-00000000f904';
  f_created  uuid := '00000000-0000-0000-0000-00000000f905';
  ok boolean;
begin
  -- 1. The receiver CAN read the handed-over dossier.
  select exists (select 1 from public.user_readable_file_ids(u_transit, t_a) v where v.id = f_sent) into ok;
  if not ok then raise exception 'FAIL 1: Chef de Transit cannot read a dossier handed to Transit'; end if;

  -- 2. …and CANNOT read an unrelated dossier just for being Transit staff.
  select exists (select 1 from public.user_readable_file_ids(u_transit, t_a) v where v.id = f_unrel) into ok;
  if ok then raise exception 'FAIL 2: Transit staff gained blanket visibility'; end if;

  -- 3. An unauthorized role gains nothing from the same handoff.
  select exists (select 1 from public.user_readable_file_ids(u_courier, t_a) v where v.id = f_sent) into ok;
  if ok then raise exception 'FAIL 3: an unauthorized role obtained handoff visibility'; end if;

  -- 4. Cross-tenant stays impossible, in BOTH directions.
  select exists (select 1 from public.user_readable_file_ids(u_transit, t_a) v where v.id = f_tenantB) into ok;
  if ok then raise exception 'FAIL 4a: cross-tenant read via handoff'; end if;
  select exists (select 1 from public.user_readable_file_ids(u_transit, t_b) v where v.id = f_tenantB) into ok;
  if ok then raise exception 'FAIL 4b: tenant-A user read tenant-B file by passing tenant B'; end if;
  select exists (select 1 from public.user_readable_file_ids(u_transitB, t_b) v where v.id = f_tenantB) into ok;
  if not ok then raise exception 'FAIL 4c: tenant-B receiver lost their own legitimate read'; end if;

  -- 5. A RECEIVED handoff alone no longer grants visibility.
  select exists (select 1 from public.user_readable_file_ids(u_transit, t_a) v where v.id = f_received) into ok;
  if ok then raise exception 'FAIL 5: visibility survived reception'; end if;

  -- 6. Pre-existing grounds intact (creator here; the others are covered by
  --    rls_visibility_test.sql and must not regress).
  select exists (select 1 from public.user_readable_file_ids(u_creator, t_a) v where v.id = f_created) into ok;
  if not ok then raise exception 'FAIL 6: created_by visibility regressed'; end if;

  raise notice 'handoff-receiver visibility: all 6 groups hold';
end $$;

rollback;
