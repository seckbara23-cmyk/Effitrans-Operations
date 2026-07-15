-- Behavioral / RLS test — tenant lifecycle enforcement foundation (Phase 6.0D).
-- ---------------------------------------------------------------------------
-- The app-layer enforcement (getCurrentUser returns null for a blocked tenant) RESTS
-- on one RLS fact: a tenant user can still READ THEIR OWN organization row — including
-- its lifecycle_status — even after the tenant is suspended. If suspension made the org
-- unreadable, getCurrentUser's embedded read would return null, the block guard would be
-- skipped, and enforcement would silently FAIL OPEN.
--
-- This suite proves, against real Postgres:
--   1. suspending a tenant DELETES NOTHING (org, users and their data all remain);
--   2. the suspended tenant's user can still read their own org row and SEE the
--      SUSPENDED status — the input enforcement depends on;
--   3. the user still cannot read any OTHER tenant's org (isolation is unchanged).

begin;

insert into public.organization (id, name, country, lifecycle_status)
values ('00000000-0000-0000-0000-0000001face0', 'Lifecycle Test Co', 'SN', 'ACTIVE')
on conflict (id) do update set lifecycle_status = 'ACTIVE';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000001face1', 'lifecycle_user@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000001face1', '00000000-0000-0000-0000-0000001face0', 'lifecycle_user@test.local', 'active')
on conflict (id) do nothing;

do $$
declare
  users_before int;
  users_after  int;
  own_status   text;
  other_seen   int;
begin
  select count(*) into users_before
  from public.app_user where tenant_id = '00000000-0000-0000-0000-0000001face0';

  -- SUSPEND (what the platform action does: a single status write, nothing else).
  update public.organization
    set lifecycle_status = 'SUSPENDED'
    where id = '00000000-0000-0000-0000-0000001face0';

  -- (1) NO DATA DELETED — the users (and everything else) are untouched.
  select count(*) into users_after
  from public.app_user where tenant_id = '00000000-0000-0000-0000-0000001face0';
  if users_after <> users_before then
    raise exception 'LIFECYCLE FAIL: suspension changed the user count (% -> %)', users_before, users_after;
  end if;

  -- (2) THE SUSPENDED TENANT'S USER CAN STILL READ THEIR OWN ORG STATUS.
  -- This is the enforcement input. If RLS hid it, enforcement would fail open.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-0000-0000-0000001face1', 'role', 'authenticated')::text, true);

  select lifecycle_status into own_status
  from public.organization where id = '00000000-0000-0000-0000-0000001face0';

  -- (3) ...but still cannot see the default seed tenant's org (isolation intact).
  select count(*) into other_seen
  from public.organization where id = '00000000-0000-0000-0000-000000000001';

  perform set_config('role', 'postgres', true);

  if own_status is distinct from 'SUSPENDED' then
    raise exception 'LIFECYCLE FAIL: suspended tenant user cannot read own status (got %). Enforcement would fail OPEN.', own_status;
  end if;
  if other_seen <> 0 then
    raise exception 'ISOLATION FAIL: user read another tenant org (% rows)', other_seen;
  end if;

  raise notice 'tenant lifecycle foundation: no-deletion + own-status-readable + isolation PASS';
end $$;

rollback;
