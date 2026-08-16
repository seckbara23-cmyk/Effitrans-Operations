-- 20260901000001_hr_payroll_preparation.sql
-- Effitrans HR Platform — HR-7A/7C: FACTS-ONLY payroll preparation foundation.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. Migration 110. Governing specification:
-- docs/hr/hr-7-payroll-preparation-audit.md (CONDITIONAL GO — Tier 1 only).
--
-- THE PERMANENT BOUNDARY (DEC-B63, restated by the audit): HR-7 is payroll
-- PREPARATION and eventual controlled export — an interface, never a payroll
-- engine. NOTHING below stores or computes money: no salary, no gross, no
-- net, no rate, no tax, no CSS/IPRES/IPM arithmetic, no accounting entry, no
-- payment, no payslip. Self-assertion 6h scans the new tables' columns and
-- REFUSES TO APPLY if a monetary-looking column ever appears here — Q1 gates
-- HR-7E, and this migration makes answering it by drift impossible.
--
-- FOUR RULES, EACH FROM THE AUDIT:
--
-- 1. THE SNAPSHOT COPIES, IT NEVER JOINS (the FIN-AGING idiom). A period line
--    carries the employee's facts AS THEY WERE at collection: matricule,
--    names, labels, contract kind, status, movements, attendance quantities,
--    approved-leave tenths per category. hr_attendance_day is upsertable and
--    labels are renamable — the copy is what makes a LOCKED period
--    reproducible. employee_id remains as PROVENANCE, never as the data path.
--
-- 2. FACTS, NOT POLICY. No pro-rating, no rounding, no working-day calendar,
--    no overtime derivation (no schedule model exists — Q9). A leave request
--    crossing the period boundary is stored at face value AND flagged as an
--    exception; the platform surfaces the anomaly instead of silently
--    normalizing it. Inclusion is factual: DRAFT and ARCHIVED employees are
--    out (counted), TERMINATED employees stay in when their departure touches
--    the period, hires/departures in-period are flagged as movements.
--
-- 3. GOVERNED LIFECYCLE WITH A DATABASE-ENFORCED FREEZE.
--      DRAFT → PREPARED → VERIFIED → APPROVED → LOCKED, CANCELLED (reason)
--      from any pre-LOCKED state; VERIFIED → PREPARED is the governed reopen.
--    Lines freeze the moment the period is VERIFIED (verification examines a
--    fixed set; re-collection requires the governed reopen). APPROVED freezes
--    the period's content columns; LOCKED and CANCELLED are terminal.
--    Corrections after LOCKED are a NEW VERSION superseding the old — the
--    aging/objective idiom — never an edit.
--
-- 4. AUTHORITY IS PARKED WHERE THE AUDIT PARKED IT. Two new permissions are
--    catalogued and granted to NOBODY: hr:payroll:read (the future read-only
--    seat — Q7/Q8) and hr:payroll:approve (the approval/lock seat — Q7).
--    Until ratification a period can reach VERIFIED under hr:manage and no
--    further — the honest parked state, exactly as hr:leave:approve lived
--    before HR-B1. hr:sensitive:read is NOT touched and NOT a shortcut.
--    Preparation, verification and adjustment four-eyes run on the existing
--    hr:manage; the maker-checker CHECKs make the second actor structural.

-- ===========================================================================
-- 1. PERMISSIONS — catalogue only, granted to NOBODY (rule 4).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:payroll:read', 'hr', 'payroll_read', 'all',
   'Lire le contenu des préparations de paie (faits par employé) — siège de lecture distinct, jamais hr:sensitive:read'),
  ('hr:payroll:approve', 'hr', 'payroll_approve', 'all',
   'Approuver et verrouiller une préparation de paie (autorité distincte de hr:manage ; le dossier devient immuable)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. PERIOD — the governed container. `code` is the tenant's own period name
--    (e.g. « 2026-09 »); no calendar automation exists (Q5): dates are stated
--    explicitly every time.
-- ===========================================================================
create table if not exists public.hr_payroll_period (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  code                 text not null,
  label_fr             text not null,
  period_start         date not null,
  period_end           date not null,
  status               text not null default 'DRAFT'
                         check (status in ('DRAFT','PREPARED','VERIFIED','APPROVED','LOCKED','CANCELLED')),
  -- The collection moment: every line was true at this instant.
  cutoff_at            timestamptz,
  line_count           int not null default 0,
  draft_excluded_count int not null default 0,
  prepared_by          uuid references public.app_user (id),
  prepared_at          timestamptz,
  verified_by          uuid references public.app_user (id),
  verified_at          timestamptz,
  approved_by          uuid references public.app_user (id),
  approved_at          timestamptz,
  locked_by            uuid references public.app_user (id),
  locked_at            timestamptz,
  cancelled_at         timestamptz,
  cancellation_reason  text,
  version              int not null default 1 check (version >= 1),
  supersedes_period_id uuid references public.hr_payroll_period (id),
  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, code, version),
  constraint payroll_period_ordered check (period_end >= period_start),
  constraint payroll_period_supersedes_not_self
    check (supersedes_period_id is null or supersedes_period_id <> id),
  constraint payroll_period_prepared_has_actor
    check (status not in ('PREPARED','VERIFIED','APPROVED','LOCKED') or prepared_by is not null),
  constraint payroll_period_verified_has_actor
    check (status not in ('VERIFIED','APPROVED','LOCKED') or verified_by is not null),
  constraint payroll_period_approved_has_actor
    check (status not in ('APPROVED','LOCKED') or (approved_by is not null and approved_at is not null)),
  -- FOUR EYES: the approver is never the preparer.
  constraint payroll_period_approver_differs
    check (approved_by is null or prepared_by is null or approved_by <> prepared_by),
  constraint payroll_period_cancelled_has_reason
    check (status <> 'CANCELLED' or coalesce(btrim(cancellation_reason), '') <> '')
);
create index if not exists idx_payroll_period_tenant
  on public.hr_payroll_period (tenant_id, status, period_start desc);
drop trigger if exists trg_hr_payroll_period_updated_at on public.hr_payroll_period;
create trigger trg_hr_payroll_period_updated_at before update on public.hr_payroll_period
  for each row execute function public.set_updated_at();

-- Rule 3 — the lifecycle guard and the APPROVED/LOCKED freeze.
create or replace function public.hr_payroll_period_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('LOCKED','CANCELLED') then
    raise exception 'une préparation % est immuable', old.status using errcode = 'HR701';
  end if;
  if old.status = 'APPROVED' then
    if not (new.status in ('LOCKED','CANCELLED')
       and new.code is not distinct from old.code
       and new.label_fr is not distinct from old.label_fr
       and new.period_start is not distinct from old.period_start
       and new.period_end is not distinct from old.period_end
       and new.cutoff_at is not distinct from old.cutoff_at
       and new.line_count is not distinct from old.line_count
       and new.draft_excluded_count is not distinct from old.draft_excluded_count
       and new.prepared_by is not distinct from old.prepared_by
       and new.verified_by is not distinct from old.verified_by
       and new.approved_by is not distinct from old.approved_by
       and new.approved_at is not distinct from old.approved_at
       and new.version is not distinct from old.version
       and new.supersedes_period_id is not distinct from old.supersedes_period_id) then
      raise exception 'une préparation approuvée est figée (seul le verrouillage ou l''annulation motivée reste possible)'
        using errcode = 'HR701';
    end if;
    return new;
  end if;
  if old.status = new.status then
    return new;
  end if;
  if new.status = 'CANCELLED' then
    return new;
  end if;
  if not (
       (old.status = 'DRAFT'    and new.status = 'PREPARED')
    or (old.status = 'PREPARED' and new.status = 'VERIFIED')
    or (old.status = 'VERIFIED' and new.status = 'PREPARED')
    or (old.status = 'VERIFIED' and new.status = 'APPROVED')
  ) then
    raise exception 'transition de préparation interdite : % -> %', old.status, new.status
      using errcode = 'HR701';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_payroll_period_guard on public.hr_payroll_period;
create trigger trg_hr_payroll_period_guard before update on public.hr_payroll_period
  for each row execute function public.hr_payroll_period_guard();

-- ===========================================================================
-- 3. PERIOD LINE — the COPIED facts (rule 1). One row per included employee.
--    No monetary column exists or may ever appear here (assertion 6h).
-- ===========================================================================
create table if not exists public.hr_payroll_period_line (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  period_id             uuid not null references public.hr_payroll_period (id),
  -- PROVENANCE only: which registry row produced this copy.
  employee_id           uuid not null references public.employee (id),
  employee_number       text not null,
  first_name            text not null,
  last_name             text not null,
  department            text not null,
  org_unit_label        text,
  position_label        text,
  work_location_label   text,
  contract_kind         text,
  employment_status     text not null,
  hire_date             date,
  termination_date      date,
  joined_in_period      boolean not null default false,
  left_in_period        boolean not null default false,
  has_open_assignment   boolean not null default false,
  has_linked_account    boolean not null default false,
  attendance_days       int not null default 0,
  worked_minutes        int not null default 0,
  -- [{code,label_fr,tenths,is_paid}] — is_paid AS RECORDED (may be null: Q4).
  leave_breakdown       jsonb not null default '[]'::jsonb,
  leave_tenths_total    int not null default 0,
  -- Exception CODES; the UI renders the French. Never silently normalized.
  exceptions            jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  unique (period_id, employee_id)
);
create index if not exists idx_payroll_line_period
  on public.hr_payroll_period_line (tenant_id, period_id);

-- Rule 3 — lines freeze the moment the period is VERIFIED.
create or replace function public.hr_payroll_line_freeze()
returns trigger
language plpgsql
as $$
declare v_status text; v_period uuid;
begin
  v_period := coalesce(new.period_id, old.period_id);
  select status into v_status from public.hr_payroll_period where id = v_period;
  if v_status is null or v_status not in ('DRAFT','PREPARED') then
    raise exception 'les lignes d''une préparation % sont figées', coalesce(v_status, 'introuvable')
      using errcode = 'HR705';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists trg_hr_payroll_line_freeze on public.hr_payroll_period_line;
create trigger trg_hr_payroll_line_freeze
  before insert or update or delete on public.hr_payroll_period_line
  for each row execute function public.hr_payroll_line_freeze();

-- ===========================================================================
-- 4. ADJUSTMENTS (HR-7C) — QUANTIFIED, NON-MONETARY. The vocabulary belongs
--    to the tenant and SHIPS EMPTY: no category, no unit semantics, no rate is
--    invented here. Four-eyes on every adjustment; amendment = supersession.
-- ===========================================================================
create table if not exists public.hr_payroll_adjustment_kind (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  code        text not null,
  label_fr    text not null,
  unit        text not null check (unit in ('HOURS','DAYS','OCCURRENCES','UNITS')),
  requires_reason boolean not null default true,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, code)
);
drop trigger if exists trg_hr_payroll_adjustment_kind_updated_at on public.hr_payroll_adjustment_kind;
create trigger trg_hr_payroll_adjustment_kind_updated_at before update on public.hr_payroll_adjustment_kind
  for each row execute function public.set_updated_at();

create table if not exists public.hr_payroll_adjustment (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id),
  period_id                 uuid not null references public.hr_payroll_period (id),
  employee_id               uuid not null references public.employee (id),
  kind_id                   uuid not null references public.hr_payroll_adjustment_kind (id),
  -- Signed quantity in the kind's unit. NEVER an amount of money.
  quantity                  int not null check (quantity <> 0),
  reason                    text,
  evidence_document_id      uuid references public.hr_document (id),
  status                    text not null default 'PROPOSED'
                              check (status in ('PROPOSED','APPROVED','REJECTED','SUPERSEDED')),
  proposed_by               uuid not null references public.app_user (id),
  proposed_at               timestamptz not null default now(),
  decided_by                uuid references public.app_user (id),
  decided_at                timestamptz,
  decision_note             text,
  version                   int not null default 1 check (version >= 1),
  supersedes_adjustment_id  uuid references public.hr_payroll_adjustment (id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint payroll_adjustment_supersedes_not_self
    check (supersedes_adjustment_id is null or supersedes_adjustment_id <> id),
  -- FOUR EYES: the decider is never the proposer.
  constraint payroll_adjustment_decider_differs
    check (decided_by is null or decided_by <> proposed_by),
  constraint payroll_adjustment_decided_has_actor
    check (status not in ('APPROVED','REJECTED') or (decided_by is not null and decided_at is not null))
);
create index if not exists idx_payroll_adjustment_period
  on public.hr_payroll_adjustment (tenant_id, period_id, employee_id);
drop trigger if exists trg_hr_payroll_adjustment_updated_at on public.hr_payroll_adjustment;
create trigger trg_hr_payroll_adjustment_updated_at before update on public.hr_payroll_adjustment
  for each row execute function public.set_updated_at();

-- Adjustment history is governed: a decided row never rewrites, an APPROVED
-- row's only exit is SUPERSEDED (via a superseding proposal), and a PROPOSED
-- row changes only by decision — content corrections are NEW versions.
create or replace function public.hr_payroll_adjustment_guard()
returns trigger
language plpgsql
as $$
declare v_content_same boolean;
begin
  v_content_same :=
        new.quantity is not distinct from old.quantity
    and new.reason is not distinct from old.reason
    and new.evidence_document_id is not distinct from old.evidence_document_id
    and new.kind_id is not distinct from old.kind_id
    and new.employee_id is not distinct from old.employee_id
    and new.period_id is not distinct from old.period_id
    and new.proposed_by is not distinct from old.proposed_by
    and new.version is not distinct from old.version
    and new.supersedes_adjustment_id is not distinct from old.supersedes_adjustment_id;
  if old.status in ('REJECTED','SUPERSEDED') then
    raise exception 'un ajustement % est immuable', old.status using errcode = 'HR712';
  end if;
  if old.status = 'APPROVED' then
    if new.status = 'SUPERSEDED' and v_content_same then return new; end if;
    raise exception 'un ajustement approuvé ne peut être que remplacé' using errcode = 'HR712';
  end if;
  if not v_content_same then
    raise exception 'le contenu d''un ajustement ne se réécrit pas — proposez un remplacement'
      using errcode = 'HR712';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_payroll_adjustment_guard on public.hr_payroll_adjustment;
create trigger trg_hr_payroll_adjustment_guard before update on public.hr_payroll_adjustment
  for each row execute function public.hr_payroll_adjustment_guard();

-- ===========================================================================
-- 5. TRANSACTIONAL RPCs — actor integrity (HR630) + database authority
--    (INV-7) in every one; service_role transport only.
--    Body comments deliberately absent (INV-3 scans definer sources).
-- ===========================================================================

create or replace function public.hr_create_payroll_period(
  p_tenant uuid, p_actor uuid, p_code text, p_label text, p_start date, p_end date)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_prior uuid; v_prior_status text; v_version int := 1;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  if coalesce(btrim(p_code), '') = '' or coalesce(btrim(p_label), '') = '' then
    raise exception 'code et libellé obligatoires' using errcode = 'HR704';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'période invalide (fin avant début)' using errcode = 'HR704';
  end if;

  select id, status into v_prior, v_prior_status
    from public.hr_payroll_period
   where tenant_id = p_tenant and code = btrim(p_code)
   order by version desc limit 1;
  if v_prior is not null then
    if v_prior_status not in ('LOCKED','CANCELLED') then
      raise exception 'une préparation active existe déjà pour « % »', btrim(p_code)
        using errcode = 'HR703';
    end if;
    select version + 1 into v_version from public.hr_payroll_period where id = v_prior;
  end if;

  insert into public.hr_payroll_period (
    tenant_id, code, label_fr, period_start, period_end, version,
    supersedes_period_id, created_by)
  values (p_tenant, btrim(p_code), btrim(p_label), p_start, p_end, v_version,
          case when v_version > 1 then v_prior end, p_actor)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.hr_prepare_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_start date; v_end date; v_count int := 0; v_draft int := 0;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select status, period_start, period_end into v_status, v_start, v_end
    from public.hr_payroll_period
   where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status not in ('DRAFT','PREPARED') then
    raise exception 'seule une préparation en cours peut collecter les faits (statut %)', v_status
      using errcode = 'HR706';
  end if;

  delete from public.hr_payroll_period_line
   where period_id = p_period and tenant_id = p_tenant;

  select count(*) into v_draft from public.employee e
   where e.tenant_id = p_tenant and e.status = 'DRAFT';

  insert into public.hr_payroll_period_line (
    tenant_id, period_id, employee_id, employee_number, first_name, last_name,
    department, org_unit_label, position_label, work_location_label,
    contract_kind, employment_status, hire_date, termination_date,
    joined_in_period, left_in_period, has_open_assignment, has_linked_account,
    attendance_days, worked_minutes, leave_breakdown, leave_tenths_total, exceptions)
  select
    p_tenant, p_period, e.id, e.employee_number, e.first_name, e.last_name,
    e.department, u.name, po.title, wl.name,
    ct.contract_kind, e.status, e.hire_date, e.termination_date,
    (e.hire_date is not null and e.hire_date between v_start and v_end),
    (e.termination_date is not null and e.termination_date between v_start and v_end),
    (a.id is not null),
    (e.linked_app_user_id is not null),
    coalesce(att.days, 0), coalesce(att.minutes, 0),
    coalesce(lv.breakdown, '[]'::jsonb), coalesce(lv.total_tenths, 0),
    (
      (case when coalesce(att.days, 0) = 0 then jsonb_build_array('NO_ATTENDANCE') else '[]'::jsonb end)
      || (case when a.id is null then jsonb_build_array('NO_OPEN_ASSIGNMENT') else '[]'::jsonb end)
      || (case when ct.contract_kind is null then jsonb_build_array('NO_CONTRACT_RECORD') else '[]'::jsonb end)
      || (case when e.hire_date is null then jsonb_build_array('MISSING_HIRE_DATE') else '[]'::jsonb end)
      || (case when e.hire_date is not null and e.hire_date between v_start and v_end
               then jsonb_build_array('HIRED_IN_PERIOD') else '[]'::jsonb end)
      || (case when e.termination_date is not null and e.termination_date between v_start and v_end
               then jsonb_build_array('TERMINATED_IN_PERIOD') else '[]'::jsonb end)
      || (case when e.status = 'SUSPENDED' then jsonb_build_array('SUSPENDED_AT_CUTOFF') else '[]'::jsonb end)
      || (case when coalesce(lv.spans_boundary, false) then jsonb_build_array('LEAVE_SPANS_BOUNDARY') else '[]'::jsonb end)
      || (case when coalesce(pend.pending, 0) > 0 then jsonb_build_array('LEAVE_PENDING_AT_CUTOFF') else '[]'::jsonb end)
    )
  from public.employee e
  left join lateral (
    select x.id, x.org_unit_id, x.position_id, x.work_location_id
      from public.employee_assignment x
     where x.employee_id = e.id and x.assignment_kind = 'PRIMARY' and x.effective_to is null
     limit 1
  ) a on true
  left join public.hr_org_unit u on u.id = a.org_unit_id
  left join public.hr_position po on po.id = a.position_id
  left join public.hr_work_location wl on wl.id = a.work_location_id
  left join lateral (
    select c.contract_kind
      from public.employment_contract c
     where c.employee_id = e.id and c.status <> 'ENDED'
       and c.start_date <= v_end and (c.end_date is null or c.end_date >= v_start)
     order by c.start_date desc limit 1
  ) ct on true
  left join lateral (
    select count(*)::int as days, coalesce(sum(d.worked_minutes), 0)::int as minutes
      from public.hr_attendance_day d
     where d.employee_id = e.id and d.work_date between v_start and v_end
  ) att on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
             'code', c.code, 'label_fr', c.label_fr,
             'tenths', t.tenths, 'is_paid', c.is_paid) order by c.code) as breakdown,
           sum(t.tenths)::int as total_tenths,
           bool_or(t.spans) as spans_boundary
      from (
        select lr.category_id, sum(lr.day_tenths)::int as tenths,
               bool_or(lr.start_date < v_start or lr.end_date > v_end) as spans
          from public.hr_leave_request lr
         where lr.employee_id = e.id and lr.status = 'APPROVED'
           and lr.start_date <= v_end and lr.end_date >= v_start
         group by lr.category_id
      ) t
      join public.hr_leave_category c on c.id = t.category_id
  ) lv on true
  left join lateral (
    select count(*)::int as pending
      from public.hr_leave_request lr
     where lr.employee_id = e.id and lr.status = 'SUBMITTED'
       and lr.start_date <= v_end and lr.end_date >= v_start
  ) pend on true
  where e.tenant_id = p_tenant
    and e.status not in ('DRAFT','ARCHIVED')
    and (e.hire_date is null or e.hire_date <= v_end)
    and (e.status <> 'TERMINATED'
         or (e.termination_date is not null and e.termination_date >= v_start));

  get diagnostics v_count = row_count;

  update public.hr_payroll_period
     set status = 'PREPARED', cutoff_at = now(), line_count = v_count,
         draft_excluded_count = v_draft,
         prepared_by = p_actor, prepared_at = now()
   where id = p_period;
  return v_count;
end $$;

create or replace function public.hr_verify_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_lines int;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select status, line_count into v_status, v_lines
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status <> 'PREPARED' then
    raise exception 'seule une préparation collectée peut être vérifiée' using errcode = 'HR706';
  end if;
  if v_lines = 0 then
    raise exception 'une préparation vide ne peut pas être vérifiée' using errcode = 'HR714';
  end if;

  update public.hr_payroll_period
     set status = 'VERIFIED', verified_by = p_actor, verified_at = now()
   where id = p_period;
  return p_period;
end $$;

create or replace function public.hr_reopen_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select status into v_status
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status <> 'VERIFIED' then
    raise exception 'seule une préparation vérifiée peut être rouverte' using errcode = 'HR706';
  end if;

  update public.hr_payroll_period
     set status = 'PREPARED', verified_by = null, verified_at = null
   where id = p_period;
  return p_period;
end $$;

create or replace function public.hr_approve_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_prepared uuid;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:payroll:approve', 'SERVICE');

  select status, prepared_by into v_status, v_prepared
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status <> 'VERIFIED' then
    raise exception 'seule une préparation vérifiée peut être approuvée' using errcode = 'HR706';
  end if;
  if v_prepared is not null and v_prepared = p_actor then
    raise exception 'quatre yeux : l''approbateur doit différer du préparateur' using errcode = 'HR707';
  end if;

  update public.hr_payroll_period
     set status = 'APPROVED', approved_by = p_actor, approved_at = now()
   where id = p_period;
  return p_period;
end $$;

create or replace function public.hr_lock_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:payroll:approve', 'SERVICE');

  select status into v_status
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status <> 'APPROVED' then
    raise exception 'seule une préparation approuvée peut être verrouillée' using errcode = 'HR706';
  end if;

  update public.hr_payroll_period
     set status = 'LOCKED', locked_by = p_actor, locked_at = now()
   where id = p_period;
  return p_period;
end $$;

create or replace function public.hr_cancel_payroll_period(
  p_tenant uuid, p_period uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif d''annulation obligatoire' using errcode = 'HR715';
  end if;
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select status into v_status
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_status in ('LOCKED','CANCELLED') then
    raise exception 'une préparation % ne peut plus être annulée', v_status using errcode = 'HR701';
  end if;

  update public.hr_payroll_period
     set status = 'CANCELLED', cancelled_at = now(), cancellation_reason = btrim(p_reason)
   where id = p_period;
  return p_period;
end $$;

create or replace function public.hr_propose_payroll_adjustment(
  p_tenant uuid, p_period uuid, p_employee uuid, p_kind uuid, p_actor uuid,
  p_quantity int, p_reason text default null, p_evidence uuid default null,
  p_supersedes uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_period_status text; v_kind_active boolean; v_requires boolean;
  v_old_status text; v_id uuid; v_version int := 1;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  if p_quantity is null or p_quantity = 0 then
    raise exception 'quantité obligatoire et non nulle' using errcode = 'HR709';
  end if;
  select status into v_period_status
    from public.hr_payroll_period where id = p_period and tenant_id = p_tenant for update;
  if not found then raise exception 'préparation introuvable' using errcode = 'HR702'; end if;
  if v_period_status not in ('DRAFT','PREPARED','VERIFIED') then
    raise exception 'la préparation n''accepte plus d''ajustements' using errcode = 'HR706';
  end if;
  select is_active, requires_reason into v_kind_active, v_requires
    from public.hr_payroll_adjustment_kind where id = p_kind and tenant_id = p_tenant;
  if v_kind_active is null then
    raise exception 'catégorie d''ajustement introuvable' using errcode = 'HR708';
  end if;
  if not v_kind_active then
    raise exception 'catégorie d''ajustement désactivée' using errcode = 'HR708';
  end if;
  if v_requires and coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif obligatoire pour cette catégorie' using errcode = 'HR715';
  end if;
  if not exists (
    select 1 from public.hr_payroll_period_line l
     where l.period_id = p_period and l.employee_id = p_employee and l.tenant_id = p_tenant) then
    raise exception 'employé absent de cette préparation — collectez d''abord les faits'
      using errcode = 'HR713';
  end if;

  if p_supersedes is not null then
    select status into v_old_status from public.hr_payroll_adjustment
     where id = p_supersedes and tenant_id = p_tenant and period_id = p_period for update;
    if not found then raise exception 'ajustement à remplacer introuvable' using errcode = 'HR710'; end if;
    if v_old_status not in ('PROPOSED','APPROVED') then
      raise exception 'un ajustement % ne peut pas être remplacé', v_old_status using errcode = 'HR712';
    end if;
    update public.hr_payroll_adjustment set status = 'SUPERSEDED' where id = p_supersedes;
    select version + 1 into v_version from public.hr_payroll_adjustment where id = p_supersedes;
  end if;

  insert into public.hr_payroll_adjustment (
    tenant_id, period_id, employee_id, kind_id, quantity, reason,
    evidence_document_id, proposed_by, version, supersedes_adjustment_id)
  values (p_tenant, p_period, p_employee, p_kind, p_quantity, nullif(btrim(coalesce(p_reason, '')), ''),
          p_evidence, p_actor, v_version, p_supersedes)
  returning id into v_id;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, p_employee, 'payroll_adjustment_proposed', p_actor,
          jsonb_build_object('adjustment_id', v_id, 'period_id', p_period,
                             'quantity', p_quantity, 'amendment', p_supersedes is not null));
  return v_id;
end $$;

create or replace function public.hr_decide_payroll_adjustment(
  p_tenant uuid, p_adjustment uuid, p_actor uuid, p_decision text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_proposer uuid; v_employee uuid; v_period uuid; v_period_status text;
begin
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'décision invalide' using errcode = 'HR709';
  end if;
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select a.status, a.proposed_by, a.employee_id, a.period_id, p.status
    into v_status, v_proposer, v_employee, v_period, v_period_status
    from public.hr_payroll_adjustment a
    join public.hr_payroll_period p on p.id = a.period_id
   where a.id = p_adjustment and a.tenant_id = p_tenant for update of a;
  if not found then raise exception 'ajustement introuvable' using errcode = 'HR710'; end if;
  if v_status <> 'PROPOSED' then
    raise exception 'seul un ajustement proposé peut être décidé' using errcode = 'HR712';
  end if;
  if v_period_status not in ('DRAFT','PREPARED','VERIFIED') then
    raise exception 'la préparation n''accepte plus de décisions d''ajustement' using errcode = 'HR706';
  end if;
  if v_proposer = p_actor then
    raise exception 'quatre yeux : le décideur doit différer du proposant' using errcode = 'HR711';
  end if;

  update public.hr_payroll_adjustment
     set status = p_decision, decided_by = p_actor, decided_at = now(), decision_note = p_note
   where id = p_adjustment;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee,
          case when p_decision = 'APPROVED' then 'payroll_adjustment_approved'
               else 'payroll_adjustment_rejected' end,
          p_actor, jsonb_build_object('adjustment_id', p_adjustment, 'period_id', v_period));
  return p_adjustment;
end $$;

revoke execute on function public.hr_create_payroll_period(uuid,uuid,text,text,date,date) from public, anon, authenticated;
revoke execute on function public.hr_prepare_payroll_period(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_verify_payroll_period(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_reopen_payroll_period(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_approve_payroll_period(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_lock_payroll_period(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_cancel_payroll_period(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.hr_propose_payroll_adjustment(uuid,uuid,uuid,uuid,uuid,int,text,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_decide_payroll_adjustment(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.hr_create_payroll_period(uuid,uuid,text,text,date,date) to service_role;
grant execute on function public.hr_prepare_payroll_period(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_verify_payroll_period(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_reopen_payroll_period(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_approve_payroll_period(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_lock_payroll_period(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_cancel_payroll_period(uuid,uuid,uuid,text) to service_role;
grant execute on function public.hr_propose_payroll_adjustment(uuid,uuid,uuid,uuid,uuid,int,text,uuid,uuid) to service_role;
grant execute on function public.hr_decide_payroll_adjustment(uuid,uuid,uuid,text,text) to service_role;

-- ===========================================================================
-- 6. RLS + self-assertions.
--    Workflow (the period register) reads on hr:read like every HR surface.
--    LINE and ADJUSTMENT content is per-person confidential: it reads on the
--    preparing desk's hr:manage or the parked hr:payroll:read — NEVER on
--    hr:sensitive:read, which this migration does not touch (rule 4, §9).
-- ===========================================================================
alter table public.hr_payroll_period          enable row level security;
alter table public.hr_payroll_period_line     enable row level security;
alter table public.hr_payroll_adjustment_kind enable row level security;
alter table public.hr_payroll_adjustment      enable row level security;

drop policy if exists hr_payroll_period_select on public.hr_payroll_period;
create policy hr_payroll_period_select on public.hr_payroll_period
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_payroll_period_line_select on public.hr_payroll_period_line;
create policy hr_payroll_period_line_select on public.hr_payroll_period_line
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
         and (public.has_permission('hr:payroll:read') or public.has_permission('hr:manage')));

drop policy if exists hr_payroll_adjustment_kind_select on public.hr_payroll_adjustment_kind;
create policy hr_payroll_adjustment_kind_select on public.hr_payroll_adjustment_kind
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_payroll_adjustment_select on public.hr_payroll_adjustment;
create policy hr_payroll_adjustment_select on public.hr_payroll_adjustment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id()
         and (public.has_permission('hr:payroll:read') or public.has_permission('hr:manage')));

grant select on public.hr_payroll_period, public.hr_payroll_period_line,
                public.hr_payroll_adjustment_kind, public.hr_payroll_adjustment
  to authenticated;

do $$
declare v_count int; v_src text; v_fn text; v_args int;
begin
  -- 6a. Both new permissions exist and are granted to NOBODY (parked — Q7/Q8).
  select count(*) into v_count from public.permission
   where code in ('hr:payroll:read','hr:payroll:approve');
  if v_count <> 2 then
    raise exception 'HR-7A: the two payroll permissions must be catalogued';
  end if;
  select count(*) into v_count
  from public.role_permission rp
  join public.permission p on p.id = rp.permission_id
  where p.code in ('hr:payroll:read','hr:payroll:approve');
  if v_count <> 0 then
    raise exception 'HR-7A: payroll authorities must stay parked (% grant rows)', v_count;
  end if;

  -- 6b. hr:sensitive:read untouched, still granted to NOBODY.
  select count(*) into v_count
  from public.role_permission rp
  join public.permission p on p.id = rp.permission_id
  where p.code = 'hr:sensitive:read';
  if v_count <> 0 then
    raise exception 'HR-7A: hr:sensitive:read must not be granted by this phase';
  end if;

  -- 6c. SYSTEM_ADMIN and CEO hold nothing new (DEC-B25 + the standing boundary).
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code in ('SYSTEM_ADMIN','CEO') and p.code like 'hr:payroll:%';
  if v_count <> 0 then
    raise exception 'HR-7A: SYSTEM_ADMIN/CEO must hold no payroll authority';
  end if;

  -- 6d. The adjustment vocabulary ships EMPTY — no category is invented here.
  select count(*) into v_count from public.hr_payroll_adjustment_kind;
  if v_count <> 0 then
    raise exception 'HR-7A: no adjustment vocabulary may be seeded by a migration';
  end if;

  -- 6e. Every RPC verifies its actor and asserts authority (comment-stripped).
  for v_fn, v_args in
    select * from (values
      ('hr_create_payroll_period', 6), ('hr_prepare_payroll_period', 3),
      ('hr_verify_payroll_period', 3), ('hr_reopen_payroll_period', 3),
      ('hr_approve_payroll_period', 3), ('hr_lock_payroll_period', 3),
      ('hr_cancel_payroll_period', 4), ('hr_propose_payroll_adjustment', 9),
      ('hr_decide_payroll_adjustment', 5)
    ) as t(fn, n)
  loop
    select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.proname = v_fn and p.pronargs = v_args;
    if v_src is null then
      raise exception 'HR-7A: % (% args) must exist', v_fn, v_args;
    end if;
    if v_src !~ 'HR630' or v_src !~ 'assert_actor_authority' then
      raise exception 'HR-7A: % must verify its actor and assert authority', v_fn;
    end if;
  end loop;

  -- 6f. Approval and lock assert the PARKED authority, and only them.
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_approve_payroll_period' and p.pronargs = 3;
  if v_src !~ 'hr:payroll:approve' or v_src !~ 'HR707' then
    raise exception 'HR-7A: approval must assert hr:payroll:approve and four-eyes';
  end if;

  -- 6g. Transport: no browser role may execute any payroll RPC.
  if has_function_privilege('authenticated', 'public.hr_prepare_payroll_period(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.hr_approve_payroll_period(uuid,uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_decide_payroll_adjustment(uuid,uuid,uuid,text,text)', 'execute') then
    raise exception 'HR-7A: payroll RPCs must be service_role transport only';
  end if;

  -- 6h. THE BOUNDARY, MADE STRUCTURAL: no monetary-looking column exists in
  --     any payroll table. Q1 gates HR-7E; drift cannot answer it.
  select count(*) into v_count
  from information_schema.columns
  where table_schema = 'public' and table_name like 'hr\_payroll\_%' escape '\'
    and (column_name ~* 'amount|salar|montant|wage|rate|price|gross|net_|tax|cotis');
  if v_count <> 0 then
    raise exception 'HR-7A: a monetary-looking column entered the payroll tables (% found) — Q1/DEC-B63 forbid it', v_count;
  end if;
end $$;
