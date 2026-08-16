-- RLS + invariants test — HR-6 Performance (migration 78). BEGIN/ROLLBACK.
-- Proves: tenant confinement + hr:read gate; SYSTEM_ADMIN sees 0 (DEC-B25);
-- portal sees 0; hr:performance:finalize is granted to the Direction seats
-- (DAF/DGA) and NOBODY else — HR-B2 activated it, and the identity-lane proofs
-- live in hr_b2_performance_identity_test.sql;
-- the four-stage workflow enforces ACTOR SEPARATION at every seat; the weight
-- total is enforced AT FINALIZATION and only when objectives exist; a finalized
-- evaluation is immutable except for the acknowledgment; acknowledgment cannot
-- alter the manager's assessment; objectives lock on finalization; an amendment
-- supersedes rather than rewrites; and the ledger receives the mandated events.

begin;

-- HR-B2/EFA08: the performance RPCs now call assert_actor_authority, whose
-- SERVICE branch refuses a session-bearing caller. This suite therefore holds
-- NO jwt claims while it exercises them (it sets claims only at the end, for
-- the RLS reads, where no RPC runs).
select set_config('request.jwt.claims', '', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000006a', 'hr6-self@test.local'),
  ('00000000-0000-0000-0000-00000000006b', 'hr6-mgr@test.local'),
  ('00000000-0000-0000-0000-00000000006c', 'hr6-admin@test.local'),
  ('00000000-0000-0000-0000-00000000006d', 'hr6-portal@test.local'),
  ('00000000-0000-0000-0000-00000000006e', 'hr6-final@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000006a', '00000000-0000-0000-0000-000000000001', 'hr6-self@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000006b', '00000000-0000-0000-0000-000000000001', 'hr6-mgr@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000006c', '00000000-0000-0000-0000-000000000001', 'hr6-admin@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000006e', '00000000-0000-0000-0000-000000000001', 'hr6-final@test.local', 'active')
on conflict (id) do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000006a', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'HR_OFFICER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000006c', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- HR-B2 — the reviewing and finalizing actors carry real authority now.
-- `hr6-mgr` acts as the HR desk proxy for the manager stage (hr:manage);
-- `hr6-final` holds the Direction finalization seat. Granting these is what
-- keeps each assertion below testing ITS OWN invariant rather than the new
-- authority check.
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000060c1', '00000000-0000-0000-0000-000000000001', 'HR6_PROXY', 'Proxy RH (test HR-6)'),
  ('00000000-0000-0000-0000-0000000060c2', '00000000-0000-0000-0000-000000000001', 'HR6_FINAL', 'Finalisation (test HR-6)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000060c1', p.id from public.permission p where p.code = 'hr:manage'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000060c2', p.id from public.permission p where p.code = 'hr:performance:finalize'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-00000000006b', '00000000-0000-0000-0000-0000000060c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000006e', '00000000-0000-0000-0000-0000000060c2', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ccd06', '00000000-0000-0000-0000-000000000001', 'HR6 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000006d', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ccd06', 'hr6-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.employee (id, tenant_id, employee_number, first_name, last_name, department, status) values
  ('00000000-0000-0000-0000-0000000eee61', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9601', 'Perf', 'Un', 'OPERATIONS', 'ACTIVE'),
  ('00000000-0000-0000-0000-0000000eee62', '00000000-0000-0000-0000-000000000001',
   'EMP-2099-9602', 'Perf', 'Deux', 'OPERATIONS', 'ACTIVE')
on conflict (id) do nothing;

-- The target population is scoped to a DEDICATED test unit, so the assertions
-- below count exactly two evaluations no matter what the seed database holds.
insert into public.hr_org_unit (id, tenant_id, unit_kind, name, code) values
  ('00000000-0000-0000-0000-000000000a61', '00000000-0000-0000-0000-000000000001',
   'TEAM', 'Équipe test HR-6', 'HR6-T')
on conflict (id) do nothing;
insert into public.employee_assignment (tenant_id, employee_id, org_unit_id, manager_employee_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee61',
   '00000000-0000-0000-0000-000000000a61', '00000000-0000-0000-0000-0000000eee62'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000eee62',
   '00000000-0000-0000-0000-000000000a61', null)
on conflict do nothing;

insert into public.hr_performance_cycle
  (id, tenant_id, code, label_fr, cycle_kind, period_start, period_end, weight_total_bp,
   target_scope, target_org_unit_id) values
  ('00000000-0000-0000-0000-00000000c061', '00000000-0000-0000-0000-000000000001',
   'CYC-T1', 'Revue annuelle (test)', 'ANNUELLE', '2026-01-01', '2026-12-31', 10000,
   'ORG_UNIT', '00000000-0000-0000-0000-000000000a61')
on conflict (id) do nothing;

insert into public.hr_competency (id, tenant_id, code, label_fr, scale_min, scale_max) values
  ('00000000-0000-0000-0000-00000000c161', '00000000-0000-0000-0000-000000000001',
   'COMM-T', 'Communication (test)', 1, 5)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  officer_evals int; admin_evals int; portal_evals int;
  perm_rows int; perm_grants int;
  created int;
  eval_one uuid; obj_one uuid; obj_amended uuid;
  same_actor_rejected int := 0; finalizer_same_rejected int := 0;
  weight_mismatch_rejected int := 0;
  immutable_rejected int := 0; ack_tamper_rejected int := 0;
  objective_locked_rejected int := 0; scale_rejected int := 0;
  superseded_kept int; locked_objectives int;
  ev_opened int; ev_self int; ev_mgr int; ev_final int; ev_ack int; ev_objective int;
  manager_comments_after text;
begin
  perform set_config('role', 'postgres', true);

  -- HR-B2: the finalize authority exists; its grants land ONLY on the
  -- Direction seats (and this suite's own finalization fixture role).
  -- perm_grants counts grants OUTSIDE that set: 0.
  select count(*) into perm_rows from public.permission where code = 'hr:performance:finalize';
  select count(*) into perm_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
    join public.role r on r.id = rp.role_id
    where p.code = 'hr:performance:finalize'
      and r.code not in ('DAF', 'DGA', 'HR6_FINAL');

  -- Opening the cycle materializes evaluations and emits one event per employee.
  select public.hr_open_performance_cycle(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c061',
    '00000000-0000-0000-0000-00000000006a') into created;
  select count(*) into ev_opened from public.hr_employee_event
   where event_kind = 'performance_cycle_opened'
     and employee_id in ('00000000-0000-0000-0000-0000000eee61','00000000-0000-0000-0000-0000000eee62');

  select id into eval_one from public.hr_evaluation
   where cycle_id = '00000000-0000-0000-0000-00000000c061'
     and employee_id = '00000000-0000-0000-0000-0000000eee61';

  -- An objective worth 60% only — deliberately short of the configured 100%.
  select public.hr_assign_objective(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c061',
    '00000000-0000-0000-0000-0000000eee61', '00000000-0000-0000-0000-00000000006a',
    'Objectif test', 6000) into obj_one;

  -- Off-scale competency levels are refused by the tenant's own scale.
  begin
    insert into public.hr_competency_assessment (tenant_id, evaluation_id, competency_id, manager_level)
    values ('00000000-0000-0000-0000-000000000001', eval_one,
            '00000000-0000-0000-0000-00000000c161', 99);
  exception when others then scale_rejected := 1;
  end;

  -- Stage 1.
  perform public.hr_submit_self_assessment(
    '00000000-0000-0000-0000-000000000001', eval_one,
    '00000000-0000-0000-0000-00000000006a', 'Auto-évaluation de test');
  select count(*) into ev_self from public.hr_employee_event
   where event_kind = 'self_assessment_submitted' and employee_id = '00000000-0000-0000-0000-0000000eee61';

  -- ACTOR SEPARATION 1: the self-assessor may not also be the reviewer.
  begin
    perform public.hr_submit_manager_review(
      '00000000-0000-0000-0000-000000000001', eval_one,
      '00000000-0000-0000-0000-00000000006a', 'Revue interdite');
  exception when others then same_actor_rejected := 1;
  end;

  -- Stage 2, by a different actor.
  perform public.hr_submit_manager_review(
    '00000000-0000-0000-0000-000000000001', eval_one,
    '00000000-0000-0000-0000-00000000006b', 'Revue du manager');
  select count(*) into ev_mgr from public.hr_employee_event
   where event_kind = 'manager_review_submitted' and employee_id = '00000000-0000-0000-0000-0000000eee61';

  -- ACTOR SEPARATION 2: the reviewer may not finalize their own review.
  begin
    perform public.hr_finalize_evaluation(
      '00000000-0000-0000-0000-000000000001', eval_one, '00000000-0000-0000-0000-00000000006b');
  exception when others then finalizer_same_rejected := 1;
  end;

  -- WEIGHT RULE: 6000 bp <> the cycle's configured 10000 bp, so finalization refuses.
  begin
    perform public.hr_finalize_evaluation(
      '00000000-0000-0000-0000-000000000001', eval_one, '00000000-0000-0000-0000-00000000006e');
  exception when others then weight_mismatch_rejected := 1;
  end;

  -- An AMENDMENT supersedes rather than rewrites: the old row survives.
  select public.hr_assign_objective(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c061',
    '00000000-0000-0000-0000-0000000eee61', '00000000-0000-0000-0000-00000000006a',
    'Objectif test (amendé)', 10000,
    null::text, null::text, null::text, null::date, obj_one) into obj_amended;
  select count(*) into superseded_kept from public.hr_objective
   where id = obj_one and status = 'SUPERSEDED';
  -- Counted HERE, after the amendment: an amendment is an assignment too, so
  -- both the original and the amended objective must appear on the timeline.
  select count(*) into ev_objective from public.hr_employee_event
   where event_kind = 'objective_assigned' and employee_id = '00000000-0000-0000-0000-0000000eee61';

  -- Now the live total is exactly 10000 bp and finalization succeeds.
  perform public.hr_finalize_evaluation(
    '00000000-0000-0000-0000-000000000001', eval_one,
    '00000000-0000-0000-0000-00000000006e', 'Modération', 'Synthèse');
  select count(*) into ev_final from public.hr_employee_event
   where event_kind = 'performance_review_finalized' and employee_id = '00000000-0000-0000-0000-0000000eee61';
  select count(*) into locked_objectives from public.hr_objective
   where id = obj_amended and locked_at is not null;

  -- A locked objective is frozen for good.
  begin
    update public.hr_objective set weight_bp = 1 where id = obj_amended;
  exception when others then objective_locked_rejected := 1;
  end;

  -- A finalized evaluation refuses every edit that is not the acknowledgment.
  begin
    update public.hr_evaluation set manager_comments = 'réécriture' where id = eval_one;
  exception when others then immutable_rejected := 1;
  end;

  -- The acknowledgment may not smuggle a change to the manager's assessment.
  begin
    update public.hr_evaluation
       set status = 'ACKNOWLEDGED', acknowledged_by = '00000000-0000-0000-0000-00000000006a',
           acknowledged_at = now(), manager_comments = 'réécriture furtive'
     where id = eval_one;
  exception when others then ack_tamper_rejected := 1;
  end;

  -- The honest acknowledgment succeeds and leaves the assessment untouched.
  perform public.hr_acknowledge_evaluation(
    '00000000-0000-0000-0000-000000000001', eval_one, '00000000-0000-0000-0000-00000000006a', 'Lu');
  select count(*) into ev_ack from public.hr_employee_event
   where event_kind = 'performance_review_acknowledged' and employee_id = '00000000-0000-0000-0000-0000000eee61';
  select manager_comments into manager_comments_after from public.hr_evaluation where id = eval_one;

  -- RLS: officer sees, SYSTEM_ADMIN sees nothing, portal sees nothing.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000006a','role','authenticated')::text, true);
  select count(*) into officer_evals from public.hr_evaluation where cycle_id = '00000000-0000-0000-0000-00000000c061';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000006c','role','authenticated')::text, true);
  select count(*) into admin_evals from public.hr_evaluation where cycle_id = '00000000-0000-0000-0000-00000000c061';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000006d','role','authenticated')::text, true);
  select count(*) into portal_evals from public.hr_evaluation where cycle_id = '00000000-0000-0000-0000-00000000c061';
  perform set_config('role', 'postgres', true);

  insert into _r values
    ('officer_sees_evaluations', officer_evals), ('system_admin_sees', admin_evals),
    ('portal_sees', portal_evals),
    ('finalize_permission_rows', perm_rows), ('finalize_permission_grants', perm_grants),
    ('evaluations_created', created), ('event_cycle_opened', ev_opened),
    ('event_objective_assigned', ev_objective), ('event_self_submitted', ev_self),
    ('event_manager_submitted', ev_mgr), ('event_finalized', ev_final),
    ('event_acknowledged', ev_ack),
    ('same_actor_review_rejected', same_actor_rejected),
    ('same_actor_finalize_rejected', finalizer_same_rejected),
    ('weight_mismatch_rejected', weight_mismatch_rejected),
    ('superseded_row_kept', superseded_kept), ('objectives_locked', locked_objectives),
    ('objective_locked_rejected', objective_locked_rejected),
    ('finalized_immutable', immutable_rejected), ('ack_tamper_rejected', ack_tamper_rejected),
    ('off_scale_rejected', scale_rejected);

  if officer_evals<>2 or admin_evals<>0 or portal_evals<>0
     or perm_rows<>1 or perm_grants<>0
     or created<>2 or ev_opened<>2 or ev_objective<>2 or ev_self<>1 or ev_mgr<>1
     or ev_final<>1 or ev_ack<>1
     or same_actor_rejected<>1 or finalizer_same_rejected<>1 or weight_mismatch_rejected<>1
     or superseded_kept<>1 or locked_objectives<>1 or objective_locked_rejected<>1
     or immutable_rejected<>1 or ack_tamper_rejected<>1 or scale_rejected<>1
     or manager_comments_after <> 'Revue du manager'
  then
    raise exception 'HR-6 PERF FAIL: off=% adm=% por=% perm=% grants=% created=% opened=% obj=% self=% mgr=% fin=% ack=% sameA=% sameF=% weight=% sup=% lock=% lockRej=% immut=% tamper=% scale=% comments=%',
      officer_evals, admin_evals, portal_evals, perm_rows, perm_grants, created, ev_opened,
      ev_objective, ev_self, ev_mgr, ev_final, ev_ack, same_actor_rejected,
      finalizer_same_rejected, weight_mismatch_rejected, superseded_kept, locked_objectives,
      objective_locked_rejected, immutable_rejected, ack_tamper_rejected, scale_rejected,
      manager_comments_after;
  end if;
end $$;

select * from _r order by check_name;
rollback;
