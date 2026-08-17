-- ===========================================================================
-- HR-8A — offboarding dark foundation, proven live (audit invariants I-8.*).
-- ---------------------------------------------------------------------------
--   A. a case opens only for an ACTIVE/SUSPENDED employee, with a mandatory
--      reason and an OFFBOARDING-kind template; items are label SNAPSHOTS
--   B. one live case per employee (RPC refusal AND the index itself)
--   C. cross-tenant actor refused (HR630); unauthorized actor refused (EFA15)
--   D. THE COMPLETION GATE (I-8.2), database-side, in order:
--        not TERMINATED → HR813 · open custody → HR814 · blocking → HR815
--      equipment released ONLY through the existing hr_return_equipment
--   E. evidence discipline: DONE needs evidence when required (HR809);
--      NOT_APPLICABLE resolves a blocking item without evidence
--   F. completion emits the ledger events, including the ACCOUNT ADVISORY
--      (linked, unarchived account → offboarding_completed_account_active)
--   G. terminal states refuse further acts (HR812/HR810); cancellation
--      requires a reason (CHECK); a cancelled case frees the live slot
--   H. label snapshot immunity: editing the template never rewrites items
--   I. RLS: no cross-context read; NO write path for authenticated (the
--      guarded actions/RPCs are the boundary)
--   J. no role holds BOTH hr:manage and admin:users:* (I-8.3)
--
-- EFA08 discipline: no jwt claims are held while calling the RPCs.
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a8001', 'hr8-officer@test.local'),
  ('00000000-0000-0000-0000-0000000a8002', 'hr8-noperm@test.local'),
  ('00000000-0000-0000-0000-0000000a8003', 'hr8-othertenant@test.local'),
  ('00000000-0000-0000-0000-0000000a8004', 'hr8-departing@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000a80b2', 'HR-8 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000a8001', '00000000-0000-0000-0000-000000000001', 'hr8-officer@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a8002', '00000000-0000-0000-0000-000000000001', 'hr8-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a8003', '00000000-0000-0000-0000-0000000a80b2', 'hr8-othertenant@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a8004', '00000000-0000-0000-0000-000000000001', 'hr8-departing@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000a80c1', '00000000-0000-0000-0000-000000000001', 'HR8_HR', 'RH (test HR-8)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000a80c1', p.id from public.permission p where p.code = 'hr:manage'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000a8001', '00000000-0000-0000-0000-0000000a80c1', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- Employees: the departing E1 (linked account), E2 for governance cases,
-- a DRAFT and a TERMINATED record (both must be refused a case).
insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status, hire_date, termination_date, linked_app_user_id) values
  ('00000000-0000-0000-0000-0000000a8e01', '00000000-0000-0000-0000-000000000001', 'HR8-E1', 'Fatou', 'Diop', 'TRANSIT', 'ACTIVE', '2097-02-01', null, '00000000-0000-0000-0000-0000000a8004'),
  ('00000000-0000-0000-0000-0000000a8e02', '00000000-0000-0000-0000-000000000001', 'HR8-E2', 'Ousmane', 'Fall', 'FINANCE', 'ACTIVE', '2098-05-01', null, null),
  ('00000000-0000-0000-0000-0000000a8e03', '00000000-0000-0000-0000-000000000001', 'HR8-E3', 'Adama', 'Ba', 'OPERATIONS', 'DRAFT', null, null, null),
  ('00000000-0000-0000-0000-0000000a8e04', '00000000-0000-0000-0000-000000000001', 'HR8-E4', 'Moussa', 'Sy', 'TRANSIT', 'TERMINATED', '2096-01-01', '2099-01-31', null)
on conflict (id) do nothing;

-- Templates: one OFFBOARDING (consumed), one ONBOARDING (must be refused).
insert into public.hr_checklist_template (id, tenant_id, code, label_fr, kind) values
  ('00000000-0000-0000-0000-0000000a8fa1', '00000000-0000-0000-0000-000000000001', 'HR8_DEPART', 'Clôture de départ (test)', 'OFFBOARDING'),
  ('00000000-0000-0000-0000-0000000a8fa2', '00000000-0000-0000-0000-000000000001', 'HR8_ONBOARD', 'Intégration (test)', 'ONBOARDING')
on conflict (tenant_id, code) do nothing;
insert into public.hr_checklist_item_template (id, tenant_id, template_id, position, label_fr, is_required, is_blocking, evidence_required) values
  ('00000000-0000-0000-0000-0000000a8da1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8fa1', 1, 'Restituer le badge d''accès', true, true, false),
  ('00000000-0000-0000-0000-0000000a8da2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8fa1', 2, 'Entretien de départ', false, false, false),
  ('00000000-0000-0000-0000-0000000a8da3', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8fa1', 3, 'Remise du reçu de solde signé', true, true, true)
on conflict (template_id, position) do nothing;

-- Equipment in E1's custody, assigned through the REAL rail.
insert into public.hr_equipment_type (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000a8ea1', '00000000-0000-0000-0000-000000000001', 'HR8_LAPTOP', 'Ordinateur (test HR-8)')
on conflict (tenant_id, code) do nothing;
insert into public.hr_equipment (id, tenant_id, equipment_type_id, asset_tag) values
  ('00000000-0000-0000-0000-0000000a8eb1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8ea1', 'HR8-TAG-1')
on conflict (id) do nothing;
select public.hr_assign_equipment(
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8eb1',
  '00000000-0000-0000-0000-0000000a8e01', '00000000-0000-0000-0000-0000000a8001');

-- ---- C. authority refusals ------------------------------------------------
do $$
declare v_id uuid;
begin
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
      '00000000-0000-0000-0000-0000000a8003', 'Départ test');
    raise exception 'HR-8: a cross-tenant actor must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR630' then
      raise exception 'HR-8: expected HR630 cross-tenant, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
      '00000000-0000-0000-0000-0000000a8002', 'Départ test');
    raise exception 'HR-8: opening a case requires hr:manage';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-8: expected EFA15, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'HR-8 PASS: authority refusals (HR630, EFA15)';
end $$;

-- ---- A. opening governance ------------------------------------------------
do $$
declare v_id uuid;
begin
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02',
      '00000000-0000-0000-0000-0000000a8001', '   ');
    raise exception 'HR-8: a blank reason must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR802' then
      raise exception 'HR-8: expected HR802 blank reason, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02',
      '00000000-0000-0000-0000-0000000a8001', 'Départ test',
      null, '00000000-0000-0000-0000-0000000a8fa2');
    raise exception 'HR-8: an ONBOARDING template must be refused (I-8.10)';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR804' then
      raise exception 'HR-8: expected HR804 wrong-kind template, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e03',
      '00000000-0000-0000-0000-0000000a8001', 'Départ test');
    raise exception 'HR-8: a DRAFT employee has no employment to end';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR803' then
      raise exception 'HR-8: expected HR803 for DRAFT, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e04',
      '00000000-0000-0000-0000-0000000a8001', 'Départ test');
    raise exception 'HR-8: a TERMINATED employee is outside the audited baseline (RQ-8.6)';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR803' then
      raise exception 'HR-8: expected HR803 for TERMINATED, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'HR-8 PASS: opening governance (HR802/HR804/HR803)';
end $$;

-- ---- A. the real case opens; items are snapshots --------------------------
create temp table _hr8 (k text primary key, v text) on commit drop;
do $$
declare v_case uuid; v_items int; v_status text; v_events int;
begin
  v_case := public.hr_open_offboarding_case(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
    '00000000-0000-0000-0000-0000000a8001', 'Démission',
    current_date + 14, '00000000-0000-0000-0000-0000000a8fa1',
    '00000000-0000-0000-0000-0000000a8e02');
  insert into _hr8 values ('case_e1', v_case::text);

  select status into v_status from public.hr_offboarding_case where id = v_case;
  if v_status <> 'OPEN' then
    raise exception 'HR-8: a new case must be OPEN, got %', v_status;
  end if;
  select count(*) into v_items from public.hr_offboarding_item where case_id = v_case;
  if v_items <> 3 then
    raise exception 'HR-8: 3 items must be instantiated from the template, got %', v_items;
  end if;
  if not exists (
    select 1 from public.hr_offboarding_item
     where case_id = v_case and position = 1 and label_fr = 'Restituer le badge d''accès') then
    raise exception 'HR-8: item labels must be snapshot from the template';
  end if;
  select count(*) into v_events from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000a8e01'
     and event_kind = 'offboarding_case_opened';
  if v_events <> 1 then
    raise exception 'HR-8: opening must emit offboarding_case_opened, found %', v_events;
  end if;
  raise notice 'HR-8 PASS: case opened, items snapshot, ledger emitted';
end $$;

-- ---- B. one live case per employee ----------------------------------------
do $$
declare v_id uuid;
begin
  begin
    v_id := public.hr_open_offboarding_case(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
      '00000000-0000-0000-0000-0000000a8001', 'Doublon');
    raise exception 'HR-8: a second live case must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR806' then
      raise exception 'HR-8: expected HR806 duplicate case, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'HR-8 PASS: live-case uniqueness (HR806)';
end $$;

-- ---- D. THE COMPLETION GATE, in order (I-8.2) -----------------------------
do $$
declare v_case uuid;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';

  begin
    perform public.hr_complete_offboarding(
      '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');
    raise exception 'HR-8: completion while ACTIVE must be refused (offboarding != termination)';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR813' then
      raise exception 'HR-8: expected HR813 not-terminated, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  update public.employee
     set status = 'TERMINATED', termination_date = current_date, termination_reason = 'Démission (test)'
   where id = '00000000-0000-0000-0000-0000000a8e01';

  begin
    perform public.hr_complete_offboarding(
      '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');
    raise exception 'HR-8: completion with open custody must be refused (freeze rule)';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR814' then
      raise exception 'HR-8: expected HR814 equipment outstanding, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.hr_return_equipment(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.hr_equipment_assignment
      where employee_id = '00000000-0000-0000-0000-0000000a8e01' and returned_on is null),
    '00000000-0000-0000-0000-0000000a8001', 'RETURNED');

  begin
    perform public.hr_complete_offboarding(
      '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');
    raise exception 'HR-8: completion with blocking items pending must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR815' then
      raise exception 'HR-8: expected HR815 blocking pending, got % (%)', sqlstate, sqlerrm;
    end if;
    if sqlerrm not like '%Restituer le badge%' then
      raise exception 'HR-8: the refusal must name the pending items in French, got %', sqlerrm;
    end if;
  end;
  raise notice 'HR-8 PASS: completion gate order (HR813 -> HR814 -> HR815)';
end $$;

-- ---- E. items: evidence rule, auto-advance, N/A resolves blocking ---------
do $$
declare v_case uuid; v_status text;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';

  perform public.hr_complete_offboarding_item(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.hr_offboarding_item where case_id = v_case and position = 1),
    '00000000-0000-0000-0000-0000000a8001', 'DONE');

  select status into v_status from public.hr_offboarding_case where id = v_case;
  if v_status <> 'IN_PROGRESS' then
    raise exception 'HR-8: the first item act must advance OPEN -> IN_PROGRESS, got %', v_status;
  end if;
  if not exists (
    select 1 from public.hr_offboarding_item
     where case_id = v_case and position = 1 and status = 'DONE'
       and completed_by is not null and completed_at is not null) then
    raise exception 'HR-8: DONE must carry actor and timestamp (CHECK-backed)';
  end if;

  begin
    perform public.hr_complete_offboarding_item(
      '00000000-0000-0000-0000-000000000001',
      (select id from public.hr_offboarding_item where case_id = v_case and position = 3),
      '00000000-0000-0000-0000-0000000a8001', 'DONE');
    raise exception 'HR-8: DONE without required evidence must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR809' then
      raise exception 'HR-8: expected HR809 evidence required, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.hr_complete_offboarding_item(
    '00000000-0000-0000-0000-000000000001',
    (select id from public.hr_offboarding_item where case_id = v_case and position = 3),
    '00000000-0000-0000-0000-0000000a8001', 'NOT_APPLICABLE');
  raise notice 'HR-8 PASS: item discipline (auto-advance, HR809, N/A resolves)';
end $$;

-- ---- E2. QUALIFYING evidence (D-4): presence AND provenance, server-side --
do $$
declare v_case uuid; v_item uuid; v_doc uuid; v_foreign uuid; v_deleted uuid; v_type uuid;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';
  -- The step is currently NOT_APPLICABLE from case E; reopen it to prove the
  -- evidence path itself, then restore it so later cases are unaffected.
  select id into v_item from public.hr_offboarding_item where case_id = v_case and position = 3;
  perform public.hr_complete_offboarding_item(
    '00000000-0000-0000-0000-000000000001', v_item,
    '00000000-0000-0000-0000-0000000a8001', 'PENDING');

  -- The suite brings its own document type. The SOLDE_TOUT_COMPTE row is
  -- seeded by migration 20260802000001 via `select ... from organization`, and
  -- in a fresh CI database the tenant does not exist yet at that point (seed.sql
  -- runs after the migrations) — so that row is present in production and
  -- ABSENT here. A fixture must never depend on which environment it runs in.
  insert into public.hr_document_type (id, tenant_id, code, label_fr, data_class, required_for_termination)
  values ('00000000-0000-0000-0000-0000000a8fc1', '00000000-0000-0000-0000-000000000001',
          'HR8_SOLDE', 'Solde de tout compte (test HR-8)', 'C2', false)
  on conflict (tenant_id, code) do nothing;
  select id into v_type from public.hr_document_type
   where tenant_id = '00000000-0000-0000-0000-000000000001' and code = 'HR8_SOLDE';
  if v_type is null then
    raise exception 'HR-8: the test document type fixture is missing';
  end if;

  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
          v_type, 'Solde signé E1', 'hr/e1/solde.pdf')
  returning id into v_doc;
  -- Another employee's document, and one that was soft-deleted.
  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02',
          v_type, 'Solde signé E2', 'hr/e2/solde.pdf')
  returning id into v_foreign;
  insert into public.hr_document (tenant_id, employee_id, document_type_id, title, storage_path, deleted_at)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e01',
          v_type, 'Solde supprimé', 'hr/e1/old.pdf', now())
  returning id into v_deleted;

  begin
    perform public.hr_complete_offboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item,
      '00000000-0000-0000-0000-0000000a8001', 'DONE');
    raise exception 'HR-8: DONE without evidence must be refused server-side';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR809' then
      raise exception 'HR-8: expected HR809 missing evidence, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    perform public.hr_complete_offboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item,
      '00000000-0000-0000-0000-0000000a8001', 'DONE', v_foreign);
    raise exception 'HR-8: another employee''s document must not qualify as evidence';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR816' then
      raise exception 'HR-8: expected HR816 foreign evidence, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    perform public.hr_complete_offboarding_item(
      '00000000-0000-0000-0000-000000000001', v_item,
      '00000000-0000-0000-0000-0000000a8001', 'DONE', v_deleted);
    raise exception 'HR-8: a deleted document must not qualify as evidence';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR816' then
      raise exception 'HR-8: expected HR816 deleted evidence, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- The employee's own live document completes the step.
  perform public.hr_complete_offboarding_item(
    '00000000-0000-0000-0000-000000000001', v_item,
    '00000000-0000-0000-0000-0000000a8001', 'DONE', v_doc);
  if not exists (
    select 1 from public.hr_offboarding_item
     where id = v_item and status = 'DONE' and evidence_document_id = v_doc
       and completed_by is not null) then
    raise exception 'HR-8: a qualifying document must complete the step and be recorded';
  end if;
  if not exists (
    select 1 from public.hr_employee_event
     where employee_id = '00000000-0000-0000-0000-0000000a8e01'
       and event_kind = 'offboarding_item_completed'
       and payload->>'evidence_document_id' = v_doc::text) then
    raise exception 'HR-8: the ledger must record which document justified the step';
  end if;
  raise notice 'HR-8 PASS: qualifying evidence (HR809 presence, HR816 provenance)';
end $$;

-- ---- F. completion succeeds; ledger + ACCOUNT ADVISORY --------------------
do $$
declare v_case uuid; v_payload jsonb;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';

  perform public.hr_complete_offboarding(
    '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');

  if not exists (
    select 1 from public.hr_offboarding_case
     where id = v_case and status = 'COMPLETED' and completed_at is not null) then
    raise exception 'HR-8: the case must be COMPLETED with a timestamp';
  end if;
  if (select status from public.hr_offboarding_item where case_id = v_case and position = 2) <> 'PENDING' then
    raise exception 'HR-8: the non-blocking item must be allowed to stay PENDING';
  end if;
  if not exists (
    select 1 from public.hr_employee_event
     where employee_id = '00000000-0000-0000-0000-0000000a8e01'
       and event_kind = 'offboarding_case_completed') then
    raise exception 'HR-8: completion must emit offboarding_case_completed';
  end if;

  select payload into v_payload from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000a8e01'
     and event_kind = 'offboarding_completed_account_active';
  if v_payload is null then
    raise exception 'HR-8: a linked unarchived account must emit the advisory (prompt, never a call)';
  end if;
  if v_payload->>'account_status' <> 'active' then
    raise exception 'HR-8: the advisory must carry the account status, got %', v_payload->>'account_status';
  end if;
  if (select status from public.app_user where id = '00000000-0000-0000-0000-0000000a8004') <> 'active' then
    raise exception 'HR-8: completion must NEVER touch the account (I-8.3)';
  end if;
  raise notice 'HR-8 PASS: completion, ledger, account advisory without account write';
end $$;

-- ---- G. terminal states refuse further acts -------------------------------
do $$
declare v_case uuid;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';
  begin
    perform public.hr_complete_offboarding(
      '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');
    raise exception 'HR-8: completing a COMPLETED case must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR812' then
      raise exception 'HR-8: expected HR812 on re-complete, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.hr_complete_offboarding_item(
      '00000000-0000-0000-0000-000000000001',
      (select id from public.hr_offboarding_item where case_id = v_case and position = 2),
      '00000000-0000-0000-0000-0000000a8001', 'DONE');
    raise exception 'HR-8: item acts on a COMPLETED case must be refused';
  exception when others then
    if sqlerrm like 'HR-8:%' then raise; end if;
    if sqlstate <> 'HR810' then
      raise exception 'HR-8: expected HR810 on closed-case item act, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  raise notice 'HR-8 PASS: terminal states are terminal (HR812/HR810)';
end $$;

-- ---- H. label snapshot immunity (I-8.4) -----------------------------------
do $$
declare v_case uuid;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e1';
  update public.hr_checklist_item_template
     set label_fr = 'Libellé réécrit après coup'
   where id = '00000000-0000-0000-0000-0000000a8da1';
  if not exists (
    select 1 from public.hr_offboarding_item
     where case_id = v_case and position = 1 and label_fr = 'Restituer le badge d''accès') then
    raise exception 'HR-8: editing a template must never rewrite an instantiated item (I-8.4)';
  end if;
  raise notice 'HR-8 PASS: label snapshot immunity';
end $$;

-- ---- G2. cancellation is governed; the live slot is freed -----------------
do $$
declare v_case uuid; v_new uuid;
begin
  v_case := public.hr_open_offboarding_case(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02',
    '00000000-0000-0000-0000-0000000a8001', 'Départ envisagé');

  begin
    update public.hr_offboarding_case set status = 'CANCELLED' where id = v_case;
    raise exception 'HR-8: CANCELLED without a reason must violate the CHECK';
  exception when check_violation then
    null;
  end;

  update public.hr_offboarding_case
     set status = 'CANCELLED', cancelled_at = now(), cancellation_reason = 'Départ annulé (test)'
   where id = v_case;

  v_new := public.hr_open_offboarding_case(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02',
    '00000000-0000-0000-0000-0000000a8001', 'Départ confirmé');
  insert into _hr8 values ('case_e2', v_new::text);

  begin
    insert into public.hr_offboarding_case (tenant_id, employee_id, reason)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a8e02', 'Doublon direct');
    raise exception 'HR-8: the partial unique index must refuse a second live case even on direct insert';
  exception when unique_violation then
    null;
  end;
  raise notice 'HR-8 PASS: governed cancellation, freed slot, index refusal';
end $$;

-- ---- D2. a zero-item case completes from OPEN once the gates are green ----
do $$
declare v_case uuid;
begin
  select v::uuid into v_case from _hr8 where k = 'case_e2';
  update public.employee
     set status = 'TERMINATED', termination_date = current_date, termination_reason = 'Fin de contrat (test)'
   where id = '00000000-0000-0000-0000-0000000a8e02';
  perform public.hr_complete_offboarding(
    '00000000-0000-0000-0000-000000000001', v_case, '00000000-0000-0000-0000-0000000a8001');
  if not exists (
    select 1 from public.hr_offboarding_case where id = v_case and status = 'COMPLETED') then
    raise exception 'HR-8: a zero-item case with green gates must complete';
  end if;
  if exists (
    select 1 from public.hr_employee_event
     where employee_id = '00000000-0000-0000-0000-0000000a8e02'
       and event_kind = 'offboarding_completed_account_active') then
    raise exception 'HR-8: no advisory may be emitted for an unlinked employee';
  end if;
  raise notice 'HR-8 PASS: zero-item completion; no advisory without a linked account';
end $$;

-- ---- I. RLS: reads are fenced; authenticated has NO write path ------------
do $$
declare v_count int; v_sqlstate text;
begin
  set local role authenticated;
  select count(*) into v_count from public.hr_offboarding_case;
  reset role;
  if v_count <> 0 then
    raise exception 'HR-8 RLS FAIL: context-less authenticated read saw % case row(s)', v_count;
  end if;

  begin
    set local role authenticated;
    update public.hr_offboarding_case set summary = 'x';
    reset role;
    raise exception 'HR-8 RLS FAIL: authenticated wrote hr_offboarding_case';
  exception
    when insufficient_privilege then
      reset role;
    when others then
      v_sqlstate := sqlstate;
      reset role;
      if v_sqlstate = 'P0001' then raise; end if;
      raise exception 'HR-8 RLS FAIL: expected 42501 on write, got %', v_sqlstate;
  end;
  raise notice 'HR-8 PASS: RLS fence (no read without context, no write path)';
end $$;

-- ---- J. the handoff stays a handoff: no dual-authority role (I-8.3) -------
do $$
declare v_overlap int;
begin
  select count(distinct rp1.role_id) into v_overlap
    from public.role_permission rp1
    join public.permission p1 on p1.id = rp1.permission_id and p1.code = 'hr:manage'
    join public.role_permission rp2 on rp2.role_id = rp1.role_id
    join public.permission p2 on p2.id = rp2.permission_id and p2.code like 'admin:users:%';
  if v_overlap > 0 then
    raise exception 'HR-8 FAIL: % role(s) hold both hr:manage and admin:users:* (I-8.3)', v_overlap;
  end if;
  raise notice 'HR-8 PASS: no role holds both hr:manage and admin:users:*';
end $$;

rollback;
