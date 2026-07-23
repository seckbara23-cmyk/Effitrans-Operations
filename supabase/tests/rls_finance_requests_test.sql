-- RLS regression test — finance requests (Phase 9.0E). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves public.finance_request is tenant-confined, permission-gated, and
-- portal-invisible:
--   * staff WITH finance:read (SYSTEM_ADMIN) sees own-tenant request           -> 1
--   * staff WITHOUT finance:read (no roles) sees nothing                       -> 0
--   * a PORTAL user of the dossier's own client sees NOTHING (no portal
--     policy exists on the table — internal finance ops never reach customers) -> 0
--   * cross-tenant reads are denied                                            -> 0
--   * the tenant trigger rejects a cross-tenant request even as postgres       -> raises
--   * the dedup unique index rejects a duplicate dedup_key                     -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c3', 'Test Tenant C3', 'SN')
on conflict (id) do nothing;

-- G1 = SYSTEM_ADMIN tenant A (finance:read); G2 = tenant-A staff, no roles;
-- G3 = other-tenant staff; G4 = portal user of the dossier's client.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'fr-g1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'fr-g2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'fr-g3@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', 'fr-g4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'fr-g1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'fr-g2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c3', 'fr-g3@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-000000000001', 'FR Client A1')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cc03', 'fr-g4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fc03', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-90031', 'IMP', '00000000-0000-0000-0000-00000000cc03')
on conflict (id) do nothing;

insert into public.finance_request
  (id, tenant_id, file_id, category, amount, currency, purpose, beneficiary, requested_by, dedup_key) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fc03', 'CUSTOMS_DUTY', 250000, 'XOF',
   'Droits de douane — déclaration test', 'Douanes sénégalaises',
   '00000000-0000-0000-0000-0000000000e1', 'fr-test-dedup-1')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  g1_sees int; g2_sees int; g3_sees int; g4_sees int;
  trigger_rejected int := 0;
  dedup_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- G1: SYSTEM_ADMIN tenant A — sees its own tenant's request.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into g1_sees from public.finance_request where id = '00000000-0000-0000-0000-00000000fa01';

  -- G2: tenant-A staff with NO finance:read — sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into g2_sees from public.finance_request where id = '00000000-0000-0000-0000-00000000fa01';

  -- G3: another tenant's staff — sees nothing of tenant A.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e3','role','authenticated')::text, true);
  select count(*) into g3_sees from public.finance_request where id = '00000000-0000-0000-0000-00000000fa01';

  -- G4: portal user of the dossier's OWN client — internal finance ops are
  -- never customer-readable (no portal policy on the table at all).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e4','role','authenticated')::text, true);
  select count(*) into g4_sees from public.finance_request where id = '00000000-0000-0000-0000-00000000fa01';

  perform set_config('role', 'postgres', true);

  -- Defense-in-depth: the tenant trigger rejects a cross-tenant request even as postgres.
  begin
    insert into public.finance_request (tenant_id, file_id, category, amount, purpose, beneficiary, requested_by)
    values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-00000000fc03',
            'OTHER', 1000, 'cross-tenant probe', 'X', '00000000-0000-0000-0000-0000000000e3');
  exception when others then
    trigger_rejected := 1;
  end;

  -- The dedup unique index rejects a duplicate dedup_key.
  begin
    insert into public.finance_request (tenant_id, file_id, category, amount, purpose, beneficiary, requested_by, dedup_key)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fc03',
            'OTHER', 1000, 'duplicate probe', 'X', '00000000-0000-0000-0000-0000000000e1', 'fr-test-dedup-1');
  exception when others then
    dedup_rejected := 1;
  end;

  insert into _r values
    ('g1_finance_read_sees', g1_sees),
    ('g2_no_permission_sees', g2_sees),
    ('g3_cross_tenant_sees', g3_sees),
    ('g4_portal_sees', g4_sees),
    ('trigger_cross_tenant_rejected', trigger_rejected),
    ('dedup_duplicate_rejected', dedup_rejected);

  if g1_sees<>1 or g2_sees<>0 or g3_sees<>0 or g4_sees<>0
     or trigger_rejected<>1 or dedup_rejected<>1
  then
    raise exception 'RLS FINANCE REQUESTS FAIL: g1=% g2=% g3=% g4=% trigger=% dedup=%',
      g1_sees, g2_sees, g3_sees, g4_sees, trigger_rejected, dedup_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
