-- RLS role-scope validation (RLS-2) — non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves audit_log read access is scoped by the 'audit:read:all' permission:
--   * a user WITH it (SYSTEM_ADMIN) sees their tenant's audit rows
--   * a user WITHOUT it (CUSTOMS_DECLARANT) sees none
-- Tenant isolation (RLS-1) is unaffected by the refactor.
--
-- Requires both foundation migrations + seed (roles/permissions) applied.
-- Run: psql "$DATABASE_URL" -f supabase/tests/rls_role_scope_test.sql
-- (or paste into the Supabase SQL Editor — the final SELECT is the result).

begin;

-- Test users in tenant A (Effitrans = 000…001).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'plain@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'plain@test.local')
on conflict (id) do nothing;

-- Assign roles: admin -> SYSTEM_ADMIN (has audit:read:all); plain -> CUSTOMS_DECLARANT (none).
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000d1', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000c1', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CUSTOMS_DECLARANT'
on conflict do nothing;

-- One audit row in tenant A.
insert into public.audit_log (id, tenant_id, actor_id, action)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000d1', 'test.event')
on conflict (id) do nothing;

-- Collect results as each simulated user (role switch via set_config('role',...)).
create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  v_admin int;
  v_plain int;
begin
  -- USER WITH audit:read:all
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  select count(*) into v_admin from public.audit_log
   where id = '00000000-0000-0000-0000-0000000000e1';

  -- USER WITHOUT audit:read:all
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into v_plain from public.audit_log
   where id = '00000000-0000-0000-0000-0000000000e1';

  perform set_config('role', 'postgres', true);
  insert into _r values ('admin_sees_audit', v_admin), ('plain_sees_audit', v_plain);
end $$;

-- Expected: admin_sees_audit = 1, plain_sees_audit = 0
select * from _r order by check_name;

rollback;
