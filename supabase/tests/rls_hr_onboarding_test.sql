-- RLS + invariants test — HR-4 Onboarding & Equipment (migration 76). BEGIN/ROLLBACK.
-- Proves: tenant confinement + hr:read gate; SYSTEM_ADMIN sees 0 (DEC-B25);
-- portal invisibility; ONE active custodian per asset (partial unique index);
-- custody history is never overwritten by a reassignment; the completion gate
-- refuses while a blocking item is PENDING and succeeds once it is resolved;
-- both RPCs emit their ledger event inside the SAME transaction.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f7', 'hr4-officer@test.local'),
  ('00000000-0000-0000-0000-0000000000f8', 'hr4-admin@test.local'),
  ('00000000-0000-0000-0000-0000000000f9', 'hr4-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-000000000001', 'hr4-officer@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-000000000001', 'hr4-admin@test.local', 'active')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f7', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f8', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ccd04', '00000000-0000-0000-0000-000000000001', 'HR4 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ccd04', 'hr4-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee41', '00000000-0000-0000-0000-000000000001', 'EMP-2099-9401', 'Onb', 'One', 'OPERATIONS', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000eee42', '00000000-0000-0000-0000-000000000001', 'EMP-2099-9402', 'Onb', 'Two', 'OPERATIONS', 'ACTIVE')
on conflict (id) do nothing;

insert into public.hr_equipment_type (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-000000e74401', '00000000-0000-0000-0000-000000000001', 'LAPTOP_T', 'Portable (test)')
on conflict (id) do nothing;
insert into public.hr_equipment (id, tenant_id, equipment_type_id, asset_tag) values
  ('00000000-0000-0000-0000-000000e94401', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000e74401', 'TAG-TEST-401')
on conflict (id) do nothing;

insert into public.hr_onboarding_case (id, tenant_id, employee_id, status) values
  ('00000000-0000-0000-0000-000000ca4401', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee41', 'IN_PROGRESS')
on conflict (id) do nothing;
insert into public.hr_onboarding_item (id, tenant_id, case_id, position, label_fr, is_required, is_blocking) values
  ('00000000-0000-0000-0000-0000001a4401', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000ca4401', 1, 'Contrat vérifié (test)', true, true),
  ('00000000-0000-0000-0000-0000001a4402', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000ca4401', 2, 'Optionnel (test)', false, false)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  officer_cases int; admin_cases int; portal_cases int; officer_equipment int;
  a1 uuid; double_custody_rejected int := 0; history_rows int;
  gate_refused int := 0; completed int := 0;
  events_after_assign int; events_after_return int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f7','role','authenticated')::text, true);
  select count(*) into officer_cases from public.hr_onboarding_case where id = '00000000-0000-0000-0000-000000ca4401';
  select count(*) into officer_equipment from public.hr_equipment where id = '00000000-0000-0000-0000-000000e94401';

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f8','role','authenticated')::text, true);
  select count(*) into admin_cases from public.hr_onboarding_case where id = '00000000-0000-0000-0000-000000ca4401';

  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f9','role','authenticated')::text, true);
  select count(*) into portal_cases from public.hr_onboarding_case where id = '00000000-0000-0000-0000-000000ca4401';

  perform set_config('role', 'postgres', true);

  -- Assign via the RPC; the ledger event must exist in the SAME transaction.
  a1 := public.hr_assign_equipment(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000e94401',
    '00000000-0000-0000-0000-0000000eee41', '00000000-0000-0000-0000-0000000000f7');
  select count(*) into events_after_assign from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000eee41' and event_kind = 'asset_assigned';

  -- A second live custodian is refused by the partial unique index.
  begin
    insert into public.hr_equipment_assignment (tenant_id, equipment_id, employee_id)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000e94401',
            '00000000-0000-0000-0000-0000000eee42');
  exception when others then
    double_custody_rejected := 1;
  end;

  -- Return, then reassign: history GROWS, it is never overwritten.
  perform public.hr_return_equipment(
    '00000000-0000-0000-0000-000000000001', a1, '00000000-0000-0000-0000-0000000000f7', 'RETURNED');
  select count(*) into events_after_return from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000eee41' and event_kind = 'asset_returned';
  perform public.hr_assign_equipment(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000e94401',
    '00000000-0000-0000-0000-0000000eee42', '00000000-0000-0000-0000-0000000000f7');
  select count(*) into history_rows from public.hr_equipment_assignment
   where equipment_id = '00000000-0000-0000-0000-000000e94401';

  -- The completion gate refuses while the blocking item is PENDING...
  begin
    perform public.hr_complete_onboarding(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000ca4401',
      '00000000-0000-0000-0000-0000000000f7');
  exception when others then
    gate_refused := 1;
  end;

  -- ...and succeeds once it is resolved (the optional one stays PENDING).
  perform public.hr_complete_onboarding_item(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000001a4401',
    '00000000-0000-0000-0000-0000000000f7', 'DONE');
  perform public.hr_complete_onboarding(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000ca4401',
    '00000000-0000-0000-0000-0000000000f7');
  select count(*) into completed from public.hr_onboarding_case
   where id = '00000000-0000-0000-0000-000000ca4401' and status = 'COMPLETED' and completed_at is not null;

  insert into _r values
    ('officer_sees_case', officer_cases), ('officer_sees_equipment', officer_equipment),
    ('system_admin_sees', admin_cases), ('portal_sees', portal_cases),
    ('double_custody_rejected', double_custody_rejected),
    ('custody_history_rows', history_rows),
    ('event_on_assign', events_after_assign), ('event_on_return', events_after_return),
    ('completion_gate_refused', gate_refused), ('completed_after_unblock', completed);

  if officer_cases<>1 or officer_equipment<>1 or admin_cases<>0 or portal_cases<>0
     or double_custody_rejected<>1 or history_rows<>2
     or events_after_assign<>1 or events_after_return<>1
     or gate_refused<>1 or completed<>1
  then
    raise exception 'HR-4 FAIL: case=% equip=% admin=% portal=% dbl=% hist=% ev_a=% ev_r=% gate=% done=%',
      officer_cases, officer_equipment, admin_cases, portal_cases, double_custody_rejected,
      history_rows, events_after_assign, events_after_return, gate_refused, completed;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- HR-8 carryover — evidence parity with Départs (the ratified D-4 model):
-- presence (HR408) was already enforced; provenance (HR412) is now too. A step
-- may only cite a document of ITS OWN employee, not soft-deleted.
-- ---------------------------------------------------------------------------
do $$
declare v_type uuid; v_doc uuid; v_foreign uuid; v_deleted uuid;
        v_item uuid := '00000000-0000-0000-0000-0000001a4402';
begin
  perform set_config('request.jwt.claims', '', true);

  -- The suite brings its own document type: the SOLDE_TOUT_COMPTE row is seeded
  -- by a migration that selects from `organization`, and in a fresh CI database
  -- the tenant does not exist yet at that point.
  insert into public.hr_document_type (id, tenant_id, code, label_fr, data_class, required_for_termination)
  values ('00000000-0000-0000-0000-0000000dc441', '00000000-0000-0000-0000-000000000001',
          'HR4_PREUVE', 'Pièce justificative (test HR-4)', 'C2', false)
  on conflict (tenant_id, code) do nothing;
  select id into v_type from public.hr_document_type
   where tenant_id = '00000000-0000-0000-0000-000000000001' and code = 'HR4_PREUVE';

  update public.hr_onboarding_item set evidence_required = true, status = 'PENDING' where id = v_item;

  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee41',
          v_type, 'Preuve E1', 'hr/e1/preuve.pdf') returning id into v_doc;
  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee42',
          v_type, 'Preuve E2', 'hr/e2/preuve.pdf') returning id into v_foreign;
  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path, deleted_at)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee41',
          v_type, 'Preuve supprimée', 'hr/e1/old.pdf', now()) returning id into v_deleted;

  begin
    perform public.hr_complete_onboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item, '00000000-0000-0000-0000-0000000000f7', 'DONE');
    raise exception 'HR-4 FAIL: DONE without evidence must be refused';
  exception when others then
    if sqlerrm like 'HR-4 FAIL%' then raise; end if;
    if sqlstate <> 'HR408' then
      raise exception 'HR-4 FAIL: expected HR408, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    perform public.hr_complete_onboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item, '00000000-0000-0000-0000-0000000000f7', 'DONE', v_foreign);
    raise exception 'HR-4 FAIL: another employee''s document must not qualify';
  exception when others then
    if sqlerrm like 'HR-4 FAIL%' then raise; end if;
    if sqlstate <> 'HR412' then
      raise exception 'HR-4 FAIL: expected HR412 foreign evidence, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    perform public.hr_complete_onboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item, '00000000-0000-0000-0000-0000000000f7', 'DONE', v_deleted);
    raise exception 'HR-4 FAIL: a deleted document must not qualify';
  exception when others then
    if sqlerrm like 'HR-4 FAIL%' then raise; end if;
    if sqlstate <> 'HR412' then
      raise exception 'HR-4 FAIL: expected HR412 deleted evidence, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.hr_complete_onboarding_item(
    '00000000-0000-0000-0000-000000000001', v_item, '00000000-0000-0000-0000-0000000000f7', 'DONE', v_doc);
  if not exists (
    select 1 from public.hr_onboarding_item
     where id = v_item and status = 'DONE' and evidence_document_id = v_doc) then
    raise exception 'HR-4 FAIL: a qualifying document must complete the step and be recorded';
  end if;
  insert into _r values ('evidence_provenance_enforced', 1);
end $$;

select * from _r order by check_name;
rollback;
