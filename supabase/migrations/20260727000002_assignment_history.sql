-- 20260727000002_assignment_history.sql
-- Effitrans Operations Platform — PHASE WES-3A: append-only assignment ledger.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Implements the frozen doctrine:
--
--     Departments own dossiers.  People own tasks.  Drivers own missions.
--
-- Every assignment and reassignment becomes an append-only, auditable fact, and
-- the mutation that causes it commits WITH it or not at all.
--
-- ===========================================================================
-- TRANSACTIONALITY (WES-9A doctrine, applied)
-- ===========================================================================
-- WES-9A settled this for the platform: the domain mutation and its mandatory
-- record succeed or fail together, and best-effort writes are forbidden. The
-- supabase-js client cannot hold a multi-statement transaction, so
-- "update the assignee, then insert history" is a dual write and is prohibited.
--
-- Assignment is therefore performed by RPCs — `assign_task`, `assign_step`,
-- `assign_operational_owner` — each a security-definer function that performs
-- the assignment write, appends the history row, and emits the business event
-- in ONE transaction. The application never writes an assignee column directly
-- for these subjects.
--
-- RPC rather than trigger, unlike WES-9's domain events, because assignment
-- carries envelope data that is NOT derivable from the row: the actor, the
-- reason, the workflow step key and the policy version the decision was made
-- under. A trigger would have to invent them. WES-0A's mechanism 1 says exactly
-- this: "receiving actor, correlation, causation and policy version as
-- parameters ... otherwise mechanism 1."
--
-- ===========================================================================
-- 1. assignment_event — the ledger.
--
--    Like business_event, references are PLAIN UUIDs, not foreign keys, for
--    every subject that cascades from operational_file (`task`,
--    `process_step_execution`). History must survive the deletion of the thing
--    it describes; a cascade would erase exactly the record needed to explain
--    what happened.
-- ===========================================================================
create table public.assignment_event (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),

  -- The dossier this assignment belongs to. Plain uuid: operational_file is the
  -- root every subject cascades from.
  file_id           uuid,

  subject_type      text not null check (subject_type in (
                      'COMMERCIAL_OWNER', 'OPERATIONAL_OWNER', 'STEP', 'TASK')),
  -- The task / step-execution / process-instance / dossier the assignment is on.
  subject_id        uuid not null,

  -- NULL previous = initial assignment. NULL new = unassignment, permitted only
  -- where the business contract allows it (tasks and steps; never an owner).
  previous_user_id  uuid references public.app_user (id),
  new_user_id       uuid references public.app_user (id),

  actor_user_id     uuid references public.app_user (id),

  -- Free text, and it stays HERE. WES-9A ratified that unrestricted free text
  -- never reaches business_event; the event carries a structured reason CODE
  -- and this row's id as a safe reference.
  reason            text,
  -- Structured, safe to copy into the immutable event.
  reason_code       text check (reason_code in (
                      'INITIAL', 'REASSIGNMENT', 'SUPERVISOR_INTERVENTION',
                      'WORKLOAD_BALANCING', 'ABSENCE', 'ESCALATION',
                      'CORRECTION', 'UNASSIGNMENT', 'GOVERNANCE')),

  -- Where in the workflow the decision was taken.
  workflow_step_key text,
  -- Which pinned WES-7 policy governed eligibility at that moment.
  policy_version_id uuid references public.workflow_policy_version (id),

  -- Honest provenance. LEGACY_IMPORT marks a row derived from a pre-WES-3
  -- column rather than observed; nothing is ever back-dated as if witnessed.
  provenance        text not null default 'OBSERVED'
                      check (provenance in ('OBSERVED', 'LEGACY_IMPORT')),

  created_at        timestamptz not null default now()
);

create index idx_assignment_event_file
  on public.assignment_event (file_id, created_at desc) where file_id is not null;
create index idx_assignment_event_subject
  on public.assignment_event (subject_type, subject_id, created_at desc);
create index idx_assignment_event_tenant
  on public.assignment_event (tenant_id, created_at desc);
create index idx_assignment_event_new_user
  on public.assignment_event (new_user_id) where new_user_id is not null;

comment on table public.assignment_event is
  'WES-3A append-only assignment history. Written ONLY by the assign_* RPCs, in the '
  'same transaction as the assignment itself. Never updated, never deleted.';

-- ===========================================================================
-- 2. Immutability — append-only for EVERY role, service role included.
-- ===========================================================================
create trigger trg_assignment_event_no_update
  before update on public.assignment_event
  for each row execute function public.prevent_mutation();

create trigger trg_assignment_event_no_delete
  before delete on public.assignment_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 3. Integrity guards the application cannot bypass.
-- ===========================================================================
create or replace function public.check_assignment_event()
returns trigger
language plpgsql
as $$
declare
  v_tenant uuid;
begin
  -- An owner may be reassigned but never left vacant.
  if new.subject_type in ('COMMERCIAL_OWNER', 'OPERATIONAL_OWNER')
     and new.new_user_id is null then
    raise exception 'assignment_event: % cannot be unassigned', new.subject_type;
  end if;

  -- A real change, or an initial assignment. Recording a no-op as history is
  -- noise that makes the ledger less readable, not more complete.
  if new.previous_user_id is not distinct from new.new_user_id then
    raise exception 'assignment_event: previous and new assignee are identical';
  end if;

  -- Cross-tenant assignment is impossible, not merely discouraged.
  if new.new_user_id is not null then
    select tenant_id into v_tenant from public.app_user where id = new.new_user_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'assignment_event: assignee belongs to another tenant';
    end if;
  end if;
  if new.actor_user_id is not null then
    select tenant_id into v_tenant from public.app_user where id = new.actor_user_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'assignment_event: actor belongs to another tenant';
    end if;
  end if;

  -- A supervisor/governance decision must say why. Enforced in the DATABASE so
  -- no future caller can skip it.
  if new.reason_code in ('SUPERVISOR_INTERVENTION', 'GOVERNANCE')
     and (new.reason is null or btrim(new.reason) = '') then
    raise exception 'assignment_event: a reason is required for %', new.reason_code;
  end if;

  return new;
end;
$$;

create trigger trg_assignment_event_check
  before insert on public.assignment_event
  for each row execute function public.check_assignment_event();

-- ===========================================================================
-- 4. RLS — SELECT only, tenant-scoped, following DOSSIER visibility.
--
--    Assignment history is dossier history: whoever may read the dossier may
--    read who worked on it. No second, weaker rule is introduced. Rows with no
--    dossier (owner assignments recorded before a file exists) require the
--    governance permission.
-- ===========================================================================
alter table public.assignment_event enable row level security;

create policy assignment_event_select on public.assignment_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      (file_id is not null and public.can_read_file(file_id))
      or (file_id is null and public.has_permission('admin:config:manage'))
    )
  );

grant select on public.assignment_event to authenticated;

-- ===========================================================================
-- 5. assign_task — atomic assignment + history + business event.
--
--    ELIGIBILITY IS NOT CHECKED HERE. Policy-based eligibility (seat bindings
--    from the pinned WES-7 policy) is resolved in TypeScript, where the policy
--    document lives; duplicating it in SQL would create the second source of
--    truth WES-7 spent a phase removing. What SQL enforces is what SQL can
--    enforce absolutely: tenancy, existence, activity, and the no-op guard.
-- ===========================================================================
create or replace function public.assign_task(
  p_task_id      uuid,
  p_new_user_id  uuid,
  p_actor        uuid,
  p_reason_code  text,
  p_reason       text default null,
  p_step_key     text default null,
  p_policy_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_previous uuid;
  v_status   text;
  v_active   text;
  v_history  uuid;
begin
  select tenant_id, file_id, assigned_to, status
    into v_tenant, v_file, v_previous, v_status
    from public.task where id = p_task_id for update;
  if not found then raise exception 'task not found'; end if;

  if v_status in ('DONE', 'CANCELLED') then
    raise exception 'a % task cannot be reassigned', v_status;
  end if;

  if v_previous is not distinct from p_new_user_id then
    raise exception 'assignee unchanged';
  end if;

  if p_new_user_id is not null then
    select status into v_active from public.app_user
     where id = p_new_user_id and tenant_id = v_tenant;
    if not found then raise exception 'assignee is not a member of this tenant'; end if;
    if v_active <> 'active' then raise exception 'assignee is not active'; end if;
  end if;

  update public.task set assigned_to = p_new_user_id where id = p_task_id;

  insert into public.assignment_event (
    tenant_id, file_id, subject_type, subject_id,
    previous_user_id, new_user_id, actor_user_id,
    reason, reason_code, workflow_step_key, policy_version_id)
  values (
    v_tenant, v_file, 'TASK', p_task_id,
    v_previous, p_new_user_id, p_actor,
    nullif(btrim(coalesce(p_reason, '')), ''), p_reason_code, p_step_key, p_policy_id)
  returning id into v_history;

  -- WES-3I: the business event, in the SAME transaction. Metadata carries the
  -- structured code and the history row id as a safe reference — never the
  -- free-text reason (WES-9A / DEC-B75).
  perform public.emit_business_event(
    v_tenant,
    case
      when v_previous is null and p_new_user_id is not null then 'TASK_ASSIGNED'
      when p_new_user_id is null then 'TASK_UNASSIGNED'
      else 'TASK_REASSIGNED'
    end,
    'task', 'assignment_rpc', 'task', p_task_id, v_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'reason_code', p_reason_code,
      'assignment_event_id', v_history::text,
      'workflow_step_key', p_step_key)));

  return jsonb_build_object(
    'task_id', p_task_id, 'file_id', v_file,
    'previous_user_id', v_previous, 'new_user_id', p_new_user_id,
    'assignment_event_id', v_history);
end; $$;

revoke execute on function public.assign_task(uuid, uuid, uuid, text, text, text, uuid) from public;
grant execute on function public.assign_task(uuid, uuid, uuid, text, text, text, uuid) to service_role;

-- ===========================================================================
-- 6. assign_process_step — same contract for a step execution.
-- ===========================================================================
create or replace function public.assign_process_step(
  p_execution_id uuid,
  p_new_user_id  uuid,
  p_actor        uuid,
  p_reason_code  text,
  p_reason       text default null,
  p_policy_id    uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_previous uuid;
  v_step     text;
  v_active   text;
  v_history  uuid;
begin
  select e.tenant_id, e.assigned_user_id, e.step_key, i.file_id
    into v_tenant, v_previous, v_step, v_file
    from public.process_step_execution e
    join public.process_instance i on i.id = e.process_instance_id
   where e.id = p_execution_id
   for update of e;
  if not found then raise exception 'step execution not found'; end if;

  if v_previous is not distinct from p_new_user_id then
    raise exception 'assignee unchanged';
  end if;

  if p_new_user_id is not null then
    select status into v_active from public.app_user
     where id = p_new_user_id and tenant_id = v_tenant;
    if not found then raise exception 'assignee is not a member of this tenant'; end if;
    if v_active <> 'active' then raise exception 'assignee is not active'; end if;
  end if;

  update public.process_step_execution
     set assigned_user_id = p_new_user_id
   where id = p_execution_id;

  insert into public.assignment_event (
    tenant_id, file_id, subject_type, subject_id,
    previous_user_id, new_user_id, actor_user_id,
    reason, reason_code, workflow_step_key, policy_version_id)
  values (
    v_tenant, v_file, 'STEP', p_execution_id,
    v_previous, p_new_user_id, p_actor,
    nullif(btrim(coalesce(p_reason, '')), ''), p_reason_code, v_step, p_policy_id)
  returning id into v_history;

  perform public.emit_business_event(
    v_tenant,
    case when v_previous is null then 'STEP_ASSIGNED' else 'STEP_REASSIGNED' end,
    'task', 'assignment_rpc', 'process_step_execution', p_execution_id, v_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'reason_code', p_reason_code,
      'assignment_event_id', v_history::text,
      'workflow_step_key', v_step)));

  return jsonb_build_object(
    'execution_id', p_execution_id, 'file_id', v_file,
    'previous_user_id', v_previous, 'new_user_id', p_new_user_id,
    'assignment_event_id', v_history);
end; $$;

revoke execute on function public.assign_process_step(uuid, uuid, uuid, text, text, uuid) from public;
grant execute on function public.assign_process_step(uuid, uuid, uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- 7. assign_operational_owner — the canonical owner, never vacated.
-- ===========================================================================
create or replace function public.assign_operational_owner(
  p_instance_id uuid,
  p_new_user_id uuid,
  p_actor       uuid,
  p_reason_code text,
  p_reason      text default null,
  p_policy_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_previous uuid;
  v_active   text;
  v_history  uuid;
begin
  if p_new_user_id is null then
    raise exception 'the operational owner cannot be unassigned';
  end if;

  select tenant_id, file_id, owner_user_id
    into v_tenant, v_file, v_previous
    from public.process_instance where id = p_instance_id for update;
  if not found then raise exception 'process instance not found'; end if;

  if v_previous is not distinct from p_new_user_id then
    raise exception 'owner unchanged';
  end if;

  select status into v_active from public.app_user
   where id = p_new_user_id and tenant_id = v_tenant;
  if not found then raise exception 'owner is not a member of this tenant'; end if;
  if v_active <> 'active' then raise exception 'owner is not active'; end if;

  update public.process_instance
     set owner_user_id = p_new_user_id
   where id = p_instance_id;

  insert into public.assignment_event (
    tenant_id, file_id, subject_type, subject_id,
    previous_user_id, new_user_id, actor_user_id,
    reason, reason_code, policy_version_id)
  values (
    v_tenant, v_file, 'OPERATIONAL_OWNER', p_instance_id,
    v_previous, p_new_user_id, p_actor,
    nullif(btrim(coalesce(p_reason, '')), ''), p_reason_code, p_policy_id)
  returning id into v_history;

  perform public.emit_business_event(
    v_tenant,
    case when v_previous is null then 'OPERATIONAL_OWNER_ASSIGNED'
         else 'OPERATIONAL_OWNER_REASSIGNED' end,
    'dossier', 'assignment_rpc', 'process_instance', p_instance_id, v_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'reason_code', p_reason_code,
      'assignment_event_id', v_history::text)));

  return jsonb_build_object(
    'instance_id', p_instance_id, 'file_id', v_file,
    'previous_user_id', v_previous, 'new_user_id', p_new_user_id,
    'assignment_event_id', v_history);
end; $$;

revoke execute on function public.assign_operational_owner(uuid, uuid, uuid, text, text, uuid) from public;
grant execute on function public.assign_operational_owner(uuid, uuid, uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- 8. business_event source vocabulary — add 'assignment_rpc'.
--
--    The WES-9 CHECK listed three sources. Assignment events come from a fourth
--    mechanism and must say so honestly rather than borrow 'policy_rpc'.
-- ===========================================================================
alter table public.business_event drop constraint if exists business_event_source_check;
alter table public.business_event
  add constraint business_event_source_check
  check (source in ('db_trigger', 'policy_rpc', 'app_action', 'assignment_rpc'));

-- ===========================================================================
-- 9. WES-3E — the visibility contract, realigned to the canonical model.
--
--    BEFORE (20260709000001): file:read:all · account_manager_id ·
--    coordinator_id · assigned_to_user_id · created_by · an open assigned task.
--
--    That set is why reassigning a task could make a dossier disappear: the only
--    non-owner route in was a task assignment, so moving the task moved the
--    visibility with it. It also omitted the canonical operational owner and
--    every step assignee entirely.
--
--    AFTER: ownership + department responsibility + current work assignment.
--    `assigned_to_user_id` is REMOVED as a visibility source (WES-3F) — the
--    column survives for compatibility but no longer grants sight of anything.
--
--    Department membership is expressed as ROLES, not a department column:
--    9.0A ratified that department is derived from roles and is never itself
--    authorization. A user sees dossiers their department is responsible for
--    because they hold one of that department's roles.
-- ===========================================================================
create or replace function public.user_readable_file_ids(p_user uuid, p_tenant uuid)
returns table(id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select f.id
  from public.operational_file f
  where f.tenant_id = p_tenant
    and (
      -- explicit governance permission
      exists (select 1 from public.get_user_permissions(p_user) gp where gp.code = 'file:read:all')
      -- commercial ownership
      or f.account_manager_id = p_user
      or f.coordinator_id = p_user
      or f.created_by = p_user
      -- CANONICAL operational ownership (WES-3G) — previously missing
      or exists (
        select 1 from public.process_instance pi
         where pi.file_id = f.id and pi.owner_user_id = p_user)
      -- current work assignment: task …
      or exists (
        select 1 from public.task t
         where t.file_id = f.id and t.assigned_to = p_user)
      -- … or step execution (WES-3B) — previously missing
      or exists (
        select 1 from public.process_step_execution e
          join public.process_instance pi on pi.id = e.process_instance_id
         where pi.file_id = f.id and e.assigned_user_id = p_user)
      -- BOUNDED historical relationship: this user was verifiably assigned work
      -- on this dossier before. Read from the append-only ledger, so it cannot
      -- be claimed by merely holding a role.
      or exists (
        select 1 from public.assignment_event ae
         where ae.file_id = f.id
           and (ae.new_user_id = p_user or ae.previous_user_id = p_user))
    );
$$;

grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated, service_role;

comment on function public.user_readable_file_ids(uuid, uuid) is
  'WES-3E. Ownership + assignment + bounded assignment history. '
  'operational_file.assigned_to_user_id is DELIBERATELY ABSENT: it is retired as a '
  'visibility source (WES-3F). Department-responsibility visibility is applied in the '
  'server resolver (lib/workflow/access), which is projection-aware; this function is '
  'the coarse row filter, never the whole contract.';
