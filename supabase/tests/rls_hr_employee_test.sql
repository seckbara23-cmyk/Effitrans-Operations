-- RLS regression test — HR employee registry (Phase HR-1). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves public.employee is tenant-confined, permission-gated on hr:read, and
-- portal-invisible — AND that SYSTEM_ADMIN sees NOTHING (DEC-B25: SYSTEM_ADMIN
-- holds no hr:* by default; the strongest data isolation on the platform):
--   * HR_OFFICER (hr:read) sees its own tenant's employee                    -> 1
--   * SYSTEM_ADMIN (NO hr:read) sees NOTHING — the decisive DEC-B25 proof     -> 0
--   * another tenant's staff sees nothing                                     -> 0
--   * a PORTAL user sees NOTHING (no portal policy on the table)              -> 0
--   * the tenant trigger rejects a cross-tenant account link even as postgres -> raises
--   * the partial-unique index rejects linking one account to two employees   -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d1', 'Test Tenant D1', 'SN')
on conflict (id) do nothing;

-- H1 = HR_OFFICER tenant A (hr:read); H2 = SYSTEM_ADMIN tenant A (NO hr:read);
-- H3 = other-tenant staff; H4 = portal user; H5 = a plain active tenant-A
-- account used as the link target.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'hr-h1@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'hr-h2@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'hr-h3@test.local'),
  ('00000000-0000-0000-0000-0000000000f4', 'hr-h4@test.local'),
  ('00000000-0000-0000-0000-0000000000f5', 'hr-h5@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'hr-h1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'hr-h2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'hr-h3@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-000000000001', 'hr-h5@test.local', 'active')
on conflict (id) do nothing;

-- H1 → HR_OFFICER (has hr:read + hr:manage); H2 → SYSTEM_ADMIN (no hr:*).
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000f2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ccd01', '00000000-0000-0000-0000-000000000001', 'HR Client A1')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ccd01', 'hr-h4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

-- The employee under test — tenant A, linked to the plain account H5.
insert into public.employee
  (id, tenant_id, employee_number, first_name, last_name, department, status, linked_app_user_id) values
  ('00000000-0000-0000-0000-0000000eee01', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9001', 'Awa', 'Diop', 'OPERATIONS', 'ACTIVE', '00000000-0000-0000-0000-0000000000f5')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  h1_sees int; h2_sees int; h3_sees int; h4_sees int;
  trigger_rejected int := 0;
  dup_link_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- H1: HR_OFFICER tenant A — sees its own tenant's employee.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f1','role','authenticated')::text, true);
  select count(*) into h1_sees from public.employee where id = '00000000-0000-0000-0000-0000000eee01';

  -- H2: SYSTEM_ADMIN tenant A — holds NO hr:read, so sees NOTHING (DEC-B25).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f2','role','authenticated')::text, true);
  select count(*) into h2_sees from public.employee where id = '00000000-0000-0000-0000-0000000eee01';

  -- H3: another tenant's staff — sees nothing of tenant A.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f3','role','authenticated')::text, true);
  select count(*) into h3_sees from public.employee where id = '00000000-0000-0000-0000-0000000eee01';

  -- H4: portal user — HR is never customer-readable (no portal policy).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000f4','role','authenticated')::text, true);
  select count(*) into h4_sees from public.employee where id = '00000000-0000-0000-0000-0000000eee01';

  perform set_config('role', 'postgres', true);

  -- Defense-in-depth: the tenant trigger rejects a cross-tenant account link
  -- even as postgres (employee in tenant D1, account belongs to tenant A).
  begin
    insert into public.employee (tenant_id, employee_number, first_name, last_name, department, linked_app_user_id)
    values ('00000000-0000-0000-0000-0000000000d1', 'EMP-X-1', 'X', 'Y', 'OPERATIONS',
            '00000000-0000-0000-0000-0000000000f5');
  exception when others then
    trigger_rejected := 1;
  end;

  -- The partial-unique index rejects linking one account to a SECOND employee.
  begin
    insert into public.employee (tenant_id, employee_number, first_name, last_name, department, linked_app_user_id)
    values ('00000000-0000-0000-0000-000000000001', 'EMP-2099-9002', 'Second', 'Person', 'FINANCE',
            '00000000-0000-0000-0000-0000000000f5');
  exception when others then
    dup_link_rejected := 1;
  end;

  insert into _r values
    ('h1_hr_read_sees', h1_sees),
    ('h2_system_admin_sees', h2_sees),
    ('h3_cross_tenant_sees', h3_sees),
    ('h4_portal_sees', h4_sees),
    ('trigger_cross_tenant_link_rejected', trigger_rejected),
    ('dup_account_link_rejected', dup_link_rejected);

  if h1_sees<>1 or h2_sees<>0 or h3_sees<>0 or h4_sees<>0
     or trigger_rejected<>1 or dup_link_rejected<>1
  then
    raise exception 'RLS HR EMPLOYEE FAIL: h1=% h2(admin)=% h3=% h4=% trigger=% dup=%',
      h1_sees, h2_sees, h3_sees, h4_sees, trigger_rejected, dup_link_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
