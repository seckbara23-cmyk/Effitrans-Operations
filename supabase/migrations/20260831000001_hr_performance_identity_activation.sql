-- 20260831000001_hr_performance_identity_activation.sql
-- Effitrans HR Platform — HR-B2: performance gains IDENTITY.
-- ---------------------------------------------------------------------------
-- ADDITIVE and idempotent. No table is created; one additive configuration
-- column; no RLS change — the RPCs are the boundary (the HR-A2 rule), and this
-- migration makes the six performance RPCs carry the authority they previously
-- delegated entirely to the application.
--
-- HR-6 built the whole machine and left one thing out, exactly as HR-5 did for
-- leave: identity. Every stage rode `hr:manage`, so an HR operator typed the
-- employee's self-assessment, a second operator typed the manager review, and
-- HR would have typed the employee's own acknowledgment. The manager recorded
-- on each evaluation — snapshotted from the open PRIMARY assignment when the
-- cycle opened — was never read as authorization. HR-B1 solved this shape for
-- leave (migration 108); this migration replays it on evaluations.
--
-- THE LANES (docs/hr/hr-b2-performance-audit.md §10, ratified):
--
--   SELF   — hr_submit_self_assessment, hr_acknowledge_evaluation: the actor
--            whose linked ACTIVE employee IS the evaluation's employee acts on
--            their own record. Their words, their receipt.
--   MANAGER— hr_submit_manager_review: the actor whose linked ACTIVE employee
--            IS the evaluation's SNAPSHOTTED manager_employee_id. The snapshot,
--            never a live re-derivation: an evaluation is reviewed by the
--            manager of record at cycle-open, so a later re-assignment cannot
--            hand a stranger someone's half-finished review, and a former
--            manager cannot reach back into a cycle they have left.
--   ORG    — everyone else falls through to assert_actor_authority (OPS-SEC-2A
--            / INV-7): hr:manage for the HR desk, hr:performance:finalize for
--            the consequential act. Verified IN THE DATABASE, not in UI logic.
--
-- FINALIZATION IS TWO-LANE: the manager of record may finalize their scope, or
-- an org-wide seat may. HR616 IS PRESERVED IN BOTH: whoever authored the
-- manager review can never finalize it — so a manager who reviewed their own
-- report needs Direction, which is precisely the reconciliation HR-1A
-- described. Nothing here weakens it.
--
-- IDENTITY GRANTS NOTHING BEYOND ITS OWN ROW. `employee.linked_app_user_id`
-- keeps granting no permission anywhere; here it PROVES WHO IS CALLING, and
-- the evaluation's own columns decide what that person may do. Cross-employee,
-- cross-manager and cross-tenant access stay refused (HR630 checks the actor
-- belongs to the tenant and is active before anything else happens).
--
-- ORG-WIDE SEATS: `hr:performance:finalize` → DGA and DAF, the Direction
-- roles, in all three sources. Deliberately NOT the CEO role: six broad
-- multi-role accounts hold it in production, and self-assertion 5c below
-- refuses to apply if that ever changes without ratification (HR-1A question
-- a). HR_OFFICER does not hold it either — preparing a review and freezing it
-- forever are different authorities.
--
-- NO BUSINESS CONTENT IS INVENTED. No competency, no scale, no rating, no
-- score, no cadence, no vocabulary value. The one new column is an EMPTY list.

-- ===========================================================================
-- 1. Cycle-kind vocabulary — the contract HR-6 promised ("validated app-side
--    against hr_configuration", the employment_kinds idiom) but never had a
--    column for. EMPTY BY DEFAULT: an empty list means the tenant has not
--    named its cycle kinds, and the application accepts any non-empty kind.
--    Naming them is Effitrans's decision, not this migration's.
-- ===========================================================================
alter table public.hr_configuration
  add column if not exists performance_cycle_kinds jsonb not null default '[]'::jsonb;

-- ===========================================================================
-- 2. Org-wide finalization seats: DGA + DAF. Explicit p.code (the seed.sql
--    rule). CEO deliberately absent — see the header and assertion 5c.
-- ===========================================================================
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'hr:performance:finalize'
where r.code in ('DGA', 'DAF')
on conflict do nothing;

-- ===========================================================================
-- 3. The six RPCs, re-created with actor integrity and the identity lanes.
--    Signatures are UNCHANGED — every existing caller keeps working.
--    Body comments deliberately absent (INV-3 scans definer sources).
-- ===========================================================================

create or replace function public.hr_open_performance_cycle(
  p_tenant uuid, p_cycle uuid, p_actor uuid)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_scope text; v_unit uuid; v_position uuid; v_created int := 0;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

  select status, target_scope, target_org_unit_id, target_position_id
    into v_status, v_scope, v_unit, v_position
    from public.hr_performance_cycle where id = p_cycle and tenant_id = p_tenant for update;
  if not found then raise exception 'cycle introuvable' using errcode = 'HR608'; end if;
  if v_status <> 'DRAFT' then
    raise exception 'seul un cycle en brouillon peut être ouvert' using errcode = 'HR609';
  end if;

  update public.hr_performance_cycle set status = 'OPEN' where id = p_cycle;

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

create or replace function public.hr_submit_self_assessment(
  p_tenant uuid, p_evaluation uuid, p_actor uuid, p_comments text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_cycle_status text; v_actor_emp uuid; v_is_self boolean := false;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;

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

  select e.id into v_actor_emp
    from public.employee e
   where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor and e.status = 'ACTIVE'
   limit 1;
  v_is_self := v_actor_emp is not null and v_actor_emp = v_employee;
  if not v_is_self then
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');
  end if;

  update public.hr_evaluation
     set status = 'SELF_SUBMITTED', self_comments = p_comments,
         self_entered_by = p_actor, self_submitted_at = now()
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'self_assessment_submitted', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation, 'by_employee', v_is_self));
  return p_evaluation;
end $$;

create or replace function public.hr_submit_manager_review(
  p_tenant uuid, p_evaluation uuid, p_actor uuid,
  p_comments text, p_strengths text default null, p_development text default null,
  p_actions text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_self uuid; v_manager_emp uuid;
  v_actor_emp uuid; v_is_manager boolean := false;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;

  select status, employee_id, self_entered_by, manager_employee_id
    into v_status, v_employee, v_self, v_manager_emp
    from public.hr_evaluation where id = p_evaluation and tenant_id = p_tenant for update;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_status <> 'SELF_SUBMITTED' then
    raise exception 'l''auto-évaluation doit être soumise d''abord' using errcode = 'HR613';
  end if;
  if v_self is not null and v_self = p_actor then
    raise exception 'séparation des acteurs : l''évaluateur doit différer de l''auto-évalué'
      using errcode = 'HR614';
  end if;

  select e.id into v_actor_emp
    from public.employee e
   where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor and e.status = 'ACTIVE'
   limit 1;
  if v_actor_emp is not null and v_actor_emp = v_employee then
    raise exception 'un évaluateur ne revoit jamais sa propre évaluation' using errcode = 'HR631';
  end if;
  v_is_manager := v_actor_emp is not null and v_manager_emp is not null and v_actor_emp = v_manager_emp;
  if not v_is_manager then
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');
  end if;

  update public.hr_evaluation
     set status = 'MANAGER_SUBMITTED', manager_comments = p_comments,
         manager_strengths = p_strengths, manager_development = p_development,
         recommended_actions = p_actions,
         manager_entered_by = p_actor, manager_submitted_at = now()
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'manager_review_submitted', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation, 'by_manager_of_record', v_is_manager));
  return p_evaluation;
end $$;

create or replace function public.hr_finalize_evaluation(
  p_tenant uuid, p_evaluation uuid, p_actor uuid,
  p_moderation_note text default null, p_final_summary text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_cycle uuid; v_manager uuid; v_manager_emp uuid;
  v_total_bp int; v_required_bp int; v_objectives int;
  v_actor_emp uuid; v_is_manager boolean := false;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;

  select e.status, e.employee_id, e.cycle_id, e.manager_entered_by, e.manager_employee_id,
         c.weight_total_bp
    into v_status, v_employee, v_cycle, v_manager, v_manager_emp, v_required_bp
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

  select e.id into v_actor_emp
    from public.employee e
   where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor and e.status = 'ACTIVE'
   limit 1;
  if v_actor_emp is not null and v_actor_emp = v_employee then
    raise exception 'un finalisateur ne finalise jamais sa propre évaluation' using errcode = 'HR631';
  end if;
  v_is_manager := v_actor_emp is not null and v_manager_emp is not null and v_actor_emp = v_manager_emp;
  if not v_is_manager then
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:performance:finalize', 'SERVICE');
  end if;

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
                             'objectives', v_objectives, 'by_manager_of_record', v_is_manager));
  return p_evaluation;
end $$;

create or replace function public.hr_acknowledge_evaluation(
  p_tenant uuid, p_evaluation uuid, p_actor uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_status text; v_employee uuid; v_actor_emp uuid; v_is_self boolean := false;
begin
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;

  select status, employee_id into v_status, v_employee
    from public.hr_evaluation where id = p_evaluation and tenant_id = p_tenant for update;
  if not found then raise exception 'évaluation introuvable' using errcode = 'HR610'; end if;
  if v_status <> 'FINALIZED' then
    raise exception 'seule une évaluation finalisée peut être accusée de réception'
      using errcode = 'HR618';
  end if;

  select e.id into v_actor_emp
    from public.employee e
   where e.tenant_id = p_tenant and e.linked_app_user_id = p_actor and e.status = 'ACTIVE'
   limit 1;
  v_is_self := v_actor_emp is not null and v_actor_emp = v_employee;
  if not v_is_self then
    perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');
  end if;

  update public.hr_evaluation
     set status = 'ACKNOWLEDGED', acknowledged_by = p_actor,
         acknowledged_at = now(), acknowledgment_note = p_note
   where id = p_evaluation;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'performance_review_acknowledged', p_actor,
          jsonb_build_object('evaluation_id', p_evaluation, 'by_employee', v_is_self));
  return p_evaluation;
end $$;

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
  if not exists (
    select 1 from public.app_user u
     where u.id = p_actor and u.tenant_id = p_tenant and u.status = 'active') then
    raise exception 'acteur inconnu, inactif ou hors organisation' using errcode = 'HR630';
  end if;
  perform public.assert_actor_authority(p_actor, p_tenant, 'hr:manage', 'SERVICE');

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

-- ===========================================================================
-- 4. Transport contract — unchanged and re-asserted: service_role only.
-- ===========================================================================
revoke execute on function public.hr_open_performance_cycle(uuid,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.hr_submit_self_assessment(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.hr_finalize_evaluation(uuid,uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.hr_acknowledge_evaluation(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke execute on function public.hr_assign_objective(uuid,uuid,uuid,uuid,text,int,text,text,text,date,uuid) from public, anon, authenticated;
grant execute on function public.hr_open_performance_cycle(uuid,uuid,uuid) to service_role;
grant execute on function public.hr_submit_self_assessment(uuid,uuid,uuid,text) to service_role;
grant execute on function public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.hr_finalize_evaluation(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.hr_acknowledge_evaluation(uuid,uuid,uuid,text) to service_role;
grant execute on function public.hr_assign_objective(uuid,uuid,uuid,uuid,text,int,text,text,text,date,uuid) to service_role;

-- ===========================================================================
-- 5. Self-assertions — the migration proves its own claims. prosrc INCLUDES
--    comments, so every source scan strips them first (the P1.1 lesson).
-- ===========================================================================
do $$
declare v_count int; v_src text; v_fn text; v_args int;
begin
  -- 5a. Direction holds the finalization seat (0 roles → vacuously true).
  select count(*) into v_count
  from public.role r
  where r.code in ('DGA','DAF')
    and not exists (
      select 1 from public.role_permission rp
      join public.permission p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'hr:performance:finalize');
  if v_count <> 0 then
    raise exception 'HR-B2: % Direction role(s) missing hr:performance:finalize', v_count;
  end if;

  -- 5b. HR_OFFICER does not hold it: preparing a review and freezing it
  --     forever are different authorities.
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'HR_OFFICER' and p.code = 'hr:performance:finalize';
  if v_count <> 0 then
    raise exception 'HR-B2: HR_OFFICER must not hold hr:performance:finalize';
  end if;

  -- 5c. THE GOVERNANCE BOUNDARY: CEO stays ungranted until Effitrans answers
  --     HR-1A question (a). Widening this is a decision, never drift.
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'CEO' and p.code = 'hr:performance:finalize';
  if v_count <> 0 then
    raise exception 'HR-B2: CEO must not hold hr:performance:finalize without explicit ratification';
  end if;

  -- 5d. hr:sensitive:read is NOT broadened by this phase. Identity-scoped C3
  --     disclosure (Q2) is a read-layer rule about YOUR OWN row; the org-wide
  --     sensitive permission keeps its own, separate, still-ungranted life.
  select count(*) into v_count
  from public.role_permission rp
  join public.permission p on p.id = rp.permission_id
  where p.code = 'hr:sensitive:read';
  if v_count <> 0 then
    raise exception 'HR-B2: hr:sensitive:read must not be granted by the identity phase';
  end if;

  -- 5e. SYSTEM_ADMIN still holds NO hr:* (DEC-B25).
  select count(*) into v_count
  from public.role_permission rp
  join public.role r on r.id = rp.role_id
  join public.permission p on p.id = rp.permission_id
  where r.code = 'SYSTEM_ADMIN' and p.code like 'hr:%';
  if v_count <> 0 then
    raise exception 'HR-B2: SYSTEM_ADMIN must hold no hr:* permission';
  end if;

  -- 5f. EVERY performance RPC verifies its actor (HR630) — no exceptions.
  for v_fn, v_args in
    select * from (values
      ('hr_open_performance_cycle', 3), ('hr_submit_self_assessment', 4),
      ('hr_submit_manager_review', 7), ('hr_finalize_evaluation', 5),
      ('hr_acknowledge_evaluation', 4), ('hr_assign_objective', 11)
    ) as t(fn, n)
  loop
    select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
    from pg_proc p where p.proname = v_fn and p.pronargs = v_args;
    if v_src is null then
      raise exception 'HR-B2: % (% args) must exist', v_fn, v_args;
    end if;
    if v_src !~ 'HR630' or v_src !~ 'assert_actor_authority' then
      raise exception 'HR-B2: % must verify its actor and assert authority', v_fn;
    end if;
  end loop;

  -- 5g. The identity lanes read the SNAPSHOT and the account link, and the
  --     finalizer separation (HR616) survives the rewrite.
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_submit_manager_review' and p.pronargs = 7;
  if v_src !~ 'manager_employee_id' or v_src !~ 'linked_app_user_id' then
    raise exception 'HR-B2: the manager lane must read the snapshot and the account link';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_finalize_evaluation' and p.pronargs = 5;
  if v_src !~ 'HR616' or v_src !~ 'hr:performance:finalize' or v_src !~ 'manager_employee_id' then
    raise exception 'HR-B2: finalization must keep HR616 and carry both lanes';
  end if;
  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_src
  from pg_proc p where p.proname = 'hr_submit_self_assessment' and p.pronargs = 4;
  if v_src !~ 'linked_app_user_id' then
    raise exception 'HR-B2: the self lane must read the account link';
  end if;

  -- 5h. Transport: no browser role may execute a performance RPC.
  if has_function_privilege('anon', 'public.hr_finalize_evaluation(uuid,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_finalize_evaluation(uuid,uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_submit_manager_review(uuid,uuid,uuid,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.hr_submit_self_assessment(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'HR-B2: performance RPCs must be service_role transport only';
  end if;

  -- 5i. The cycle-kind vocabulary column exists and names nothing.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'hr_configuration'
       and column_name = 'performance_cycle_kinds') then
    raise exception 'HR-B2: performance_cycle_kinds must exist on hr_configuration';
  end if;
  select count(*) into v_count from public.hr_configuration
   where jsonb_array_length(performance_cycle_kinds) > 0;
  if v_count <> 0 then
    raise exception 'HR-B2: no cycle-kind vocabulary may be seeded by a migration';
  end if;
end $$;
