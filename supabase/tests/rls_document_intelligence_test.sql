-- RLS regression test — Document Intelligence (Phase 7.4A). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the intelligence tables inherit dossier visibility (document:read + can_read_file)
-- in BOTH directions, and that the authenticated client can never write them (SELECT-only):
--   * tenant-A operator sees tenant-A job/candidate, NOT tenant B; and vice versa
--   * a user without document:read sees none
--   * cross-tenant + same-tenant writes via the authenticated client are rejected
-- Expected: A(1/0), B(1/0), noperm(0), writes blocked.

begin;

insert into public.organization (id, name, country) values ('00000000-0000-0000-0000-0000000000e2', 'DI Tenant B', 'SN') on conflict (id) do nothing;
insert into public.role (id, tenant_id, code, label_fr) values ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000e2', 'B_DOC', 'B Doc') on conflict (id) do nothing;
insert into public.role_permission (role_id, permission_id) select '00000000-0000-0000-0000-0000000000eb', p.id from public.permission p where p.code in ('document:read','file:read:all') on conflict do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e1a1', 'diA@test.local'), ('00000000-0000-0000-0000-00000000e1b1', 'diB@test.local'), ('00000000-0000-0000-0000-00000000e1c1', 'diN@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000e1a1', '00000000-0000-0000-0000-000000000001', 'diA@test.local'),
  ('00000000-0000-0000-0000-00000000e1b1', '00000000-0000-0000-0000-0000000000e2', 'diB@test.local'),
  ('00000000-0000-0000-0000-00000000e1c1', '00000000-0000-0000-0000-000000000001', 'diN@test.local')
on conflict (id) do nothing;
-- diA → OPS_SUPERVISOR (tenant A: document:read + file:read:all); diB → B_DOC; diN → no doc role.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000e1a1', r.id, r.tenant_id from public.role r where r.code = 'OPS_SUPERVISOR' and r.tenant_id = '00000000-0000-0000-0000-000000000001' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
values ('00000000-0000-0000-0000-00000000e1b1', '00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-0000000000e2') on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000e2a0', '00000000-0000-0000-0000-000000000001', 'DI Client A'),
  ('00000000-0000-0000-0000-00000000e2b0', '00000000-0000-0000-0000-0000000000e2', 'DI Client B')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000efa1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97701', 'IMP', '00000000-0000-0000-0000-00000000e2a0'),
  ('00000000-0000-0000-0000-00000000efb1', '00000000-0000-0000-0000-0000000000e2', 'EFT-IMP-2099-97702', 'IMP', '00000000-0000-0000-0000-00000000e2b0')
on conflict (id) do nothing;
insert into public.document (id, tenant_id, file_id, type_code, storage_path, status) values
  ('00000000-0000-0000-0000-00000000eda1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000efa1', 'BILL_OF_LADING', 'a/x.pdf', 'UPLOADED'),
  ('00000000-0000-0000-0000-00000000edb1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000efb1', 'BILL_OF_LADING', 'b/x.pdf', 'UPLOADED')
on conflict (id) do nothing;
insert into public.document_intelligence_job (id, tenant_id, document_id, file_id, declared_class, status) values
  ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000eda1', '00000000-0000-0000-0000-00000000efa1', 'BILL_OF_LADING', 'READY_FOR_REVIEW'),
  ('00000000-0000-0000-0000-00000000e0b1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000edb1', '00000000-0000-0000-0000-00000000efb1', 'BILL_OF_LADING', 'READY_FOR_REVIEW')
on conflict (id) do nothing;
insert into public.document_candidate_field (id, tenant_id, job_id, file_id, document_class, field_key) values
  ('00000000-0000-0000-0000-00000000eca1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-00000000efa1', 'BILL_OF_LADING', 'bl_number'),
  ('00000000-0000-0000-0000-00000000ecb1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000e0b1', '00000000-0000-0000-0000-00000000efb1', 'BILL_OF_LADING', 'bl_number')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare a_j int; a_oj int; a_c int; a_oc int; b_j int; b_oj int; n_j int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e1a1','role','authenticated')::text, true);
  select count(*) into a_j  from public.document_intelligence_job where id='00000000-0000-0000-0000-00000000e0a1';
  select count(*) into a_oj from public.document_intelligence_job where id='00000000-0000-0000-0000-00000000e0b1';
  select count(*) into a_c  from public.document_candidate_field where id='00000000-0000-0000-0000-00000000eca1';
  select count(*) into a_oc from public.document_candidate_field where id='00000000-0000-0000-0000-00000000ecb1';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e1b1','role','authenticated')::text, true);
  select count(*) into b_j  from public.document_intelligence_job where id='00000000-0000-0000-0000-00000000e0b1';
  select count(*) into b_oj from public.document_intelligence_job where id='00000000-0000-0000-0000-00000000e0a1';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e1c1','role','authenticated')::text, true);
  select count(*) into n_j from public.document_intelligence_job where id='00000000-0000-0000-0000-00000000e0a1';
  perform set_config('role', 'postgres', true);
  insert into _r values ('A_ownJob', a_j), ('A_otherJob', a_oj), ('A_ownField', a_c), ('A_otherField', a_oc), ('B_ownJob', b_j), ('B_otherJob', b_oj), ('noperm_job', n_j);
  if a_j<>1 or a_oj<>0 or a_c<>1 or a_oc<>0 or b_j<>1 or b_oj<>0 or n_j<>0 then
    raise exception 'RLS DOCINTEL FAIL: A(j=% oj=% c=% oc=%) B(j=% oj=%) noperm=%', a_j, a_oj, a_c, a_oc, b_j, b_oj, n_j;
  end if;
end $$;

do $$
declare x_b boolean := false; x_a int := 0; s_b boolean := false; s_a int := 0;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000e1a1','role','authenticated')::text, true);
  begin update public.document_intelligence_job set status='CANCELLED' where id='00000000-0000-0000-0000-00000000e0b1'; get diagnostics x_a = row_count; exception when others then x_b := true; end;
  begin update public.document_candidate_field set review_decision='APPROVED' where id='00000000-0000-0000-0000-00000000eca1'; get diagnostics s_a = row_count; exception when others then s_b := true; end;
  perform set_config('role', 'postgres', true);
  insert into _r values ('xtenant_job_write_blocked', case when x_b or x_a=0 then 1 else 0 end), ('sametenant_field_write_blocked', case when s_b or s_a=0 then 1 else 0 end);
  if not (x_b or x_a=0) or not (s_b or s_a=0) then raise exception 'RLS DOCINTEL WRITE FAIL: xtenant(b=% a=%) same(b=% a=%)', x_b, x_a, s_b, s_a; end if;
end $$;

-- Phase 7.4B: the failure_category vocabulary admits OCR_REQUIRED (migration 20260716000008),
-- the honest terminal outcome for a scanned / image-only PDF (we do not OCR).
do $$
declare ok boolean := false;
begin
  perform set_config('role', 'postgres', true);
  begin
    insert into public.document_intelligence_job (id, tenant_id, document_id, file_id, declared_class, status, failure_category)
    values ('00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000eda1', '00000000-0000-0000-0000-00000000efa1', 'BILL_OF_LADING', 'FAILED', 'OCR_REQUIRED');
    ok := true;
  exception when others then ok := false; end;
  insert into _r values ('ocr_required_failure_category_accepted', case when ok then 1 else 0 end);
  if not ok then raise exception 'RLS DOCINTEL 7.4B FAIL: failure_category OCR_REQUIRED rejected (migration 20260716000008 missing?)'; end if;
end $$;

select * from _r order by check_name;
rollback;
