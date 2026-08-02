-- 20260803000002_hr_training.sql
-- Effitrans HR Platform — HR-6 (part 2 of 2): Training catalog, plans & evidence.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. Migration 79. Migrations 1–78 are untouched.
--
-- WHAT THIS IS, AND WHAT IT REFUSES TO BE
-- ---------------------------------------
-- This is an HR TRAINING REGISTER: what training a person is required to hold,
-- when they were assigned it, whether they completed it, and the certificate
-- that proves it. It is NOT a learning platform.
--
-- There is deliberately NO course content, NO lesson, NO module, NO chapter, NO
-- quiz, NO score-per-question, NO enrolment key, NO player, NO progress
-- tracking beyond a status, and NO authoring surface. A repository audit
-- confirmed no LMS, SmileyCX or e-learning code exists here; nothing below
-- creates the first one. Where delivery happens is a `provider_reference` —
-- a pointer OUT of this system, never a second system inside it.
--
-- ALSO REFUSED, because it is out of scope (§17) and unratified: cost, budget,
-- invoice, purchase order, reimbursement. `hr_training_course` carries no money
-- column at all, so no procurement flow can accrete onto it by accident.
--
-- NO PERMISSION IS ADDED. Training is operational HR data, not a separate
-- authority: reads ride hr:read and writes ride hr:manage, exactly as equipment
-- and onboarding do. `hr:training:manage` was considered and NOT created — see
-- docs/hr/hr-6-permission-analysis.md.
--
-- Certificates reuse HR-3's PRIVATE hr-documents bounded context. No second
-- bucket is created: the existing private bucket holds PDFs and images already.

-- ===========================================================================
-- 1. THE CATALOG — what training exists, and what it is worth holding.
--    validity_months is the TENANT's own configured revalidation interval. It
--    is not a legal retention period and no statutory value is implied.
-- ===========================================================================
create table if not exists public.hr_training_course (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  code              text not null,
  title             text not null,
  provider          text,
  category          text,
  delivery_mode     text not null default 'IN_PERSON'
                      check (delivery_mode in ('IN_PERSON','ONLINE','INTERNAL','EXTERNAL','CERTIFICATION')),
  duration_minutes  int check (duration_minutes is null or duration_minutes > 0),
  -- NULL = does not expire. A number = revalidate every N months (tenant rule).
  validity_months   int check (validity_months is null or validity_months > 0),
  is_mandatory      boolean not null default false,
  -- Target population as CONFIGURATION, not as authorization: which org units
  -- or positions are expected to hold this. Empty = everyone / unspecified.
  target_org_unit_id uuid references public.hr_org_unit (id),
  target_position_id uuid references public.hr_position (id),
  requires_evidence boolean not null default false,
  is_active         boolean not null default true,
  created_by        uuid references public.app_user (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, code)
);
create index if not exists idx_training_course_tenant
  on public.hr_training_course (tenant_id, is_active, is_mandatory);
drop trigger if exists trg_hr_training_course_updated_at on public.hr_training_course;
create trigger trg_hr_training_course_updated_at before update on public.hr_training_course
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. TRAINING PLANS — an employee's development plan for a period. A plan is a
--    GROUPING, never a gate: an enrollment may exist without one.
-- ===========================================================================
create table if not exists public.hr_training_plan (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  employee_id  uuid not null references public.employee (id),
  label_fr     text not null,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'ACTIVE'
                 check (status in ('ACTIVE','COMPLETED','CANCELLED')),
  note         text,
  created_by   uuid references public.app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint training_plan_period_ordered check (period_end >= period_start)
);
create index if not exists idx_training_plan_employee
  on public.hr_training_plan (tenant_id, employee_id, period_start desc);
drop trigger if exists trg_hr_training_plan_updated_at on public.hr_training_plan;
create trigger trg_hr_training_plan_updated_at before update on public.hr_training_plan
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. ENROLLMENTS — the working record. One row per (employee, course, attempt).
--    Lifecycle: PLANNED → ENROLLED → IN_PROGRESS → COMPLETED, with governed
--    CANCELLED and FAILED exits. A FAILED attempt is HISTORY, not a deletion:
--    a retake is a NEW enrollment, so the register keeps both.
-- ===========================================================================
create table if not exists public.hr_training_enrollment (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  employee_id            uuid not null references public.employee (id),
  course_id              uuid not null references public.hr_training_course (id),
  plan_id                uuid references public.hr_training_plan (id),
  status                 text not null default 'PLANNED'
                           check (status in ('PLANNED','ENROLLED','IN_PROGRESS','COMPLETED','FAILED','CANCELLED')),
  planned_date           date,
  due_date               date,
  started_at             timestamptz,
  completed_on           date,
  -- Free text: PASS / ÉCHEC / a provider's own grade. No formula reads it, and
  -- nothing here averages or ranks it.
  result                 text,
  -- The certificate lives in HR-3's PRIVATE bucket. Never public.document.
  certificate_document_id uuid references public.hr_document (id),
  -- When this certification lapses. Derived from the course's own configured
  -- validity_months at completion time, or entered directly by the tenant.
  expiry_date            date,
  -- A pointer OUT to wherever delivery actually happened. Never a second system.
  provider_reference     text,
  note                   text,
  cancellation_reason    text,
  assigned_by            uuid references public.app_user (id),
  completed_by           uuid references public.app_user (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint enrollment_completed_has_date
    check (status <> 'COMPLETED' or completed_on is not null),
  constraint enrollment_cancelled_has_reason
    check (status <> 'CANCELLED' or coalesce(btrim(cancellation_reason), '') <> ''),
  constraint enrollment_dates_ordered
    check (due_date is null or planned_date is null or due_date >= planned_date)
);
create index if not exists idx_enrollment_employee
  on public.hr_training_enrollment (tenant_id, employee_id, status);
create index if not exists idx_enrollment_due
  on public.hr_training_enrollment (tenant_id, due_date)
  where status in ('PLANNED','ENROLLED','IN_PROGRESS');
create index if not exists idx_enrollment_expiry
  on public.hr_training_enrollment (tenant_id, expiry_date)
  where status = 'COMPLETED' and expiry_date is not null;
drop trigger if exists trg_hr_training_enrollment_updated_at on public.hr_training_enrollment;
create trigger trg_hr_training_enrollment_updated_at before update on public.hr_training_enrollment
  for each row execute function public.set_updated_at();

-- A finished enrollment is history. COMPLETED / FAILED / CANCELLED are terminal:
-- a correction is a new enrollment, exactly as a corrected leave request is a
-- new request (HR-5 rule 4). The one exception is recording the certificate
-- document against an already-completed training, which adds evidence without
-- changing the outcome.
create or replace function public.hr_training_enrollment_terminal_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('COMPLETED','FAILED','CANCELLED') then
    if old.status = 'COMPLETED' and new.status = 'COMPLETED'
       and old.certificate_document_id is null
       and new.certificate_document_id is not null
       and new.completed_on is not distinct from old.completed_on
       and new.result      is not distinct from old.result
       and new.employee_id is not distinct from old.employee_id
       and new.course_id   is not distinct from old.course_id
    then
      return new;  -- attaching the certificate afterwards, and nothing else
    end if;
    raise exception 'une inscription % est immuable', old.status using errcode = 'HR650';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_training_enrollment_terminal on public.hr_training_enrollment;
create trigger trg_hr_training_enrollment_terminal before update on public.hr_training_enrollment
  for each row execute function public.hr_training_enrollment_terminal_guard();

-- ===========================================================================
-- 4. TRANSACTIONAL RPCs — same hardened pattern. Assignment and completion each
--    commit their domain write and their ledger events together or not at all.
-- ===========================================================================

create or replace function public.hr_assign_training(
  p_tenant uuid, p_employee uuid, p_course uuid, p_actor uuid,
  p_planned date default null, p_due date default null, p_plan uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_active boolean; v_mandatory boolean;
begin
  select is_active, is_mandatory into v_active, v_mandatory
    from public.hr_training_course where id = p_course and tenant_id = p_tenant;
  if not found then raise exception 'formation introuvable' using errcode = 'HR651'; end if;
  if not v_active then
    raise exception 'formation inactive' using errcode = 'HR652';
  end if;
  if not exists (select 1 from public.employee where id = p_employee and tenant_id = p_tenant) then
    raise exception 'employé introuvable' using errcode = 'HR653';
  end if;

  insert into public.hr_training_enrollment (
    tenant_id, employee_id, course_id, plan_id, status, planned_date, due_date, assigned_by)
  values (p_tenant, p_employee, p_course, p_plan, 'PLANNED', p_planned, p_due, p_actor)
  returning id into v_id;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, p_employee, 'training_assigned', p_actor,
          jsonb_build_object('enrollment_id', v_id, 'course_id', p_course,
                             'mandatory', v_mandatory, 'due_date', p_due));
  return v_id;
end $$;

-- Completion computes the expiry from the COURSE's own configured validity, and
-- emits certificate_recorded as a SEPARATE timeline fact when evidence exists —
-- because "trained" and "we hold the proof" are different statements.
create or replace function public.hr_complete_training(
  p_tenant uuid, p_enrollment uuid, p_actor uuid,
  p_result text default null, p_completed_on date default null,
  p_certificate uuid default null, p_provider_reference text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_course uuid; v_validity int;
  v_requires_evidence boolean; v_done date; v_expiry date;
begin
  select e.status, e.employee_id, e.course_id, c.validity_months, c.requires_evidence
    into v_status, v_employee, v_course, v_validity, v_requires_evidence
    from public.hr_training_enrollment e
    join public.hr_training_course c on c.id = e.course_id
   where e.id = p_enrollment and e.tenant_id = p_tenant for update of e;
  if not found then raise exception 'inscription introuvable' using errcode = 'HR654'; end if;
  if v_status in ('COMPLETED','FAILED','CANCELLED') then
    raise exception 'inscription déjà clôturée (%)', v_status using errcode = 'HR650';
  end if;
  if v_requires_evidence and p_certificate is null then
    raise exception 'cette formation exige une pièce justificative' using errcode = 'HR655';
  end if;

  v_done := coalesce(p_completed_on, current_date);
  if v_validity is not null then
    v_expiry := (v_done + make_interval(months => v_validity))::date;
  end if;

  update public.hr_training_enrollment
     set status = 'COMPLETED', completed_on = v_done, result = p_result,
         certificate_document_id = p_certificate, expiry_date = v_expiry,
         provider_reference = coalesce(p_provider_reference, provider_reference),
         completed_by = p_actor
   where id = p_enrollment;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'training_completed', p_actor,
          jsonb_build_object('enrollment_id', p_enrollment, 'course_id', v_course,
                             'completed_on', v_done, 'expiry_date', v_expiry));

  if p_certificate is not null then
    insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
    values (p_tenant, v_employee, 'certificate_recorded', p_actor,
            jsonb_build_object('enrollment_id', p_enrollment, 'document_id', p_certificate,
                               'expiry_date', v_expiry));
  end if;
  return p_enrollment;
end $$;

-- FAILED and CANCELLED are governed terminal exits, not deletions.
create or replace function public.hr_close_training_enrollment(
  p_tenant uuid, p_enrollment uuid, p_actor uuid, p_status text, p_reason text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_employee uuid;
begin
  if p_status not in ('FAILED','CANCELLED') then
    raise exception 'clôture invalide' using errcode = 'HR656';
  end if;
  if p_status = 'CANCELLED' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'motif d''annulation obligatoire' using errcode = 'HR657';
  end if;
  select status, employee_id into v_status, v_employee
    from public.hr_training_enrollment where id = p_enrollment and tenant_id = p_tenant for update;
  if not found then raise exception 'inscription introuvable' using errcode = 'HR654'; end if;
  if v_status in ('COMPLETED','FAILED','CANCELLED') then
    raise exception 'inscription déjà clôturée (%)', v_status using errcode = 'HR650';
  end if;

  update public.hr_training_enrollment
     set status = p_status, cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         completed_by = p_actor
   where id = p_enrollment;
  return p_enrollment;
end $$;

revoke execute on function public.hr_assign_training(uuid,uuid,uuid,uuid,date,date,uuid) from public;
revoke execute on function public.hr_complete_training(uuid,uuid,uuid,text,date,uuid,text) from public;
revoke execute on function public.hr_close_training_enrollment(uuid,uuid,uuid,text,text) from public;
grant execute on function public.hr_assign_training(uuid,uuid,uuid,uuid,date,date,uuid) to service_role;
grant execute on function public.hr_complete_training(uuid,uuid,uuid,text,date,uuid,text) to service_role;
grant execute on function public.hr_close_training_enrollment(uuid,uuid,uuid,text,text) to service_role;

-- ===========================================================================
-- 5. RLS — the uniform HR idiom. Reads on hr:read; writes via service role.
--    No portal policy. SYSTEM_ADMIN sees zero rows (DEC-B25).
-- ===========================================================================
alter table public.hr_training_course     enable row level security;
alter table public.hr_training_plan       enable row level security;
alter table public.hr_training_enrollment enable row level security;

drop policy if exists hr_training_course_select on public.hr_training_course;
create policy hr_training_course_select on public.hr_training_course
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_training_plan_select on public.hr_training_plan;
create policy hr_training_plan_select on public.hr_training_plan
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_training_enrollment_select on public.hr_training_enrollment;
create policy hr_training_enrollment_select on public.hr_training_enrollment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_training_course, public.hr_training_plan,
                public.hr_training_enrollment
  to authenticated;
