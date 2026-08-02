-- RLS regression test — HR-3 Documents & Contracts (migration 75). BEGIN/ROLLBACK.
-- Proves: tenant confinement + hr:read gate; SYSTEM_ADMIN sees 0 (DEC-B25);
-- C3-classed documents invisible WITHOUT hr:sensitive:read even to HR_OFFICER;
-- contract maker-checker CHECK (verifier <> preparer); template immutability;
-- the hr-documents bucket is PRIVATE.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d5', 'hr3-a@test.local'),
  ('00000000-0000-0000-0000-0000000000d6', 'hr3-admin@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-000000000001', 'hr3-a@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-000000000001', 'hr3-admin@test.local', 'active')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000d5', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000d6', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee21', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9201', 'Doc', 'Test', 'HUMAN_RESOURCES', 'ACTIVE')
on conflict (id) do nothing;

insert into public.hr_document_type (id, tenant_id, code, label_fr, data_class) values
  ('00000000-0000-0000-0000-0000000d7001', '00000000-0000-0000-0000-000000000001', 'ATTESTATION_T', 'Attestation (test)', 'C2'),
  ('00000000-0000-0000-0000-0000000d7002', '00000000-0000-0000-0000-000000000001', 'CNI_SCAN_T', 'Pièce d''identité (test)', 'C3')
on conflict (id) do nothing;

insert into public.hr_document (id, tenant_id, employee_id, document_type_id, title, storage_path) values
  ('00000000-0000-0000-0000-0000000dd001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee21', '00000000-0000-0000-0000-0000000d7001', 'att.pdf', 't/att.pdf'),
  ('00000000-0000-0000-0000-0000000dd002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee21', '00000000-0000-0000-0000-0000000d7002', 'cni.pdf', 't/cni.pdf')
on conflict (id) do nothing;

insert into public.employment_contract (id, tenant_id, employee_id, contract_kind, start_date, prepared_by) values
  ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee21', 'CDI', '2026-01-01', '00000000-0000-0000-0000-0000000000d5')
on conflict (id) do nothing;

insert into public.hr_template_version (id, tenant_id, code, version, title, body_md) values
  ('00000000-0000-0000-0000-00000007e001', '00000000-0000-0000-0000-000000000001', 'LETTRE_T', 1, 'T', 'corps')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  officer_docs int; officer_c3 int; admin_docs int; officer_contracts int;
  self_verify_rejected int := 0; template_update_rejected int := 0; bucket_private int;
begin
  perform set_config('role', 'authenticated', true);

  -- HR_OFFICER (hr:read, NO hr:sensitive:read): sees the C2 doc, NOT the C3 one.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d5','role','authenticated')::text, true);
  select count(*) into officer_docs from public.hr_document where id = '00000000-0000-0000-0000-0000000dd001';
  select count(*) into officer_c3   from public.hr_document where id = '00000000-0000-0000-0000-0000000dd002';
  select count(*) into officer_contracts from public.employment_contract where id = '00000000-0000-0000-0000-0000000cc001';

  -- SYSTEM_ADMIN: zero (DEC-B25).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000d6','role','authenticated')::text, true);
  select count(*) into admin_docs from public.hr_document
   where id in ('00000000-0000-0000-0000-0000000dd001','00000000-0000-0000-0000-0000000dd002');

  perform set_config('role', 'postgres', true);

  -- Maker-checker CHECK: the preparer cannot verify their own contract.
  begin
    update public.employment_contract
       set status = 'VERIFIED', verified_by = prepared_by, verified_at = now()
     where id = '00000000-0000-0000-0000-0000000cc001';
  exception when others then
    self_verify_rejected := 1;
  end;

  -- Template versions are immutable.
  begin
    update public.hr_template_version set body_md = 'tampered'
     where id = '00000000-0000-0000-0000-00000007e001';
  exception when others then
    template_update_rejected := 1;
  end;

  select case when public = false then 1 else 0 end into bucket_private
    from storage.buckets where id = 'hr-documents';

  insert into _r values
    ('officer_sees_c2', officer_docs), ('officer_sees_c3', officer_c3),
    ('system_admin_sees', admin_docs), ('officer_sees_contract', officer_contracts),
    ('self_verify_rejected', self_verify_rejected),
    ('template_update_rejected', template_update_rejected),
    ('bucket_private', bucket_private);

  if officer_docs<>1 or officer_c3<>0 or admin_docs<>0 or officer_contracts<>1
     or self_verify_rejected<>1 or template_update_rejected<>1 or coalesce(bucket_private,0)<>1
  then
    raise exception 'HR-3 FAIL: c2=% c3=% admin=% contract=% visa=% tmpl=% bucket=%',
      officer_docs, officer_c3, admin_docs, officer_contracts,
      self_verify_rejected, template_update_rejected, bucket_private;
  end if;
end $$;

select * from _r order by check_name;
rollback;
