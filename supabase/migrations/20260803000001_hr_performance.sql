-- 20260803000001_hr_performance.sql
-- Effitrans HR Platform — HR-6 (part 1 of 2): Performance, Objectives & Competencies.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. Migration 78. Migrations 1–77 are untouched.
--
-- SIX RULES THIS MIGRATION ENCODES, EACH ONE MANDATED:
--
-- 1. NO CORPORATE SCORING FORMULA IS INVENTED. There is deliberately NO overall
--    score, NO average, NO rating, NO ranking and NO talent classification
--    column anywhere below. What exists are SCORING PRIMITIVES: a per-objective
--    achievement in basis points, and a per-competency level on a scale the
--    TENANT defines. Aggregation is a management decision (HRQ-P3) and would be
--    an additive column in a later migration, never a guess made here.
--
-- 2. NO FLOATING POINT. Weights and achievements are integer BASIS POINTS
--    (10000 = 100.00%), the day_tenths discipline from HR-5 carried forward.
--    A performance weight expressed as 0.1 + 0.2 must never become 0.30000000000000004.
--
-- 3. WEIGHTS ARE ENFORCED AT FINALIZATION, NOT ASSUMED. An objective set may be
--    incomplete while a cycle is open — that is what "open" means. The total is
--    checked once, in hr_finalize_evaluation, against the cycle's own configured
--    total. An employee with NO objectives is finalizable (a competency-only
--    review is legitimate); an employee WITH objectives must total exactly.
--
-- 4. FINALIZED PERFORMANCE IS IMMUTABLE. Once finalized, an evaluation accepts
--    exactly ONE further change — the employee's acknowledgment — and its
--    objectives are locked. The employee acknowledges receipt; they cannot
--    alter the manager's assessment. Enforced by trigger, not by convention.
--
-- 5. ACTOR SEPARATION IS STRUCTURAL. Self-assessment, manager review, HR
--    finalization and acknowledgment are four recorded actors, and the CHECK
--    constraints refuse to let one person occupy two of those seats. No stage
--    can silently impersonate another.
--
-- 6. ONE NEW PERMISSION, GRANTED TO NOBODY. `hr:performance:finalize` follows
--    the `hr:leave:approve` precedent exactly: finalization locks a person's
--    performance record forever, which is a different authority from managing
--    HR data. Reads ride hr:read; C3 evaluation CONTENT additionally rides the
--    EXISTING hr:sensitive:read (HR-3 precedent) — no hr:performance:read is
--    invented. Activation is one INSERT after ratification.
--
-- SYSTEM_ADMIN receives nothing here (DEC-B25). No portal policy: customers
-- never read HR. No new storage bucket: evidence reuses HR-3's private one.

-- ===========================================================================
-- 1. PERMISSION — catalogue only, granted to NOBODY (rule 6)
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('hr:performance:finalize', 'hr', 'performance_finalize', 'all',
   'Finaliser une évaluation de performance (autorité distincte de hr:manage ; le dossier devient immuable)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. PERFORMANCE CYCLES — tenant-configurable review campaigns.
--    `kind` is VOCABULARY, validated app-side against hr_configuration, exactly
--    as employment_kind is for contracts: a tenant that runs a "revue de
--    stage" must not need a migration to say so.
--    The configuration SNAPSHOT (weight_total_bp) lives on the cycle, so that
--    changing the tenant default later never retro-invalidates a closed cycle.
-- ===========================================================================
create table if not exists public.hr_performance_cycle (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  code                text not null,
  label_fr            text not null,
  cycle_kind          text not null,
  status              text not null default 'DRAFT'
                        check (status in ('DRAFT','OPEN','IN_REVIEW','FINALIZED','CANCELLED')),
  period_start        date not null,
  period_end          date not null,
  opens_on            date,
  submission_deadline date,
  review_deadline     date,
  finalized_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,
  -- The responsible HR owner. An app_user (an accountable operator), never an
  -- employee record: accountability attaches to a login, not to a person's file.
  hr_owner_id         uuid references public.app_user (id),
  -- Target population, resolved from CURRENT assignments at OPEN time.
  target_scope        text not null default 'ALL_ACTIVE'
                        check (target_scope in ('ALL_ACTIVE','ORG_UNIT','POSITION')),
  target_org_unit_id  uuid references public.hr_org_unit (id),
  target_position_id  uuid references public.hr_position (id),
  -- Configuration snapshot. 10000 bp = 100.00%. Tenant-settable per cycle.
  weight_total_bp     int not null default 10000 check (weight_total_bp > 0),
  created_by          uuid references public.app_user (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, code),
  constraint cycle_period_ordered check (period_end >= period_start),
  constraint cycle_finalized_has_timestamp
    check (status <> 'FINALIZED' or finalized_at is not null),
  constraint cycle_cancelled_has_reason
    check (status <> 'CANCELLED' or coalesce(btrim(cancellation_reason), '') <> ''),
  -- A scoped cycle must say what it is scoped to.
  constraint cycle_scope_has_target check (
    (target_scope = 'ALL_ACTIVE')
    or (target_scope = 'ORG_UNIT' and target_org_unit_id is not null)
    or (target_scope = 'POSITION' and target_position_id is not null)
  )
);
create index if not exists idx_perf_cycle_tenant_status
  on public.hr_performance_cycle (tenant_id, status, period_start desc);
drop trigger if exists trg_hr_performance_cycle_updated_at on public.hr_performance_cycle;
create trigger trg_hr_performance_cycle_updated_at before update on public.hr_performance_cycle
  for each row execute function public.set_updated_at();

-- Rule 4 (cycle level) — a FINALIZED cycle is frozen; a CANCELLED cycle is a
-- terminal governed exit. Neither may be reopened, and no uncontrolled
-- transition exists: the allowed forward path is DRAFT→OPEN→IN_REVIEW→FINALIZED
-- with CANCELLED reachable from any non-terminal state.
create or replace function public.hr_performance_cycle_transition_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    -- Editing a terminal cycle is refused even when the status is unchanged.
    if old.status in ('FINALIZED','CANCELLED') then
      raise exception 'un cycle % est immuable', old.status using errcode = 'HR601';
    end if;
    return new;
  end if;
  if old.status in ('FINALIZED','CANCELLED') then
    raise exception 'un cycle % ne peut pas être rouvert', old.status using errcode = 'HR602';
  end if;
  if new.status = 'CANCELLED' then
    return new;  -- governed exit from any non-terminal state
  end if;
  if not (
       (old.status = 'DRAFT'     and new.status = 'OPEN')
    or (old.status = 'OPEN'      and new.status = 'IN_REVIEW')
    or (old.status = 'IN_REVIEW' and new.status = 'FINALIZED')
  ) then
    raise exception 'transition de cycle interdite : % -> %', old.status, new.status
      using errcode = 'HR603';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_performance_cycle_guard on public.hr_performance_cycle;
create trigger trg_hr_performance_cycle_guard before update on public.hr_performance_cycle
  for each row execute function public.hr_performance_cycle_transition_guard();

-- ===========================================================================
-- 3. COMPETENCY CATALOG — configuration, NOT seeded.
--    No competency is created by this migration. Effitrans-specific
--    competencies require management approval (§6); shipping a default list
--    would be shipping an opinion about how this company evaluates people.
--    The SCALE is tenant-configurable: bounds plus optional level labels.
-- ===========================================================================
create table if not exists public.hr_competency (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  code         text not null,
  label_fr     text not null,
  description  text,
  category     text,
  scale_min    int not null default 1,
  scale_max    int not null default 5,
  -- e.g. {"1":"Débutant","5":"Expert"} — the tenant's own words, or empty.
  scale_labels jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, code),
  constraint competency_scale_ordered check (scale_max > scale_min)
);
drop trigger if exists trg_hr_competency_updated_at on public.hr_competency;
create trigger trg_hr_competency_updated_at before update on public.hr_competency
  for each row execute function public.set_updated_at();

-- Expected level per POSITION — the tenant's own competency framework.
create table if not exists public.hr_competency_expectation (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  position_id    uuid not null references public.hr_position (id),
  competency_id  uuid not null references public.hr_competency (id),
  expected_level int not null,
  created_at     timestamptz not null default now(),
  unique (position_id, competency_id)
);
create index if not exists idx_competency_expectation_tenant
  on public.hr_competency_expectation (tenant_id, position_id);

-- ===========================================================================
-- 4. EVALUATIONS — the four-actor record (rule 5).
--    manager_employee_id is a SNAPSHOT of the responsible manager taken from
--    the open PRIMARY assignment when the cycle opens. It records WHO the
--    manager was; it grants nobody anything (DEC-B63 stands untouched).
--    Write authority is checked by the application against hr:manage, and
--    finalization against hr:performance:finalize.
-- ===========================================================================
create table if not exists public.hr_evaluation (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  cycle_id              uuid not null references public.hr_performance_cycle (id),
  employee_id           uuid not null references public.employee (id),
  manager_employee_id   uuid references public.employee (id),
  status                text not null default 'DRAFT'
                          check (status in ('DRAFT','SELF_SUBMITTED','MANAGER_SUBMITTED',
                                            'FINALIZED','ACKNOWLEDGED','CANCELLED')),
  -- Stage 1 — self-assessment. `entered_by` is the LOGIN that typed it. Until an
  -- employee self-service surface exists (HRQ-P1) that login is an HR operator
  -- acting on the employee's behalf, and the column is named so that nobody can
  -- later mistake it for proof that the employee typed it themselves.
  self_comments         text,
  self_entered_by       uuid references public.app_user (id),
  self_submitted_at     timestamptz,
  -- Stage 2 — manager assessment.
  manager_comments      text,
  manager_strengths     text,
  manager_development   text,
  recommended_actions   text,
  manager_entered_by    uuid references public.app_user (id),
  manager_submitted_at  timestamptz,
  -- Stage 3 — HR moderation + finalization (hr:performance:finalize).
  moderation_note       text,
  final_summary         text,
  finalized_by          uuid references public.app_user (id),
  finalized_at          timestamptz,
  -- Stage 4 — the employee's acknowledgment of RECEIPT. Never an approval.
  acknowledged_by       uuid references public.app_user (id),
  acknowledged_at       timestamptz,
  acknowledgment_note   text,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (cycle_id, employee_id),
  -- Rule 5 — no actor may occupy two seats.
  constraint evaluation_manager_differs_from_self
    check (manager_entered_by is null or self_entered_by is null
           or manager_entered_by <> self_entered_by),
  constraint evaluation_finalizer_differs_from_manager
    check (finalized_by is null or manager_entered_by is null
           or finalized_by <> manager_entered_by),
  -- Stage completeness.
  constraint evaluation_submitted_has_actor
    check (self_submitted_at is null or self_entered_by is not null),
  constraint evaluation_manager_stage_has_actor
    check (manager_submitted_at is null or manager_entered_by is not null),
  constraint evaluation_finalized_has_actor
    check (status <> 'FINALIZED' or (finalized_by is not null and finalized_at is not null)),
  constraint evaluation_acknowledged_has_actor
    check (status <> 'ACKNOWLEDGED' or (acknowledged_by is not null and acknowledged_at is not null)),
  constraint evaluation_cancelled_has_reason
    check (status <> 'CANCELLED' or coalesce(btrim(cancellation_reason), '') <> ''),
  -- An employee is never their own manager of record.
  constraint evaluation_not_own_manager
    check (manager_employee_id is null or manager_employee_id <> employee_id)
);
create index if not exists idx_evaluation_cycle on public.hr_evaluation (tenant_id, cycle_id, status);
create index if not exists idx_evaluation_employee on public.hr_evaluation (tenant_id, employee_id);
create index if not exists idx_evaluation_manager
  on public.hr_evaluation (tenant_id, manager_employee_id) where manager_employee_id is not null;
drop trigger if exists trg_hr_evaluation_updated_at on public.hr_evaluation;
create trigger trg_hr_evaluation_updated_at before update on public.hr_evaluation
  for each row execute function public.set_updated_at();

-- Rule 4 — THE immutability rule. After FINALIZED the record accepts exactly one
-- further transition, the acknowledgment, and that transition may touch only the
-- acknowledgment columns. Every assessment field is compared explicitly: the
-- employee acknowledges receipt WITHOUT being able to alter what the manager wrote.
create or replace function public.hr_evaluation_immutable_once_finalized()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('FINALIZED','ACKNOWLEDGED','CANCELLED') then
    if old.status = 'FINALIZED' and new.status = 'ACKNOWLEDGED'
       and new.self_comments       is not distinct from old.self_comments
       and new.manager_comments    is not distinct from old.manager_comments
       and new.manager_strengths   is not distinct from old.manager_strengths
       and new.manager_development is not distinct from old.manager_development
       and new.recommended_actions is not distinct from old.recommended_actions
       and new.moderation_note     is not distinct from old.moderation_note
       and new.final_summary       is not distinct from old.final_summary
       and new.finalized_by        is not distinct from old.finalized_by
       and new.finalized_at        is not distinct from old.finalized_at
       and new.manager_entered_by  is not distinct from old.manager_entered_by
       and new.self_entered_by     is not distinct from old.self_entered_by
       and new.cycle_id            is not distinct from old.cycle_id
       and new.employee_id         is not distinct from old.employee_id
    then
      return new;  -- the one governed exit
    end if;
    raise exception 'une évaluation % est immuable', old.status using errcode = 'HR604';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_evaluation_immutable on public.hr_evaluation;
create trigger trg_hr_evaluation_immutable before update on public.hr_evaluation
  for each row execute function public.hr_evaluation_immutable_once_finalized();

-- ===========================================================================
-- 5. OBJECTIVES — weights and achievement in BASIS POINTS (rule 2).
--    Amendment after review begins is a NEW VERSION, never a rewrite (rule 4):
--    supersedes_objective_id + version, with the superseded row left intact.
-- ===========================================================================
create table if not exists public.hr_objective (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.organization (id),
  cycle_id               uuid not null references public.hr_performance_cycle (id),
  employee_id            uuid not null references public.employee (id),
  title                  text not null,
  description            text,
  category               text,
  -- 10000 bp = 100.00%. Integer only — no float ever touches a weight.
  weight_bp              int not null default 0 check (weight_bp >= 0 and weight_bp <= 10000),
  measurable_target      text,
  due_date               date,
  status                 text not null default 'DRAFT'
                           check (status in ('DRAFT','ACTIVE','ACHIEVED','PARTIAL','MISSED','CANCELLED','SUPERSEDED')),
  -- Employee-reported progress and manager-assessed achievement, both bp.
  progress_bp            int not null default 0 check (progress_bp >= 0 and progress_bp <= 10000),
  manager_achievement_bp int check (manager_achievement_bp >= 0 and manager_achievement_bp <= 10000),
  manager_assessment     text,
  completion_note        text,
  -- Evidence reuses HR-3's private bounded context. NEVER public.document.
  evidence_document_id   uuid references public.hr_document (id),
  version                int not null default 1 check (version >= 1),
  supersedes_objective_id uuid references public.hr_objective (id),
  locked_at              timestamptz,
  created_by             uuid references public.app_user (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint objective_supersedes_not_self
    check (supersedes_objective_id is null or supersedes_objective_id <> id)
);
create index if not exists idx_objective_cycle_employee
  on public.hr_objective (tenant_id, cycle_id, employee_id);
create index if not exists idx_objective_due
  on public.hr_objective (tenant_id, due_date) where locked_at is null;
drop trigger if exists trg_hr_objective_updated_at on public.hr_objective;
create trigger trg_hr_objective_updated_at before update on public.hr_objective
  for each row execute function public.set_updated_at();

-- A locked objective is frozen for good. Finalization locks; nothing unlocks.
create or replace function public.hr_objective_locked_guard()
returns trigger
language plpgsql
as $$
begin
  if old.locked_at is not null then
    raise exception 'un objectif finalisé est immuable' using errcode = 'HR605';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_objective_locked on public.hr_objective;
create trigger trg_hr_objective_locked before update on public.hr_objective
  for each row execute function public.hr_objective_locked_guard();

-- ===========================================================================
-- 6. COMPETENCY ASSESSMENTS — primitives only (rule 1). A self level, a manager
--    level, a note. No average, no gap score, no derived rating.
-- ===========================================================================
create table if not exists public.hr_competency_assessment (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  evaluation_id  uuid not null references public.hr_evaluation (id),
  competency_id  uuid not null references public.hr_competency (id),
  self_level     int,
  manager_level  int,
  expected_level int,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (evaluation_id, competency_id)
);
create index if not exists idx_competency_assessment_tenant
  on public.hr_competency_assessment (tenant_id, evaluation_id);
drop trigger if exists trg_hr_competency_assessment_updated_at on public.hr_competency_assessment;
create trigger trg_hr_competency_assessment_updated_at before update on public.hr_competency_assessment
  for each row execute function public.set_updated_at();

-- Levels must sit inside the tenant's own configured scale. The scale is
-- configuration; this only refuses values the tenant's own definition excludes.
create or replace function public.hr_competency_assessment_scale_guard()
returns trigger
language plpgsql
as $$
declare v_min int; v_max int;
begin
  select scale_min, scale_max into v_min, v_max
    from public.hr_competency where id = new.competency_id;
  if v_min is null then
    raise exception 'compétence introuvable' using errcode = 'HR606';
  end if;
  if new.self_level is not null and (new.self_level < v_min or new.self_level > v_max) then
    raise exception 'niveau auto-évalué hors échelle (%..%)', v_min, v_max using errcode = 'HR607';
  end if;
  if new.manager_level is not null and (new.manager_level < v_min or new.manager_level > v_max) then
    raise exception 'niveau manager hors échelle (%..%)', v_min, v_max using errcode = 'HR607';
  end if;
  if new.expected_level is not null and (new.expected_level < v_min or new.expected_level > v_max) then
    raise exception 'niveau attendu hors échelle (%..%)', v_min, v_max using errcode = 'HR607';
  end if;
  return new;
end $$;
drop trigger if exists trg_hr_competency_assessment_scale on public.hr_competency_assessment;
create trigger trg_hr_competency_assessment_scale
  before insert or update on public.hr_competency_assessment
  for each row execute function public.hr_competency_assessment_scale_guard();

-- ===========================================================================
-- 7. TRANSACTIONAL RPCs — ADR-HR2-01 as hardened in HR-4/HR-5. Each one commits
--    its state transition, its domain writes and its ledger events together or
--    not at all. Service-role only; the APPLICATION checks the permission.
-- ===========================================================================

-- Opening a cycle materializes one evaluation per targeted employee and puts the
-- event on each of their timelines, in ONE transaction. Re-running is a no-op on
-- the evaluations (unique cycle+employee) but the status guard refuses a second
-- transition, so this cannot double-emit.
create or replace function public.hr_open_performance_cycle(
  p_tenant uuid, p_cycle uuid, p_actor uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_scope text; v_unit uuid; v_position uuid; v_created int := 0;
begin
  select status, target_scope, target_org_unit_id, target_position_id
    into v_status, v_scope, v_unit, v_position
    from public.hr_performance_cycle where id = p_cycle and tenant_id = p_tenant for update;
  if not found then raise exception 'cycle introuvable' using errcode = 'HR608'; end if;
  if v_status <> 'DRAFT' then
    raise exception 'seul un cycle en brouillon peut être ouvert' using errcode = 'HR609';
  end if;

  update public.hr_performance_cycle set status = 'OPEN' where id = p_cycle;

  -- The target population, resolved from CURRENT open PRIMARY assignments.
  with target as (
    select e.id as employee_id, a.manager_employee_id
      from public.employee e
      left join public.employee_assignment a
        on a.employee_id = e.id and a.effective_to is null and a.assignment_kind = 'PRIMARY'
     where e.tenant_id = p_tenant
       and e.status = 'ACTIVE'
       and (v_scope = 'ALL_ACTIVE'
            or (v_scope = 'ORG_UNIT' and a.org_unit_id = v_unit)
            or (v_scope = 'POSITION' and a.position_id = v_position))
  ), inserted as (
    insert into public.hr_evaluation (tenant_id, cycle_id, employee_id, manager_employee_id)
    select p_tenant, p_cycle, t.employee_id,
           -- Never record someone as their own manager.
           nullif(t.manager_employee_id, t.employee_id)
      from target t
    on conflict (cycle_id, employee_id) do nothing
    returning employee_id
  )
  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  select p_tenant, i.employee_id, 'performance_cycle_opened', p_actor,
         jsonb_build_object('cycle_id', p_cycle)
    from inserted i;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

-- Stage 1 → SELF_SUBMITTED.
create or replace function public.hr_submit_self_assessment(
  p_tenant uuid, p_evaluation uuid, p_actor uuid, p_comments text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_employee uuid; v_cycle_status text;
begin
  select e.status, e.employee_id, c.status into v_status, v_employee, v_cycle_status
    from public.hr_evaluation e
    join public.hr_performance_cycle c on c.id = e.cycle_id
   where e.id = p_evaluation and e.tenant_id = p_tenant for update of e;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_cycle_status not in ('OPEN','IN_REVIEW') then
    raise exception 'le cycle n''est pas ouvert' using errcode = 'HR611';
  end if;
  if v_status <> 'DRAFT' then
    raise exception 'auto-évaluation déjà soumise' using errcode = 'HR612';
  end if;

  update public.hr_evaluation
     set status = 'SELF_SUBMITTED', self_comments = p_comments,
         self_entered_by = p_actor, self_submitted_at = now()
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'self_assessment_submitted', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation));
  return p_evaluation;
end $$;

-- Stage 2 → MANAGER_SUBMITTED. The actor must differ from the self-assessment
-- actor: the CHECK would refuse it anyway, and refusing here names the reason.
create or replace function public.hr_submit_manager_review(
  p_tenant uuid, p_evaluation uuid, p_actor uuid,
  p_comments text, p_strengths text default null, p_development text default null,
  p_actions text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_employee uuid; v_self uuid;
begin
  select status, employee_id, self_entered_by into v_status, v_employee, v_self
    from public.hr_evaluation where id = p_evaluation and tenant_id = p_tenant for update;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_status <> 'SELF_SUBMITTED' then
    raise exception 'l''auto-évaluation doit être soumise d''abord' using errcode = 'HR613';
  end if;
  if v_self is not null and v_self = p_actor then
    raise exception 'séparation des acteurs : l''évaluateur doit différer de l''auto-évalué'
      using errcode = 'HR614';
  end if;

  update public.hr_evaluation
     set status = 'MANAGER_SUBMITTED', manager_comments = p_comments,
         manager_strengths = p_strengths, manager_development = p_development,
         recommended_actions = p_actions,
         manager_entered_by = p_actor, manager_submitted_at = now()
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'manager_review_submitted', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation));
  return p_evaluation;
end $$;

-- Stage 3 → FINALIZED. THE consequential act: it validates the weight total
-- (rule 3), locks every objective (rule 4), records the moderation and emits.
-- Gated in the application on hr:performance:finalize, which nobody holds.
create or replace function public.hr_finalize_evaluation(
  p_tenant uuid, p_evaluation uuid, p_actor uuid,
  p_moderation_note text default null, p_final_summary text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_cycle uuid; v_manager uuid;
  v_total_bp int; v_required_bp int; v_objectives int;
begin
  select e.status, e.employee_id, e.cycle_id, e.manager_entered_by, c.weight_total_bp
    into v_status, v_employee, v_cycle, v_manager, v_required_bp
    from public.hr_evaluation e
    join public.hr_performance_cycle c on c.id = e.cycle_id
   where e.id = p_evaluation and e.tenant_id = p_tenant for update of e;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_status <> 'MANAGER_SUBMITTED' then
    raise exception 'seule une évaluation revue par le manager peut être finalisée'
      using errcode = 'HR615';
  end if;
  if v_manager is not null and v_manager = p_actor then
    raise exception 'séparation des acteurs : le finalisateur doit différer de l''évaluateur'
      using errcode = 'HR616';
  end if;

  -- Rule 3 — weights are checked HERE, once, and only if objectives exist.
  select count(*), coalesce(sum(weight_bp), 0) into v_objectives, v_total_bp
    from public.hr_objective
   where tenant_id = p_tenant and cycle_id = v_cycle and employee_id = v_employee
     and status not in ('CANCELLED','SUPERSEDED');
  if v_objectives > 0 and v_total_bp <> v_required_bp then
    raise exception 'le total des pondérations est % bp, attendu % bp', v_total_bp, v_required_bp
      using errcode = 'HR617';
  end if;

  update public.hr_evaluation
     set status = 'FINALIZED', moderation_note = p_moderation_note,
         final_summary = p_final_summary, finalized_by = p_actor, finalized_at = now()
   where id = p_evaluation;

  update public.hr_objective set locked_at = now()
   where tenant_id = p_tenant and cycle_id = v_cycle and employee_id = v_employee
     and locked_at is null;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'performance_review_finalized', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation, 'cycle_id', v_cycle,
                             'objectives', v_objectives));
  return p_evaluation;
end $$;

-- Stage 4 → ACKNOWLEDGED. Receipt, never approval: the trigger guarantees this
-- call cannot alter one character of what the manager or HR wrote.
create or replace function public.hr_acknowledge_evaluation(
  p_tenant uuid, p_evaluation uuid, p_actor uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_employee uuid;
begin
  select status, employee_id into v_status, v_employee
    from public.hr_evaluation where id = p_evaluation and tenant_id = p_tenant for update;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_status <> 'FINALIZED' then
    raise exception 'seule une évaluation finalisée peut être accusée de réception'
      using errcode = 'HR618';
  end if;

  update public.hr_evaluation
     set status = 'ACKNOWLEDGED', acknowledged_by = p_actor,
         acknowledged_at = now(), acknowledgment_note = p_note
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'performance_review_acknowledged', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation));
  return p_evaluation;
end $$;

-- Assigning an objective is a domain write plus a timeline event — one call.
-- Draft EDITS deliberately do NOT emit (§12): only the assignment does.
create or replace function public.hr_assign_objective(
  p_tenant uuid, p_cycle uuid, p_employee uuid, p_actor uuid,
  p_title text, p_weight_bp int, p_description text default null,
  p_category text default null, p_target text default null, p_due date default null,
  p_supersedes uuid default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_cycle_status text; v_locked timestamptz;
begin
  if p_weight_bp is null or p_weight_bp < 0 or p_weight_bp > 10000 then
    raise exception 'pondération hors bornes (0..10000 bp)' using errcode = 'HR619';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'intitulé d''objectif obligatoire' using errcode = 'HR620';
  end if;
  select status into v_cycle_status from public.hr_performance_cycle
   where id = p_cycle and tenant_id = p_tenant;
  if not found then raise exception 'cycle introuvable' using errcode = 'HR608'; end if;
  if v_cycle_status not in ('DRAFT','OPEN','IN_REVIEW') then
    raise exception 'le cycle n''accepte plus d''objectifs' using errcode = 'HR621';
  end if;

  -- An amendment supersedes rather than rewrites (rule 4).
  if p_supersedes is not null then
    select locked_at into v_locked from public.hr_objective
     where id = p_supersedes and tenant_id = p_tenant for update;
    if not found then raise exception 'objectif à remplacer introuvable' using errcode = 'HR622'; end if;
    if v_locked is not null then
      raise exception 'un objectif finalisé ne peut pas être amendé' using errcode = 'HR605';
    end if;
    update public.hr_objective set status = 'SUPERSEDED' where id = p_supersedes;
  end if;

  insert into public.hr_objective (
    tenant_id, cycle_id, employee_id, title, description, category, weight_bp,
    measurable_target, due_date, status, version, supersedes_objective_id, created_by)
  values (
    p_tenant, p_cycle, p_employee, btrim(p_title), p_description, p_category, p_weight_bp,
    p_target, p_due, 'ACTIVE',
    coalesce((select version + 1 from public.hr_objective where id = p_supersedes), 1),
    p_supersedes, p_actor)
  returning id into v_id;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, p_employee, 'objective_assigned', p_actor,
          jsonb_build_object('objective_id', v_id, 'cycle_id', p_cycle,
                             'weight_bp', p_weight_bp, 'amendment', p_supersedes is not null));
  return v_id;
end $$;

revoke execute on function public.hr_open_performance_cycle(uuid,uuid,uuid) from public;
revoke execute on function public.hr_submit_self_assessment(uuid,uuid,uuid,text) from public;
revoke execute on function public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text) from public;
revoke execute on function public.hr_finalize_evaluation(uuid,uuid,uuid,text,text) from public;
revoke execute on function public.hr_acknowledge_evaluation(uuid,uuid,uuid,text) from public;
revoke execute on function public.hr_assign_objective(uuid,uuid,uuid,uuid,text,int,text,text,text,date,uuid) from public;
grant execute on function public.hr_open_performance_cycle(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_submit_self_assessment(uuid,uuid,uuid,text) to service_role;
grant execute on function public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.hr_finalize_evaluation(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.hr_acknowledge_evaluation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.hr_assign_objective(uuid,uuid,uuid,uuid,text,int,text,text,text,date,uuid) to service_role;

-- ===========================================================================
-- 8. RLS — the uniform HR idiom. Reads on hr:read; writes via service role
--    only. No portal policy (customers never read HR). SYSTEM_ADMIN holds no
--    hr:* (DEC-B25) and therefore sees zero rows here too.
--
--    C3 NOTE: evaluation CONTENT (comments, strengths, development areas) is
--    C3. The row-level gate is hr:read; the application withholds the C3 COLUMNS
--    unless the reader also holds hr:sensitive:read — the same two-tier shape
--    HR-3 uses for C3-classed documents. No hr:performance:read is invented.
-- ===========================================================================
alter table public.hr_performance_cycle       enable row level security;
alter table public.hr_competency              enable row level security;
alter table public.hr_competency_expectation  enable row level security;
alter table public.hr_evaluation              enable row level security;
alter table public.hr_objective               enable row level security;
alter table public.hr_competency_assessment   enable row level security;

drop policy if exists hr_performance_cycle_select on public.hr_performance_cycle;
create policy hr_performance_cycle_select on public.hr_performance_cycle
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_competency_select on public.hr_competency;
create policy hr_competency_select on public.hr_competency
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_competency_expectation_select on public.hr_competency_expectation;
create policy hr_competency_expectation_select on public.hr_competency_expectation
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_evaluation_select on public.hr_evaluation;
create policy hr_evaluation_select on public.hr_evaluation
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_objective_select on public.hr_objective;
create policy hr_objective_select on public.hr_objective
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_competency_assessment_select on public.hr_competency_assessment;
create policy hr_competency_assessment_select on public.hr_competency_assessment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_performance_cycle, public.hr_competency,
                public.hr_competency_expectation, public.hr_evaluation,
                public.hr_objective, public.hr_competency_assessment
  to authenticated;
