-- RLS regression test — assignment history & visibility (WES-3). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the guarantees that must hold in the DATABASE, not merely in the resolver:
--
--   ASSIGNMENT HISTORY (WES-3A)
--   * initial assignment creates exactly ONE history row                        -> 1
--   * reassignment creates a SECOND row, the first unchanged                    -> 2
--   * unassignment is recorded                                                  -> 1
--   * UPDATE on a history row raises                                            -> raises
--   * DELETE on a history row raises                                            -> raises
--   * a cross-tenant assignee is refused                                        -> raises
--   * a supervisor/governance decision without a reason is refused              -> raises
--   * a no-op assignment is refused                                             -> raises
--   * an operational owner cannot be unassigned                                 -> raises
--
--   ATOMICITY (WES-3A / WES-9A doctrine)
--   * assignment + history + business event commit together                     -> 1/1/1
--   * a FAILED event rolls the assignment back entirely                          -> 0 and unchanged
--   * a retry of the same assignee appends no duplicate                          -> equal
--
--   VISIBILITY (WES-3E / WES-3F)
--   * the canonical operational owner can read the dossier                       -> 1
--   * a step assignee can read the dossier                                       -> 1
--   * assigned_to_user_id ALONE no longer grants visibility                      -> 0
--   * task reassignment does NOT remove the previous holder's visibility         -> 1
--   * a bounded historical contributor retains read access                       -> 1
--   * an unrelated tenant-B user sees nothing                                    -> 0
--   * a portal user sees no assignment history                                   -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000f1', 'Test Tenant W3', 'SN')
on conflict (id) do nothing;

insert into public.role (tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000000f1', 'SYSTEM_ADMIN', 'Administrateur', 'Administrator', true)
on conflict (tenant_id, code) do nothing;

-- A1 = tenant-A operational owner (no file:read:all — ownership must be enough)
-- A2 = tenant-A step assignee
-- A3 = tenant-A legacy assigned_to_user_id holder ONLY (must see nothing)
-- A4 = tenant-A task holder who is then reassigned away
-- A5 = tenant-A colleague who receives the task
-- B1 = tenant-W3 user (cross-tenant probe)
-- P1 = tenant-A portal user
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'w3-a1@test.local'),
  ('00000000-0000-0000-0000-00000000a002', 'w3-a2@test.local'),
  ('00000000-0000-0000-0000-00000000a003', 'w3-a3@test.local'),
  ('00000000-0000-0000-0000-00000000a004', 'w3-a4@test.local'),
  ('00000000-0000-0000-0000-00000000a005', 'w3-a5@test.local'),
  ('00000000-0000-0000-0000-00000000b001', 'w3-b1@test.local'),
  ('00000000-0000-0000-0000-00000000p001', 'w3-p1@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001', 'w3-a1@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001', 'w3-a2@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-000000000001', 'w3-a3@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-000000000001', 'w3-a4@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000a005', '00000000-0000-0000-0000-000000000001', 'w3-a5@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-0000000000f1', 'w3-b1@test.local', 'active')
on conflict (id) do nothing;

-- Every tenant-A probe holds DOCUMENTATION_OFFICER: plain `file:read`, NOT
-- `file:read:all`. The operational_file policy is
-- `file:read AND can_read_file(id)`, so without a role every count below would
-- be 0 for the wrong reason — and A3's 0 in particular has to prove the LEGACY
-- COLUMN grants nothing, not that A3 lacks permission.
insert into public.user_role (user_id, role_id, tenant_id)
select u.id, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000a001'::uuid),
  ('00000000-0000-0000-0000-00000000a002'::uuid),
  ('00000000-0000-0000-0000-00000000a003'::uuid),
  ('00000000-0000-0000-0000-00000000a004'::uuid),
  ('00000000-0000-0000-0000-00000000a005'::uuid)
) as u(id)
join public.role r
  on r.code = 'DOCUMENTATION_OFFICER'
 and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-000000000001', 'W3 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000p001', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000000ca', 'w3-p1@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  hist_initial int; hist_after_reassign int; hist_unassign int;
  first_row_unchanged int;
  update_rejected int := 0; delete_rejected int := 0;
  cross_tenant_rejected int := 0; reason_required_rejected int := 0;
  noop_rejected int := 0; owner_unassign_rejected int := 0;
  atomic_task int; atomic_hist int; atomic_event int;
  rollback_assignee uuid; rollback_hist int;
  retry_before int; retry_after int;
  owner_sees int; step_sees int; legacy_only_sees int;
  previous_holder_sees int; b1_sees int; p1_sees_history int;
  v_file uuid := '00000000-0000-0000-0000-00000000f110';
  v_file2 uuid := '00000000-0000-0000-0000-00000000f120';
  v_task uuid := '00000000-0000-0000-0000-00000000f210';
  v_inst uuid := '00000000-0000-0000-0000-00000000f310';
  v_exec uuid := '00000000-0000-0000-0000-00000000f410';
  v_first uuid;
begin
  perform set_config('role', 'postgres', true);

  -- Dossier 1: owner + step assignee + task.
  insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
  values (v_file, '00000000-0000-0000-0000-000000000001', 'W3-TEST-0001', 'IMP',
          '00000000-0000-0000-0000-0000000000ca', 'IN_PROGRESS');

  insert into public.process_instance (id, tenant_id, file_id, owner_user_id)
  values (v_inst, '00000000-0000-0000-0000-000000000001', v_file, null);

  insert into public.process_step_execution (id, tenant_id, process_instance_id, step_key, state)
  values (v_exec, '00000000-0000-0000-0000-000000000001', v_inst, 'T1', 'ACTIVE');

  insert into public.task (id, tenant_id, file_id, title, status)
  values (v_task, '00000000-0000-0000-0000-000000000001', v_file, 'W3 task', 'TODO');

  -- ------------------------------------------------- history: initial + reassign
  perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a004',
                             '00000000-0000-0000-0000-00000000a001', 'INITIAL');
  select count(*) into hist_initial from public.assignment_event
   where subject_type = 'TASK' and subject_id = v_task;

  select id into v_first from public.assignment_event
   where subject_id = v_task and previous_user_id is null;

  perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a005',
                             '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  select count(*) into hist_after_reassign from public.assignment_event
   where subject_type = 'TASK' and subject_id = v_task;

  -- The FIRST row still says what it always said.
  select count(*) into first_row_unchanged from public.assignment_event
   where id = v_first
     and previous_user_id is null
     and new_user_id = '00000000-0000-0000-0000-00000000a004';

  -- ------------------------------------------------------------- immutability
  begin
    update public.assignment_event set new_user_id = null where id = v_first;
  exception when others then update_rejected := 1;
  end;
  begin
    delete from public.assignment_event where id = v_first;
  exception when others then delete_rejected := 1;
  end;

  -- --------------------------------------------------------------- guardrails
  begin
    perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000b001',
                               '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  exception when others then cross_tenant_rejected := 1;
  end;

  begin
    perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a004',
                               '00000000-0000-0000-0000-00000000a001',
                               'SUPERVISOR_INTERVENTION', null);
  exception when others then reason_required_rejected := 1;
  end;

  begin
    -- a005 already holds it
    perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a005',
                               '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  exception when others then noop_rejected := 1;
  end;

  -- ------------------------------------------------------------ unassignment
  perform public.assign_task(v_task, null,
                             '00000000-0000-0000-0000-00000000a001', 'UNASSIGNMENT');
  select count(*) into hist_unassign from public.assignment_event
   where subject_id = v_task and new_user_id is null;

  -- ------------------------------------------------- owner: assign, never vacate
  perform public.assign_operational_owner(v_inst, '00000000-0000-0000-0000-00000000a001',
                                          '00000000-0000-0000-0000-00000000a001', 'INITIAL');
  begin
    perform public.assign_operational_owner(v_inst, null,
                                            '00000000-0000-0000-0000-00000000a001', 'UNASSIGNMENT');
  exception when others then owner_unassign_rejected := 1;
  end;

  -- Step assignment, so A2 becomes a step assignee.
  perform public.assign_process_step(v_exec, '00000000-0000-0000-0000-00000000a002',
                                     '00000000-0000-0000-0000-00000000a001', 'INITIAL');

  -- ------------------------------------------------------------- ATOMICITY
  -- All three writes land together.
  select count(*) into atomic_task from public.process_instance
   where id = v_inst and owner_user_id = '00000000-0000-0000-0000-00000000a001';
  select count(*) into atomic_hist from public.assignment_event
   where subject_type = 'OPERATIONAL_OWNER' and subject_id = v_inst;
  select count(*) into atomic_event from public.business_event
   where subject_id = v_inst and event_type = 'OPERATIONAL_OWNER_ASSIGNED';

  -- A FAILED event must roll the assignment back. Break emission for real.
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$ begin raise exception 'ledger unavailable'; end; $body$;
  $fn$;

  begin
    perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a004',
                               '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  exception when others then null;
  end;

  select assigned_to into rollback_assignee from public.task where id = v_task;
  select count(*) into rollback_hist from public.assignment_event
   where subject_id = v_task and new_user_id = '00000000-0000-0000-0000-00000000a004'
     and reason_code = 'REASSIGNMENT';

  -- Restore emission.
  execute $fn$
    create or replace function public.emit_business_event(
      p_tenant_id uuid, p_event_type text, p_event_domain text, p_source text,
      p_subject_type text, p_subject_id uuid default null, p_dossier_id uuid default null,
      p_actor_user_id uuid default null, p_metadata jsonb default '{}'::jsonb,
      p_causation_id uuid default null, p_event_version int default 1)
    returns uuid language plpgsql security definer set search_path = public
    as $body$
    declare v_id uuid;
    begin
      insert into public.business_event (
        tenant_id, event_type, event_domain, event_version, source,
        dossier_id, subject_type, subject_id, actor_user_id,
        correlation_id, causation_id, metadata)
      values (
        p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
        p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
        p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb))
      returning id into v_id;
      return v_id;
    end; $body$;
  $fn$;

  -- RETRY appends no duplicate: the second identical call is refused.
  perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a004',
                             '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  select count(*) into retry_before from public.assignment_event where subject_id = v_task;
  begin
    perform public.assign_task(v_task, '00000000-0000-0000-0000-00000000a004',
                               '00000000-0000-0000-0000-00000000a001', 'REASSIGNMENT');
  exception when others then null;
  end;
  select count(*) into retry_after from public.assignment_event where subject_id = v_task;

  -- ------------------------------------------------------------- VISIBILITY
  -- Dossier 2 carries ONLY the legacy column, held by A3.
  insert into public.operational_file
    (id, tenant_id, file_number, type, client_id, status, assigned_to_user_id)
  values (v_file2, '00000000-0000-0000-0000-000000000001', 'W3-TEST-0002', 'IMP',
          '00000000-0000-0000-0000-0000000000ca', 'IN_PROGRESS',
          '00000000-0000-0000-0000-00000000a003');

  perform set_config('role', 'authenticated', true);

  -- A1: canonical operational owner, no file:read:all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000a001','role','authenticated')::text, true);
  select count(*) into owner_sees from public.operational_file where id = v_file;

  -- A2: step assignee.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000a002','role','authenticated')::text, true);
  select count(*) into step_sees from public.operational_file where id = v_file;

  -- A3: legacy assigned_to_user_id ONLY — retired, so nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000a003','role','authenticated')::text, true);
  select count(*) into legacy_only_sees from public.operational_file where id = v_file2;

  -- A5: held the task, then it moved away and now holds nothing. Bounded
  -- assignment history is the ONLY thing keeping them in — which is the point.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000a005','role','authenticated')::text, true);
  select count(*) into previous_holder_sees from public.operational_file where id = v_file;

  -- B1: another tenant entirely.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000b001','role','authenticated')::text, true);
  select count(*) into b1_sees from public.assignment_event where file_id = v_file;

  -- P1: portal user — no policy on assignment_event at all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000p001','role','authenticated')::text, true);
  select count(*) into p1_sees_history from public.assignment_event;

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('history_initial_row', hist_initial),
    ('history_after_reassign', hist_after_reassign),
    ('first_row_immutable_content', first_row_unchanged),
    ('history_unassignment_recorded', hist_unassign),
    ('history_update_rejected', update_rejected),
    ('history_delete_rejected', delete_rejected),
    ('cross_tenant_assignee_rejected', cross_tenant_rejected),
    ('reason_required_rejected', reason_required_rejected),
    ('noop_assignment_rejected', noop_rejected),
    ('owner_unassign_rejected', owner_unassign_rejected),
    ('atomic_assignment_written', atomic_task),
    ('atomic_history_written', atomic_hist),
    ('atomic_event_written', atomic_event),
    ('failed_event_rolls_back_history', rollback_hist),
    ('retry_appends_no_duplicate', retry_after - retry_before),
    ('operational_owner_sees_dossier', owner_sees),
    ('step_assignee_sees_dossier', step_sees),
    ('legacy_column_alone_grants_nothing', legacy_only_sees),
    ('reassigned_away_still_sees_dossier', previous_holder_sees),
    ('cross_tenant_sees_history', b1_sees),
    ('portal_sees_history', p1_sees_history);

  if hist_initial <> 1 or hist_after_reassign <> 2 or first_row_unchanged <> 1
     or hist_unassign <> 1
     or update_rejected <> 1 or delete_rejected <> 1
     or cross_tenant_rejected <> 1 or reason_required_rejected <> 1
     or noop_rejected <> 1 or owner_unassign_rejected <> 1
     or atomic_task <> 1 or atomic_hist <> 1 or atomic_event <> 1
     or rollback_assignee is distinct from null or rollback_hist <> 0
     or retry_after <> retry_before
     or owner_sees <> 1 or step_sees <> 1 or legacy_only_sees <> 0
     or previous_holder_sees <> 1 or b1_sees <> 0 or p1_sees_history <> 0
  then
    raise exception 'RLS WES-3 FAIL: h1=% h2=% imm=% unassign=% upd=% del=% xt=% reason=% noop=% ownerun=% at=% ah=% ae=% rbassignee=% rbhist=% retry=%/% owner=% step=% legacy=% prev=% b1=% p1=%',
      hist_initial, hist_after_reassign, first_row_unchanged, hist_unassign,
      update_rejected, delete_rejected, cross_tenant_rejected, reason_required_rejected,
      noop_rejected, owner_unassign_rejected, atomic_task, atomic_hist, atomic_event,
      rollback_assignee, rollback_hist, retry_before, retry_after,
      owner_sees, step_sees, legacy_only_sees, previous_holder_sees, b1_sees, p1_sees_history;
  end if;
end $$;

select * from _r order by check_name;
rollback;
