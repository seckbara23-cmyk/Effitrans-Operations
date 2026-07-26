-- RLS regression test — Expense supporting documents (Phase 11.0C). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the finance-classified attachment set carries the SAME confinement the
-- rest of the expense bounded context does — the point of DEC-C22 being a
-- dedicated table instead of the dossier-bound `document`:
--   * FINANCE_OFFICER (finance:expense:read) sees its tenant's attachment  -> 1
--   * tenant-A staff WITHOUT finance:expense:read sees NOTHING             -> 0
--   * another tenant's staff holding the permission sees NOTHING           -> 0
--   * a PORTAL user sees NOTHING (no portal policy on the table)           -> 0
--   * a dossier reader WITHOUT finance:expense:read sees NOTHING even when
--     the parent authorization is linked to a dossier they can read        -> 0
--   * the one-parent CHECK rejects a row with BOTH parents set             -> raises
--   * the tenant trigger rejects a cross-tenant parent                     -> raises
--   * the tenant trigger rejects a cross-tenant uploader                   -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- Other tenant (isolation) with a FINANCE_OFFICER role genuinely holding the
-- permission, so a "sees nothing" result is isolation and not a missing grant.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000f1', 'Test Tenant F1', 'SN')
on conflict (id) do nothing;
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000f1', 'FINANCE_OFFICER', 'Agent financier', 'Finance Officer', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-0000000000f1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

-- Y1 = FINANCE_OFFICER tenant A (has finance:expense:read)
-- Y2 = OPS_AGENT tenant A (dossier reader, NO finance:expense:read)
-- Y3 = FINANCE_OFFICER tenant F1 (has the permission, wrong tenant)
-- Y4 = portal user tenant A
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'att-b1@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'att-b2@test.local'),
  ('00000000-0000-0000-0000-0000000000b3', 'att-b3@test.local'),
  ('00000000-0000-0000-0000-0000000000b4', 'att-b4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'att-b1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'att-b2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f1', 'att-b3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DOCUMENTATION_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000b3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-0000000000f1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-000000000001', 'Att Client B1')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c5', 'att-b4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

-- A DOSSIER-LINKED authorization: the hardest case for the visibility class —
-- the dossier is readable by ops staff, the expense evidence must NOT be.
insert into public.operational_file (id, tenant_id, file_number, client_id, status) values
  ('00000000-0000-0000-0000-00000000fa01', '00000000-0000-0000-0000-000000000001',
   'ATT-TEST-0001', '00000000-0000-0000-0000-0000000000c5', 'OPEN')
on conflict (id) do nothing;

insert into public.expense_authorization
  (id, tenant_id, file_id, amount, currency, beneficiary, reason, status, requested_by) values
  ('00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fa01', 90000, 'XOF', 'Transitaire', 'Frais de manutention',
   'DRAFT', '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

-- A voucher on the same authorization, so the one-parent CHECK below is exercised
-- against two REAL parents (a dangling FK would "pass" the test for the wrong reason).
insert into public.expense_voucher
  (id, tenant_id, authorization_id, source_authorization_version, amount, currency, beneficiary, reason, status, entered_by) values
  ('00000000-0000-0000-0000-00000000fa04', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fa02', 1, 90000, 'XOF', 'Transitaire', 'Frais de manutention', 'DRAFT',
   '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

insert into public.expense_attachment
  (id, tenant_id, document_type, authorization_id, kind, file_name, mime_type, byte_size, storage_path, uploaded_by) values
  ('00000000-0000-0000-0000-00000000fa03', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-00000000fa02', 'Facture', 'facture.pdf',
   'application/pdf', 1024,
   '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-00000000fa02/00000000-0000-0000-0000-00000000fa03.pdf',
   '00000000-0000-0000-0000-0000000000b1')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  y1_sees int; y2_sees int; y3_sees int; y4_sees int; y2_file_sees int;
  both_parents_rejected int := 0; cross_tenant_parent_rejected int := 0; cross_tenant_uploader_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- Y1: FINANCE_OFFICER tenant A — sees the attachment.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);
  select count(*) into y1_sees from public.expense_attachment where id = '00000000-0000-0000-0000-00000000fa03';

  -- Y2: OPS_AGENT tenant A — CAN read the dossier, must NOT read its expense
  -- evidence. This is the whole reason for a separate visibility class (§14).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b2','role','authenticated')::text, true);
  select count(*) into y2_sees from public.expense_attachment where id = '00000000-0000-0000-0000-00000000fa03';
  select count(*) into y2_file_sees from public.operational_file where id = '00000000-0000-0000-0000-00000000fa01';

  -- Y3: FINANCE_OFFICER of ANOTHER tenant — holds the permission, sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b3','role','authenticated')::text, true);
  select count(*) into y3_sees from public.expense_attachment where id = '00000000-0000-0000-0000-00000000fa03';

  -- Y4: portal user — no portal policy exists on the table.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000b4','role','authenticated')::text, true);
  select count(*) into y4_sees from public.expense_attachment where id = '00000000-0000-0000-0000-00000000fa03';

  -- Structural guarantees, as the owner role (RLS is not what enforces these).
  perform set_config('role', 'postgres', true);

  -- One parent only: an authorization AND a voucher on one row is rejected.
  begin
    insert into public.expense_attachment
      (tenant_id, document_type, authorization_id, voucher_id, file_name, storage_path, uploaded_by)
    values ('00000000-0000-0000-0000-000000000001', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-00000000fa02', '00000000-0000-0000-0000-00000000fa04',
            'x.pdf', 'p/one', '00000000-0000-0000-0000-0000000000b1');
  exception when others then both_parents_rejected := 1;
  end;

  -- Cross-tenant parent: attachment claims tenant F1, parent lives in tenant A.
  begin
    insert into public.expense_attachment
      (tenant_id, document_type, authorization_id, file_name, storage_path, uploaded_by)
    values ('00000000-0000-0000-0000-0000000000f1', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-00000000fa02', 'x.pdf', 'p/two',
            '00000000-0000-0000-0000-0000000000b3');
  exception when others then cross_tenant_parent_rejected := 1;
  end;

  -- Cross-tenant uploader: parent + tenant are A, uploader belongs to F1.
  begin
    insert into public.expense_attachment
      (tenant_id, document_type, authorization_id, file_name, storage_path, uploaded_by)
    values ('00000000-0000-0000-0000-000000000001', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-00000000fa02', 'x.pdf', 'p/three',
            '00000000-0000-0000-0000-0000000000b3');
  exception when others then cross_tenant_uploader_rejected := 1;
  end;

  insert into _r values
    ('y1_finance_expense_read_sees', y1_sees),
    ('y2_dossier_reader_sees_attachment', y2_sees),
    ('y2_dossier_reader_sees_file', y2_file_sees),
    ('y3_cross_tenant_sees', y3_sees),
    ('y4_portal_sees', y4_sees),
    ('both_parents_rejected', both_parents_rejected),
    ('cross_tenant_parent_rejected', cross_tenant_parent_rejected),
    ('cross_tenant_uploader_rejected', cross_tenant_uploader_rejected);

  if y1_sees<>1 or y2_sees<>0 or y3_sees<>0 or y4_sees<>0
     or both_parents_rejected<>1 or cross_tenant_parent_rejected<>1 or cross_tenant_uploader_rejected<>1
  then
    raise exception 'RLS EXPENSE ATTACHMENTS FAIL: y1=% y2=% y2file=% y3=% y4=% both=% parent=% uploader=%',
      y1_sees, y2_sees, y2_file_sees, y3_sees, y4_sees,
      both_parents_rejected, cross_tenant_parent_rejected, cross_tenant_uploader_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
