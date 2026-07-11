-- RLS regression test — Driver transport access (Phase 3.4C). BEGIN/ROLLBACK.
-- ---------------------------------------------------------------------------
-- Proves the additive transport_record driver policy + isolation:
--   * a DRIVER reads their OWN assigned transport (driver_user_id = them)
--   * a DRIVER does NOT read another driver's transport
--   * a DRIVER does NOT read a tenant-B transport (cross-tenant)
--   * a DRIVER does NOT read finance (payment) — no finance permission/policy
-- Expected: own=1, other=0, tenantB=0, payment=0.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000dd0001', 'drv_a@test.local'),
  ('00000000-0000-0000-0000-000000dd0002', 'drv_b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-000000dd0001', '00000000-0000-0000-0000-000000000001', 'drv_a@test.local'),
  ('00000000-0000-0000-0000-000000dd0002', '00000000-0000-0000-0000-000000000001', 'drv_b@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-000000dd0001'::uuid, 'DRIVER'),
  ('00000000-0000-0000-0000-000000dd0002'::uuid, 'DRIVER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-000000cd0001', '00000000-0000-0000-0000-000000000001', 'Drv Client A'),
  ('00000000-0000-0000-0000-000000cd0002', '00000000-0000-0000-0000-0000000000b2', 'Drv Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-000000fd0001', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-96001', 'TRP', '00000000-0000-0000-0000-000000cd0001'),
  ('00000000-0000-0000-0000-000000fd0002', '00000000-0000-0000-0000-000000000001', 'EFT-TRP-2099-96002', 'TRP', '00000000-0000-0000-0000-000000cd0001'),
  ('00000000-0000-0000-0000-000000fd0003', '00000000-0000-0000-0000-0000000000b2', 'EFT-TRP-2099-96003', 'TRP', '00000000-0000-0000-0000-000000cd0002')
on conflict (id) do nothing;

-- trx assigned to driver A; try assigned to driver B; trb (tenant B) unassigned.
insert into public.transport_record (id, tenant_id, file_id, status, driver_user_id) values
  ('00000000-0000-0000-0000-000000dd7001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000fd0001', 'DRIVER_ASSIGNED', '00000000-0000-0000-0000-000000dd0001'),
  ('00000000-0000-0000-0000-000000dd7002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000fd0002', 'DRIVER_ASSIGNED', '00000000-0000-0000-0000-000000dd0002'),
  ('00000000-0000-0000-0000-000000dd7003', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000fd0003', 'NOT_STARTED', null)
on conflict (id) do nothing;

-- A finance row the driver must never read.
insert into public.invoice (id, tenant_id, file_id, status, currency)
values ('00000000-0000-0000-0000-000000dd9001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000fd0001', 'DRAFT', 'XOF')
on conflict (id) do nothing;
insert into public.payment (id, tenant_id, invoice_id, amount, method, paid_at)
values ('00000000-0000-0000-0000-000000dd9002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000dd9001', 1000, 'CASH', now())
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare own int; other int; tenant_b int; fin int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-000000dd0001','role','authenticated')::text, true);

  select count(*) into own      from public.transport_record where id='00000000-0000-0000-0000-000000dd7001';
  select count(*) into other    from public.transport_record where id='00000000-0000-0000-0000-000000dd7002';
  select count(*) into tenant_b from public.transport_record where id='00000000-0000-0000-0000-000000dd7003';
  select count(*) into fin      from public.payment          where id='00000000-0000-0000-0000-000000dd9002';

  perform set_config('role', 'postgres', true);
  insert into _r values ('own', own), ('other', other), ('tenant_b', tenant_b), ('payment', fin);

  if own<>1 or other<>0 or tenant_b<>0 or fin<>0 then
    raise exception 'RLS DRIVER FAIL: own=% other=% tenant_b=% payment=%', own, other, tenant_b, fin;
  end if;
end $$;

select * from _r order by check_name;
rollback;
