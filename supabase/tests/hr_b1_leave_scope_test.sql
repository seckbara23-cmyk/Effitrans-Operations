-- ===========================================================================
-- HR-B1 — leave approval carries ORGANIZATIONAL authority, proven live.
-- ---------------------------------------------------------------------------
-- The decision RPC now has two lanes: the requester's manager on the open
-- PRIMARY assignment (identity), or an org-wide hr:leave:approve seat
-- (assert_actor_authority). This suite proves, against the real functions:
--
--   * a linked NON-manager without the permission ......... refused (EFA15)
--   * the requester deciding their own request ............ refused (HR524)
--   * a manager deciding a request THEY filed ............. refused (HR524)
--   * a decider whose own employee record is the subject .. refused (HR527)
--   * the legitimate manager, in scope .................... approves; the
--       entitlement moves EXACTLY once; the ledger event exists
--   * deciding twice ...................................... refused (HR523)
--   * a refusal ........................................... consumes nothing
--   * the manager, OUT of scope (not their report) ........ refused (EFA15)
--   * an org-wide Direction seat, any employee ............ allowed
--   * a permission holder from ANOTHER tenant ............. refused (HR530)
--   * SELF cancel: own undecided request .................. allowed
--   * SELF cancel: own APPROVED request ................... refused (HR526)
--   * SELF cancel: someone else's request ................. refused (HR529)
--   * ADMIN cancel of an approved leave ................... returns the
--       entitlement to exactly its prior value
--   * ADMIN cancel without hr:manage ...................... refused (EFA15)
--
-- Non-destructive: BEGIN/ROLLBACK.
-- ===========================================================================
begin;

-- ---- fixtures -------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e1001', 'hrb1-manager@test.local'),
  ('00000000-0000-0000-0000-0000000e1002', 'hrb1-report@test.local'),
  ('00000000-0000-0000-0000-0000000e1003', 'hrb1-hr@test.local'),
  ('00000000-0000-0000-0000-0000000e1004', 'hrb1-direction@test.local'),
  ('00000000-0000-0000-0000-0000000e1005', 'hrb1-outsider@test.local'),
  ('00000000-0000-0000-0000-0000000e1006', 'hrb1-othertenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000e10b2', 'HR-B1 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000e1001', '00000000-0000-0000-0000-000000000001', 'hrb1-manager@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000e1002', '00000000-0000-0000-0000-000000000001', 'hrb1-report@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000e1003', '00000000-0000-0000-0000-000000000001', 'hrb1-hr@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000e1004', '00000000-0000-0000-0000-000000000001', 'hrb1-direction@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000e1005', '00000000-0000-0000-0000-000000000001', 'hrb1-outsider@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000e1006', '00000000-0000-0000-0000-0000000e10b2', 'hrb1-othertenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000e10c1', '00000000-0000-0000-0000-000000000001', 'HRB1_HR', 'RH (test HR-B1)'),
  ('00000000-0000-0000-0000-0000000e10c2', '00000000-0000-0000-0000-000000000001', 'HRB1_DIR', 'Direction (test HR-B1)'),
  ('00000000-0000-0000-0000-0000000e10c3', '00000000-0000-0000-0000-0000000e10b2', 'HRB1_DIR_B', 'Direction B (test HR-B1)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000e10c1', p.id from public.permission p where p.code = 'hr:manage'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000e10c2', p.id from public.permission p where p.code = 'hr:leave:approve'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000e10c3', p.id from public.permission p where p.code = 'hr:leave:approve'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000e1003', '00000000-0000-0000-0000-0000000e10c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000e1004', '00000000-0000-0000-0000-0000000e10c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000e1006', '00000000-0000-0000-0000-0000000e10c3', '00000000-0000-0000-0000-0000000e10b2')
on conflict do nothing;

-- Employees: a manager, their report, a lone employee (no manager), and a
-- linked bystander. The link proves identity; only the ASSIGNMENT confers scope.
insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status, linked_app_user_id) values
  ('00000000-0000-0000-0000-0000000e1e01', '00000000-0000-0000-0000-000000000001', 'HRB1-M1', 'Mariama', 'Chef', 'TRANSIT', 'ACTIVE', '00000000-0000-0000-0000-0000000e1001'),
  ('00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-000000000001', 'HRB1-R1', 'Rokhaya', 'Agent', 'TRANSIT', 'ACTIVE', '00000000-0000-0000-0000-0000000e1002'),
  ('00000000-0000-0000-0000-0000000e1e03', '00000000-0000-0000-0000-000000000001', 'HRB1-L1', 'Lamine', 'Seul', 'FINANCE', 'ACTIVE', null),
  ('00000000-0000-0000-0000-0000000e1e04', '00000000-0000-0000-0000-000000000001', 'HRB1-O1', 'Ousmane', 'Tiers', 'OPERATIONS', 'ACTIVE', '00000000-0000-0000-0000-0000000e1005')
on conflict (id) do nothing;

insert into public.employee_assignment (id, tenant_id, employee_id, manager_employee_id, assignment_kind, effective_from) values
  ('00000000-0000-0000-0000-0000000e1a01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1e01', 'PRIMARY', '2099-01-01')
on conflict (id) do nothing;

insert into public.hr_leave_category (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000e1ca1', '00000000-0000-0000-0000-000000000001', 'HRB1_TEST', 'Congé (test HR-B1)')
on conflict (tenant_id, code) do nothing;

insert into public.hr_leave_entitlement (id, tenant_id, employee_id, category_id, period_start, period_end, opening_tenths) values
  ('00000000-0000-0000-0000-0000000e1ee1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', '2099-01-01', '2099-12-31', 100)
on conflict (id) do nothing;

-- Requests. r7 starts OUTSIDE the entitlement period on purpose (no movement).
insert into public.hr_leave_request (id, tenant_id, employee_id, category_id, status, start_date, end_date, day_tenths, requested_by, submitted_at) values
  ('00000000-0000-0000-0000-0000000e1f01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-03-01', '2099-03-02', 20, '00000000-0000-0000-0000-0000000e1002', now()),
  ('00000000-0000-0000-0000-0000000e1f02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-04-01', '2099-04-02', 20, '00000000-0000-0000-0000-0000000e1002', now()),
  ('00000000-0000-0000-0000-0000000e1f03', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e01', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-05-01', '2099-05-02', 20, '00000000-0000-0000-0000-0000000e1003', now()),
  ('00000000-0000-0000-0000-0000000e1f04', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-06-01', '2099-06-02', 20, '00000000-0000-0000-0000-0000000e1001', now()),
  ('00000000-0000-0000-0000-0000000e1f05', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e03', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-07-01', '2099-07-02', 20, '00000000-0000-0000-0000-0000000e1003', now()),
  ('00000000-0000-0000-0000-0000000e1f06', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'DRAFT', '2099-08-01', '2099-08-02', 20, '00000000-0000-0000-0000-0000000e1002', null),
  ('00000000-0000-0000-0000-0000000e1f07', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2100-02-01', '2100-02-02', 20, '00000000-0000-0000-0000-0000000e1002', now()),
  ('00000000-0000-0000-0000-0000000e1f08', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1e02', '00000000-0000-0000-0000-0000000e1ca1', 'SUBMITTED', '2099-09-01', '2099-09-02', 20, '00000000-0000-0000-0000-0000000e1002', now())
on conflict (id) do nothing;

-- ---- 1. a linked NON-manager without the permission is refused ------------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f08',
      '00000000-0000-0000-0000-0000000e1005', 'APPROVED', null);
    raise exception 'HR-B1: a linked bystander must never decide';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B1: expected EFA15 (no authority), got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 2. the requester never decides their own request (HR524) -------------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f08',
      '00000000-0000-0000-0000-0000000e1002', 'APPROVED', null);
    raise exception 'HR-B1: the requester must never decide their own request';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR524' then
      raise exception 'HR-B1: expected HR524, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 3. a manager deciding the request THEY filed is refused (HR524) ------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f04',
      '00000000-0000-0000-0000-0000000e1001', 'APPROVED', null);
    raise exception 'HR-B1: maker-checker must hold on the manager lane too';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR524' then
      raise exception 'HR-B1: expected HR524 on manager-filed request, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 4. nobody decides their OWN leave, even HR-filed (HR527) -------------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f03',
      '00000000-0000-0000-0000-0000000e1001', 'APPROVED', null);
    raise exception 'HR-B1: deciding one''s own leave must be refused';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR527' then
      raise exception 'HR-B1: expected HR527 (own leave), got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 5. the legitimate manager approves; the entitlement moves ONCE -------
do $$
declare v_status text; v_by uuid; v_taken int; v_events int;
begin
  perform public.hr_decide_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f01',
    '00000000-0000-0000-0000-0000000e1001', 'APPROVED', 'Bon repos');
  select status, approved_by into v_status, v_by from public.hr_leave_request
   where id = '00000000-0000-0000-0000-0000000e1f01';
  if v_status <> 'APPROVED' or v_by <> '00000000-0000-0000-0000-0000000e1001' then
    raise exception 'HR-B1: the manager approval must record status and decider (got %, %)', v_status, v_by;
  end if;
  select taken_tenths into v_taken from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-0000000e1ee1';
  if v_taken <> 20 then
    raise exception 'HR-B1: approval must consume exactly the request tenths (taken=%)', v_taken;
  end if;
  select count(*) into v_events from public.hr_employee_event
   where employee_id = '00000000-0000-0000-0000-0000000e1e02' and event_kind = 'leave_approved'
     and payload->>'request_id' = '00000000-0000-0000-0000-0000000e1f01';
  if v_events <> 1 then
    raise exception 'HR-B1: exactly one leave_approved ledger event expected (got %)', v_events;
  end if;
end $$;

-- ---- 6. deciding twice is refused (HR523) — no double consumption ---------
do $$
declare v_taken int;
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f01',
      '00000000-0000-0000-0000-0000000e1004', 'APPROVED', null);
    raise exception 'HR-B1: a decided request must never be decided again';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR523' then
      raise exception 'HR-B1: expected HR523 on re-decide, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
  select taken_tenths into v_taken from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-0000000e1ee1';
  if v_taken <> 20 then
    raise exception 'HR-B1: a refused re-decide must not move the entitlement (taken=%)', v_taken;
  end if;
end $$;

-- ---- 7. a refusal consumes nothing ----------------------------------------
do $$
declare v_taken int; v_status text;
begin
  perform public.hr_decide_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f02',
    '00000000-0000-0000-0000-0000000e1001', 'REFUSED', 'Période chargée');
  select status into v_status from public.hr_leave_request where id = '00000000-0000-0000-0000-0000000e1f02';
  select taken_tenths into v_taken from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-0000000e1ee1';
  if v_status <> 'REFUSED' or v_taken <> 20 then
    raise exception 'HR-B1: a refusal must not consume entitlement (status=%, taken=%)', v_status, v_taken;
  end if;
end $$;

-- ---- 8. the manager lane does NOT extend beyond their reports -------------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f05',
      '00000000-0000-0000-0000-0000000e1001', 'APPROVED', null);
    raise exception 'HR-B1: a manager must not decide outside their reports';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B1: expected EFA15 out of scope, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 9. an org-wide Direction seat decides anyone -------------------------
do $$
declare v_status text;
begin
  perform public.hr_decide_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f05',
    '00000000-0000-0000-0000-0000000e1004', 'APPROVED', null);
  select status into v_status from public.hr_leave_request where id = '00000000-0000-0000-0000-0000000e1f05';
  if v_status <> 'APPROVED' then
    raise exception 'HR-B1: the Direction seat must be able to decide (status=%)', v_status;
  end if;
end $$;

-- ---- 10. a permission holder from ANOTHER tenant is refused ---------------
do $$
begin
  begin
    perform public.hr_decide_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f08',
      '00000000-0000-0000-0000-0000000e1006', 'APPROVED', null);
    raise exception 'HR-B1: cross-tenant decision must be impossible';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR530' then
      raise exception 'HR-B1: expected HR530 cross-tenant, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 11. SELF cancel of one's own undecided request works -----------------
do $$
declare v_status text;
begin
  perform public.hr_cancel_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f06',
    '00000000-0000-0000-0000-0000000e1002', 'Je reporte', 'SELF');
  select status into v_status from public.hr_leave_request where id = '00000000-0000-0000-0000-0000000e1f06';
  if v_status <> 'CANCELLED' then
    raise exception 'HR-B1: SELF cancel of an own draft must work (status=%)', v_status;
  end if;
end $$;

-- ---- 12. SELF cancel of an APPROVED leave is refused (HR526) --------------
do $$
begin
  perform public.hr_decide_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f07',
    '00000000-0000-0000-0000-0000000e1001', 'APPROVED', null);
  begin
    perform public.hr_cancel_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f07',
      '00000000-0000-0000-0000-0000000e1002', 'Je change d''avis', 'SELF');
    raise exception 'HR-B1: SELF cancel of approved leave must be refused';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR526' then
      raise exception 'HR-B1: expected HR526 on approved SELF cancel, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 13. SELF cancel of somebody else's request is refused (HR529) --------
do $$
begin
  begin
    perform public.hr_cancel_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f08',
      '00000000-0000-0000-0000-0000000e1001', 'Pas la mienne', 'SELF');
    raise exception 'HR-B1: SELF cancel must be limited to one''s own request';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'HR529' then
      raise exception 'HR-B1: expected HR529, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 14. ADMIN cancel of an approved leave returns the entitlement --------
do $$
declare v_taken int;
begin
  perform public.hr_cancel_leave_request(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f01',
    '00000000-0000-0000-0000-0000000e1003', 'Erreur de saisie', 'ADMIN');
  select taken_tenths into v_taken from public.hr_leave_entitlement
   where id = '00000000-0000-0000-0000-0000000e1ee1';
  if v_taken <> 0 then
    raise exception 'HR-B1: the admin cancel must return the entitlement exactly (taken=%)', v_taken;
  end if;
end $$;

-- ---- 15. ADMIN cancel without hr:manage is refused ------------------------
do $$
begin
  begin
    perform public.hr_cancel_leave_request(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000e1f08',
      '00000000-0000-0000-0000-0000000e1005', 'Je tente', 'ADMIN');
    raise exception 'HR-B1: ADMIN cancel requires hr:manage in the database';
  exception when others then
    if sqlerrm like 'HR-B1:%' then raise; end if;
    if sqlstate <> 'EFA15' then
      raise exception 'HR-B1: expected EFA15 on unauthorized admin cancel, got % (%)', sqlstate, sqlerrm;
    end if;
  end;
end $$;

-- ---- 16. the 4-argument cancel signature is gone --------------------------
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc
   where proname = 'hr_cancel_leave_request' and pronargs = 4;
  if v_count <> 0 then
    raise exception 'HR-B1: the 4-argument cancel signature must not exist';
  end if;
end $$;

select 'HR-B1 leave scope: all checks passed' as result;

rollback;
