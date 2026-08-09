-- ===========================================================================
-- HR-A1 — Foundation activation (HRQ-D2 = Option A, ratified 2026-08-09).
-- ---------------------------------------------------------------------------
-- Two acts, both additive and idempotent:
--
--   1. GRANT hr:config:manage to HR_OFFICER — the catalog row has existed
--      since migration 73, deliberately granted to NOBODY (the B1 pause).
--      Ratification ends the pause for THIS permission only. The other three
--      parked authorities (hr:sensitive:read, hr:leave:approve,
--      hr:performance:finalize) STAY parked — asserted below, not assumed.
--      SYSTEM_ADMIN receives nothing (DEC-B25) — also asserted.
--
--   2. RE-POINT the matricule format to the ratified continuous scheme
--      EMP-0001 → EMP-0002 → … (no year segment). The ENGINE is unchanged:
--      the same employee_counter table, the same concurrency-safe
--      ON CONFLICT … RETURNING upsert, the same definer-only privilege
--      surface. Only the bucket key and the rendered text change. The
--      continuous sequence lives in the year=0 bucket (the counter's primary
--      key is (tenant_id, year); 0 is not a calendar year, so the bucket can
--      never collide with a historical per-year row). The prefix comes from
--      hr_configuration.employee_number_prefix — the column the wizard has
--      always saved and nothing consumed until now — with 'EMP' as the
--      default when no configuration row exists or the prefix is blank.
--
-- Verified against production before writing (read-only, 2026-08-09):
--   * employee_counter has ZERO rows — no matricule was ever allocated, so
--     there is no mixed-format history to protect. Were any per-year numbers
--     to exist, they would remain valid and untouched: uniqueness is
--     (tenant_id, employee_number), and 'EMP-2026-0001' can never collide
--     with 'EMP-0001'. Existing numbers are additionally immutable by
--     trigger (migration 73).
--   * HR_OFFICER exists in the one production tenant with exactly the
--     migration-57 grant list; the four parked permissions have no grants.
--
-- On an EMPTY database (CI at migration time) the grant is a guarded no-op:
-- no role rows exist yet — supabase/seed.sql carries the same grant for the
-- seeded tenant (parity is test-enforced). Every assertion below is written
-- to hold on both an empty and a populated database.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The HRQ-D2 Option A grant. Per-tenant roles: grant to every tenant's
--    HR_OFFICER (today: exactly one tenant). Explicit p.code — module-based
--    expansion would over-grant (the seed.sql rule).
-- ---------------------------------------------------------------------------
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'hr:config:manage'
where r.code = 'HR_OFFICER'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The ratified matricule scheme. Same signature, same counter, same
--    locking pattern; the (uuid, uuid) trusted-actor overload (OPS-SEC-2A)
--    delegates here unchanged, so authority checks are untouched.
--    NOTE: body comments are deliberately absent — INV-3 scans definer
--    function sources.
-- ---------------------------------------------------------------------------
create or replace function public.next_employee_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_seq    int;
begin
  select coalesce(nullif(btrim(employee_number_prefix, ' -'), ''), 'EMP')
    into v_prefix
    from public.hr_configuration
   where tenant_id = p_tenant;
  if v_prefix is null then
    v_prefix := 'EMP';
  end if;

  insert into public.employee_counter (tenant_id, year, next_seq)
  values (p_tenant, 0, 1)
  on conflict (tenant_id, year)
    do update set next_seq = employee_counter.next_seq + 1
  returning next_seq into v_seq;

  return v_prefix || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- CREATE OR REPLACE preserves ACLs, but privileges are re-stated rather than
-- trusted (the OPS-SEC-1 lesson: hosted Supabase adds explicit anon /
-- authenticated grants on top of PostgreSQL's implicit PUBLIC one).
revoke execute on function public.next_employee_number(uuid) from public;
revoke execute on function public.next_employee_number(uuid) from anon;
revoke execute on function public.next_employee_number(uuid) from authenticated;
grant execute on function public.next_employee_number(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Assertions — the migration proves its own outcome, vacuous-safe on an
--    empty database.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_count int;
  v_src   text;
  v_oid   oid;
begin
  -- 3a. No tenant's HR_OFFICER is missing the grant (0 roles → vacuously true).
  select count(*) into v_count
  from public.role r
  where r.code = 'HR_OFFICER'
    and not exists (
      select 1 from public.role_permission rp
      join public.permission p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'hr:config:manage');
  if v_count <> 0 then
    raise exception 'HR-A1: % HR_OFFICER role(s) missing hr:config:manage', v_count;
  end if;

  -- 3b. The three parked authorities remain granted to NOBODY.
  select count(*) into v_count
  from public.role_permission rp
  join public.permission p on p.id = rp.permission_id
  where p.code in ('hr:sensitive:read', 'hr:leave:approve', 'hr:performance:finalize');
  if v_count <> 0 then
    raise exception 'HR-A1: a parked hr permission acquired a grant (% rows)', v_count;
  end if;

  -- 3c. SYSTEM_ADMIN still holds NO hr:* (DEC-B25). Platform administration
  --     is not HR authority.
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'SYSTEM_ADMIN' and p.code like 'hr:%';
  if v_count <> 0 then
    raise exception 'HR-A1: SYSTEM_ADMIN acquired hr:* (% rows)', v_count;
  end if;

  -- 3d. The function was actually replaced: no year segment remains, the
  --     configuration prefix is consulted, and the counter is still the one
  --     engine (no second mechanism).
  select p.prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'next_employee_number' and p.pronargs = 1;
  if v_src is null then
    raise exception 'HR-A1: next_employee_number(uuid) missing';
  end if;
  if v_src like '%extract(year%' then
    raise exception 'HR-A1: next_employee_number still embeds the calendar year';
  end if;
  if v_src not like '%employee_number_prefix%' then
    raise exception 'HR-A1: next_employee_number does not consult the configured prefix';
  end if;
  if v_src not like '%public.employee_counter%' then
    raise exception 'HR-A1: next_employee_number abandoned the employee_counter engine';
  end if;

  -- 3e. Privilege surface unchanged: definer-only, browser roles cannot call.
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'next_employee_number' and p.pronargs = 1;
  if has_function_privilege('anon', v_oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_oid, 'EXECUTE') then
    raise exception 'HR-A1: browser role can call next_employee_number';
  end if;
  if not has_function_privilege('service_role', v_oid, 'EXECUTE') then
    raise exception 'HR-A1: service_role lost next_employee_number';
  end if;

  -- 3f. The trusted-actor overload still exists and still delegates (its
  --     source is unchanged by this migration; presence is what could break).
  if to_regprocedure('public.next_employee_number(uuid,uuid)') is null then
    raise exception 'HR-A1: trusted-actor overload next_employee_number(uuid,uuid) missing';
  end if;

  -- 3g. The counter table is untouched.
  if to_regclass('public.employee_counter') is null then
    raise exception 'HR-A1: employee_counter table missing';
  end if;
end
$assert$;
