-- HR-A2 — employee registry activation: database-level proofs.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- What only the database can prove:
--   * ORGANIZATIONAL PLACEMENT GRANTS NOTHING: linking an employee to a login
--     account AND assigning them to a FINANCE-mapped unit changes
--     get_user_permissions by exactly zero rows — placement is metadata,
--     authorization is user_role -> role_permission, and only that;
--   * the account-link backstops hold under direct SQL (beneath the app):
--     a cross-tenant link is REFUSED by the tenant trigger, and one account
--     linking to two employees is REFUSED by the partial unique index;
--   * "one open PRIMARY assignment per employee" is a DB invariant, not an
--     app convention.
--
-- (An employee linking to two accounts is impossible BY SHAPE — one nullable
-- column — pinned structurally in tests/hr-a2-registry-activation.test.ts.
-- EMP-0001 allocation, refusal-burns-nothing and prefix behavior are proven in
-- hr_a1_foundation_activation_test.sql, which still runs in this same CI job.)

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_t2     uuid;
  v_user   uuid := '00000000-0000-4000-8000-0000000000a1';
  v_user2  uuid := '00000000-0000-4000-8000-0000000000a2';
  v_emp    uuid;
  v_unit   uuid;
  v_before int;
  v_after  int;
  v_refused boolean;
begin
  -- Fixtures: two active accounts in tenant A, a throwaway tenant B, and a
  -- FINANCE-mapped DEPARTMENT unit (the strongest placement-authority
  -- temptation: if placement granted anything, Finance would be it).
  insert into auth.users (id, email) values
    (v_user,  'hr-a2-p1@test.local'),
    (v_user2, 'hr-a2-p2@test.local')
  on conflict (id) do nothing;
  insert into public.app_user (id, tenant_id, email, status) values
    (v_user,  v_tenant, 'hr-a2-p1@test.local', 'active'),
    (v_user2, v_tenant, 'hr-a2-p2@test.local', 'active')
  on conflict (id) do nothing;

  insert into public.organization (name) values ('HR-A2 probe tenant B') returning id into v_t2;

  insert into public.hr_org_unit (tenant_id, unit_kind, name, canonical_department)
  values (v_tenant, 'DEPARTMENT', 'Unité Finance — sonde HR-A2', 'FINANCE')
  returning id into v_unit;

  -- -------------------------------------------------------------------------
  -- A. Placement grants NOTHING (the HR-0P invariant, proven live).
  -- -------------------------------------------------------------------------
  select count(*) into v_before from public.get_user_permissions(v_user);

  insert into public.employee
    (tenant_id, employee_number, first_name, last_name, department, status, linked_app_user_id)
  values
    (v_tenant, 'EMP-A2-PROBE-1', 'Sonde', 'Placement', 'FINANCE', 'ACTIVE', v_user)
  returning id into v_emp;

  insert into public.employee_assignment
    (tenant_id, employee_id, org_unit_id, assignment_kind, effective_from)
  values
    (v_tenant, v_emp, v_unit, 'PRIMARY', current_date);

  select count(*) into v_after from public.get_user_permissions(v_user);

  insert into _r values
    ('linking + FINANCE-unit placement grants ZERO permissions',
     v_before = v_after, v_before::text || ' -> ' || v_after::text),
    ('the probe account held no permission to begin with (clean probe)',
     v_before = 0, v_before::text);

  -- -------------------------------------------------------------------------
  -- B. Cross-tenant account link REFUSED by the tenant trigger, even in
  --    direct SQL beneath the app layer.
  -- -------------------------------------------------------------------------
  v_refused := false;
  begin
    insert into public.employee
      (tenant_id, employee_number, first_name, last_name, department, linked_app_user_id)
    values
      (v_t2, 'EMP-A2-PROBE-XT', 'Sonde', 'InterTenant', 'OPERATIONS', v_user2);
  exception when others then v_refused := true;
  end;
  insert into _r values ('cross-tenant account link refused', v_refused, '-');

  -- -------------------------------------------------------------------------
  -- C. One account can NEVER link to two employees (partial unique index).
  -- -------------------------------------------------------------------------
  v_refused := false;
  begin
    insert into public.employee
      (tenant_id, employee_number, first_name, last_name, department, linked_app_user_id)
    values
      (v_tenant, 'EMP-A2-PROBE-2', 'Sonde', 'DoubleLien', 'OPERATIONS', v_user);
  exception when others then v_refused := true;
  end;
  insert into _r values ('one account cannot link to two employees', v_refused, '-');

  -- -------------------------------------------------------------------------
  -- D. One OPEN PRIMARY assignment per employee is a DB invariant.
  -- -------------------------------------------------------------------------
  v_refused := false;
  begin
    insert into public.employee_assignment
      (tenant_id, employee_id, org_unit_id, assignment_kind, effective_from)
    values
      (v_tenant, v_emp, v_unit, 'PRIMARY', current_date);
  exception when others then v_refused := true;
  end;
  insert into _r values ('second open PRIMARY assignment refused', v_refused, '-');
end
$suite$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'HR-A2 registry activation suite FAILED: %', v_bad;
  end if;
  raise notice 'HR-A2 registry activation suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
