-- RLS regression test — Physical deposit + Collections (Phase 5.0D). Non-destructive.
-- ---------------------------------------------------------------------------
-- READ isolation (RLS):
--   * ADMINISTRATIVE_OFFICER (admin_service:manage) sees tenant-A deposits, NOT tenant B
--   * COURIER sees ONLY the deposit assigned to them — never another courier's,
--     never an unassigned one
--   * COURIER sees NO collection follow-up at all
--   * COLLECTIONS_OFFICER sees collections + accepted proofs, tenant-scoped
--   * DRIVER sees neither deposits nor collections
--   * a portal/platform identity (no app_user row) sees nothing
--
-- WRITE integrity (triggers — the backstop against a buggy server action):
--   * a courier from another tenant is rejected
--   * a proof document from another dossier is rejected
--   * an invoice maker/checker from another tenant is rejected
--   * a collection follow-up is APPEND-ONLY (update blocked)
--
-- Requires all migrations + seed applied.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
values ('00000000-0000-0000-0000-0000000000b2', 'ADMINISTRATIVE_OFFICER', 'Agent administratif', 'Administrative Officer', true)
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('admin_service:manage', 'file:read', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-0000000000b2' and r.code = 'ADMINISTRATIVE_OFFICER'
on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000da001', 'd-admin@test.local'),
  ('00000000-0000-0000-0000-0000000da002', 'd-courier1@test.local'),
  ('00000000-0000-0000-0000-0000000da003', 'd-courier2@test.local'),
  ('00000000-0000-0000-0000-0000000da004', 'd-collections@test.local'),
  ('00000000-0000-0000-0000-0000000da005', 'd-driver@test.local'),
  ('00000000-0000-0000-0000-0000000da006', 'd-admin-b@test.local'),
  ('00000000-0000-0000-0000-0000000da007', 'd-outsider@test.local')
on conflict (id) do nothing;

-- da007 has NO app_user row: stands in for a portal user / platform admin.
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-000000000001', 'd-admin@test.local'),
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-000000000001', 'd-courier1@test.local'),
  ('00000000-0000-0000-0000-0000000da003', '00000000-0000-0000-0000-000000000001', 'd-courier2@test.local'),
  ('00000000-0000-0000-0000-0000000da004', '00000000-0000-0000-0000-000000000001', 'd-collections@test.local'),
  ('00000000-0000-0000-0000-0000000da005', '00000000-0000-0000-0000-000000000001', 'd-driver@test.local'),
  ('00000000-0000-0000-0000-0000000da006', '00000000-0000-0000-0000-0000000000b2', 'd-admin-b@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000da001'::uuid, 'ADMINISTRATIVE_OFFICER', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000da002'::uuid, 'COURIER',                '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000da003'::uuid, 'COURIER',                '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000da004'::uuid, 'COLLECTIONS_OFFICER',    '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000da005'::uuid, 'DRIVER',                 '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-0000000da006'::uuid, 'ADMINISTRATIVE_OFFICER', '00000000-0000-0000-0000-0000000000b2'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000dac1', '00000000-0000-0000-0000-000000000001', 'D Client A'),
  ('00000000-0000-0000-0000-00000000dac2', '00000000-0000-0000-0000-0000000000b2', 'D Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000daf1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95001', 'IMP', '00000000-0000-0000-0000-00000000dac1'),
  ('00000000-0000-0000-0000-00000000daf2', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95002', 'IMP', '00000000-0000-0000-0000-00000000dac1'),
  ('00000000-0000-0000-0000-00000000daf3', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-95003', 'IMP', '00000000-0000-0000-0000-00000000dac2')
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, client_id, status) values
  ('00000000-0000-0000-0000-00000000dai1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf1', '00000000-0000-0000-0000-00000000dac1', 'VALIDATED'),
  ('00000000-0000-0000-0000-00000000dai2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf2', '00000000-0000-0000-0000-00000000dac1', 'VALIDATED'),
  ('00000000-0000-0000-0000-00000000dai3', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000daf3', '00000000-0000-0000-0000-00000000dac2', 'VALIDATED')
on conflict (id) do nothing;

-- dep1 assigned to courier1; dep2 assigned to courier2; dep3 tenant B.
insert into public.invoice_deposit (id, tenant_id, file_id, invoice_id, status, courier_user_id) values
  ('00000000-0000-0000-0000-00000000dad1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf1', '00000000-0000-0000-0000-00000000dai1', 'ASSIGNED', '00000000-0000-0000-0000-0000000da002'),
  ('00000000-0000-0000-0000-00000000dad2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf2', '00000000-0000-0000-0000-00000000dai2', 'ASSIGNED', '00000000-0000-0000-0000-0000000da003'),
  ('00000000-0000-0000-0000-00000000dad3', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000daf3', '00000000-0000-0000-0000-00000000dai3', 'ASSIGNED', null)
on conflict (id) do nothing;

insert into public.collection_follow_up (id, tenant_id, file_id, invoice_id, channel, outcome, note) values
  ('00000000-0000-0000-0000-00000000dcf1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf1', '00000000-0000-0000-0000-00000000dai1', 'PHONE', 'PROMISE_TO_PAY', 'Relance 1'),
  ('00000000-0000-0000-0000-00000000dcf3', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000daf3', '00000000-0000-0000-0000-00000000dai3', 'PHONE', 'NO_ANSWER', 'Relance B')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------- READ RLS ----
do $$
declare
  admin_a int; admin_b int;
  c1_own int; c1_other int; c1_collections int;
  coll_a int; coll_b int;
  driver_dep int; driver_coll int;
  outsider int;
  adminb_a int; adminb_b int;
begin
  perform set_config('role', 'authenticated', true);

  -- ADMINISTRATIVE_OFFICER (tenant A)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da001','role','authenticated')::text, true);
  select count(*) into admin_a from public.invoice_deposit where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into admin_b from public.invoice_deposit where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  -- COURIER 1 — must see ONLY their own assignment.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da002','role','authenticated')::text, true);
  select count(*) into c1_own from public.invoice_deposit where id = '00000000-0000-0000-0000-00000000dad1';
  select count(*) into c1_other from public.invoice_deposit where id = '00000000-0000-0000-0000-00000000dad2';
  select count(*) into c1_collections from public.collection_follow_up;

  -- COLLECTIONS_OFFICER (tenant A)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da004','role','authenticated')::text, true);
  select count(*) into coll_a from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into coll_b from public.collection_follow_up where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  -- DRIVER — no deposit permission, no collections permission.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da005','role','authenticated')::text, true);
  select count(*) into driver_dep from public.invoice_deposit;
  select count(*) into driver_coll from public.collection_follow_up;

  -- Tenant-B admin — sees only B.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da006','role','authenticated')::text, true);
  select count(*) into adminb_a from public.invoice_deposit where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into adminb_b from public.invoice_deposit where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  -- Portal / platform identity (no app_user row).
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000da007','role','authenticated')::text, true);
  select count(*) into outsider from public.invoice_deposit;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('admin_deposits_A', admin_a), ('admin_deposits_B', admin_b),
    ('courier1_own', c1_own), ('courier1_other_courier', c1_other),
    ('courier1_collections', c1_collections),
    ('collections_A', coll_a), ('collections_B', coll_b),
    ('driver_deposits', driver_dep), ('driver_collections', driver_coll),
    ('tenantB_admin_sees_A', adminb_a), ('tenantB_admin_sees_B', adminb_b),
    ('no_tenant_identity', outsider);

  if admin_a <> 2 or admin_b <> 0
     or c1_own <> 1 or c1_other <> 0 or c1_collections <> 0
     or coll_a <> 1 or coll_b <> 0
     or driver_dep <> 0 or driver_coll <> 0
     or adminb_a <> 0 or adminb_b <> 1
     or outsider <> 0 then
    raise exception 'RLS 5.0D FAIL: admin(A=% B=%) courier1(own=% other=% coll=%) collections(A=% B=%) driver(dep=% coll=%) adminB(A=% B=%) outsider=%',
      admin_a, admin_b, c1_own, c1_other, c1_collections, coll_a, coll_b,
      driver_dep, driver_coll, adminb_a, adminb_b, outsider;
  end if;
end $$;

-- ------------------------------------------------- WRITE INTEGRITY (triggers) ----
do $$
declare
  blocked_courier boolean := false;
  blocked_proof   boolean := false;
  blocked_checker boolean := false;
  blocked_update  boolean := false;
begin
  -- 1. courier from another tenant.
  begin
    insert into public.invoice_deposit (tenant_id, file_id, invoice_id, courier_user_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf1',
            '00000000-0000-0000-0000-00000000dai1', '00000000-0000-0000-0000-0000000da006');
  exception when others then blocked_courier := true;
  end;

  -- 2. proof document belonging to ANOTHER dossier.
  declare
    doc_id uuid;
  begin
    insert into public.document (tenant_id, file_id, type_code, storage_path, status)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000daf2',
            'PROOF_OF_DEPOSIT', 'x/y/z.pdf', 'APPROVED')
    returning id into doc_id;

    update public.invoice_deposit
      set proof_document_id = doc_id
      where id = '00000000-0000-0000-0000-00000000dad1';  -- dad1 is on daf1, doc is on daf2
  exception when others then blocked_proof := true;
  end;

  -- 3. invoice checker from another tenant.
  begin
    update public.invoice
      set validated_by = '00000000-0000-0000-0000-0000000da006'
      where id = '00000000-0000-0000-0000-00000000dai1';
  exception when others then blocked_checker := true;
  end;

  -- 4. collection follow-ups are APPEND-ONLY.
  begin
    update public.collection_follow_up
      set note = 'rewritten'
      where id = '00000000-0000-0000-0000-00000000dcf1';
  exception when others then blocked_update := true;
  end;

  insert into _r values
    ('blocked_cross_tenant_courier', blocked_courier::int),
    ('blocked_foreign_proof_document', blocked_proof::int),
    ('blocked_cross_tenant_invoice_checker', blocked_checker::int),
    ('blocked_followup_update', blocked_update::int);

  if not blocked_courier or not blocked_proof or not blocked_checker or not blocked_update then
    raise exception '5.0D INTEGRITY FAIL: courier=% proof=% checker=% followup_update=%',
      blocked_courier, blocked_proof, blocked_checker, blocked_update;
  end if;
end $$;

select * from _r order by check_name;
rollback;
