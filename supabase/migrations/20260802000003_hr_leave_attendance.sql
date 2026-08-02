-- 20260802000003_hr_leave_attendance.sql
-- Effitrans HR Platform — HR-5: Leave & Attendance.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first.
--
-- FOUR RULES THIS MIGRATION ENCODES, EACH ONE MANDATED:
--
-- 1. ON_LEAVE IS DERIVED. There is no ON_LEAVE column, no ON_LEAVE status and
--    no transition to one. `employee.status` keeps its ratified five values
--    (DRAFT/ACTIVE/SUSPENDED/TERMINATED/ARCHIVED). Being on leave is a FACT
--    COMPUTED from an approved, currently-active request — nothing here lets
--    anyone assert it independently, because a hand-set ON_LEAVE would drift
--    from the approval that justifies it.
--
-- 2. APPROVAL IS ITS OWN AUTHORITY. `hr:leave:approve` is added to the
--    catalogue and GRANTED TO NO ROLE. Approval deliberately does NOT ride
--    hr:manage: requesting leave and approving it are different authorities,
--    and folding them together is how separation of duties becomes decorative.
--    Activation is one INSERT once management ratifies (see
--    docs/hr/hr-5-permission-ratification.md).
--
-- 3. NO LEGAL VALUE IS INVENTED. No accrual formula, no entitlement quantity,
--    no public holiday, no retention period appears anywhere below. The seeded
--    categories carry a VOCABULARY ONLY, with `is_paid` NULL (unknown, not
--    assumed) and `is_provisional = true` until Senegal labour counsel confirms
--    them. Every quantity is entered by the tenant.
--
-- 4. LEAVE HISTORY IS IMMUTABLE ONCE DECIDED. A decided request can never be
--    edited or re-decided (trigger); a correction is a new request.

-- ===========================================================================
-- 1. PERMISSION — catalogue only, granted to NOBODY (rule 2)
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:leave:approve', 'hr', 'leave_approve', 'all',
   'Approuver ou refuser une demande de congé (autorité distincte de hr:manage)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. LEAVE CATEGORIES — configuration. Quantities live in entitlements, never
--    here: a category says WHAT a leave is, never HOW MUCH is due.
-- ===========================================================================
create table if not exists public.hr_leave_category (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  code              text not null,
  label_fr          text not null,
  -- NULL = not yet confirmed by counsel. Deliberately not defaulted to a guess.
  is_paid           boolean,
  requires_evidence boolean not null default false,
  -- TRUE until a qualified reviewer confirms the category against Senegalese
  -- labour law. The UI shows provisional categories as such.
  is_provisional    boolean not null default true,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, code)
);
drop trigger if exists trg_hr_leave_category_updated_at on public.hr_leave_category;
create trigger trg_hr_leave_category_updated_at before update on public.hr_leave_category
  for each row execute function public.set_updated_at();

-- Vocabulary seed ONLY — no quantity, no accrual, is_paid unknown, provisional.
insert into public.hr_leave_category (tenant_id, code, label_fr, is_paid, requires_evidence, is_provisional)
select o.id, v.code, v.label_fr, null::boolean, v.evidence, true
from public.organization o
cross join (values
  ('ANNUAL',    'Congé annuel',            false),
  ('SICK',      'Congé maladie',           true),
  ('MATERNITY', 'Congé de maternité',      true),
  ('PATERNITY', 'Congé de paternité',      true),
  ('UNPAID',    'Congé sans solde',        false),
  ('SPECIAL',   'Congé pour événement familial', false)
) as v(code, label_fr, evidence)
on conflict (tenant_id, code) do nothing;

-- ===========================================================================
-- 3. ENTITLEMENTS — every quantity is TENANT-ENTERED, in integer DAY-TENTHS
--    (10 = one day, 5 = half a day). Integer arithmetic only: the aging
--    engine's minor-unit discipline applied to days, so no float ever decides
--    how much leave someone has.
-- ===========================================================================
create table if not exists public.hr_leave_entitlement (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  employee_id    uuid not null references public.employee (id),
  category_id    uuid not null references public.hr_leave_category (id),
  period_start   date not null,
  period_end     date not null,
  opening_tenths int not null default 0,
  accrued_tenths int not null default 0,
  taken_tenths   int not null default 0,
  note           text,
  created_by     uuid references public.app_user (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (employee_id, category_id, period_start),
  constraint entitlement_period_ordered check (period_end >= period_start),
  constraint entitlement_no_negative_inputs
    check (opening_tenths >= 0 and accrued_tenths >= 0 and taken_tenths >= 0)
);
create index if not exists idx_entitlement_employee
  on public.hr_leave_entitlement (tenant_id, employee_id);
drop trigger if exists trg_hr_leave_entitlement_updated_at on public.hr_leave_entitlement;
create trigger trg_hr_leave_entitlement_updated_at before update on public.hr_leave_entitlement
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 4. REQUESTS — closed lifecycle + structural maker-checker.
-- ===========================================================================
create table if not exists public.hr_leave_request (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  employee_id          uuid not null references public.employee (id),
  category_id          uuid not null references public.hr_leave_category (id),
  status               text not null default 'DRAFT'
                         check (status in ('DRAFT','SUBMITTED','APPROVED','REFUSED','CANCELLED')),
  start_date           date not null,
  end_date             date not null,
  day_tenths           int not null check (day_tenths > 0),
  reason               text,
  evidence_document_id uuid references public.hr_document (id),
  requested_by         uuid not null references public.app_user (id),
  submitted_at         timestamptz,
  approved_by          uuid references public.app_user (id),
  decided_at           timestamptz,
  decision_note        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint leave_dates_ordered check (end_date >= start_date),
  -- Separation of duties: the decider is never the requester.
  constraint leave_approver_differs check (approved_by is null or approved_by <> requested_by),
  constraint leave_decided_has_decider
    check (status not in ('APPROVED','REFUSED') or (approved_by is not null and decided_at is not null))
);
create index if not exists idx_leave_request_employee
  on public.hr_leave_request (tenant_id, employee_id, start_date);
-- The derivation index: "is this employee on leave right now?" is a range scan
-- over APPROVED rows only.
create index if not exists idx_leave_request_approved_window
  on public.hr_leave_request (tenant_id, employee_id, start_date, end_date)
  where status = 'APPROVED';
drop trigger if exists trg_hr_leave_request_updated_at on public.hr_leave_request;
create trigger trg_hr_leave_request_updated_at before update on public.hr_leave_request
  for each row execute function public.set_updated_at();

-- Rule 4 — a decided request is frozen. Only a CANCELLED transition from an
-- approved future leave is allowed, and nothing else may change afterwards.
create or replace function public.hr_leave_request_immutable_once_decided()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('APPROVED','REFUSED','CANCELLED') then
    if old.status = 'APPROVED' and new.status = 'CANCELLED'
       and new.start_date = old.start_date and new.end_date = old.end_date
       and new.day_tenths = old.day_tenths and new.category_id = old.category_id then
      return new;  -- the one governed exit
    end if;
    raise exception 'une demande décidée est immuable (%)', old.status using errcode = 'HR520';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_leave_request_immutable on public.hr_leave_request;
create trigger trg_hr_leave_request_immutable before update on public.hr_leave_request
  for each row execute function public.hr_leave_request_immutable_once_decided();

-- ===========================================================================
-- 5. ATTENDANCE — the INPUT CONTRACT (ratified §9 extension point). A typed
--    shape a future device or import can satisfy. No device integration, no
--    biometrics, no GPS, no inferred hours: minutes are recorded, never guessed.
-- ===========================================================================
create table if not exists public.hr_attendance_day (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  employee_id    uuid not null references public.employee (id),
  work_date      date not null,
  worked_minutes int not null check (worked_minutes >= 0 and worked_minutes <= 1440),
  source         text not null default 'MANUAL'
                   check (source in ('MANUAL','IMPORT','DEVICE')),
  note           text,
  recorded_by    uuid references public.app_user (id),
  recorded_at    timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists idx_attendance_employee_date
  on public.hr_attendance_day (tenant_id, employee_id, work_date desc);

-- ===========================================================================
-- 6. TRANSACTIONAL RPC — ADR-HR2-01, as exercised in HR-4. The decision, the
--    balance movement and the ledger event commit together or not at all.
--    Approval authority is checked by the APPLICATION against
--    hr:leave:approve; this function is service-role only.
-- ===========================================================================
create or replace function public.hr_decide_leave_request(
  p_tenant uuid, p_request uuid, p_actor uuid, p_decision text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee uuid; v_category uuid; v_tenths int; v_status text; v_requester uuid;
  v_start date; v_end date; v_ent uuid;
begin
  if p_decision not in ('APPROVED','REFUSED') then
    raise exception 'décision invalide' using errcode = 'HR521';
  end if;
  select employee_id, category_id, day_tenths, status, requested_by, start_date, end_date
    into v_employee, v_category, v_tenths, v_status, v_requester, v_start, v_end
    from public.hr_leave_request
   where id = p_request and tenant_id = p_tenant for update;
  if not found then raise exception 'demande introuvable' using errcode = 'HR522'; end if;
  if v_status <> 'SUBMITTED' then
    raise exception 'seule une demande soumise peut être décidée' using errcode = 'HR523';
  end if;
  if v_requester = p_actor then
    raise exception 'séparation des tâches : le décideur doit différer du demandeur' using errcode = 'HR524';
  end if;

  update public.hr_leave_request
     set status = p_decision, approved_by = p_actor, decided_at = now(), decision_note = p_note
   where id = p_request;

  -- An approval consumes entitlement, if a period covering the leave exists.
  -- No period is CREATED here: inventing an entitlement would be inventing a
  -- legal quantity. Absence of a period simply means nothing to decrement.
  if p_decision = 'APPROVED' then
    select id into v_ent from public.hr_leave_entitlement
     where tenant_id = p_tenant and employee_id = v_employee and category_id = v_category
       and v_start >= period_start and v_start <= period_end
     order by period_start desc limit 1 for update;
    if v_ent is not null then
      update public.hr_leave_entitlement
         set taken_tenths = taken_tenths + v_tenths where id = v_ent;
    end if;
  end if;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee,
          case when p_decision = 'APPROVED' then 'leave_approved' else 'leave_refused' end,
          p_actor,
          jsonb_build_object('request_id', p_request, 'start_date', v_start,
                             'end_date', v_end, 'day_tenths', v_tenths));
  return p_request;
end $$;

-- Cancelling an APPROVED leave gives the entitlement back, in one transaction.
create or replace function public.hr_cancel_leave_request(
  p_tenant uuid, p_request uuid, p_actor uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_employee uuid; v_category uuid; v_tenths int; v_status text; v_start date; v_ent uuid;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif d''annulation obligatoire' using errcode = 'HR525';
  end if;
  select employee_id, category_id, day_tenths, status, start_date
    into v_employee, v_category, v_tenths, v_status, v_start
    from public.hr_leave_request
   where id = p_request and tenant_id = p_tenant for update;
  if not found then raise exception 'demande introuvable' using errcode = 'HR522'; end if;
  if v_status not in ('DRAFT','SUBMITTED','APPROVED') then
    raise exception 'cette demande ne peut plus être annulée' using errcode = 'HR526';
  end if;

  update public.hr_leave_request
     set status = 'CANCELLED', decision_note = p_reason where id = p_request;

  if v_status = 'APPROVED' then
    select id into v_ent from public.hr_leave_entitlement
     where tenant_id = p_tenant and employee_id = v_employee and category_id = v_category
       and v_start >= period_start and v_start <= period_end
     order by period_start desc limit 1 for update;
    if v_ent is not null then
      update public.hr_leave_entitlement
         set taken_tenths = greatest(taken_tenths - v_tenths, 0) where id = v_ent;
    end if;
  end if;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'leave_cancelled', p_actor,
          jsonb_build_object('request_id', p_request, 'reason', p_reason));
  return p_request;
end $$;

revoke execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) from public;
revoke execute on function public.hr_cancel_leave_request(uuid,uuid,uuid,text) from public;
grant execute on function public.hr_decide_leave_request(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.hr_cancel_leave_request(uuid,uuid,uuid,text) to service_role;

-- ===========================================================================
-- 7. RLS — uniform idiom; reads on hr:read, writes via service role. No portal
--    policy. SYSTEM_ADMIN holds no hr:* (DEC-B25).
-- ===========================================================================
alter table public.hr_leave_category    enable row level security;
alter table public.hr_leave_entitlement enable row level security;
alter table public.hr_leave_request     enable row level security;
alter table public.hr_attendance_day    enable row level security;

drop policy if exists hr_leave_category_select on public.hr_leave_category;
create policy hr_leave_category_select on public.hr_leave_category
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_leave_entitlement_select on public.hr_leave_entitlement;
create policy hr_leave_entitlement_select on public.hr_leave_entitlement
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_leave_request_select on public.hr_leave_request;
create policy hr_leave_request_select on public.hr_leave_request
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_attendance_day_select on public.hr_attendance_day;
create policy hr_attendance_day_select on public.hr_attendance_day
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_leave_category, public.hr_leave_entitlement,
                public.hr_leave_request, public.hr_attendance_day
  to authenticated;

-- ===========================================================================
-- 8. NO GRANT. hr:leave:approve is held by nobody until ratification. Until
--    then the approval action denies everyone — the feature is requestable and
--    visible, but undecidable, which is the honest state of an unratified
--    authority.
-- ===========================================================================
