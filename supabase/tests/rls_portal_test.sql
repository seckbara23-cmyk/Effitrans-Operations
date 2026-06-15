-- RLS regression test — Customer Portal (Phase 1.12A). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the second identity class (client_user) is strictly client-scoped and
-- leaks nothing internal:
--   * an ACTIVE portal user sees ONLY their own client's dossiers              -> 1
--   * NOT another client's dossier in the same tenant                          -> 0
--   * NOT another tenant's dossier                                             -> 0
--   * NOT tasks                                                                -> 0
--   * NOT audit_log                                                            -> 0
--   * a DISABLED portal user sees nothing                                      -> 0
--   * STAFF RLS is unaffected (SYSTEM_ADMIN still sees the dossier)            -> 1
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- S1 = staff admin (app_user); P1 = active portal; P2 = disabled portal (client_user).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'staff@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'p1@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'p2@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'staff@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a1', '00000000-0000-0000-0000-000000000001', 'Client A1'),
  ('00000000-0000-0000-0000-00000000c1a2', '00000000-0000-0000-0000-000000000001', 'Client A2'),
  ('00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-0000000000b2', 'Client B1')
on conflict (id) do nothing;

-- P1 active -> client A1; P2 disabled -> client A1. (NOT in app_user.)
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c1a1', 'p1@test.local', 'ACTIVE', 'CLIENT_USER'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c1a1', 'p2@test.local', 'DISABLED', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fa11', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-90011', 'IMP', '00000000-0000-0000-0000-00000000c1a1'),
  ('00000000-0000-0000-0000-00000000fa12', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-90012', 'IMP', '00000000-0000-0000-0000-00000000c1a2'),
  ('00000000-0000-0000-0000-00000000fb11', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-90013', 'IMP', '00000000-0000-0000-0000-00000000c1b1')
on conflict (id) do nothing;

insert into public.task (id, tenant_id, file_id, title) values
  ('00000000-0000-0000-0000-00000000ada1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fa11', 'Internal task')
on conflict (id) do nothing;

insert into public.audit_log (action, tenant_id, actor_id)
values ('test.portal.seed', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1');

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  p1_a1 int; p1_a2 int; p1_b1 int; p1_task int; p1_audit int;
  p2_a1 int; s1_a1 int;
begin
  perform set_config('role', 'authenticated', true);

  -- P1 active portal (client A1)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
  select count(*) into p1_a1    from public.operational_file where id='00000000-0000-0000-0000-00000000fa11';
  select count(*) into p1_a2    from public.operational_file where id='00000000-0000-0000-0000-00000000fa12';
  select count(*) into p1_b1    from public.operational_file where id='00000000-0000-0000-0000-00000000fb11';
  select count(*) into p1_task  from public.task where id='00000000-0000-0000-0000-00000000ada1';
  select count(*) into p1_audit from public.audit_log where action='test.portal.seed';

  -- P2 disabled portal
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a3','role','authenticated')::text, true);
  select count(*) into p2_a1 from public.operational_file where id='00000000-0000-0000-0000-00000000fa11';

  -- S1 staff admin (staff RLS unaffected)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into s1_a1 from public.operational_file where id='00000000-0000-0000-0000-00000000fa11';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('p1_own_file', p1_a1), ('p1_other_client', p1_a2), ('p1_other_tenant', p1_b1),
    ('p1_task', p1_task), ('p1_audit', p1_audit),
    ('p2_disabled', p2_a1), ('staff_unaffected', s1_a1);

  if p1_a1<>1 or p1_a2<>0 or p1_b1<>0 or p1_task<>0 or p1_audit<>0 or p2_a1<>0 or s1_a1<>1 then
    raise exception 'RLS PORTAL FAIL: p1(own=% otherClient=% otherTenant=% task=% audit=%) p2(own=%) staff(own=%)',
      p1_a1, p1_a2, p1_b1, p1_task, p1_audit, p2_a1, s1_a1;
  end if;
end $$;

select * from _r order by check_name;
rollback;
