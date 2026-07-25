-- RLS regression test — Finance Expense Documents (Phase 11.0B). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the expense bounded context is tenant-confined, gated on
-- finance:expense:read, portal-invisible, append-only where required, and 1:1:
--   * FINANCE_OFFICER (finance:expense:read) sees its own tenant's authorization -> 1
--   * a tenant-A staff account WITHOUT the permission sees NOTHING              -> 0
--   * another tenant's staff holding the permission sees NOTHING (isolation)    -> 0
--   * a PORTAL user sees NOTHING (no portal policy on the tables)               -> 0
--   * expense_visa is append-only: UPDATE and DELETE both raise                 -> raises
--   * expense_authorization_version is immutable: UPDATE raises                 -> raises
--   * the 1:1 constraint rejects a SECOND voucher for one authorization         -> raises
--   * the tenant trigger rejects a cross-tenant requester even as postgres      -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- Other tenant (to prove isolation) + a FINANCE_OFFICER role for it (seed only
-- seeds tenant A) so its user genuinely HOLDS finance:expense:read.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000e1', 'Test Tenant E1', 'SN')
on conflict (id) do nothing;
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000e1', 'FINANCE_OFFICER', 'Agent financier', 'Finance Officer', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-0000000000e1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

-- X1 = FINANCE_OFFICER tenant A (has finance:expense:read); X2 = QUOTATION_MANAGER
-- tenant A (no finance:expense:read); X3 = FINANCE_OFFICER tenant E1 (has the
-- permission, wrong tenant); X4 = portal user tenant A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'exp-a1@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'exp-a2@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'exp-a3@test.local'),
  ('00000000-0000-0000-0000-0000000000a4', 'exp-a4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'exp-a1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'exp-a2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', 'exp-a3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-0000000000e1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-000000000001', 'Exp Client A1')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c4', 'exp-a4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

-- The document under test: an APPROVED authorization in tenant A, plus one
-- immutable version, one voucher (the 1:1), one attempt and one visa.
insert into public.expense_authorization
  (id, tenant_id, amount, currency, beneficiary, reason, status, requested_by) values
  ('00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-000000000001',
   150000, 'XOF', 'Douane', 'Droits et taxes', 'APPROVED', '00000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

insert into public.expense_authorization_version
  (id, tenant_id, authorization_id, version_number, amount, currency, beneficiary, reason, snapshot, content_sha256) values
  ('00000000-0000-0000-0000-00000000ea02', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000ea01', 1, 150000, 'XOF', 'Douane', 'Droits et taxes', '{}'::jsonb, 'deadbeef')
on conflict (id) do nothing;

insert into public.expense_voucher
  (id, tenant_id, authorization_id, source_authorization_version, amount, currency, beneficiary, reason, status, entered_by) values
  ('00000000-0000-0000-0000-00000000ea03', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000ea01', 1, 150000, 'XOF', 'Douane', 'Droits et taxes', 'DRAFT',
   '00000000-0000-0000-0000-0000000000a1')
on conflict (id) do nothing;

insert into public.expense_approval_attempt
  (id, tenant_id, document_type, authorization_id, version_id, attempt_number, status) values
  ('00000000-0000-0000-0000-00000000ea04', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-00000000ea02', 1, 'IN_PROGRESS')
on conflict (id) do nothing;

insert into public.expense_visa
  (id, tenant_id, document_type, authorization_id, version_id, attempt_id, step_code, step_ordinal,
   signer_user_id, signer_role_code, signer_display_name, decision, content_sha256) values
  ('00000000-0000-0000-0000-00000000ea05', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-00000000ea02',
   '00000000-0000-0000-0000-00000000ea04', 'VISA_DEMANDEUR', 1,
   '00000000-0000-0000-0000-0000000000a1', 'FINANCE_OFFICER', 'Test Signer', 'APPROVED', 'deadbeef')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  x1_sees int; x2_sees int; x3_sees int; x4_sees int;
  visa_update_rejected int := 0; visa_delete_rejected int := 0;
  version_update_rejected int := 0; one_to_one_rejected int := 0; tenant_trigger_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- X1: FINANCE_OFFICER tenant A — sees its own tenant's authorization.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into x1_sees from public.expense_authorization where id = '00000000-0000-0000-0000-00000000ea01';

  -- X2: QUOTATION_MANAGER tenant A — no finance:expense:read, sees NOTHING.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
  select count(*) into x2_sees from public.expense_authorization where id = '00000000-0000-0000-0000-00000000ea01';

  -- X3: FINANCE_OFFICER tenant E1 — HAS the permission but WRONG tenant.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a3','role','authenticated')::text, true);
  select count(*) into x3_sees from public.expense_authorization where id = '00000000-0000-0000-0000-00000000ea01';

  -- X4: portal user — expense documents are never customer-readable.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000a4','role','authenticated')::text, true);
  select count(*) into x4_sees from public.expense_authorization where id = '00000000-0000-0000-0000-00000000ea01';

  perform set_config('role', 'postgres', true);

  -- Append-only visa ledger: UPDATE and DELETE both raise (even as postgres).
  begin
    update public.expense_visa set comment = 'tamper' where id = '00000000-0000-0000-0000-00000000ea05';
  exception when others then visa_update_rejected := 1;
  end;
  begin
    delete from public.expense_visa where id = '00000000-0000-0000-0000-00000000ea05';
  exception when others then visa_delete_rejected := 1;
  end;

  -- Immutable version: UPDATE raises.
  begin
    update public.expense_authorization_version set amount = 1 where id = '00000000-0000-0000-0000-00000000ea02';
  exception when others then version_update_rejected := 1;
  end;

  -- One-to-one: a SECOND voucher for the same authorization is rejected.
  begin
    insert into public.expense_voucher
      (tenant_id, authorization_id, source_authorization_version, amount, currency, beneficiary, reason, entered_by)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ea01', 1, 1, 'XOF', 'X', 'Y',
            '00000000-0000-0000-0000-0000000000a1');
  exception when others then one_to_one_rejected := 1;
  end;

  -- Tenant trigger: a cross-tenant requester is rejected (authorization in E1,
  -- requester belongs to tenant A).
  begin
    insert into public.expense_authorization (tenant_id, amount, beneficiary, reason, requested_by)
    values ('00000000-0000-0000-0000-0000000000e1', 1, 'X', 'Y', '00000000-0000-0000-0000-0000000000a1');
  exception when others then tenant_trigger_rejected := 1;
  end;

  insert into _r values
    ('x1_finance_expense_read_sees', x1_sees),
    ('x2_no_permission_sees', x2_sees),
    ('x3_cross_tenant_sees', x3_sees),
    ('x4_portal_sees', x4_sees),
    ('visa_update_rejected', visa_update_rejected),
    ('visa_delete_rejected', visa_delete_rejected),
    ('version_update_rejected', version_update_rejected),
    ('one_to_one_voucher_rejected', one_to_one_rejected),
    ('tenant_trigger_rejected', tenant_trigger_rejected);

  if x1_sees<>1 or x2_sees<>0 or x3_sees<>0 or x4_sees<>0
     or visa_update_rejected<>1 or visa_delete_rejected<>1 or version_update_rejected<>1
     or one_to_one_rejected<>1 or tenant_trigger_rejected<>1
  then
    raise exception 'RLS EXPENSE DOCUMENTS FAIL: x1=% x2=% x3=% x4=% visaU=% visaD=% verU=% one2one=% tenant=%',
      x1_sees, x2_sees, x3_sees, x4_sees, visa_update_rejected, visa_delete_rejected,
      version_update_rejected, one_to_one_rejected, tenant_trigger_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
