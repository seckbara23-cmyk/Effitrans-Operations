-- HR-A1 — foundation activation: grant state + ratified matricule scheme.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- What only the database can prove:
--   * the HRQ-D2 Option A grant landed EXACTLY as ratified — hr:config:manage
--     to HR_OFFICER, nothing to SYSTEM_ADMIN, the three parked authorities
--     still granted to NOBODY;
--   * next_employee_number now yields the ratified continuous EMP-0001 scheme,
--     stays concurrency-safe on the SAME counter engine, keeps per-tenant
--     isolation, honors the configured prefix without ever resetting the
--     sequence, and remains uncallable by browser roles;
--   * organizational placement grants nothing: the RBAC resolution functions
--     never read the HR tables.
--
-- Throwaway tenants are created INSIDE the transaction, so every numbering
-- assertion is absolute (first allocation = 0001) and nothing leaks to later
-- suites.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

-- ---------------------------------------------------------------------------
-- A. The grant, exactly as ratified.
-- ---------------------------------------------------------------------------
do $grants$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_perms  text;
begin
  insert into _r values
    ('HR_OFFICER holds hr:config:manage',
     exists (select 1
               from public.role r
               join public.role_permission rp on rp.role_id = r.id
               join public.permission p on p.id = rp.permission_id
              where r.tenant_id = v_tenant and r.code = 'HR_OFFICER'
                and p.code = 'hr:config:manage'),
     '-'),
    -- HR-B1 unparked hr:leave:approve onto the Direction seats; the OTHER two
    -- authorities stay parked, and the leave seat lands NOWHERE else.
    ('the two parked authorities are granted to NOBODY',
     not exists (select 1
                   from public.role_permission rp
                   join public.permission p on p.id = rp.permission_id
                  where p.code in ('hr:sensitive:read', 'hr:performance:finalize')),
     '-'),
    ('hr:leave:approve lands ONLY on the Direction seats DAF/DGA (HR-B1)',
     not exists (select 1
                   from public.role r
                   join public.role_permission rp on rp.role_id = r.id
                   join public.permission p on p.id = rp.permission_id
                  where p.code = 'hr:leave:approve' and r.code not in ('DAF', 'DGA'))
     and 2 = (select count(*)
                from public.role r
                join public.role_permission rp on rp.role_id = r.id
                join public.permission p on p.id = rp.permission_id
               where r.tenant_id = v_tenant and r.code in ('DAF', 'DGA')
                 and p.code = 'hr:leave:approve'),
     '-'),
    ('SYSTEM_ADMIN holds NO hr:* (DEC-B25)',
     not exists (select 1
                   from public.role r
                   join public.role_permission rp on rp.role_id = r.id
                   join public.permission p on p.id = rp.permission_id
                  where r.code = 'SYSTEM_ADMIN' and p.code like 'hr:%'),
     '-'),
    ('no role beyond HR_OFFICER and the Direction leave seats holds any hr:*',
     not exists (select 1
                   from public.role r
                   join public.role_permission rp on rp.role_id = r.id
                   join public.permission p on p.id = rp.permission_id
                  where p.code like 'hr:%' and r.code <> 'HR_OFFICER'
                    and not (r.code in ('DAF', 'DGA') and p.code = 'hr:leave:approve')),
     '-');

  -- The EXACT permission set — an over-grant elsewhere in the seed would pass
  -- the point checks above but not this pin.
  select string_agg(p.code, ',' order by p.code) into v_perms
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.tenant_id = v_tenant and r.code = 'HR_OFFICER';
  insert into _r values
    ('HR_OFFICER permission set is exactly the ratified seven',
     v_perms = 'hr:config:manage,hr:manage,hr:read,messaging:read,messaging:send,profile:read:self,profile:update:self',
     coalesce(v_perms, 'NULL'));
end
$grants$;

-- ---------------------------------------------------------------------------
-- B. The ratified matricule scheme, on throwaway tenants.
-- ---------------------------------------------------------------------------
do $numbering$
declare
  v_t1 uuid;
  v_t2 uuid;
  v_n  text;
  v_n2 text;
begin
  insert into public.organization (name) values ('HR-A1 numbering probe A') returning id into v_t1;
  insert into public.organization (name) values ('HR-A1 numbering probe B') returning id into v_t2;

  -- B1. First allocations: exact ratified format, starting at 0001, no year.
  v_n := public.next_employee_number(v_t1);
  insert into _r values
    ('first matricule is EMP-0001', v_n = 'EMP-0001', v_n),
    ('no calendar-year segment in the matricule', v_n !~ '20\d\d', v_n);

  -- B2. Continuous sequence.
  v_n := public.next_employee_number(v_t1);
  insert into _r values ('second matricule is EMP-0002', v_n = 'EMP-0002', v_n);

  -- B3. Tenant isolation: tenant B starts its OWN sequence at 0001.
  v_n2 := public.next_employee_number(v_t2);
  insert into _r values ('tenant B sequence is independent (EMP-0001)', v_n2 = 'EMP-0001', v_n2);

  -- B4. The configured prefix is honored…
  insert into public.hr_configuration (tenant_id, employee_number_prefix)
  values (v_t1, 'ETS');
  v_n := public.next_employee_number(v_t1);
  insert into _r values
    ('configured prefix is honored (ETS-0003)', v_n = 'ETS-0003', v_n);

  -- B5. …and a prefix change NEVER resets the sequence (uniqueness safety),
  --     while a blank prefix falls back to the default.
  update public.hr_configuration set employee_number_prefix = '  ' where tenant_id = v_t1;
  v_n := public.next_employee_number(v_t1);
  insert into _r values
    ('blank prefix falls back to EMP; sequence continues (EMP-0004)', v_n = 'EMP-0004', v_n);

  -- B6. One engine: the continuous bucket lives in employee_counter (year=0),
  --     and no second counter table appeared.
  insert into _r values
    ('continuous bucket is employee_counter year=0',
     (select next_seq from public.employee_counter where tenant_id = v_t1 and year = 0) = 4,
     coalesce((select next_seq::text from public.employee_counter where tenant_id = v_t1 and year = 0), 'NULL'));

  -- B7. A refused trusted-overload call allocates nothing (gate before the
  --     side effect): forged actor -> exception -> next number is consecutive.
  begin
    perform public.next_employee_number(v_t1, '00000000-0000-4000-8000-0000000000ee'::uuid);
    insert into _r values ('forged actor call was refused', false, 'no exception raised');
  exception when others then
    insert into _r values ('forged actor call was refused', true, '-');
  end;
  v_n := public.next_employee_number(v_t1);
  insert into _r values
    ('refusal burned no number (EMP-0005 follows)', v_n = 'EMP-0005', v_n);
end
$numbering$;

-- ---------------------------------------------------------------------------
-- C. The protective surfaces around the engine are intact.
-- ---------------------------------------------------------------------------
do $surfaces$
declare v_oid oid;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'next_employee_number' and p.pronargs = 1;

  insert into _r values
    ('browser roles cannot call next_employee_number',
     not (has_function_privilege('anon', v_oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_oid, 'EXECUTE')),
     '-'),
    ('service_role can call next_employee_number',
     has_function_privilege('service_role', v_oid, 'EXECUTE'), '-'),
    ('matricule immutability trigger still present',
     exists (select 1 from pg_trigger
              where tgrelid = 'public.employee'::regclass
                and tgname = 'trg_employee_number_immutable' and not tgisinternal),
     '-'),
    ('employee_counter stays deny-all (RLS on, zero policies)',
     (select relrowsecurity from pg_class where oid = 'public.employee_counter'::regclass)
     and not exists (select 1 from pg_policy where polrelid = 'public.employee_counter'::regclass),
     '-'),
    ('hr_configuration keeps RLS with policies',
     (select relrowsecurity from pg_class where oid = 'public.hr_configuration'::regclass)
     and exists (select 1 from pg_policy where polrelid = 'public.hr_configuration'::regclass),
     '-');
end
$surfaces$;

-- ---------------------------------------------------------------------------
-- D. Organizational placement grants NOTHING: the RBAC resolution functions
--    never read the HR tables. Department/org-unit/assignment are metadata;
--    authorization is user_role -> role_permission, and only that.
-- ---------------------------------------------------------------------------
do $placement$
declare v_src text;
begin
  select string_agg(p.prosrc, ' ') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('get_user_permissions', 'has_permission');
  insert into _r values
    ('RBAC resolution functions exist', v_src is not null, '-'),
    ('RBAC never reads employee/org-unit/assignment tables',
     v_src is not null
     and v_src not like '%public.employee%'
     and v_src not like '%hr_org_unit%'
     and v_src not like '%employee_assignment%',
     '-');
end
$placement$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'HR-A1 foundation activation suite FAILED: %', v_bad;
  end if;
  raise notice 'HR-A1 foundation activation suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
