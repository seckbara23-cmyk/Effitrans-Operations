-- RLS regression test — Deposit chain of custody (Phase 5.0D-3). Non-destructive.
-- ---------------------------------------------------------------------------
-- READ isolation on invoice_deposit_event:
--   * ADMINISTRATIVE_OFFICER sees tenant-A custody, NOT tenant B
--   * COURIER sees ONLY the custody chain of a deposit assigned to THEM
--   * COURIER cannot read another courier's custody chain
--   * COLLECTIONS_OFFICER sees the tenant's chain (needed to chase the receivable)
--   * DRIVER sees nothing
--   * a portal/platform identity (no app_user row) sees nothing
--
-- APPEND-ONLY + integrity (triggers — the backstop against a buggy server action):
--   * a custody event can never be UPDATEd
--   * a custody event can never be DELETEd
--   * an actor from another tenant is rejected
--   * evidence borrowed from another dossier is rejected
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
  ('00000000-0000-0000-0000-00000000ce01', 'c-admin@test.local'),
  ('00000000-0000-0000-0000-00000000ce02', 'c-courier1@test.local'),
  ('00000000-0000-0000-0000-00000000ce03', 'c-courier2@test.local'),
  ('00000000-0000-0000-0000-00000000ce04', 'c-collections@test.local'),
  ('00000000-0000-0000-0000-00000000ce05', 'c-driver@test.local'),
  ('00000000-0000-0000-0000-00000000ce06', 'c-admin-b@test.local'),
  ('00000000-0000-0000-0000-00000000ce07', 'c-outsider@test.local')
on conflict (id) do nothing;

-- ce07 gets NO app_user row: a portal user / platform admin.
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-000000000001', 'c-admin@test.local'),
  ('00000000-0000-0000-0000-00000000ce02', '00000000-0000-0000-0000-000000000001', 'c-courier1@test.local'),
  ('00000000-0000-0000-0000-00000000ce03', '00000000-0000-0000-0000-000000000001', 'c-courier2@test.local'),
  ('00000000-0000-0000-0000-00000000ce04', '00000000-0000-0000-0000-000000000001', 'c-collections@test.local'),
  ('00000000-0000-0000-0000-00000000ce05', '00000000-0000-0000-0000-000000000001', 'c-driver@test.local'),
  ('00000000-0000-0000-0000-00000000ce06', '00000000-0000-0000-0000-0000000000b2', 'c-admin-b@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000ce01'::uuid, 'ADMINISTRATIVE_OFFICER', '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000ce02'::uuid, 'COURIER',                '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000ce03'::uuid, 'COURIER',                '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000ce04'::uuid, 'COLLECTIONS_OFFICER',    '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000ce05'::uuid, 'DRIVER',                 '00000000-0000-0000-0000-000000000001'::uuid),
  ('00000000-0000-0000-0000-00000000ce06'::uuid, 'ADMINISTRATIVE_OFFICER', '00000000-0000-0000-0000-0000000000b2'::uuid)
) as u(uid, code, ten)
join public.role r on r.code = u.code and r.tenant_id = u.ten
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000cec01', '00000000-0000-0000-0000-000000000001', 'C Client A'),
  ('00000000-0000-0000-0000-0000000cec02', '00000000-0000-0000-0000-0000000000b2', 'C Client B')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000cef01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-94001', 'IMP', '00000000-0000-0000-0000-0000000cec01'),
  ('00000000-0000-0000-0000-0000000cef02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-94002', 'IMP', '00000000-0000-0000-0000-0000000cec01'),
  ('00000000-0000-0000-0000-0000000cef03', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-94003', 'IMP', '00000000-0000-0000-0000-0000000cec02')
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, client_id, status) values
  ('00000000-0000-0000-0000-0000000ceb01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef01', '00000000-0000-0000-0000-0000000cec01', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000ceb02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef02', '00000000-0000-0000-0000-0000000cec01', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000ceb03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000cef03', '00000000-0000-0000-0000-0000000cec02', 'ISSUED')
on conflict (id) do nothing;

-- dep1 -> courier1, dep2 -> courier2, dep3 -> tenant B.
insert into public.invoice_deposit (id, tenant_id, file_id, invoice_id, status, courier_user_id) values
  ('00000000-0000-0000-0000-0000000ced01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef01', '00000000-0000-0000-0000-0000000ceb01', 'ASSIGNED', '00000000-0000-0000-0000-00000000ce02'),
  ('00000000-0000-0000-0000-0000000ced02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef02', '00000000-0000-0000-0000-0000000ceb02', 'ASSIGNED', '00000000-0000-0000-0000-00000000ce03'),
  ('00000000-0000-0000-0000-0000000ced03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000cef03', '00000000-0000-0000-0000-0000000ceb03', 'ASSIGNED', null)
on conflict (id) do nothing;

insert into public.invoice_deposit_event
  (id, tenant_id, file_id, invoice_id, deposit_id, event, from_status, to_status, actor_id, actor_role_code, from_department, to_department)
values
  ('00000000-0000-0000-0000-0000000cee01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef01', '00000000-0000-0000-0000-0000000ceb01', '00000000-0000-0000-0000-0000000ced01', 'COURIER_ASSIGNED', 'READY_FOR_COURIER', 'ASSIGNED', '00000000-0000-0000-0000-00000000ce01', 'ADMINISTRATIVE_OFFICER', 'administration', 'courier'),
  ('00000000-0000-0000-0000-0000000cee02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef02', '00000000-0000-0000-0000-0000000ceb02', '00000000-0000-0000-0000-0000000ced02', 'COURIER_ASSIGNED', 'READY_FOR_COURIER', 'ASSIGNED', '00000000-0000-0000-0000-00000000ce01', 'ADMINISTRATIVE_OFFICER', 'administration', 'courier'),
  ('00000000-0000-0000-0000-0000000cee03', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000cef03', '00000000-0000-0000-0000-0000000ceb03', '00000000-0000-0000-0000-0000000ced03', 'WORKFLOW_CREATED', null, 'PREPARATION_PENDING', '00000000-0000-0000-0000-00000000ce06', 'ADMINISTRATIVE_OFFICER', null, 'billing')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------- READ RLS ----
do $$
declare
  admin_a int; admin_b int;
  c1_own int; c1_other int;
  coll_a int; coll_b int;
  driver_any int; outsider_any int;
  adminb_a int; adminb_b int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce01','role','authenticated')::text, true);
  select count(*) into admin_a from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into admin_b from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  -- COURIER 1 — only their OWN deposit's custody chain.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce02','role','authenticated')::text, true);
  select count(*) into c1_own from public.invoice_deposit_event where deposit_id = '00000000-0000-0000-0000-0000000ced01';
  select count(*) into c1_other from public.invoice_deposit_event where deposit_id = '00000000-0000-0000-0000-0000000ced02';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce04','role','authenticated')::text, true);
  select count(*) into coll_a from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into coll_b from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce05','role','authenticated')::text, true);
  select count(*) into driver_any from public.invoice_deposit_event;

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce06','role','authenticated')::text, true);
  select count(*) into adminb_a from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-000000000001';
  select count(*) into adminb_b from public.invoice_deposit_event where tenant_id = '00000000-0000-0000-0000-0000000000b2';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce07','role','authenticated')::text, true);
  select count(*) into outsider_any from public.invoice_deposit_event;

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('admin_custody_A', admin_a), ('admin_custody_B', admin_b),
    ('courier1_own_chain', c1_own), ('courier1_other_chain', c1_other),
    ('collections_A', coll_a), ('collections_B', coll_b),
    ('driver_custody', driver_any),
    ('tenantB_admin_sees_A', adminb_a), ('tenantB_admin_sees_B', adminb_b),
    ('no_tenant_identity', outsider_any);

  if admin_a <> 2 or admin_b <> 0
     or c1_own <> 1 or c1_other <> 0
     or coll_a <> 2 or coll_b <> 0
     or driver_any <> 0
     or adminb_a <> 0 or adminb_b <> 1
     or outsider_any <> 0 then
    raise exception 'RLS CUSTODY FAIL: admin(A=% B=%) courier1(own=% other=%) collections(A=% B=%) driver=% adminB(A=% B=%) outsider=%',
      admin_a, admin_b, c1_own, c1_other, coll_a, coll_b, driver_any, adminb_a, adminb_b, outsider_any;
  end if;
end $$;

-- ------------------------------------------- APPEND-ONLY + integrity (triggers) ----
do $$
declare
  blocked_update boolean := false;
  blocked_delete boolean := false;
  blocked_actor  boolean := false;
  blocked_evidence boolean := false;
  doc_id uuid;
begin
  -- 1. A custody event can NEVER be rewritten.
  begin
    update public.invoice_deposit_event
      set reason = 'rewritten'
      where id = '00000000-0000-0000-0000-0000000cee01';
  exception when others then blocked_update := true;
  end;

  -- 2. ...nor deleted.
  begin
    delete from public.invoice_deposit_event where id = '00000000-0000-0000-0000-0000000cee01';
  exception when others then blocked_delete := true;
  end;

  -- 3. An actor from another tenant is rejected.
  begin
    insert into public.invoice_deposit_event
      (tenant_id, file_id, invoice_id, deposit_id, event, to_status, actor_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef01',
            '00000000-0000-0000-0000-0000000ceb01', '00000000-0000-0000-0000-0000000ced01',
            'PACKAGE_PREPARED', 'READY_FOR_COURIER', '00000000-0000-0000-0000-00000000ce06');
  exception when others then blocked_actor := true;
  end;

  -- 4. Evidence borrowed from ANOTHER dossier is rejected.
  begin
    insert into public.document (tenant_id, file_id, type_code, storage_path, status)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef02',
            'PROOF_OF_DEPOSIT', 'x/y/other.pdf', 'APPROVED')
    returning id into doc_id;

    insert into public.invoice_deposit_event
      (tenant_id, file_id, invoice_id, deposit_id, event, to_status, actor_id, evidence_document_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000cef01',
            '00000000-0000-0000-0000-0000000ceb01', '00000000-0000-0000-0000-0000000ced01',
            'PROOF_UPLOADED', 'DEPOSITED', '00000000-0000-0000-0000-00000000ce02', doc_id);
  exception when others then blocked_evidence := true;
  end;

  insert into _r values
    ('blocked_custody_update', blocked_update::int),
    ('blocked_custody_delete', blocked_delete::int),
    ('blocked_cross_tenant_actor', blocked_actor::int),
    ('blocked_foreign_evidence', blocked_evidence::int);

  if not blocked_update or not blocked_delete or not blocked_actor or not blocked_evidence then
    raise exception 'CUSTODY INTEGRITY FAIL: update=% delete=% actor=% evidence=%',
      blocked_update, blocked_delete, blocked_actor, blocked_evidence;
  end if;
end $$;

select * from _r order by check_name;
rollback;
