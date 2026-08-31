-- 20260926000001_calendar_read_parity.sql
-- ===========================================================================
-- UAT-PERF-CALENDAR-01 — the calendar becomes exactly as readable as the
-- calculations it explains. Migration 134. Governing audit:
-- docs/performance/uat-perf-calendar-01-audit.md (29405a6), APPROVED.
--
-- THE FINDING. Two authorized users in the same tenant resolved different
-- calendar VIEWS: the read was gated on hr:read alone, while the page's own
-- header comment promised visibility to performance:read — « reading the
-- indicators without being able to see their time base would be opaque ». The
-- comment and the gate drifted because nothing pinned them together. The
-- CALCULATIONS never diverged: loadCalendar() is admin-client with a
-- server-resolved tenant and no viewer context — proven in the audit, and
-- untouched here.
--
-- THE RULE, ratified: calendar READ authority is `hr:read OR
-- performance:read`, same tenant. An authorized Performance reader may see the
-- basis behind figures they can already read. Calendar MANAGEMENT stays
-- `hr:manage` — HR owns the calendar; Performance consumes it. This migration
-- recreates ONE select policy and nothing else: no write policy appears, no
-- role gains a grant, no hr:* reaches anyone new, and SYSTEM_ADMIN gains
-- nothing (DEC-B25 undisturbed).
-- ===========================================================================

drop policy if exists hr_calendar_day_select on public.hr_calendar_day;
create policy hr_calendar_day_select on public.hr_calendar_day
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (public.has_permission('hr:read') or public.has_permission('performance:read'))
  );

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare
  v_all   int;
  v_write int;
  v_qual  text;
begin
  -- Still exactly ONE policy, still zero write policies: the hr:manage
  -- actions remain the only write boundary (HR-A2 idiom, M127 contract).
  select count(*) into v_all from pg_policies
   where schemaname = 'public' and tablename = 'hr_calendar_day';
  select count(*) into v_write from pg_policies
   where schemaname = 'public' and tablename = 'hr_calendar_day'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if v_all <> 1 or v_write <> 0 then
    raise exception 'M134: expected exactly 1 select policy and 0 write policies, found %/%', v_all, v_write;
  end if;

  -- The recreated policy carries BOTH read capabilities AND the tenant clause.
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'hr_calendar_day'
     and policyname = 'hr_calendar_day_select';
  if v_qual not like '%hr:read%' or v_qual not like '%performance:read%' then
    raise exception 'M134: the select policy does not carry both read lanes (got %)', v_qual;
  end if;
  if v_qual not like '%auth_tenant_id%' then
    raise exception 'M134: the tenant clause is missing — cross-tenant isolation would be broken (got %)', v_qual;
  end if;

  -- No permission row was created or granted by this migration: the two
  -- capabilities already exist and no role_permission changes here.
  if not exists (select 1 from public.permission where code = 'performance:read') then
    raise exception 'M134: performance:read does not exist — this migration widens a policy, it never invents a capability';
  end if;

  raise notice 'M134 OK: calendar read = same tenant + (hr:read OR performance:read); management untouched (hr:manage actions, no write policy); cross-tenant isolation intact';
end $$;
