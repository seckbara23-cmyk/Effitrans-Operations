-- RLS tenant-isolation validation (RLS-1)
-- ---------------------------------------------------------------------------
-- Proves a user in tenant A cannot read tenant B's foundation rows, and CAN
-- read its own. Non-destructive: runs inside BEGIN/ROLLBACK.
--
-- Run against a linked/local Supabase DB (requires the foundation + RBAC
-- migrations applied). Example:
--   psql "$DATABASE_URL" -f supabase/tests/rls_tenant_isolation_test.sql
-- or via `supabase db execute` once the project is linked.
--
-- It simulates an authenticated user using Supabase's RLS test pattern:
-- set the `authenticated` role + a JWT claims setting so auth.uid() resolves.
-- ---------------------------------------------------------------------------

begin;

-- Tenant A = seeded Effitrans (000...001). Create tenant B + two users.
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Minimal auth.users rows (id + email). If your local auth schema requires more
-- columns, create the users via the service role instead and reuse their ids.
insert into auth.users (id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', 'user-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'user-b@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'user-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', 'user-b@test.local')
on conflict (id) do nothing;

-- Simulate USER A (tenant A).
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text,
  true
);

do $$
declare
  leak int;
  own  int;
begin
  -- MUST NOT see tenant B's organization
  select count(*) into leak from public.organization
   where id = '00000000-0000-0000-0000-0000000000b2';
  if leak <> 0 then
    raise exception 'RLS LEAK: user A read tenant B organization (% rows)', leak;
  end if;

  -- MUST NOT see tenant B's user profile
  select count(*) into leak from public.app_user
   where id = '00000000-0000-0000-0000-0000000000b1';
  if leak <> 0 then
    raise exception 'RLS LEAK: user A read tenant B app_user (% rows)', leak;
  end if;

  -- MUST see its own organization
  select count(*) into own from public.organization
   where id = '00000000-0000-0000-0000-000000000001';
  if own <> 1 then
    raise exception 'RLS REGRESSION: user A cannot read own organization (% rows)', own;
  end if;

  -- MUST see its own profile
  select count(*) into own from public.app_user
   where id = '00000000-0000-0000-0000-0000000000a1';
  if own <> 1 then
    raise exception 'RLS REGRESSION: user A cannot read own profile (% rows)', own;
  end if;

  raise notice 'RLS tenant isolation: PASS (user A isolated from tenant B; own rows visible)';
end $$;

reset role;
rollback;
