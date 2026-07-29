-- RLS regression test — STAFF password lifecycle (migration 20260729000001).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- The migration adds three additive columns to app_user and changes NO policy.
-- app_user carries exactly one policy, app_user_select_self (SELECT), and the
-- `authenticated` role is granted SELECT ONLY on the table
-- (20260613000004_grant_table_privileges). That asymmetry is what the forced-
-- change gate depends on, and this test proves both halves of it:
--
--   * a staff user MUST be able to read their own flags — otherwise the login
--     gate could not tell them their password needs changing;
--   * a staff user MUST NOT be able to WRITE them — otherwise clearing
--     must_change_password would be one anon-key PATCH away, and an
--     administrator's forced change would be advisory rather than enforced.
--
-- The write half is refused by TWO independent mechanisms, and this test accepts
-- either as proof: the missing UPDATE grant rejects it at the privilege layer
-- (an exception), and were that grant ever added, the absence of an UPDATE
-- policy would still reduce it to zero rows. What is asserted is the PROPERTY —
-- the flag is unchanged — not the particular mechanism that enforced it.
--
-- Checks:
--   * S1 reads its OWN row and its own password-lifecycle flags            -> 1
--   * S1 sees ONLY its own app_user row (self-select, not tenant-wide)     -> 1
--   * S1 cannot read a same-tenant colleague's row                         -> 0
--   * S1 cannot read a tenant-B staff row                                  -> 0
--   * S1 clearing its own must_change_password changes NOTHING             -> 0 rows
--   * S1 extending its own temp_password_expires_at changes NOTHING        -> 0 rows
--   * the flag is still true, and the expiry still the original            -> true
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
   true, '2099-01-01T00:00:00Z'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 's2pw@test.local',
   false, null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b3', 'sbpw@test.local',
   true, '2099-01-01T00:00:00Z')
on conflict (id) do nothing;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  s1_self int; s1_total int; s1_sees_s2 int; s1_sees_sb int;
  cleared int := -1; expiry_moved int := -1;
  clear_refusal text := 'rls_zero_rows'; expiry_refusal text := 'rls_zero_rows';
  flag_after boolean; expiry_after timestamptz;
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

  -- WRITE (1): the flag is NOT self-clearable.
  begin
    with upd as (
      update public.app_user set must_change_password = false
      where id='00000000-0000-0000-0000-0000000000d1'
      returning 1
    ) select count(*) into cleared from upd;
  exception when others then
    -- Refused at the privilege layer: `authenticated` has SELECT only.
    clear_refusal := 'privilege_' || sqlstate;
    cleared := 0;
  end;

  -- WRITE (2): nor is the expiry self-extendable.
  begin
    with upd2 as (
      update public.app_user set temp_password_expires_at = '2100-01-01T00:00:00Z'
      where id='00000000-0000-0000-0000-0000000000d1'
      returning 1
    ) select count(*) into expiry_moved from upd2;
  exception when others then
    expiry_refusal := 'privilege_' || sqlstate;
    expiry_moved := 0;
  end;

  perform set_config('role', 'postgres', true);
  select must_change_password, temp_password_expires_at
    into flag_after, expiry_after
    from public.app_user where id='00000000-0000-0000-0000-0000000000d1';

  insert into _r values
    ('s1_reads_own_flags', s1_self::text), ('s1_total_visible', s1_total::text),
    ('s1_sees_colleague', s1_sees_s2::text), ('s1_sees_tenant_b', s1_sees_sb::text),
    ('s1_self_cleared_rows', cleared::text), ('s1_self_extended_rows', expiry_moved::text),
    ('clear_refused_by', clear_refusal), ('expiry_refused_by', expiry_refusal),
    ('flag_still_set', flag_after::text), ('expiry_unchanged', (expiry_after < '2100-01-01T00:00:00Z')::text);

  if s1_self<>1 or s1_total<>1 or s1_sees_s2<>0 or s1_sees_sb<>0
     or cleared<>0 or expiry_moved<>0
     or flag_after is not true
     or expiry_after >= '2100-01-01T00:00:00Z' then
    raise exception 'RLS STAFF PASSWORD FAIL: read(own=% total=% colleague=% tenantB=%) write(cleared=% [%] extended=% [%]) after(flag=% expiry=%)',
      s1_self, s1_total, s1_sees_s2, s1_sees_sb,
      cleared, clear_refusal, expiry_moved, expiry_refusal, flag_after, expiry_after;
  end if;
end $$;

select * from _r order by check_name;
rollback;
