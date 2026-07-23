-- RLS regression test — workflow structural extensions (Phase 9.0B). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the Phase 9.0B tables are tenant-confined, permission-gated, and
-- portal-invisible:
--   * staff WITH process:read (SYSTEM_ADMIN) sees own-tenant decision/blocker    -> 1 / 1
--   * staff WITHOUT process:read (DRIVER-equivalent) sees nothing                -> 0 / 0
--   * a PORTAL user sees NO decision and NO blocker — even a customer_visible
--     one (no portal policy exists on these tables at all)                       -> 0 / 0
--   * cross-tenant reads are denied for every table                              -> 0 / 0 / 0
--   * team membership is tenant-scoped: own tenant sees the roster,
--     another tenant's staff does not                                            -> 1 / 0
--   * the DB triggers reject a cross-tenant team member and a cross-tenant
--     process owner even from the postgres role (defense-in-depth)               -> both raise
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000c2', 'Test Tenant C2', 'SN')
on conflict (id) do nothing;

-- S1 = SYSTEM_ADMIN tenant A (process:read); S2 = staff tenant A with NO roles;
-- S3 = SYSTEM_ADMIN-equivalent of tenant C2; P1 = portal user tenant A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'ws-s1@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'ws-s2@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'ws-s3@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'ws-p1@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'ws-s1@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'ws-s2@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000c2', 'ws-s3@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000001', 'WS Client A1')
on conflict (id) do nothing;

insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000cc01', 'ws-p1@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fc01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-90021', 'IMP', '00000000-0000-0000-0000-00000000cc01')
on conflict (id) do nothing;

insert into public.process_instance (id, tenant_id, file_id) values
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fc01')
on conflict (id) do nothing;

-- A decision + a CUSTOMER-VISIBLE blocker (the strongest portal-leak test case).
insert into public.process_decision (id, tenant_id, process_instance_id, decision_type, requested_by, reason) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a101', 'CONTINUE_BEFORE_PAYMENT', '00000000-0000-0000-0000-0000000000f1', 'Client stratégique — poursuite demandée avant paiement.')
on conflict (id) do nothing;

insert into public.process_blocker (id, tenant_id, process_instance_id, category, title, description, opened_by, customer_visible, customer_message) values
  ('00000000-0000-0000-0000-00000000b101', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a101', 'PAYMENT_PENDING', 'Paiement fournisseur en attente', 'INTERNE: montant en litige avec le fournisseur X', '00000000-0000-0000-0000-0000000000f1', true, 'Une étape est en attente de confirmation.')
on conflict (id) do nothing;

insert into public.organization_team_member (id, tenant_id, team_code, app_user_id) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000001', 'MARITIME', '00000000-0000-0000-0000-0000000000f1')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  s1_decision int; s1_blocker int; s1_team int;
  s2_decision int; s2_blocker int;
  s3_decision int; s3_blocker int; s3_team int;
  p1_decision int; p1_blocker int;
  trigger_team_rejected int := 0;
  trigger_owner_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- S1: SYSTEM_ADMIN tenant A — sees its own tenant's rows.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f1','role','authenticated')::text, true);
  select count(*) into s1_decision from public.process_decision where id = '00000000-0000-0000-0000-00000000d101';
  select count(*) into s1_blocker  from public.process_blocker  where id = '00000000-0000-0000-0000-00000000b101';
  select count(*) into s1_team     from public.organization_team_member where id = '00000000-0000-0000-0000-00000000e101';

  -- S2: tenant-A staff with NO process:read — sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f2','role','authenticated')::text, true);
  select count(*) into s2_decision from public.process_decision where id = '00000000-0000-0000-0000-00000000d101';
  select count(*) into s2_blocker  from public.process_blocker  where id = '00000000-0000-0000-0000-00000000b101';

  -- S3: another tenant's staff — sees nothing of tenant A.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f3','role','authenticated')::text, true);
  select count(*) into s3_decision from public.process_decision where id = '00000000-0000-0000-0000-00000000d101';
  select count(*) into s3_blocker  from public.process_blocker  where id = '00000000-0000-0000-0000-00000000b101';
  select count(*) into s3_team     from public.organization_team_member where id = '00000000-0000-0000-0000-00000000e101';

  -- P1: portal user of the dossier's OWN client — still sees NOTHING internal,
  -- including the customer_visible blocker (no portal policy on these tables;
  -- the customer surface goes through a customer-safe reader in a later phase).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f4','role','authenticated')::text, true);
  select count(*) into p1_decision from public.process_decision where id = '00000000-0000-0000-0000-00000000d101';
  select count(*) into p1_blocker  from public.process_blocker  where id = '00000000-0000-0000-0000-00000000b101';

  perform set_config('role', 'postgres', true);

  -- Defense-in-depth: the tenant triggers reject cross-tenant rows even as postgres.
  begin
    insert into public.organization_team_member (tenant_id, team_code, app_user_id)
    values ('00000000-0000-0000-0000-0000000000c2', 'AIBD', '00000000-0000-0000-0000-0000000000f1');
  exception when others then
    trigger_team_rejected := 1;
  end;

  begin
    update public.process_instance
      set owner_user_id = '00000000-0000-0000-0000-0000000000f3'
      where id = '00000000-0000-0000-0000-00000000a101';
  exception when others then
    trigger_owner_rejected := 1;
  end;

  insert into _r values
    ('s1_decision', s1_decision), ('s1_blocker', s1_blocker), ('s1_team', s1_team),
    ('s2_no_permission_decision', s2_decision), ('s2_no_permission_blocker', s2_blocker),
    ('s3_cross_tenant_decision', s3_decision), ('s3_cross_tenant_blocker', s3_blocker), ('s3_cross_tenant_team', s3_team),
    ('p1_portal_decision', p1_decision), ('p1_portal_blocker', p1_blocker),
    ('trigger_team_rejected', trigger_team_rejected), ('trigger_owner_rejected', trigger_owner_rejected);

  if s1_decision<>1 or s1_blocker<>1 or s1_team<>1
     or s2_decision<>0 or s2_blocker<>0
     or s3_decision<>0 or s3_blocker<>0 or s3_team<>0
     or p1_decision<>0 or p1_blocker<>0
     or trigger_team_rejected<>1 or trigger_owner_rejected<>1
  then
    raise exception 'RLS WORKFLOW STRUCTURES FAIL: s1(d=% b=% t=%) s2(d=% b=%) s3(d=% b=% t=%) p1(d=% b=%) triggers(team=% owner=%)',
      s1_decision, s1_blocker, s1_team, s2_decision, s2_blocker,
      s3_decision, s3_blocker, s3_team, p1_decision, p1_blocker,
      trigger_team_rejected, trigger_owner_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
