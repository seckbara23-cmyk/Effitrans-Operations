-- ===========================================================================
-- HR-B2 — performance identity lanes, proven live against the real functions.
-- ---------------------------------------------------------------------------
--   * an unknown / cross-tenant actor ..................... refused (HR630)
--   * the employee submits their OWN self-assessment ...... allowed
--   * an employee touching SOMEONE ELSE'S evaluation ...... refused (EFA15)
--   * the SNAPSHOTTED manager writes the review ........... allowed
--   * a manager who manages the person TODAY but is not
--     the snapshot ....................................... refused (EFA15)
--       (the decisive case: the snapshot is the authority, not a live lookup)
--   * a manager reviewing their OWN evaluation ............ refused (HR631)
--   * the reviewing manager finalizing their own review ... refused (HR616)
--   * a Direction seat (hr:performance:finalize) finalizes  allowed
--   * a CEO-role holder without the grant finalizes ....... refused (EFA15)
--   * the employee acknowledges their OWN review .......... allowed
--   * another employee acknowledging it ................... refused (EFA15)
--   * a finalized evaluation stays immutable .............. refused (HR604)
--   * the HR desk (hr:manage) keeps every proxy lane ...... allowed
--
-- EFA08 DISCIPLINE: assert_actor_authority's SERVICE branch refuses a
-- session-bearing caller, so this suite sets NO jwt claims and clears any the
-- session may carry — exactly how the service-role client calls arrive.
--
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

select set_config('request.jwt.claims', '', true);
select set_config('role', 'postgres', true);

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000f2001', 'b2-emp1@test.local'),
  ('00000000-0000-0000-0000-0000000f2002', 'b2-emp2@test.local'),
  ('00000000-0000-0000-0000-0000000f2003', 'b2-manager@test.local'),
  ('00000000-0000-0000-0000-0000000f2004', 'b2-othermanager@test.local'),
  ('00000000-0000-0000-0000-0000000f2005', 'b2-hr@test.local'),
  ('00000000-0000-0000-0000-0000000f2006', 'b2-direction@test.local'),
  ('00000000-0000-0000-0000-0000000f2007', 'b2-ceo@test.local'),
  ('00000000-0000-0000-0000-0000000f2008', 'b2-othertenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000f20b2', 'HR-B2 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000f2001', '00000000-0000-0000-0000-000000000001', 'b2-emp1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2002', '00000000-0000-0000-0000-000000000001', 'b2-emp2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2003', '00000000-0000-0000-0000-000000000001', 'b2-manager@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2004', '00000000-0000-0000-0000-000000000001', 'b2-othermanager@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2005', '00000000-0000-0000-0000-000000000001', 'b2-hr@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2006', '00000000-0000-0000-0000-000000000001', 'b2-direction@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2007', '00000000-0000-0000-0000-000000000001', 'b2-ceo@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000f2008', '00000000-0000-0000-0000-0000000f20b2', 'b2-othertenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000f20c1', '00000000-0000-0000-0000-000000000001', 'B2_HR', 'RH (test B2)'),
  ('00000000-0000-0000-0000-0000000f20c2', '00000000-0000-0000-0000-000000000001', 'B2_DIR', 'Direction (test B2)'),
  ('00000000-0000-0000-0000-0000000f20c3', '00000000-0000-0000-0000-000000000001', 'B2_CEO', 'CEO sans finalisation (test B2)'),
  ('00000000-0000-0000-0000-0000000f20c4', '00000000-0000-0000-0000-0000000f20b2', 'B2_DIR_B', 'Direction B (test B2)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000f20c1', p.id from public.permission p where p.code = 'hr:manage'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000f20c2', p.id from public.permission p where p.code = 'hr:performance:finalize'
on conflict do nothing;
-- The CEO-role stand-in deliberately gets a broad READ permission and NOT the
-- finalization seat: the governance boundary, exercised.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000f20c3', p.id from public.permission p where p.code = 'hr:read'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000f20c4', p.id from public.permission p where p.code = 'hr:performance:finalize'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000f2005', '00000000-0000-0000-0000-0000000f20c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000f2006', '00000000-0000-0000-0000-0000000f20c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000f2007', '00000000-0000-0000-0000-0000000f20c3', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000f2008', '00000000-0000-0000-0000-0000000f20c4', '00000000-0000-0000-0000-0000000f20b2')
on conflict do nothing;

-- Employees. Every lane holder is LINKED; the link proves identity only.
insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status, linked_app_user_id) values
  ('00000000-0000-0000-0000-0000000f2e01', '00000000-0000-0000-0000-000000000001', 'B2-E1', 'Aissatou', 'Ba', 'TRANSIT', 'ACTIVE', '00000000-0000-0000-0000-0000000f2001'),
  ('00000000-0000-0000-0000-0000000f2e02', '00000000-0000-0000-0000-000000000001', 'B2-E2', 'Modou', 'Fall', 'FINANCE', 'ACTIVE', '00000000-0000-0000-0000-0000000f2002'),
  ('00000000-0000-0000-0000-0000000f2e03', '00000000-0000-0000-0000-000000000001', 'B2-M1', 'Fatou', 'Sow', 'TRANSIT', 'ACTIVE', '00000000-0000-0000-0000-0000000f2003'),
  ('00000000-0000-0000-0000-0000000f2e04', '00000000-0000-0000-0000-000000000001', 'B2-M2', 'Cheikh', 'Diop', 'TRANSIT', 'ACTIVE', '00000000-0000-0000-0000-0000000f2004')
on conflict (id) do nothing;

-- THE DECISIVE FIXTURE: today, employee 1 reports to the OTHER manager (M2).
-- The evaluation below was opened when M1 was their manager, and M1's snapshot
-- is what authorizes the review. A live-assignment lookup would hand this
-- review to M2 — which is exactly the mistake this suite refuses.
insert into public.employee_assignment (id, tenant_id, employee_id, manager_employee_id, assignment_kind, effective_from) values
  ('00000000-0000-0000-0000-0000000f2a01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000f2e01', '00000000-0000-0000-0000-0000000f2e04', 'PRIMARY', '2099-01-01')
on conflict (id) do nothing;

insert into public.hr_performance_cycle (id, tenant_id, code, label_fr, cycle_kind, status, period_start, period_end)
values ('00000000-0000-0000-0000-0000000f2c01', '00000000-0000-0000-0000-000000000001',
        'B2-TEST', 'Campagne test B2', 'ANNUELLE', 'OPEN', '2099-01-01', '2099-12-31')
on conflict (id) do nothing;

insert into public.hr_evaluation (id, tenant_id, cycle_id, employee_id, manager_employee_id, status) values
  -- ev1: employee 1, manager of record = M1 (NOT today's manager M2).
  ('00000000-0000-0000-0000-0000000f2f01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000f2c01', '00000000-0000-0000-0000-0000000f2e01',
   '00000000-0000-0000-0000-0000000f2e03', 'DRAFT'),
  -- ev2: employee 2, manager of record = M2.
  ('00000000-0000-0000-0000-0000000f2f02', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000f2c01', '00000000-0000-0000-0000-0000000f2e02',
   '00000000-0000-0000-0000-0000000f2e04', 'DRAFT'),
  -- ev3: the manager M1's OWN evaluation, managed by M2.
  ('00000000-0000-0000-0000-0000000f2f03', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000f2c01', '00000000-0000-0000-0000-0000000f2e03',
   '00000000-0000-0000-0000-0000000f2e04', 'SELF_SUBMITTED')
on conflict (id) do nothing;

-- ---- 1. an unknown actor is refused (HR630) -------------------------------
do $$
begin
  begin
    perform public.hr_submit_self_assessment(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2fff', 'tentative');
    raise exception 'HR-B2: an unknown actor must be refused';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'HR630' then
      raise exception 'HR-B2: expected HR630, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 2. a cross-tenant actor is refused (HR630) ---------------------------
do $$
begin
  begin
    perform public.hr_submit_self_assessment(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2008', 'tentative');
    raise exception 'HR-B2: a cross-tenant actor must be refused';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'HR630' then
      raise exception 'HR-B2: expected HR630 cross-tenant, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 3. an employee may not touch SOMEONE ELSE'S evaluation --------------
do $$
begin
  begin
    perform public.hr_submit_self_assessment(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f02',
      '00000000-0000-0000-0000-0000000f2001', 'pas la mienne');
    raise exception 'HR-B2: an employee must not self-assess another employee';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 cross-employee, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 4. the employee submits their OWN self-assessment --------------------
do $$
declare v_status text; v_by uuid; v_flag boolean;
begin
  perform public.hr_submit_self_assessment(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
    '00000000-0000-0000-0000-0000000f2001', 'Mon bilan de l''année.');
  select status, self_entered_by into v_status, v_by
    from public.hr_evaluation where id = '00000000-0000-0000-0000-0000000f2f01';
  if v_status <> 'SELF_SUBMITTED' or v_by <> '00000000-0000-0000-0000-0000000f2001' then
    raise exception 'HR-B2: the self lane must record the employee (%, %)', v_status, v_by;
  end if;
  select (payload->>'by_employee')::boolean into v_flag
    from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000f2e01'
     and event_kind = 'self_assessment_submitted'
   order by created_at desc limit 1;
  if v_flag is not true then
    raise exception 'HR-B2: the ledger must record that the EMPLOYEE spoke';
  end if;
end $$;

-- ---- 5. TODAY'S manager is NOT the snapshot, and is refused ---------------
do $$
begin
  -- M2 currently manages employee 1 (the open PRIMARY assignment above) but is
  -- not this evaluation's manager of record. Live relationship, no authority.
  begin
    perform public.hr_submit_manager_review(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2004', 'revue par le mauvais manager');
    raise exception 'HR-B2: only the SNAPSHOTTED manager may review';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 for a non-snapshot manager, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 6. the SNAPSHOTTED manager writes the review -------------------------
do $$
declare v_status text; v_by uuid; v_flag boolean;
begin
  perform public.hr_submit_manager_review(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
    '00000000-0000-0000-0000-0000000f2003', 'Bonne progression.', 'Rigueur', 'Délégation');
  select status, manager_entered_by into v_status, v_by
    from public.hr_evaluation where id = '00000000-0000-0000-0000-0000000f2f01';
  if v_status <> 'MANAGER_SUBMITTED' or v_by <> '00000000-0000-0000-0000-0000000f2003' then
    raise exception 'HR-B2: the manager lane must record the manager (%, %)', v_status, v_by;
  end if;
  select (payload->>'by_manager_of_record')::boolean into v_flag
    from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000f2e01'
     and event_kind = 'manager_review_submitted'
   order by created_at desc limit 1;
  if v_flag is not true then
    raise exception 'HR-B2: the ledger must record the manager-of-record lane';
  end if;
end $$;

-- ---- 7. nobody reviews their OWN evaluation (HR631) -----------------------
do $$
begin
  begin
    perform public.hr_submit_manager_review(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f03',
      '00000000-0000-0000-0000-0000000f2003', 'je me revois moi-même');
    raise exception 'HR-B2: reviewing one''s own evaluation must be refused';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'HR631' then
      raise exception 'HR-B2: expected HR631, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 8. HR616 — the reviewer never finalizes their own review -------------
do $$
begin
  begin
    perform public.hr_finalize_evaluation(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2003', null, null);
    raise exception 'HR-B2: HR616 must refuse the reviewing manager';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'HR616' then
      raise exception 'HR-B2: expected HR616, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 9. a CEO-role holder WITHOUT the seat cannot finalize ----------------
do $$
begin
  begin
    perform public.hr_finalize_evaluation(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2007', null, null);
    raise exception 'HR-B2: an ungranted CEO holder must not finalize';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 for CEO without the seat, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 10. the Direction seat finalizes -------------------------------------
do $$
declare v_status text; v_by uuid;
begin
  perform public.hr_finalize_evaluation(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
    '00000000-0000-0000-0000-0000000f2006', 'Modération RH', 'Synthèse finale');
  select status, finalized_by into v_status, v_by
    from public.hr_evaluation where id = '00000000-0000-0000-0000-0000000f2f01';
  if v_status <> 'FINALIZED' or v_by <> '00000000-0000-0000-0000-0000000f2006' then
    raise exception 'HR-B2: the Direction seat must finalize (%, %)', v_status, v_by;
  end if;
end $$;

-- ---- 11. another employee cannot acknowledge someone else's review -------
do $$
begin
  begin
    perform public.hr_acknowledge_evaluation(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
      '00000000-0000-0000-0000-0000000f2002', null);
    raise exception 'HR-B2: only the employee concerned may acknowledge';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 on foreign acknowledgment, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 12. the employee acknowledges their OWN finalized review ------------
do $$
declare v_status text; v_flag boolean;
begin
  perform public.hr_acknowledge_evaluation(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f01',
    '00000000-0000-0000-0000-0000000f2001', 'Pris connaissance.');
  select status into v_status from public.hr_evaluation where id = '00000000-0000-0000-0000-0000000f2f01';
  if v_status <> 'ACKNOWLEDGED' then
    raise exception 'HR-B2: the employee must be able to acknowledge (%)', v_status;
  end if;
  select (payload->>'by_employee')::boolean into v_flag
    from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000f2e01'
     and event_kind = 'performance_review_acknowledged'
   order by created_at desc limit 1;
  if v_flag is not true then
    raise exception 'HR-B2: the ledger must record the employee''s own receipt';
  end if;
end $$;

-- ---- 13. a finalized evaluation stays immutable (HR604) -------------------
do $$
begin
  begin
    update public.hr_evaluation set manager_comments = 'réécriture'
     where id = '00000000-0000-0000-0000-0000000f2f01';
    raise exception 'HR-B2: a finalized evaluation must stay immutable';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'HR604' then
      raise exception 'HR-B2: expected HR604, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 14. the HR desk keeps every proxy lane (hr:manage) -------------------
do $$
declare v_status text; v_flag boolean;
begin
  perform public.hr_submit_self_assessment(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2f02',
    '00000000-0000-0000-0000-0000000f2005', 'Saisi par les RH pour l''employé.');
  select status into v_status from public.hr_evaluation where id = '00000000-0000-0000-0000-0000000f2f02';
  if v_status <> 'SELF_SUBMITTED' then
    raise exception 'HR-B2: the HR desk must keep its proxy lane (%)', v_status;
  end if;
  select (payload->>'by_employee')::boolean into v_flag
    from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000f2e02'
     and event_kind = 'self_assessment_submitted'
   order by created_at desc limit 1;
  if v_flag is not false then
    raise exception 'HR-B2: a proxy entry must NOT claim the employee spoke';
  end if;
end $$;

-- ---- 15. an actor with no lane and no permission is refused everywhere ----
do $$
begin
  begin
    perform public.hr_open_performance_cycle(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2c01',
      '00000000-0000-0000-0000-0000000f2001');
    raise exception 'HR-B2: opening a cycle requires hr:manage';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 on cycle open, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  begin
    perform public.hr_assign_objective(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f2c01',
      '00000000-0000-0000-0000-0000000f2e01', '00000000-0000-0000-0000-0000000f2001',
      'Objectif non autorisé', 5000);
    raise exception 'HR-B2: assigning an objective requires hr:manage';
  exception when others then
    if sqlerrm like 'HR-B2:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B2: expected EFA15 on objective assign, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

select 'HR-B2 performance identity: all checks passed' as result;

rollback;
