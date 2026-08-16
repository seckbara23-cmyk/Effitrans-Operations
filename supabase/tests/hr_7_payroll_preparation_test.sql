-- ===========================================================================
-- HR-7A/7C — facts-only payroll preparation, proven live (audit cases A–H).
-- ---------------------------------------------------------------------------
--   A. facts collected correctly from the authoritative HR records
--   B. the SNAPSHOT survives later mutation of the source (attendance edit
--      after collection does not rewrite the line; re-collection does)
--   C. another tenant's actor is refused (HR630)
--   D. an unauthorized actor cannot run any preparation act (EFA15)
--   E. a LOCKED preparation is immutable — period AND lines, at the trigger
--   F. adjustment history is governed: four-eyes, no rewrite, supersession
--   G. anomalies become EXCEPTIONS, never invented values
--   H. no monetary-looking column exists in any payroll table
--
-- EFA08 discipline: no jwt claims are held while calling the RPCs.
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a7001', 'hr7-officer@test.local'),
  ('00000000-0000-0000-0000-0000000a7002', 'hr7-second@test.local'),
  ('00000000-0000-0000-0000-0000000a7003', 'hr7-direction@test.local'),
  ('00000000-0000-0000-0000-0000000a7004', 'hr7-noperm@test.local'),
  ('00000000-0000-0000-0000-0000000a7005', 'hr7-othertenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000a70b2', 'HR-7 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000a7001', '00000000-0000-0000-0000-000000000001', 'hr7-officer@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a7002', '00000000-0000-0000-0000-000000000001', 'hr7-second@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a7003', '00000000-0000-0000-0000-000000000001', 'hr7-direction@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a7004', '00000000-0000-0000-0000-000000000001', 'hr7-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000a7005', '00000000-0000-0000-0000-0000000a70b2', 'hr7-othertenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000a70c1', '00000000-0000-0000-0000-000000000001', 'HR7_HR', 'RH (test HR-7)'),
  ('00000000-0000-0000-0000-0000000a70c2', '00000000-0000-0000-0000-000000000001', 'HR7_APPROVE', 'Approbation paie (test HR-7)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000a70c1', p.id from public.permission p where p.code = 'hr:manage'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000a70c2', p.id from public.permission p where p.code = 'hr:payroll:approve'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000a7001', '00000000-0000-0000-0000-0000000a70c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000a7002', '00000000-0000-0000-0000-0000000a70c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000a7003', '00000000-0000-0000-0000-0000000a70c2', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- Employees: a full ACTIVE record; a mid-period HIRE with no attendance; a
-- mid-period DEPARTURE; a DRAFT (must be EXCLUDED and counted).
insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status, hire_date, termination_date) values
  ('00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-000000000001', 'HR7-E1', 'Awa', 'Cissé', 'TRANSIT', 'ACTIVE', '2098-01-15', null),
  ('00000000-0000-0000-0000-0000000a7e02', '00000000-0000-0000-0000-000000000001', 'HR7-E2', 'Ibrahima', 'Ndour', 'FINANCE', 'ACTIVE', '2099-03-10', null),
  ('00000000-0000-0000-0000-0000000a7e03', '00000000-0000-0000-0000-000000000001', 'HR7-E3', 'Mame', 'Diarra', 'OPERATIONS', 'TERMINATED', '2097-06-01', '2099-03-20'),
  ('00000000-0000-0000-0000-0000000a7e04', '00000000-0000-0000-0000-000000000001', 'HR7-E4', 'Pape', 'Sarr', 'TRANSIT', 'DRAFT', null, null)
on conflict (id) do nothing;

insert into public.hr_org_unit (id, tenant_id, unit_kind, name) values
  ('00000000-0000-0000-0000-0000000a7d01', '00000000-0000-0000-0000-000000000001', 'TEAM', 'Equipe test HR-7')
on conflict (id) do nothing;
insert into public.employee_assignment (id, tenant_id, employee_id, org_unit_id, assignment_kind, effective_from) values
  ('00000000-0000-0000-0000-0000000a7a01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-0000000a7d01', 'PRIMARY', '2098-02-01')
on conflict (id) do nothing;

-- Attendance for E1 inside the period (2099-03) + one row OUTSIDE it.
insert into public.hr_attendance_day (tenant_id, employee_id, work_date, worked_minutes) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e01', '2099-03-02', 480),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e01', '2099-03-03', 450),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e01', '2099-04-01', 999)
on conflict (employee_id, work_date) do nothing;

-- Approved leave for E1: one inside, one CROSSING the period boundary.
insert into public.hr_leave_category (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000a7ca1', '00000000-0000-0000-0000-000000000001', 'HR7_CAT', 'Congé (test HR-7)')
on conflict (tenant_id, code) do nothing;
insert into public.hr_leave_request (id, tenant_id, employee_id, category_id, status, start_date, end_date, day_tenths, requested_by, approved_by, decided_at, submitted_at) values
  ('00000000-0000-0000-0000-0000000a7f01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-0000000a7ca1', 'APPROVED', '2099-03-05', '2099-03-06', 20, '00000000-0000-0000-0000-0000000a7001', '00000000-0000-0000-0000-0000000a7002', now(), now()),
  ('00000000-0000-0000-0000-0000000a7f02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-0000000a7ca1', 'APPROVED', '2099-03-30', '2099-04-02', 40, '00000000-0000-0000-0000-0000000a7001', '00000000-0000-0000-0000-0000000a7002', now(), now())
on conflict (id) do nothing;

create temp table _hr7 (k text, v text) on commit drop;

-- ---- C. cross-tenant actor refused (HR630) --------------------------------
do $$
declare v_id uuid;
begin
  begin
    v_id := public.hr_create_payroll_period(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7005',
      'HR7-X', 'Croisé', '2099-03-01', '2099-03-31');
    raise exception 'HR-7: a cross-tenant actor must be refused';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR630' then
      raise exception 'HR-7: expected HR630 cross-tenant, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- D. an unauthorized actor is refused everywhere (EFA15) ---------------
do $$
declare v_id uuid;
begin
  begin
    v_id := public.hr_create_payroll_period(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7004',
      'HR7-N', 'Sans droit', '2099-03-01', '2099-03-31');
    raise exception 'HR-7: creating a period requires hr:manage';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-7: expected EFA15, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- A + G. facts collected correctly; anomalies become exceptions --------
do $$
declare
  v_period uuid; v_count int;
  v_days int; v_mins int; v_tenths int; v_exc jsonb; v_status text;
  v_e2_exc jsonb; v_e3 int; v_e4 int; v_draft int;
begin
  v_period := public.hr_create_payroll_period(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7001',
    'HR7-2099-03', 'Paie mars 2099 (test)', '2099-03-01', '2099-03-31');
  insert into _hr7 values ('period', v_period::text);

  v_count := public.hr_prepare_payroll_period(
    '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7001');
  if v_count <> 3 then
    raise exception 'HR-7: expected 3 included employees (E1, E2 hired-in, E3 terminated-in), got %', v_count;
  end if;

  select draft_excluded_count into v_draft from public.hr_payroll_period where id = v_period;
  if v_draft < 1 then
    raise exception 'HR-7: the DRAFT employee must be excluded AND counted (got %)', v_draft;
  end if;

  -- E1: 2 attendance days, 930 minutes (the April row must not leak in),
  -- 60 leave tenths (20 in-period + 40 crossing), boundary exception raised.
  select attendance_days, worked_minutes, leave_tenths_total, exceptions
    into v_days, v_mins, v_tenths, v_exc
    from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e01';
  if v_days <> 2 or v_mins <> 930 then
    raise exception 'HR-7: E1 attendance must be 2 days / 930 min (got % / %)', v_days, v_mins;
  end if;
  if v_tenths <> 60 then
    raise exception 'HR-7: E1 approved leave must total 60 tenths at face value (got %)', v_tenths;
  end if;
  if not (v_exc ? 'LEAVE_SPANS_BOUNDARY') then
    raise exception 'HR-7: the boundary-crossing leave must be an EXCEPTION, not silently prorated';
  end if;

  -- E2 (hired mid-period, nothing recorded): exceptions, never invented values.
  select exceptions into v_e2_exc from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e02';
  if not (v_e2_exc ? 'HIRED_IN_PERIOD') or not (v_e2_exc ? 'NO_ATTENDANCE')
     or not (v_e2_exc ? 'NO_OPEN_ASSIGNMENT') then
    raise exception 'HR-7: E2 must carry HIRED_IN_PERIOD + NO_ATTENDANCE + NO_OPEN_ASSIGNMENT (got %)', v_e2_exc;
  end if;

  -- E3 in (terminated inside the period), E4 (DRAFT) out.
  select count(*) into v_e3 from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e03';
  select count(*) into v_e4 from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e04';
  if v_e3 <> 1 or v_e4 <> 0 then
    raise exception 'HR-7: inclusion must be E3 in / E4 out (got % / %)', v_e3, v_e4;
  end if;
end $$;

-- ---- B. the snapshot survives later source mutation -----------------------
do $$
declare v_period uuid; v_mins int;
begin
  select v::uuid into v_period from _hr7 where k = 'period';

  update public.hr_attendance_day set worked_minutes = 1
   where employee_id = '00000000-0000-0000-0000-0000000a7e01' and work_date = '2099-03-02';

  select worked_minutes into v_mins from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e01';
  if v_mins <> 930 then
    raise exception 'HR-7: the snapshot must NOT follow a later attendance edit (got %)', v_mins;
  end if;

  perform public.hr_prepare_payroll_period(
    '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7001');
  select worked_minutes into v_mins from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e01';
  if v_mins <> 451 then
    raise exception 'HR-7: an explicit re-collection must refresh the copy (got %)', v_mins;
  end if;
end $$;

-- ---- F. adjustments: vocabulary, four-eyes, no rewrite, supersession ------
do $$
declare v_period uuid; v_kind uuid; v_adj uuid; v_adj2 uuid; v_status text;
begin
  select v::uuid into v_period from _hr7 where k = 'period';

  insert into public.hr_payroll_adjustment_kind (id, tenant_id, code, label_fr, unit)
  values ('00000000-0000-0000-0000-0000000a7b01', '00000000-0000-0000-0000-000000000001',
          'HR7_TEST_KIND', 'Ajustement (test HR-7)', 'DAYS');

  v_adj := public.hr_propose_payroll_adjustment(
    '00000000-0000-0000-0000-000000000001', v_period,
    '00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-0000000a7b01',
    '00000000-0000-0000-0000-0000000a7001', 2, 'Motif de test');

  begin
    perform public.hr_decide_payroll_adjustment(
      '00000000-0000-0000-0000-000000000001', v_adj,
      '00000000-0000-0000-0000-0000000a7001', 'APPROVED', null);
    raise exception 'HR-7: the proposer must never decide their own adjustment';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR711' then
      raise exception 'HR-7: expected HR711 four-eyes, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.hr_decide_payroll_adjustment(
    '00000000-0000-0000-0000-000000000001', v_adj,
    '00000000-0000-0000-0000-0000000a7002', 'APPROVED', 'Validé');

  begin
    update public.hr_payroll_adjustment set quantity = 99 where id = v_adj;
    raise exception 'HR-7: a decided adjustment must never be rewritten';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR712' then
      raise exception 'HR-7: expected HR712 on rewrite, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  v_adj2 := public.hr_propose_payroll_adjustment(
    '00000000-0000-0000-0000-000000000001', v_period,
    '00000000-0000-0000-0000-0000000a7e01', '00000000-0000-0000-0000-0000000a7b01',
    '00000000-0000-0000-0000-0000000a7001', 3, 'Correction', null, v_adj);
  select status into v_status from public.hr_payroll_adjustment where id = v_adj;
  if v_status <> 'SUPERSEDED' then
    raise exception 'HR-7: an amendment must SUPERSEDE, never delete (got %)', v_status;
  end if;
  perform public.hr_decide_payroll_adjustment(
    '00000000-0000-0000-0000-000000000001', v_adj2,
    '00000000-0000-0000-0000-0000000a7002', 'APPROVED', null);
end $$;

-- ---- E + four-eyes on approval + lock immutability ------------------------
do $$
declare v_period uuid; v_mins int;
begin
  select v::uuid into v_period from _hr7 where k = 'period';

  perform public.hr_verify_payroll_period(
    '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7001');

  -- The lines are frozen the moment the period is VERIFIED.
  begin
    update public.hr_payroll_period_line set worked_minutes = 0
     where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e01';
    raise exception 'HR-7: verified lines must be frozen';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR705' then
      raise exception 'HR-7: expected HR705 on frozen line, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  -- Approval without the parked seat is refused; with it, four-eyes holds:
  -- the Direction seat prepared nothing, so it may approve.
  begin
    perform public.hr_approve_payroll_period(
      '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7002');
    raise exception 'HR-7: approval requires hr:payroll:approve';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-7: expected EFA15 on unseated approval, got % (%)', sqlstate, sqlerrm;
    end if;
  end;

  perform public.hr_approve_payroll_period(
    '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7003');
  perform public.hr_lock_payroll_period(
    '00000000-0000-0000-0000-000000000001', v_period, '00000000-0000-0000-0000-0000000a7003');

  -- LOCKED: the period refuses every edit…
  begin
    update public.hr_payroll_period set label_fr = 'réécriture' where id = v_period;
    raise exception 'HR-7: a locked period must be immutable';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR701' then
      raise exception 'HR-7: expected HR701 on locked period, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  -- …its lines refuse every edit…
  begin
    delete from public.hr_payroll_period_line where period_id = v_period;
    raise exception 'HR-7: locked lines must refuse deletion';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR705' then
      raise exception 'HR-7: expected HR705 on locked line delete, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  -- …and a NEW attendance edit still cannot reach the locked copy.
  update public.hr_attendance_day set worked_minutes = 7
   where employee_id = '00000000-0000-0000-0000-0000000a7e01' and work_date = '2099-03-03';
  select worked_minutes into v_mins from public.hr_payroll_period_line
   where period_id = v_period and employee_id = '00000000-0000-0000-0000-0000000a7e01';
  if v_mins <> 451 then
    raise exception 'HR-7: the LOCKED snapshot must be permanently reproducible (got %)', v_mins;
  end if;
end $$;

-- ---- duplicate refusal + supersession version -----------------------------
do $$
declare v_period uuid; v_new uuid; v_version int;
begin
  select v::uuid into v_period from _hr7 where k = 'period';
  -- The prior version is LOCKED: a new preparation of the same code is a
  -- NEW VERSION superseding it — and only ONE active version may exist.
  v_new := public.hr_create_payroll_period(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7001',
    'HR7-2099-03', 'Paie mars 2099 (v2)', '2099-03-01', '2099-03-31');
  select version into v_version from public.hr_payroll_period where id = v_new;
  if v_version <> 2 then
    raise exception 'HR-7: the correction must be version 2 (got %)', v_version;
  end if;
  begin
    perform public.hr_create_payroll_period(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a7001',
      'HR7-2099-03', 'Doublon', '2099-03-01', '2099-03-31');
    raise exception 'HR-7: a second ACTIVE version must be refused';
  exception when others then
    if sqlerrm like 'HR-7:%' then raise; end if;
    if sqlstate <> 'HR703' then
      raise exception 'HR-7: expected HR703 duplicate, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- H. no monetary column anywhere in the payroll tables -----------------
do $$
declare v_count int;
begin
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name like 'hr\_payroll\_%' escape '\'
    and (column_name ~* 'amount|salar|montant|wage|rate|price|gross|net_|tax|cotis');
  if v_count <> 0 then
    raise exception 'HR-7: a monetary-looking column exists (%) — Q1/DEC-B63 forbid it', v_count;
  end if;
end $$;

select 'HR-7 payroll preparation: all checks passed' as result;

rollback;
