-- RLS regression test — STAFF password lifecycle (migration 20260729000001).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- The migration adds three additive columns to app_user and changes NO policy.
-- app_user carries exactly one policy, app_user_select_self (SELECT). That is a
-- deliberate asymmetry this test exists to prove, because the forced-change gate
-- depends on both halves of it:
--
--   * a staff user MUST be able to read their own flags — otherwise the login
--     gate could not tell them their password needs changing;
--   * a staff user MUST NOT be able to WRITE them — otherwise clearing
--     must_change_password would be a single anon-key PATCH away, and an
--     administrator's forced change would be advisory rather than enforced.
--
-- Checks:
--   * S1 reads its OWN row and its own password-lifecycle flags            -> 1
--   * S1 sees ONLY its own app_user row (self-select, not tenant-wide)     -> 1
--   * S1 cannot read a same-tenant colleague's row                         -> 0
--   * S1 cannot read a tenant-B staff row                                  -> 0
--   * S1's UPDATE clearing its own must_change_password affects NO row     -> 0
--   * ...and the flag is still true afterwards                             -> true
--   * S1 cannot set its own temp_password_expires_at into the future       -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b3', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- S1: tenant-A staff carrying a forced change. S2: tenant-A colleague.
-- SB: tenant-B staff.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 's1pw@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 's2pw@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'sbpw@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, must_change_password, temp_password_expires_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 's1pw@test.local',
   true, now() + interval '24 hours'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 's2pw@test.local',
   false, null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b3', 'sbpw@test.local',
   true, now() + interval '24 hours')
on conflict (id) do nothing;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  s1_self int; s1_total int; s1_sees_s2 int; s1_sees_sb int;
  cleared int; expiry_moved int;
  flag_after boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);

  -- READ: own row and own flags are visible; nobody else's is.
  select count(*) into s1_self from public.app_user
    where id='00000000-0000-0000-0000-0000000000d1'
      and must_change_password = true
      and temp_password_expires_at is not null;
  select count(*) into s1_total    from public.app_user;
  select count(*) into s1_sees_s2  from public.app_user where id='00000000-0000-0000-0000-0000000000d2';
  select count(*) into s1_sees_sb  from public.app_user where id='00000000-0000-0000-0000-0000000000d3';

  -- WRITE: the flag is NOT self-clearable. There is no UPDATE policy on
  -- app_user, so this affects zero rows rather than silently succeeding.
  with upd as (
    update public.app_user set must_change_password = false
    where id='00000000-0000-0000-0000-0000000000d1'
    returning 1
  ) select count(*) into cleared from upd;

  -- Nor is the expiry self-extendable.
  with upd2 as (
    update public.app_user set temp_password_expires_at = now() + interval '365 days'
    where id='00000000-0000-0000-0000-0000000000d1'
    returning 1
  ) select count(*) into expiry_moved from upd2;

  perform set_config('role', 'postgres', true);
  select must_change_password into flag_after from public.app_user
    where id='00000000-0000-0000-0000-0000000000d1';

  insert into _r values
    ('s1_reads_own_flags', s1_self::text), ('s1_total_visible', s1_total::text),
    ('s1_sees_colleague', s1_sees_s2::text), ('s1_sees_tenant_b', s1_sees_sb::text),
    ('s1_self_cleared_rows', cleared::text), ('s1_self_extended_rows', expiry_moved::text),
    ('flag_still_set', flag_after::text);

  if s1_self<>1 or s1_total<>1 or s1_sees_s2<>0 or s1_sees_sb<>0
     or cleared<>0 or expiry_moved<>0 or flag_after is not true then
    raise exception 'RLS STAFF PASSWORD FAIL: read(own=% total=% colleague=% tenantB=%) write(cleared=% extended=%) flagAfter=%',
      s1_self, s1_total, s1_sees_s2, s1_sees_sb, cleared, expiry_moved, flag_after;
  end if;
end $$;

select * from _r order by check_name;
rollback;
