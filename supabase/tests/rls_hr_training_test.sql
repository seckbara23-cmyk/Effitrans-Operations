-- RLS + invariants test — HR-6 Training (migration 79). BEGIN/ROLLBACK.
-- Proves: tenant confinement + hr:read gate; SYSTEM_ADMIN sees 0 (DEC-B25);
-- portal sees 0; NO new permission was added by this migration; an inactive
-- course cannot be assigned; a course requiring evidence refuses to complete
-- without a certificate; completion derives the expiry from the COURSE'S OWN
-- configured validity; a closed enrollment is immutable EXCEPT for attaching
-- the certificate afterwards; and the ledger receives training_assigned,
-- training_completed and certificate_recorded.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000007a', 'hr6t-officer@test.local'),
  ('00000000-0000-0000-0000-00000000007c', 'hr6t-admin@test.local'),
  ('00000000-0000-0000-0000-00000000007d', 'hr6t-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000007a', '00000000-0000-0000-0000-000000000001', 'hr6t-officer@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000007c', '00000000-0000-0000-0000-000000000001', 'hr6t-admin@test.local', 'active')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000007a', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000007c', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ccd07', '00000000-0000-0000-0000-000000000001', 'HR6T Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000007d', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ccd07', 'hr6t-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee71', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9701', 'Form', 'Un', 'OPERATIONS', 'ACTIVE')
on conflict (id) do nothing;

-- A 24-month certification requiring evidence, and a retired course.
insert into public.hr_training_course
  (id, tenant_id, code, title, delivery_mode, validity_months, is_mandatory, requires_evidence) values
  ('00000000-0000-0000-0000-000000000c71'::uuid, '00000000-0000-0000-0000-000000000001',
   'SEC-T', 'Sécurité (test)', 'CERTIFICATION', 24, true, true)
on conflict (id) do nothing;
insert into public.hr_training_course
  (id, tenant_id, code, title, delivery_mode, is_active) values
  ('00000000-0000-0000-0000-000000000c72'::uuid, '00000000-0000-0000-0000-000000000001',
   'OLD-T', 'Formation retirée (test)', 'INTERNAL', false)
on conflict (id) do nothing;
-- An active course that needs no evidence — used to prove the one governed
-- post-completion write (attaching a certificate that was missing).
insert into public.hr_training_course (id, tenant_id, code, title, delivery_mode) values
  ('00000000-0000-0000-0000-000000000c73'::uuid, '00000000-0000-0000-0000-000000000001',
   'ANY-T', 'Formation sans preuve (test)', 'INTERNAL')
on conflict (id) do nothing;

insert into public.hr_document_type (id, tenant_id, code, label_fr, data_class) values
  ('00000000-0000-0000-0000-000000000d71', '00000000-0000-0000-0000-000000000001',
   'CERTIF_T', 'Certificat (test)', 'C2')
on conflict (id) do nothing;
insert into public.hr_document (id, tenant_id, employee_id, document_type_id, title, storage_path) values
  ('00000000-0000-0000-0000-00000000dc71', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee71', '00000000-0000-0000-0000-000000000d71',
   'Certificat test', 'hr/test/cert.pdf')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  officer_rows int; admin_rows int; portal_rows int;
  new_perms int;
  enr uuid; enr2 uuid;
  inactive_rejected int := 0; evidence_rejected int := 0; reclose_rejected int := 0;
  tamper_rejected int := 0; cert_attach_ok int := 0;
  expiry date; ev_assigned int; ev_completed int; ev_cert int;
begin
  perform set_config('role', 'postgres', true);

  -- HR-6 part 2 adds NO permission code. The family is unchanged.
  select count(*) into new_perms from public.permission
   where code in ('hr:training:manage', 'hr:training:read', 'hr:performance:read', 'hr:performance:manage');

  -- A retired course cannot be assigned.
  begin
    perform public.hr_assign_training(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee71',
      '00000000-0000-0000-0000-000000000c72'::uuid, '00000000-0000-0000-0000-00000000007a');
  exception when others then inactive_rejected := 1;
  end;

  select public.hr_assign_training(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee71',
    '00000000-0000-0000-0000-000000000c71'::uuid, '00000000-0000-0000-0000-00000000007a',
    null::date, '2026-06-30'::date) into enr;
  select count(*) into ev_assigned from public.hr_employee_event
   where event_kind = 'training_assigned' and employee_id = '00000000-0000-0000-0000-0000000eee71';

  -- requires_evidence: completing without a certificate is refused.
  begin
    perform public.hr_complete_training(
      '00000000-0000-0000-0000-000000000001', enr, '00000000-0000-0000-0000-00000000007a',
      'RÉUSSI', '2026-03-01'::date, null);
  exception when others then evidence_rejected := 1;
  end;

  -- With the certificate it completes, and the expiry comes from the COURSE.
  perform public.hr_complete_training(
    '00000000-0000-0000-0000-000000000001', enr, '00000000-0000-0000-0000-00000000007a',
    'RÉUSSI', '2026-03-01'::date, '00000000-0000-0000-0000-00000000dc71');
  select expiry_date into expiry from public.hr_training_enrollment where id = enr;
  select count(*) into ev_completed from public.hr_employee_event
   where event_kind = 'training_completed' and employee_id = '00000000-0000-0000-0000-0000000eee71';
  select count(*) into ev_cert from public.hr_employee_event
   where event_kind = 'certificate_recorded' and employee_id = '00000000-0000-0000-0000-0000000eee71';

  -- A completed enrollment cannot be re-closed or edited.
  begin
    perform public.hr_close_training_enrollment(
      '00000000-0000-0000-0000-000000000001', enr, '00000000-0000-0000-0000-00000000007a', 'FAILED');
  exception when others then reclose_rejected := 1;
  end;
  begin
    update public.hr_training_enrollment set result = 'ÉCHEC RÉÉCRIT' where id = enr;
  exception when others then tamper_rejected := 1;
  end;

  -- The one governed post-completion write: attaching a certificate that was
  -- missing. Proven on a SECOND enrollment, for a course needing no evidence.
  select public.hr_assign_training(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee71',
    '00000000-0000-0000-0000-000000000c73'::uuid, '00000000-0000-0000-0000-00000000007a') into enr2;
  perform public.hr_complete_training(
    '00000000-0000-0000-0000-000000000001', enr2, '00000000-0000-0000-0000-00000000007a',
    'RÉUSSI', '2026-03-02'::date, null);
  begin
    update public.hr_training_enrollment
       set certificate_document_id = '00000000-0000-0000-0000-00000000dc71' where id = enr2;
    cert_attach_ok := 1;
  exception when others then cert_attach_ok := 0;
  end;

  -- RLS.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000007a','role','authenticated')::text, true);
  select count(*) into officer_rows from public.hr_training_enrollment where id = enr;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000007c','role','authenticated')::text, true);
  select count(*) into admin_rows from public.hr_training_enrollment where id = enr;
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000007d','role','authenticated')::text, true);
  select count(*) into portal_rows from public.hr_training_enrollment where id = enr;
  perform set_config('role', 'postgres', true);

  insert into _r values
    ('officer_sees_enrollment', officer_rows), ('system_admin_sees', admin_rows),
    ('portal_sees', portal_rows), ('unexpected_new_permissions', new_perms),
    ('inactive_course_rejected', inactive_rejected),
    ('evidence_required_rejected', evidence_rejected),
    ('event_training_assigned', ev_assigned), ('event_training_completed', ev_completed),
    ('event_certificate_recorded', ev_cert),
    ('reclose_rejected', reclose_rejected), ('result_tamper_rejected', tamper_rejected),
    ('certificate_attach_allowed', cert_attach_ok);

  if officer_rows<>1 or admin_rows<>0 or portal_rows<>0
     or new_perms<>0
     or inactive_rejected<>1 or evidence_rejected<>1
     or ev_assigned<>2 or ev_completed<>2 or ev_cert<>1
     or reclose_rejected<>1 or tamper_rejected<>1 or cert_attach_ok<>1
     or expiry <> date '2028-03-01'
  then
    raise exception 'HR-6 TRAIN FAIL: off=% adm=% por=% perms=% inact=% evid=% assigned=% completed=% cert=% reclose=% tamper=% attach=% expiry=%',
      officer_rows, admin_rows, portal_rows, new_perms, inactive_rejected, evidence_rejected,
      ev_assigned, ev_completed, ev_cert, reclose_rejected, tamper_rejected, cert_attach_ok, expiry;
  end if;
end $$;

select * from _r order by check_name;
rollback;
