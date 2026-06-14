-- RLS regression test — Notifications (Phase 1.6). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the notification feed is SELF-SCOPED:
--   * user A reads their own notification                         -> 1
--   * user A CANNOT read user B's notification (same tenant)      -> 0
--   * user A CANNOT read a tenant-B notification (isolation)      -> 0
--   * user B reads their own                                      -> 1
--
-- Self-scope hinges on app_user.id == auth.users.id (asserted by construction:
-- the recipient ids below are used as both the app_user id and the JWT `sub`).
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Two tenant-A users (A, B) and one tenant-B user (C).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'na@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'nb@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'nc@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'na@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'nb@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b2', 'nc@test.local')
on conflict (id) do nothing;

-- One notification for each recipient.
insert into public.notification (id, tenant_id, user_id, type, title) values
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'TASK_ASSIGNED', 'For A'),
  ('00000000-0000-0000-0000-00000000d0a2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'TASK_ASSIGNED', 'For B'),
  ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 'TASK_ASSIGNED', 'For C')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  a_own int; a_peer int; a_tenantb int; b_own int;
begin
  perform set_config('role', 'authenticated', true);

  -- User A (tenant A)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
  select count(*) into a_own     from public.notification where id='00000000-0000-0000-0000-00000000d0a1';
  select count(*) into a_peer    from public.notification where id='00000000-0000-0000-0000-00000000d0a2';
  select count(*) into a_tenantb from public.notification where id='00000000-0000-0000-0000-00000000d0c1';

  -- User B (tenant A)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000a2','role','authenticated')::text, true);
  select count(*) into b_own from public.notification where id='00000000-0000-0000-0000-00000000d0a2';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('a_sees_own',       a_own),
    ('a_sees_peer',      a_peer),
    ('a_sees_tenantB',   a_tenantb),
    ('b_sees_own',       b_own);

  if a_own <> 1 or a_peer <> 0 or a_tenantb <> 0 or b_own <> 1 then
    raise exception 'RLS NOTIFICATION FAIL: a_own=%, a_peer=%, a_tenantB=%, b_own=% (expected 1/0/0/1)',
      a_own, a_peer, a_tenantb, b_own;
  end if;
end $$;

select * from _r order by check_name;
rollback;
