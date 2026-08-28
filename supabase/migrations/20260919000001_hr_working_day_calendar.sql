-- 20260919000001_hr_working_day_calendar.sql
-- ===========================================================================
-- D3 (RATIFIED 2026-08-28) — the HR-maintained working-day calendar.
--
-- Performance and capacity calculations use days ACTUALLY WORKED: Senegal
-- public holidays, Effitrans exceptional closures and employee leave are
-- excluded, and HR owns the calendar. Leave already lives in hr_leave_request;
-- what was missing — and blocked Phase-0 Q3 — is the calendar itself. The
-- workbooks shipped with FERIES empty, which made every jours-ouvrés
-- indicator silently longer; the decision packet ruled them « non calculable »
-- until a validated calendar existed. This table is that calendar.
--
-- ONE table, TWO kinds. The frozen délai contract (ICTD-D11) consumed a single
-- FERIES list; the ruling names both public holidays and company closures as
-- non-worked. They are one calendar with a kind attribute, not two tables —
-- consumers that must distinguish (none today) can filter.
--
-- AUTHORITY. Writes go through the hr:manage actions only — the HR-A2 idiom:
-- no RLS write policy exists, so the actions ARE the boundary, and operational
-- roles gain nothing here. Reads follow the HR read idiom (hr:read).
-- SYSTEM_ADMIN holds no hr:* (DEC-B25) and that stays true: this migration
-- grants nothing to anyone.
-- ===========================================================================

create table if not exists public.hr_calendar_day (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  day         date not null,
  kind        text not null
                check (kind in ('PUBLIC_HOLIDAY','COMPANY_CLOSURE')),
  label       text not null check (length(btrim(label)) > 0),
  created_by  uuid references public.app_user (id),
  created_at  timestamptz not null default now(),
  -- One ruling per day: a day is non-worked or it is not. A day cannot be
  -- both a férié and a fermeture, and no duplicate rows can accumulate.
  unique (tenant_id, day)
);

create index if not exists idx_hr_calendar_day_tenant_day
  on public.hr_calendar_day (tenant_id, day);

alter table public.hr_calendar_day enable row level security;

drop policy if exists hr_calendar_day_select on public.hr_calendar_day;
create policy hr_calendar_day_select on public.hr_calendar_day
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_calendar_day to authenticated;

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare
  v_policies int;
  v_writes   int;
begin
  select count(*) into v_policies
    from pg_policies
   where schemaname = 'public' and tablename = 'hr_calendar_day';
  if v_policies <> 1 then
    raise exception 'M127: expected exactly 1 policy (select) on hr_calendar_day, found %', v_policies;
  end if;

  select count(*) into v_writes
    from pg_policies
   where schemaname = 'public' and tablename = 'hr_calendar_day'
     and cmd in ('INSERT','UPDATE','DELETE');
  if v_writes <> 0 then
    raise exception 'M127: hr_calendar_day must have NO write policy — the hr:manage actions are the boundary, found %', v_writes;
  end if;

  raise notice 'M127 OK: hr_calendar_day created; reads on hr:read; writes only through hr:manage actions; no authority granted to anyone';
end $$;
