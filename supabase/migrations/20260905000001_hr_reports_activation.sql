-- 20260905000001_hr_reports_activation.sql
-- Effitrans HR Platform — HR-9A: the reporting authority, catalogued and granted.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 114. Governing specification:
-- docs/hr/hr-9-reporting-audit.md (CONDITIONAL GO) + the ratifications of
-- RQ-9.1…RQ-9.4 recorded there.
--
-- THIS MIGRATION ADDS ONE PERMISSION AND TWO GRANTS. No table, no view, no
-- column, no function. HR-9 reports are computed in pure functions over the
-- HR read models that already exist — a reporting table would be a second
-- source of truth for numbers that are already true.
--
-- RQ-9.1 (ratified): `hr:reports:read` is granted to the HR desk and to the
-- executive seat, and to nobody else. It is NOT inherited from the broad
-- `analytics:read` population (CEO, DAF, commercial and recouvrement roles all
-- hold that one) — HR aggregates travel through their own authority.
--
--   HR_OFFICER  already reads every employee row under `hr:read`; an aggregate
--               over rows they may read discloses nothing new.
--   CEO         holds NO `hr:*` at all today — this is its first and only one.
--               That is precisely the ratified EXECUTIVE_SUMMARY scope: « no
--               row access at all », aggregates subject to the privacy floor.
--
-- DELIBERATELY NOT GRANTED: DGA and DAF (they hold `hr:leave:approve` and
-- `hr:performance:finalize`, but the ratified role matrix records reports as
-- ❌ for DAF), and SYSTEM_ADMIN, which holds no `hr:*` by standing decision
-- (DEC-B61). Widening is one ratified line; drift is refused by assertion 3.
--
-- RQ-9.2 (ratified) lives in the application layer by construction: the floor
-- suppresses SMALL-GROUP BREAKDOWNS for a reader with no row access, and never
-- suppresses ordinary totals for the HR desk. There is nothing to enforce in
-- the database — HR-9 stores nothing and computes nothing here.
--
-- RQ-9.3: no turnover rate exists anywhere. RQ-9.4: no historical snapshot
-- object exists anywhere. Both are asserted below, so a future migration
-- cannot introduce one silently.

-- ===========================================================================
-- 1. THE PERMISSION — inside the ratified nine-code ceiling (HR-0 §10).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:reports:read', 'hr', 'reports_read', 'all',
   'Consulter les rapports RH agrégés (effectifs, mouvements, congés) — agrégats uniquement, jamais les dossiers individuels')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. THE TWO RATIFIED GRANTS (RQ-9.1).
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'hr:reports:read'
where r.code in ('HR_OFFICER', 'CEO')
on conflict do nothing;

-- ===========================================================================
-- 3. SELF-ASSERTIONS — the migration refuses to report success if the
--    decisions it implements are not the decisions the database now holds.
-- ===========================================================================

-- 3a. The permission exists exactly once.
do $$
begin
  if (select count(*) from public.permission where code = 'hr:reports:read') <> 1 then
    raise exception 'HR-9A assertion 3a failed: hr:reports:read is not catalogued exactly once';
  end if;
end $$;

-- 3b. It reached the two ratified seats — in every tenant that has them.
do $$
declare v_missing int;
begin
  select count(*) into v_missing
    from public.role r
   where r.code in ('HR_OFFICER', 'CEO')
     and not exists (
       select 1 from public.role_permission rp
       join public.permission p on p.id = rp.permission_id and p.code = 'hr:reports:read'
        where rp.role_id = r.id);
  if v_missing > 0 then
    raise exception 'HR-9A assertion 3b failed: % ratified seat(s) did not receive hr:reports:read', v_missing;
  end if;
end $$;

-- 3c. And NOBODY else holds it — widening is a decision, never drift.
do $$
declare v_extra text;
begin
  select string_agg(distinct r.code, ', ') into v_extra
    from public.role_permission rp
    join public.permission p on p.id = rp.permission_id and p.code = 'hr:reports:read'
    join public.role r on r.id = rp.role_id
   where r.code not in ('HR_OFFICER', 'CEO');
  if v_extra is not null then
    raise exception 'HR-9A assertion 3c failed: hr:reports:read is held by unratified role(s): %', v_extra;
  end if;
end $$;

-- 3d. RQ-9.3 / RQ-9.4 — no turnover rate and no reporting/snapshot object was
--     introduced. HR-9 reads; it does not accumulate.
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','m','v')
     and (c.relname like 'hr_report%' or c.relname like 'hr_kpi%'
          or c.relname like 'hr_%snapshot%' or c.relname like 'hr_turnover%');
  if v_bad is not null then
    raise exception 'HR-9A assertion 3d failed: a reporting/snapshot object exists (%) — HR-9 aggregates, it does not store', v_bad;
  end if;
end $$;
