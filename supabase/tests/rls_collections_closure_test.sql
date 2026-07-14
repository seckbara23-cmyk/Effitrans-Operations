-- RLS regression test — Collections + closure permission (Phase 5.0D-4).
-- ---------------------------------------------------------------------------
-- READ isolation on collection_follow_up:
--   * COLLECTIONS_OFFICER sees tenant-A follow-ups, NOT tenant B
--   * COURIER sees NONE (no collections:manage)
--   * DRIVER sees NONE
--   * BILLING_OFFICER sees NONE
--   * a portal/platform identity (no app_user row) sees NONE
--
-- CLOSURE AUTHORIZATION (process:close):
--   * SYSTEM_ADMIN and OPS_SUPERVISOR hold it
--   * COLLECTIONS_OFFICER does NOT (a collector completes the recovery; a
--     supervisor closes the dossier)
--   * BILLING_OFFICER, FINANCE_OFFICER, COURIER, DRIVER do NOT
--
-- INTEGRITY (triggers):
--   * a collections assignee from another tenant is rejected
--   * a follow-up whose invoice belongs to a different dossier is rejected
--   * a follow-up can never be UPDATEd (append-only)
--
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
values ('00000000-0000-0000-0000-0000000000b2', 'COLLECTIONS_OFFICER', 'Agent de recouvrement', 'Collections Officer', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('collections:manage', 'file:read', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-0000000000b2' and r.code = 'COLLECTIONS_OFFICER'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fa01', 'x-collect@test.local'),
  ('00000000-0000-0000-0000-00000000fa02', 'x-courier@test.local'),
  ('00000000-0000-0000-0000-00000000fa03', 'x-driver@test.local'),
  ('00000000-0000-0000-0000-00000000fa04', 'x-billing@test.local'),
  ('00000000-0000-0000-0000-00000000fa05', 'x-collect-b@test.local'),
  ('00000000-0000-0000-0000-00000000fa06', 'x-outsider@test.local')
on conflict (id) do nothing;

-- fa06 gets NO app_user row: a portal user / platform admin.
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001', 'x-collect@test.local'),
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-000000000001', 'x-courier@test.local'),
  ('00000000-0000-0000-0000-00000000fa03', '00000000-0000-0000-0000-000000000001', 'x-driver@test.local'),
  ('00000000-0000-0000-0000-00000000fa04', '00000000-0000-0000-0000-000000000001', 'x-billing@test.local'),
  ('00000000-0000-0000-0000-00000000fa05', '00000000-0000-0000-0000-0000000000b2', 'x-collect-b@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000fa01'::uuid, 'COLLECTIONS_OFFICER', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000fa02'::uuid, 'COURIER',             '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000fa03'::uuid, 'DRIVER',              '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000fa04'::uuid, 'BILLING_OFFICER',     '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000fa05'::uuid, 'COLLECTIONS_OFFICER', '00000000-0000-0000-0000-0000000000b2'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000fac01', '00000000-0000-0000-0000-000000000001', 'F Client A'),
  ('00000000-0000-0000-0000-0000000fac02', '00000000-0000-0000-0000-0000000000b2', 'F Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000faf01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-93001', 'IMP', '00000000-0000-0000-0000-0000000fac01'),
  ('00000000-0000-0000-0000-0000000faf02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-93002', 'IMP', '00000000-0000-0000-0000-0000000fac01'),
  ('00000000-0000-0000-0000-0000000faf03', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-93003', 'IMP', '00000000-0000-0000-0000-0000000fac02')
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, client_id, status) values
  ('00000000-0000-0000-0000-0000000fab01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000faf01', '00000000-0000-0000-0000-0000000fac01', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000fab02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000faf02', '00000000-0000-0000-0000-0000000fac01', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000fab03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000faf03', '00000000-0000-0000-0000-0000000fac02', 'ISSUED')
on conflict (id) do nothing;

insert into public.collection_follow_up (id, tenant_id, file_id, invoice_id, channel, outcome, note) values
  ('00000000-0000-0000-0000-0000000fcf01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000faf01', '00000000-0000-0000-0000-0000000fab01', 'WHATSAPP', 'PAYMENT_PROMISED', 'Relance 1'),
  ('00000000-0000-0000-0000-0000000fcf02', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000faf03', '00000000-0000-0000-0000-0000000fab03', 'PHONE', 'NO_RESPONSE', 'Relance B')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------- READ RLS ----
do $$
declare
  coll_a int; coll_b int;
  courier_any int; driver_any int; billing_any int; outsider_any int;
  collb_a int; collb_b int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa01','role','authenticated')::text, true);
  select count(*) into coll_a from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into coll_b from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa02','role','authenticated')::text, true);
  select count(*) into courier_any from public.collection_follow_up;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa03','role','authenticated')::text, true);
  select count(*) into driver_any from public.collection_follow_up;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa04','role','authenticated')::text, true);
  select count(*) into billing_any from public.collection_follow_up;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa05','role','authenticated')::text, true);
  select count(*) into collb_a from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into collb_b from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000fa06','role','authenticated')::text, true);
  select count(*) into outsider_any from public.collection_follow_up;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('collections_A', coll_a), ('collections_B', coll_b),
    ('courier_collections', courier_any), ('driver_collections', driver_any),
    ('billing_collections', billing_any),
    ('tenantB_collector_sees_A', collb_a), ('tenantB_collector_sees_B', collb_b),
    ('no_tenant_identity', outsider_any);

  if coll_a <> 1 or coll_b <> 0
     or courier_any <> 0 or driver_any <> 0 or billing_any <> 0
     or collb_a <> 0 or collb_b <> 1
     or outsider_any <> 0 then
    raise exception 'RLS COLLECTIONS FAIL: coll(A=% B=%) courier=% driver=% billing=% collB(A=% B=%) outsider=%',
      coll_a, coll_b, courier_any, driver_any, billing_any, collb_a, collb_b, outsider_any;
  end if;
end $$;

-- --------------------------------------------------- CLOSURE AUTHORIZATION ----
do $$
declare
  admin_close int; supervisor_close int;
  collector_close int; billing_close int; finance_close int; courier_close int; driver_close int;
begin
  select count(*) into admin_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'SYSTEM_ADMIN' and p.code = 'process:close';

  select count(*) into supervisor_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'OPS_SUPERVISOR' and p.code = 'process:close';

  select count(*) into collector_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'COLLECTIONS_OFFICER' and p.code = 'process:close';

  select count(*) into billing_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'BILLING_OFFICER' and p.code = 'process:close';

  select count(*) into finance_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'FINANCE_OFFICER' and p.code = 'process:close';

  select count(*) into courier_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'COURIER' and p.code = 'process:close';

  select count(*) into driver_close
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
    where r.tenant_id = '00000000-0000-0000-0000-000000000001'
      and r.code = 'DRIVER' and p.code = 'process:close';

  insert into _r values
    ('close_system_admin', admin_close), ('close_ops_supervisor', supervisor_close),
    ('close_collections_officer', collector_close), ('close_billing_officer', billing_close),
    ('close_finance_officer', finance_close), ('close_courier', courier_close),
    ('close_driver', driver_close);

  if admin_close <> 1 or supervisor_close <> 1
     or collector_close <> 0 or billing_close <> 0 or finance_close <> 0
     or courier_close <> 0 or driver_close <> 0 then
    raise exception 'CLOSURE AUTHZ FAIL: admin=% sup=% collector=% billing=% finance=% courier=% driver=%',
      admin_close, supervisor_close, collector_close, billing_close, finance_close, courier_close, driver_close;
  end if;
end $$;

-- --------------------------------------------------------------- INTEGRITY ----
do $$
declare
  blocked_assignee boolean := false;
  blocked_mismatch boolean := false;
  blocked_update   boolean := false;
begin
  -- 1. A collections assignee from ANOTHER tenant is rejected.
  begin
    update public.invoice
      set collections_assignee_id = '00000000-0000-0000-0000-00000000fa05'
      where id = '00000000-0000-0000-0000-0000000fab01';
  exception when others then blocked_assignee := true;
  end;

  -- 2. A follow-up whose invoice belongs to a DIFFERENT dossier is rejected.
  begin
    insert into public.collection_follow_up (tenant_id, file_id, invoice_id, channel, outcome)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000faf02',
            '00000000-0000-0000-0000-0000000fab01', 'PHONE', 'NO_RESPONSE');
  exception when others then blocked_mismatch := true;
  end;

  -- 3. A follow-up is APPEND-ONLY.
  begin
    update public.collection_follow_up set note = 'rewritten'
      where id = '00000000-0000-0000-0000-0000000fcf01';
  exception when others then blocked_update := true;
  end;

  insert into _r values
    ('blocked_cross_tenant_assignee', blocked_assignee::int),
    ('blocked_invoice_file_mismatch', blocked_mismatch::int),
    ('blocked_followup_update', blocked_update::int);

  if not blocked_assignee or not blocked_mismatch or not blocked_update then
    raise exception 'COLLECTIONS INTEGRITY FAIL: assignee=% mismatch=% update=%',
      blocked_assignee, blocked_mismatch, blocked_update;
  end if;
end $$;

select * from _r order by check_name;
rollback;
