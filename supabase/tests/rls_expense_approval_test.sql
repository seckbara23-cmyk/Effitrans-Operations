-- RLS regression test — Autorisation approval chain (Phase 11.0D). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the guarantees that must hold in the DATABASE, not merely in the action:
--   * a signer of tenant A sees its own tenant's visas                    -> 1
--   * a tenant-A staff account WITHOUT finance:expense:read sees NOTHING   -> 0
--   * another tenant's signer sees NOTHING (isolation)                    -> 0
--   * a PORTAL user sees NOTHING (no portal policy on expense_visa)       -> 0
--   * the visa ledger is APPEND-ONLY: UPDATE and DELETE both raise        -> raises
--   * one visa per step per attempt: a duplicate step raises (the 11.0D
--     unique index — the concurrency backstop for an append-only ledger)  -> raises
--   * a DIFFERENT attempt may re-collect the same step (correction path)  -> succeeds
--   * the tenant trigger rejects a cross-tenant visa parent               -> raises
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

-- Other tenant (isolation) whose FINANCE_OFFICER genuinely holds the permission,
-- so "sees nothing" is isolation and not a missing grant.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000d1', 'Test Tenant D1', 'SN')
on conflict (id) do nothing;
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000d1', 'FINANCE_OFFICER', 'Agent financier', 'Finance Officer', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-0000000000d1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

-- Z1 = FINANCE_OFFICER tenant A (read+sign) · Z2 = QUOTATION_MANAGER tenant A
-- (no expense read) · Z3 = FINANCE_OFFICER tenant D1 · Z4 = portal user tenant A.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'apv-e1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'apv-e2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 'apv-e3@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', 'apv-e4@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'apv-e1@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'apv-e2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d1', 'apv-e3@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-0000000000d1' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-000000000001', 'Apv Client E1')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000c6', 'apv-e4@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

-- A document IN_APPROVAL with one frozen version and two attempts: attempt #1
-- closed (rejected round), attempt #2 open — the correction path's shape.
insert into public.expense_authorization
  (id, tenant_id, amount, currency, beneficiary, reason, status, requested_by) values
  ('00000000-0000-0000-0000-0000000ea101', '00000000-0000-0000-0000-000000000001',
   250000, 'XOF', 'Transitaire', 'Frais de dossier', 'IN_APPROVAL', '00000000-0000-0000-0000-0000000000e1')
on conflict (id) do nothing;

insert into public.expense_authorization_version
  (id, tenant_id, authorization_id, version_number, amount, currency, beneficiary, reason, snapshot, content_sha256) values
  ('00000000-0000-0000-0000-0000000ea102', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ea101', 1, 250000, 'XOF', 'Transitaire', 'Frais de dossier',
   '{}'::jsonb, 'cafebabe')
on conflict (id) do nothing;

update public.expense_authorization
  set current_version_id = '00000000-0000-0000-0000-0000000ea102'
  where id = '00000000-0000-0000-0000-0000000ea101';

insert into public.expense_approval_attempt
  (id, tenant_id, document_type, authorization_id, version_id, attempt_number, status) values
  ('00000000-0000-0000-0000-0000000ea103', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-0000000ea101',
   '00000000-0000-0000-0000-0000000ea102', 1, 'REJECTED'),
  ('00000000-0000-0000-0000-0000000ea104', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-0000000ea101',
   '00000000-0000-0000-0000-0000000ea102', 2, 'IN_PROGRESS')
on conflict (id) do nothing;

-- The Demandeur visa of the OPEN attempt (step 1).
insert into public.expense_visa
  (id, tenant_id, document_type, authorization_id, version_id, attempt_id, step_code, step_ordinal,
   signer_user_id, signer_role_code, signer_display_name, decision, content_sha256) values
  ('00000000-0000-0000-0000-0000000ea105', '00000000-0000-0000-0000-000000000001',
   'EXPENSE_AUTHORIZATION', '00000000-0000-0000-0000-0000000ea101',
   '00000000-0000-0000-0000-0000000ea102', '00000000-0000-0000-0000-0000000ea104',
   'VISA_DEMANDEUR', 1, '00000000-0000-0000-0000-0000000000e1', 'REQUESTER', 'Agent Test',
   'APPROVED', 'cafebabe')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  z1_sees int; z2_sees int; z3_sees int; z4_sees int;
  visa_update_rejected int := 0; visa_delete_rejected int := 0;
  duplicate_step_rejected int := 0; other_attempt_allowed int := 0;
  cross_tenant_rejected int := 0;
begin
  perform set_config('role', 'authenticated', true);

  -- Z1: FINANCE_OFFICER tenant A — sees the visa.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into z1_sees from public.expense_visa where id = '00000000-0000-0000-0000-0000000ea105';

  -- Z2: no finance:expense:read — sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into z2_sees from public.expense_visa where id = '00000000-0000-0000-0000-0000000ea105';

  -- Z3: another tenant's signer — sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e3','role','authenticated')::text, true);
  select count(*) into z3_sees from public.expense_visa where id = '00000000-0000-0000-0000-0000000ea105';

  -- Z4: portal user — no portal policy exists on the ledger.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e4','role','authenticated')::text, true);
  select count(*) into z4_sees from public.expense_visa where id = '00000000-0000-0000-0000-0000000ea105';

  -- Structural guarantees, as the owner role (RLS is not what enforces these).
  perform set_config('role', 'postgres', true);

  -- Append-only: a recorded visa can never be altered or removed.
  begin
    update public.expense_visa set decision = 'REJECTED'
      where id = '00000000-0000-0000-0000-0000000ea105';
  exception when others then visa_update_rejected := 1;
  end;
  begin
    delete from public.expense_visa where id = '00000000-0000-0000-0000-0000000ea105';
  exception when others then visa_delete_rejected := 1;
  end;

  -- One visa per step per attempt (the 11.0D unique index). A second visa on
  -- step 1 of the SAME attempt is rejected — this is what makes a concurrent
  -- double-sign impossible on a ledger where a duplicate could never be deleted.
  begin
    insert into public.expense_visa
      (tenant_id, document_type, authorization_id, version_id, attempt_id, step_code, step_ordinal,
       signer_user_id, signer_role_code, signer_display_name, decision, content_sha256)
    values ('00000000-0000-0000-0000-000000000001', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-0000000ea101', '00000000-0000-0000-0000-0000000ea102',
            '00000000-0000-0000-0000-0000000ea104', 'VISA_DEMANDEUR', 1,
            '00000000-0000-0000-0000-0000000000e2', 'REQUESTER', 'Autre', 'APPROVED', 'cafebabe');
  exception when others then duplicate_step_rejected := 1;
  end;

  -- …but a DIFFERENT attempt may re-collect the same step: that is the
  -- correction path (a new approval round after a rejection), not a duplicate.
  begin
    insert into public.expense_visa
      (tenant_id, document_type, authorization_id, version_id, attempt_id, step_code, step_ordinal,
       signer_user_id, signer_role_code, signer_display_name, decision, content_sha256)
    values ('00000000-0000-0000-0000-000000000001', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-0000000ea101', '00000000-0000-0000-0000-0000000ea102',
            '00000000-0000-0000-0000-0000000ea103', 'VISA_DEMANDEUR', 1,
            '00000000-0000-0000-0000-0000000000e1', 'REQUESTER', 'Agent Test', 'REJECTED', 'cafebabe');
    other_attempt_allowed := 1;
  exception when others then other_attempt_allowed := 0;
  end;

  -- Tenant trigger: a visa claiming tenant D1 on a tenant-A parent is rejected.
  begin
    insert into public.expense_visa
      (tenant_id, document_type, authorization_id, version_id, attempt_id, step_code, step_ordinal,
       signer_user_id, signer_role_code, signer_display_name, decision, content_sha256)
    values ('00000000-0000-0000-0000-0000000000d1', 'EXPENSE_AUTHORIZATION',
            '00000000-0000-0000-0000-0000000ea101', '00000000-0000-0000-0000-0000000ea102',
            '00000000-0000-0000-0000-0000000ea104', 'VISA_CHEF_TRANSIT', 2,
            '00000000-0000-0000-0000-0000000000e3', 'CHIEF_OF_TRANSIT', 'X', 'APPROVED', 'cafebabe');
  exception when others then cross_tenant_rejected := 1;
  end;

  insert into _r values
    ('z1_signer_sees', z1_sees),
    ('z2_no_permission_sees', z2_sees),
    ('z3_cross_tenant_sees', z3_sees),
    ('z4_portal_sees', z4_sees),
    ('visa_update_rejected', visa_update_rejected),
    ('visa_delete_rejected', visa_delete_rejected),
    ('duplicate_step_rejected', duplicate_step_rejected),
    ('other_attempt_allowed', other_attempt_allowed),
    ('cross_tenant_rejected', cross_tenant_rejected);

  if z1_sees<>1 or z2_sees<>0 or z3_sees<>0 or z4_sees<>0
     or visa_update_rejected<>1 or visa_delete_rejected<>1
     or duplicate_step_rejected<>1 or other_attempt_allowed<>1 or cross_tenant_rejected<>1
  then
    raise exception 'RLS EXPENSE APPROVAL FAIL: z1=% z2=% z3=% z4=% upd=% del=% dup=% otherAttempt=% tenant=%',
      z1_sees, z2_sees, z3_sees, z4_sees, visa_update_rejected, visa_delete_rejected,
      duplicate_step_rejected, other_attempt_allowed, cross_tenant_rejected;
  end if;
end $$;

select * from _r order by check_name;
rollback;
