-- RLS regression test — HR-1 Organization Foundation (migration 73). BEGIN/ROLLBACK.
-- ---------------------------------------------------------------------------
-- Proves, on live Postgres:
--   * hr_org_unit is tenant-confined + gated on hr:read; SYSTEM_ADMIN sees 0
--     (DEC-B25); cross-tenant sees 0; portal sees 0
--   * hr_import_batch is gated on hr:manage (HR working data)
--   * the kind-order trigger rejects an ascending parent (TEAM ← DEPARTMENT ok,
--     DEPARTMENT ← TEAM raises) and a cross-tenant parent
--   * hr_employee_event is append-only (UPDATE raises via prevent_mutation)
--   * employee_number is immutable (UPDATE raises)
--   * the import maker-checker CHECK rejects approver = submitter
--   * hr:config:manage / hr:sensitive:read exist in the catalog; since HR-A1
--     (HRQ-D2 = Option A) hr:config:manage is granted to HR_OFFICER and ONLY
--     HR_OFFICER, while hr:sensitive:read remains granted to NO role (DEC-B63
--     legal gates still open). Until HR-A1 this suite pinned the full B1
--     pause (zero grants on both) — the ratification retired that semantic.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d2', 'Test Tenant D2', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'hro-e1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'hro-e2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'hro-e3@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'hro-e1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'hro-e2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'hro-e3@test.local', 'active')
on conflict (id) do nothing;

-- E1 → HR_OFFICER (hr:read + hr:manage); E2 → SYSTEM_ADMIN (no hr:*).
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- Structure under test: a DEPARTMENT with a TEAM below it, tenant A.
insert into public.hr_org_unit (id, tenant_id, unit_kind, name) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-000000000001', 'DEPARTMENT', 'Exploitation Test')
on conflict (id) do nothing;
insert into public.hr_org_unit (id, tenant_id, parent_id, unit_kind, name) values
  ('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000a0001', 'TEAM', 'Équipe Quai Test')
on conflict (id) do nothing;

-- A batch in SUBMITTED, submitted by E1 — for the maker-checker CHECK probe.
insert into public.hr_import_batch (id, tenant_id, batch_number, import_kind, status, submitted_by, submitted_at) values
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-000000000001',
   'HR-IMP-TEST-1', 'ORG_UNITS', 'SUBMITTED', '00000000-0000-0000-0000-0000000000e1', now())
on conflict (id) do nothing;

-- An employee + a ledger event — for the immutability probes.
insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee11', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9101', 'Test', 'Ledger', 'HUMAN_RESOURCES', 'ACTIVE')
on conflict (id) do nothing;
insert into public.hr_employee_event (id, tenant_id, employee_id, event_kind) values
  ('00000000-0000-0000-0000-0000000c0001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000eee11', 'created')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  e1_units int; e2_units int; e3_units int;
  e1_batches int; e2_batches int;
  bad_parent_rejected int := 0;
  cross_tenant_parent_rejected int := 0;
  ledger_update_rejected int := 0;
  number_update_rejected int := 0;
  self_approve_rejected int := 0;
  cfg_perm_rows int; cfg_officer_grants int; cfg_other_grants int; sensitive_grants int;
begin
  perform set_config('role', 'authenticated', true);

  -- E1 (hr:read + hr:manage): sees both units and the batch.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into e1_units from public.hr_org_unit where tenant_id = '00000000-0000-0000-0000-000000000001'
    and id in ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000a0002');
  select count(*) into e1_batches from public.hr_import_batch where id = '00000000-0000-0000-0000-0000000b0001';

  -- E2 (SYSTEM_ADMIN, no hr:*): sees nothing of either (DEC-B25).
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into e2_units from public.hr_org_unit where id in
    ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000a0002');
  select count(*) into e2_batches from public.hr_import_batch where id = '00000000-0000-0000-0000-0000000b0001';

  -- E3 (other tenant): sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e3','role','authenticated')::text, true);
  select count(*) into e3_units from public.hr_org_unit where id in
    ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000a0002');

  perform set_config('role', 'postgres', true);

  -- Kind order must DESCEND: a DEPARTMENT under a TEAM raises.
  begin
    insert into public.hr_org_unit (tenant_id, parent_id, unit_kind, name)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000a0002',
            'DEPARTMENT', 'Inversé');
  exception when others then
    bad_parent_rejected := 1;
  end;

  -- A parent in another tenant raises, even as postgres.
  begin
    insert into public.hr_org_unit (tenant_id, parent_id, unit_kind, name)
    values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000a0001',
            'SECTION', 'Cross-tenant');
  exception when others then
    cross_tenant_parent_rejected := 1;
  end;

  -- The Timeline ledger is append-only.
  begin
    update public.hr_employee_event set event_kind = 'tampered'
     where id = '00000000-0000-0000-0000-0000000c0001';
  exception when others then
    ledger_update_rejected := 1;
  end;

  -- The matricule is immutable.
  begin
    update public.employee set employee_number = 'EMP-2099-9999'
     where id = '00000000-0000-0000-0000-0000000eee11';
  exception when others then
    number_update_rejected := 1;
  end;

  -- Maker-checker: the submitter cannot approve their own batch (CHECK).
  begin
    update public.hr_import_batch
       set status = 'READY', approved_by = submitted_by, approved_at = now()
     where id = '00000000-0000-0000-0000-0000000b0001';
  exception when others then
    self_approve_rejected := 1;
  end;

  -- Post-HRQ-D2 grant state: both codes still exist; hr:config:manage is held
  -- by HR_OFFICER and NO other role; hr:sensitive:read is held by NOBODY.
  select count(*) into cfg_perm_rows from public.permission
   where code in ('hr:config:manage', 'hr:sensitive:read');
  select count(*) into cfg_officer_grants from public.role_permission rp
   join public.permission p on p.id = rp.permission_id
   join public.role r on r.id = rp.role_id
   where p.code = 'hr:config:manage' and r.code = 'HR_OFFICER';
  select count(*) into cfg_other_grants from public.role_permission rp
   join public.permission p on p.id = rp.permission_id
   join public.role r on r.id = rp.role_id
   where p.code = 'hr:config:manage' and r.code <> 'HR_OFFICER';
  select count(*) into sensitive_grants from public.role_permission rp
   join public.permission p on p.id = rp.permission_id
   where p.code = 'hr:sensitive:read';

  insert into _r values
    ('e1_hr_read_units', e1_units),
    ('e1_hr_manage_batches', e1_batches),
    ('e2_system_admin_units', e2_units),
    ('e2_system_admin_batches', e2_batches),
    ('e3_cross_tenant_units', e3_units),
    ('kind_order_rejected', bad_parent_rejected),
    ('cross_tenant_parent_rejected', cross_tenant_parent_rejected),
    ('ledger_update_rejected', ledger_update_rejected),
    ('employee_number_update_rejected', number_update_rejected),
    ('self_approve_rejected', self_approve_rejected),
    ('permission_rows', cfg_perm_rows),
    ('config_officer_grants', cfg_officer_grants),
    ('config_other_role_grants', cfg_other_grants),
    ('sensitive_grants', sensitive_grants);

  if e1_units<>2 or e1_batches<>1 or e2_units<>0 or e2_batches<>0 or e3_units<>0
     or bad_parent_rejected<>1 or cross_tenant_parent_rejected<>1
     or ledger_update_rejected<>1 or number_update_rejected<>1
     or self_approve_rejected<>1 or cfg_perm_rows<>2
     or cfg_officer_grants<>1 or cfg_other_grants<>0 or sensitive_grants<>0
  then
    raise exception 'HR-1 ORG FAIL: e1u=% e1b=% e2u=% e2b=% e3u=% kind=% xparent=% ledger=% num=% visa=% permrows=% cfgofficer=% cfgother=% sensitive=%',
      e1_units, e1_batches, e2_units, e2_batches, e3_units,
      bad_parent_rejected, cross_tenant_parent_rejected, ledger_update_rejected,
      number_update_rejected, self_approve_rejected, cfg_perm_rows,
      cfg_officer_grants, cfg_other_grants, sensitive_grants;
  end if;
end $$;

select * from _r order by check_name;
rollback;
