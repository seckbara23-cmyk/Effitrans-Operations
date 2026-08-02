-- RLS + invariants test — HR-5 Leave & Attendance (migration 77). BEGIN/ROLLBACK.
-- Proves: tenant confinement + hr:read gate; SYSTEM_ADMIN sees 0 (DEC-B25);
-- portal sees 0; hr:leave:approve exists and is granted to NOBODY; the
-- maker-checker refusal (decider = requester) raises; a decided request is
-- immutable; approval decrements entitlement and emits in ONE transaction;
-- cancellation restores it; and NO ON_LEAVE value can enter employee.status.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000005a', 'hr5-req@test.local'),
  ('00000000-0000-0000-0000-00000000005b', 'hr5-dec@test.local'),
  ('00000000-0000-0000-0000-00000000005c', 'hr5-admin@test.local'),
  ('00000000-0000-0000-0000-00000000005d', 'hr5-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000005a', '00000000-0000-0000-0000-000000000001', 'hr5-req@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000005b', '00000000-0000-0000-0000-000000000001', 'hr5-dec@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000005c', '00000000-0000-0000-0000-000000000001', 'hr5-admin@test.local', 'active')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000005a', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000005c', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ccd05', '00000000-0000-0000-0000-000000000001', 'HR5 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000005d', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ccd05', 'hr5-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee51', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9501', 'Lea', 'Ve', 'OPERATIONS', 'ACTIVE')
on conflict (id) do nothing;

insert into public.hr_leave_category (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-000000000001', 'ANNUAL_T', 'Congé annuel (test)')
on conflict (id) do nothing;
insert into public.hr_leave_entitlement (id, tenant_id, employee_id, category_id, period_start, period_end, opening_tenths, accrued_tenths) values
  ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee51', '00000000-0000-0000-0000-00000000c501',
   '2026-01-01', '2026-12-31', 100, 50)
on conflict (id) do nothing;
insert into public.hr_leave_request (id, tenant_id, employee_id, category_id, status, start_date, end_date, day_tenths, requested_by) values
  ('00000000-0000-0000-0000-000000005501', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee51', '00000000-0000-0000-0000-00000000c501',
   'SUBMITTED', '2026-03-02', '2026-03-04', 30, '00000000-0000-0000-0000-00000000005a')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  officer_reqs int; admin_reqs int; portal_reqs int;
  perm_rows int; perm_grants int;
  same_actor_rejected int := 0; immutable_rejected int := 0;
  taken_after_approve int; taken_after_cancel int;
  events_approved int; events_cancelled int;
  on_leave_status_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000005a','role','authenticated')::text, true);
  select count(*) into officer_reqs from public.hr_leave_request where id = '00000000-0000-0000-0000-000000005501';

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000005c','role','authenticated')::text, true);
  select count(*) into admin_reqs from public.hr_leave_request where id = '00000000-0000-0000-0000-000000005501';

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000005d','role','authenticated')::text, true);
  select count(*) into portal_reqs from public.hr_leave_request where id = '00000000-0000-0000-0000-000000005501';

  perform set_config('role', 'postgres', true);

  -- The approval authority exists and is held by NOBODY (unratified).
  select count(*) into perm_rows from public.permission where code = 'hr:leave:approve';
  select count(*) into perm_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id where p.code = 'hr:leave:approve';

  -- Maker-checker: the requester cannot decide their own request.
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000005501',
      '00000000-0000-0000-0000-00000000005a', 'APPROVED');
  exception when others then
    same_actor_rejected := 1;
  end;

  -- A different actor approves: entitlement decrements and the event exists.
  perform public.hr_decide_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000005501',
    '00000000-0000-0000-0000-00000000005b', 'APPROVED');
  select taken_tenths into taken_after_approve from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-00000000e501';
  select count(*) into events_approved from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000eee51' and event_kind = 'leave_approved';

  -- A decided request cannot be re-decided or edited.
  begin
    update public.hr_leave_request set day_tenths = 999
     where id = '00000000-0000-0000-0000-000000005501';
  exception when others then
    immutable_rejected := 1;
  end;

  -- Cancelling an approved leave gives the entitlement back.
  perform public.hr_cancel_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000005501',
    '00000000-0000-0000-0000-00000000005b', 'Motif de test');
  select taken_tenths into taken_after_cancel from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-00000000e501';
  select count(*) into events_cancelled from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000eee51' and event_kind = 'leave_cancelled';

  -- ON_LEAVE is NOT an employee status: the CHECK constraint refuses it.
  begin
    update public.employee set status = 'ON_LEAVE'
     where id = '00000000-0000-0000-0000-0000000eee51';
  exception when others then
    on_leave_status_rejected := 1;
  end;

  insert into _r values
    ('officer_sees_request', officer_reqs), ('system_admin_sees', admin_reqs),
    ('portal_sees', portal_reqs),
    ('approve_permission_rows', perm_rows), ('approve_permission_grants', perm_grants),
    ('same_actor_rejected', same_actor_rejected), ('immutable_once_decided', immutable_rejected),
    ('taken_after_approve', taken_after_approve), ('taken_after_cancel', taken_after_cancel),
    ('event_leave_approved', events_approved), ('event_leave_cancelled', events_cancelled),
    ('on_leave_status_rejected', on_leave_status_rejected);

  if officer_reqs<>1 or admin_reqs<>0 or portal_reqs<>0
     or perm_rows<>1 or perm_grants<>0
     or same_actor_rejected<>1 or immutable_rejected<>1
     or taken_after_approve<>30 or taken_after_cancel<>0
     or events_approved<>1 or events_cancelled<>1
     or on_leave_status_rejected<>1
  then
    raise exception 'HR-5 FAIL: off=% adm=% por=% perm=% grants=% same=% immut=% takenA=% takenC=% evA=% evC=% onleave=%',
      officer_reqs, admin_reqs, portal_reqs, perm_rows, perm_grants, same_actor_rejected,
      immutable_rejected, taken_after_approve, taken_after_cancel, events_approved,
      events_cancelled, on_leave_status_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
