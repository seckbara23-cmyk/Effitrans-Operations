-- Multi-tenant acceptance: BIDIRECTIONAL isolation (Phase 6.0F)
-- ---------------------------------------------------------------------------
-- Proves isolation in BOTH directions across the foundation + platform tables:
--   * Tenant A cannot read or mutate Tenant B's rows (and vice versa),
--   * each tenant CAN read its own foundation rows.
-- Complements the per-domain RLS tests (finance/customs/transport/document/…),
-- which already prove isolation for their own tables. Non-destructive
-- (BEGIN/ROLLBACK). Fails the job (ON_ERROR_STOP) on any leak or cross-tenant write.
--
-- Tenant A = seeded Effitrans (000…001, rich seed data). Tenant B is created here.
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_multitenant_acceptance_test.sql

begin;

-- --- Setup (as the migration/superuser role — RLS is bypassed here) ---------------
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Effitrans Acceptance Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'accept-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'accept-b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'accept-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'accept-b@test.local')
on conflict (id) do nothing;

-- User A is a SYSTEM_ADMIN of tenant A (so a read miss is isolation, not lack of grant).
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000a1', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- One audit row per tenant, to prove audit isolation too.
insert into public.audit_log (id, tenant_id, actor_id, action) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000a1', 'accept.event.a'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-0000000000b1', 'accept.event.b')
on conflict (id) do nothing;

-- --- Direction 1: Tenant A must not read/mutate Tenant B -------------------------
do $$
declare
  v int;
  affected int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);

  -- READ own → visible.
  select count(*) into v from public.organization where id = '00000000-0000-0000-0000-000000000001';
  if v <> 1 then raise exception 'A cannot read own organization (got %)', v; end if;

  -- READ tenant B → nothing.
  select count(*) into v from public.organization where id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B organization (% rows)', v; end if;
  select count(*) into v from public.app_user where tenant_id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 0 then raise exception 'LEAK: A read B app_user (% rows)', v; end if;
  select count(*) into v from public.audit_log where id = '00000000-0000-0000-0000-0000000000e2';
  if v <> 0 then raise exception 'LEAK: A read B audit_log (% rows)', v; end if;

  -- A DOES see its own audit (SYSTEM_ADMIN has audit:read:all) — proves the miss above
  -- is isolation, not a blanket denial.
  select count(*) into v from public.audit_log where id = '00000000-0000-0000-0000-0000000000e1';
  if v <> 1 then raise exception 'A cannot read own audit (got %)', v; end if;

  -- MUTATE tenant B → zero rows affected (RLS filters B's row out of A's view).
  update public.organization set name = 'HACKED-BY-A' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'CROSS-TENANT WRITE: A updated B organization (% rows)', affected; end if;

  update public.app_user set email = 'hacked@a' where id = '00000000-0000-0000-0000-0000000000b1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'CROSS-TENANT WRITE: A updated B app_user (% rows)', affected; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'Direction A→B: PASS (A isolated from B, own rows visible, no cross-tenant write)';
end $$;

-- --- Direction 2: Tenant B must not read/mutate Tenant A -------------------------
do $$
declare
  v int;
  affected int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000b1','role','authenticated')::text, true);

  -- READ own → visible.
  select count(*) into v from public.organization where id = '00000000-0000-0000-0000-0000000000b2';
  if v <> 1 then raise exception 'B cannot read own organization (got %)', v; end if;

  -- READ tenant A across the foundation tables → nothing (A has rich seed data).
  select count(*) into v from public.organization where id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A organization (% rows)', v; end if;
  select count(*) into v from public.app_user where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A app_user (% rows)', v; end if;
  select count(*) into v from public.role where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A role (% rows)', v; end if;
  select count(*) into v from public.user_role where tenant_id = '00000000-0000-0000-0000-000000000001';
  if v <> 0 then raise exception 'LEAK: B read A user_role (% rows)', v; end if;
  select count(*) into v from public.audit_log where id = '00000000-0000-0000-0000-0000000000e1';
  if v <> 0 then raise exception 'LEAK: B read A audit_log (% rows)', v; end if;

  -- MUTATE tenant A → zero rows affected.
  update public.organization set name = 'HACKED-BY-B' where id = '00000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'CROSS-TENANT WRITE: B updated A organization (% rows)', affected; end if;

  perform set_config('role', 'postgres', true);
  raise notice 'Direction B→A: PASS (B isolated from A, own org visible, no cross-tenant write)';
  raise notice 'MULTI-TENANT ACCEPTANCE: PASS (bidirectional isolation proven)';
end $$;

rollback;
