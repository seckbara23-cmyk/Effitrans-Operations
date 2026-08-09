-- OPS-SEC-2A — behavioural persona tests for assert_actor_authority.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- These assert OUTCOMES, not grants. OPS-SEC-1 taught the difference the hard
-- way: every has_function_privilege assertion stayed green while production was
-- broken, because the defect was one call deeper than the metadata could see.
--
-- The lanes that need real rows are proven HERE rather than in the migration,
-- because CI's organization table is empty at migration time and an assertion
-- that passes on an empty database has proven nothing.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures. Two tenants, four identities, chosen so every refusal has a
-- matching acceptance -- a test that only proves refusals cannot tell "secure"
-- from "broken".
-- ---------------------------------------------------------------------------
insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000000c2', 'OPS-SEC-2A Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ac01', 'ops2a.permitted@test.local'),
  ('00000000-0000-0000-0000-00000000ac02', 'ops2a.unprivileged@test.local'),
  ('00000000-0000-0000-0000-00000000ac03', 'ops2a.tenantb@test.local'),
  ('00000000-0000-0000-0000-00000000ac04', 'ops2a.inactive@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000ac01', '00000000-0000-0000-0000-000000000001', 'ops2a.permitted@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000ac02', '00000000-0000-0000-0000-000000000001', 'ops2a.unprivileged@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000ac03', '00000000-0000-0000-0000-0000000000c2', 'ops2a.tenantb@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000ac04', '00000000-0000-0000-0000-000000000001', 'ops2a.inactive@test.local', 'archived')
on conflict (id) do nothing;

-- Roles are resolved BY PERMISSION rather than by name, so a role-template
-- rename cannot silently turn this suite into a no-op.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ac01', r.id, r.tenant_id
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
 where r.tenant_id = '00000000-0000-0000-0000-000000000001'
   and p.code = 'file:create'
 limit 1
on conflict do nothing;

-- The inactive actor holds the permission too: its refusal must be caused by
-- status, not by a missing grant.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ac04', r.id, r.tenant_id
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
 where r.tenant_id = '00000000-0000-0000-0000-000000000001'
   and p.code = 'file:create'
 limit 1
on conflict do nothing;

-- OPS-SEC-2B — a second actor holding hr:manage, so the employee-numbering
-- pilot is proven by a real permission holder rather than by the file:create one.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ac05', 'ops2a.hr@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000ac05', '00000000-0000-0000-0000-000000000001', 'ops2a.hr@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ac05', r.id, r.tenant_id
  from public.role r
  join public.role_permission rp on rp.role_id = r.id
  join public.permission p on p.id = rp.permission_id
 where r.tenant_id = '00000000-0000-0000-0000-000000000001'
   and p.code = 'hr:manage'
 limit 1
on conflict do nothing;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

-- ---------------------------------------------------------------------------
-- Helper: run one assertion and capture its SQLSTATE.
-- Results are collected into variables and written to _r only AFTER any role
-- reset -- writing to a temp table while wearing a restricted role is how
-- migration 89 failed in production.
-- ---------------------------------------------------------------------------
do $suite$
declare
  v_state    text;
  v_tenant_a uuid := '00000000-0000-0000-0000-000000000001';
  v_tenant_b uuid := '00000000-0000-0000-0000-0000000000c2';
  v_permitted   uuid := '00000000-0000-0000-0000-00000000ac01';
  v_unpriv      uuid := '00000000-0000-0000-0000-00000000ac02';
  v_tenantb     uuid := '00000000-0000-0000-0000-00000000ac03';
  v_inactive    uuid := '00000000-0000-0000-0000-00000000ac04';
  v_ghost       uuid := '00000000-0000-4000-8000-0000000000ee';
  -- results
  r_anon text; r_auth_no text; r_auth_yes text; r_auth_nominate text;
  r_auth_xtenant text; r_svc_ok text; r_svc_forged text; r_svc_wrong_tenant text;
  r_svc_no_perm text; r_svc_inactive text; r_svc_from_session text;
  r_system text; r_human_as_system text; r_pilot_ok text; r_pilot_forged text;
  v_hr uuid := '00000000-0000-0000-0000-00000000ac05';
  r_emp_ok text; r_emp_no_perm text; r_emp_xtenant text;
begin
  ---------------------------------------------------------------------------
  -- SERVICE lane: no session. auth.uid() is NULL for the service-role key.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);

  -- 1. valid human actor, correct tenant, holds the permission -> ACCEPTED
  begin
    perform public.assert_actor_authority(v_permitted, v_tenant_a, 'file:create', 'SERVICE');
    r_svc_ok := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_ok := 'REFUSED:' || v_state;
  end;

  -- 2. forged actor: a uuid belonging to nobody
  begin
    perform public.assert_actor_authority(v_ghost, v_tenant_a, 'file:create', 'SERVICE');
    r_svc_forged := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_forged := 'REFUSED:' || v_state;
  end;

  -- 3. real actor, WRONG tenant -- the cross-tenant forgery
  begin
    perform public.assert_actor_authority(v_permitted, v_tenant_b, 'file:create', 'SERVICE');
    r_svc_wrong_tenant := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_wrong_tenant := 'REFUSED:' || v_state;
  end;

  -- 4. real actor of the right tenant, but WITHOUT the permission.
  --    This is the assertion that makes service-role transport, not authority.
  begin
    perform public.assert_actor_authority(v_unpriv, v_tenant_a, 'file:create', 'SERVICE');
    r_svc_no_perm := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_no_perm := 'REFUSED:' || v_state;
  end;

  -- 5. holds the permission but is archived
  begin
    perform public.assert_actor_authority(v_inactive, v_tenant_a, 'file:create', 'SERVICE');
    r_svc_inactive := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_inactive := 'REFUSED:' || v_state;
  end;

  -- 6. PILOT, end to end: the overload must accept a valid nomination...
  begin
    perform public.next_file_number(v_tenant_a, 'IMP', v_permitted);
    r_pilot_ok := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_pilot_ok := 'REFUSED:' || v_state;
  end;

  -- 7. ...and refuse a forged one, WITHOUT allocating a number.
  begin
    perform public.next_file_number(v_tenant_a, 'IMP', v_ghost);
    r_pilot_forged := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_pilot_forged := 'REFUSED:' || v_state;
  end;

  -- 7b. EMPLOYEE numbering pilot (OPS-SEC-2B): an hr:manage holder succeeds...
  begin
    perform public.next_employee_number(v_tenant_a, v_hr);
    r_emp_ok := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_emp_ok := 'REFUSED:' || v_state;
  end;

  -- ...the file:create holder does NOT (right tenant, wrong permission)...
  begin
    perform public.next_employee_number(v_tenant_a, v_permitted);
    r_emp_no_perm := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_emp_no_perm := 'REFUSED:' || v_state;
  end;

  -- ...and neither does the right actor against the wrong tenant.
  begin
    perform public.next_employee_number(v_tenant_b, v_hr);
    r_emp_xtenant := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_emp_xtenant := 'REFUSED:' || v_state;
  end;

  -- 8. SYSTEM lane is closed, and a human actor cannot be used as automation
  begin
    perform public.assert_actor_authority(null, v_tenant_a, 'file:create', 'SYSTEM');
    r_system := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_system := 'REFUSED:' || v_state;
  end;

  begin
    perform public.assert_actor_authority(v_permitted, v_tenant_a, 'file:create', 'SYSTEM');
    r_human_as_system := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_human_as_system := 'REFUSED:' || v_state;
  end;

  ---------------------------------------------------------------------------
  -- INTERACTIVE lane: a real session. Claims are set per persona.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_permitted::text, 'role', 'authenticated')::text, true);

  -- 9. session holding the permission, acting as itself -> ACCEPTED
  begin
    perform public.assert_actor_authority(v_permitted, v_tenant_a, 'file:create', 'INTERACTIVE');
    r_auth_yes := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_auth_yes := 'REFUSED:' || v_state;
  end;

  -- 10. the same session NOMINATING SOMEONE ELSE -> must be refused
  begin
    perform public.assert_actor_authority(v_unpriv, v_tenant_a, 'file:create', 'INTERACTIVE');
    r_auth_nominate := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_auth_nominate := 'REFUSED:' || v_state;
  end;

  -- 11. the same session claiming to be a SERVICE -> must be refused, or
  --     declaring SERVICE would be a nomination bypass for any browser caller.
  begin
    perform public.assert_actor_authority(v_unpriv, v_tenant_a, 'file:create', 'SERVICE');
    r_svc_from_session := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_svc_from_session := 'REFUSED:' || v_state;
  end;

  -- 12. session acting on ANOTHER tenant
  begin
    perform public.assert_actor_authority(v_permitted, v_tenant_b, 'file:create', 'INTERACTIVE');
    r_auth_xtenant := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_auth_xtenant := 'REFUSED:' || v_state;
  end;

  -- 13. authenticated session WITHOUT the permission
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_unpriv::text, 'role', 'authenticated')::text, true);
  begin
    perform public.assert_actor_authority(v_unpriv, v_tenant_a, 'file:create', 'INTERACTIVE');
    r_auth_no := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_auth_no := 'REFUSED:' || v_state;
  end;

  -- 14. anonymous: no subject at all
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.assert_actor_authority(null, v_tenant_a, 'file:create', 'INTERACTIVE');
    r_anon := 'ACCEPTED';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    r_anon := 'REFUSED:' || v_state;
  end;

  -- Recorded only now, with no role or claims in force.
  insert into _r values
    ('service_valid_actor_accepted',       r_svc_ok = 'ACCEPTED', r_svc_ok),
    ('service_forged_actor_refused',       r_svc_forged = 'REFUSED:EFA12', r_svc_forged),
    ('service_wrong_tenant_refused',       r_svc_wrong_tenant = 'REFUSED:EFA13', r_svc_wrong_tenant),
    ('service_actor_without_permission_refused', r_svc_no_perm = 'REFUSED:EFA15', r_svc_no_perm),
    ('service_inactive_actor_refused',     r_svc_inactive = 'REFUSED:EFA14', r_svc_inactive),
    ('pilot_valid_nomination_accepted',    r_pilot_ok = 'ACCEPTED', r_pilot_ok),
    ('pilot_forged_nomination_refused',    r_pilot_forged = 'REFUSED:EFA12', r_pilot_forged),
    ('employee_pilot_hr_actor_accepted',   r_emp_ok = 'ACCEPTED', r_emp_ok),
    ('employee_pilot_wrong_permission_refused', r_emp_no_perm = 'REFUSED:EFA15', r_emp_no_perm),
    ('employee_pilot_cross_tenant_refused', r_emp_xtenant = 'REFUSED:EFA13', r_emp_xtenant),
    ('system_lane_closed',                 r_system = 'REFUSED:EFA16', r_system),
    ('human_cannot_be_automation',         r_human_as_system = 'REFUSED:EFA16', r_human_as_system),
    ('interactive_self_accepted',          r_auth_yes = 'ACCEPTED', r_auth_yes),
    ('interactive_cannot_nominate_other',  r_auth_nominate = 'REFUSED:EFA03', r_auth_nominate),
    ('session_cannot_claim_service',       r_svc_from_session = 'REFUSED:EFA08', r_svc_from_session),
    ('interactive_cross_tenant_refused',   r_auth_xtenant = 'REFUSED:EFA05', r_auth_xtenant),
    ('interactive_without_permission_refused', r_auth_no = 'REFUSED:EFA07', r_auth_no),
    ('anonymous_refused',                  r_anon = 'REFUSED:EFA02', r_anon);
end
$suite$;

-- ---------------------------------------------------------------------------
-- The forged pilot call must not have consumed a file number. Proving the
-- refusal happened BEFORE the side effect, not merely that it errored.
-- ---------------------------------------------------------------------------
do $no_side_effect$
declare v_before text; v_after text;
begin
  v_before := public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP');
  begin
    perform public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP',
                                    '00000000-0000-4000-8000-0000000000ee'::uuid);
  exception when others then null;
  end;
  v_after := public.next_file_number('00000000-0000-0000-0000-000000000001', 'IMP');
  -- Two legitimate allocations either side of one refused attempt must be
  -- consecutive; a gap would mean the refusal burned a number.
  insert into _r values ('forged_pilot_call_allocated_nothing',
    (regexp_replace(v_after,  '^.*-', '')::bigint
   - regexp_replace(v_before, '^.*-', '')::bigint) = 1,
    v_before || ' -> ' || v_after);
end
$no_side_effect$;

-- ---------------------------------------------------------------------------
-- OPS-SEC-2B — the employee sequence must not advance on a refusal either, and
-- two valid allocations either side of it must stay consecutive.
-- ---------------------------------------------------------------------------
do $emp_no_side_effect$
declare v_before text; v_after text;
begin
  v_before := public.next_employee_number('00000000-0000-0000-0000-000000000001');
  begin
    perform public.next_employee_number('00000000-0000-0000-0000-000000000001',
                                        '00000000-0000-4000-8000-0000000000ee'::uuid);
  exception when others then null;
  end;
  v_after := public.next_employee_number('00000000-0000-0000-0000-000000000001');
  insert into _r values ('forged_employee_call_allocated_nothing',
    (regexp_replace(v_after,  '\D', '', 'g')::bigint
   - regexp_replace(v_before, '\D', '', 'g')::bigint) = 1,
    v_before || ' -> ' || v_after);
end
$emp_no_side_effect$;

-- ---------------------------------------------------------------------------
-- Report. Any false fails the suite with ON_ERROR_STOP.
-- ---------------------------------------------------------------------------
select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ')
    into v_bad from _r where not ok;
  if v_bad is not null then
    raise exception 'OPS-SEC-2A persona suite FAILED: %', v_bad;
  end if;
  raise notice 'OPS-SEC-2A persona suite: all checks passed';
end
$verdict$;

rollback;
