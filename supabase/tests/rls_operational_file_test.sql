-- RLS regression test — Operational File (Phase 1.2). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves for operational_file / shipment / file_state_transition:
--   * a tenant-A user WITH file:read reads tenant A's own file/shipment/history -> 1
--   * the same user CANNOT read tenant B's file/shipment                        -> 0
--   * a tenant-A user WITHOUT file:read reads nothing                           -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- reader (SYSTEM_ADMIN -> file:read) and plain (CUSTOMS_DECLARANT -> no file:read), both tenant A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fe01', 'reader@test.local'),
  ('00000000-0000-0000-0000-00000000fe02', 'plain@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000fe01', '00000000-0000-0000-0000-000000000001', 'reader@test.local'),
  ('00000000-0000-0000-0000-00000000fe02', '00000000-0000-0000-0000-000000000001', 'plain@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000fe01', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000fe02', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CUSTOMS_DECLARANT'
on conflict do nothing;

-- A client in each tenant (files require a client).
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000f1a00', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-0000000f1b00', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- A file in each tenant (literal numbers; this test bypasses the numbering fn).
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000f1a0', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-90001', 'IMP', '00000000-0000-0000-0000-0000000f1a00'),
  ('00000000-0000-0000-0000-00000000f1b0', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-90002', 'IMP', '00000000-0000-0000-0000-0000000f1b00')
on conflict (id) do nothing;

insert into public.shipment (tenant_id, file_id, transport_mode) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f1a0', 'SEA'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000f1b0', 'AIR')
on conflict (file_id) do nothing;

insert into public.file_state_transition (tenant_id, file_id, from_status, to_status, actor_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000f1a0', 'DRAFT', 'OPENED', '00000000-0000-0000-0000-00000000fe01');

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  reader_file int; reader_b_file int; plain_file int;
  reader_ship int; reader_b_ship int; reader_trans int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fe01','role','authenticated')::text, true);
  select count(*) into reader_file   from public.operational_file      where id='00000000-0000-0000-0000-00000000f1a0';
  select count(*) into reader_b_file from public.operational_file      where id='00000000-0000-0000-0000-00000000f1b0';
  select count(*) into reader_ship   from public.shipment              where file_id='00000000-0000-0000-0000-00000000f1a0';
  select count(*) into reader_b_ship from public.shipment              where file_id='00000000-0000-0000-0000-00000000f1b0';
  select count(*) into reader_trans  from public.file_state_transition where file_id='00000000-0000-0000-0000-00000000f1a0';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fe02','role','authenticated')::text, true);
  select count(*) into plain_file from public.operational_file where id='00000000-0000-0000-0000-00000000f1a0';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('reader_sees_own_file',       reader_file),
    ('reader_sees_tenantB_file',   reader_b_file),
    ('plain_sees_own_file',        plain_file),
    ('reader_sees_own_shipment',   reader_ship),
    ('reader_sees_tenantB_shipment', reader_b_ship),
    ('reader_sees_own_transition', reader_trans);

  if reader_file <> 1 or reader_b_file <> 0 or plain_file <> 0
     or reader_ship <> 1 or reader_b_ship <> 0 or reader_trans <> 1 then
    raise exception
      'RLS FILE FAIL: own_file=%, tenantB_file=%, plain_file=%, own_ship=%, tenantB_ship=%, own_trans=% (expected 1/0/0/1/0/1)',
      reader_file, reader_b_file, plain_file, reader_ship, reader_b_ship, reader_trans;
  end if;
end $$;

select * from _r order by check_name;
rollback;
