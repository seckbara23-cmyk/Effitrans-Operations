-- Behaviour test — ICAM-2: the operational incident register (NINC).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves in the DATABASE what a screen can only promise:
--   * the ratified four-state imputability vocabulary, and EN_ANALYSE refused
--     as a verdict — it is the ABSENCE of a decision (GOV-04)
--   * an invented category is refused
--   * recording needs incident:record; adjudication needs incident:adjudicate
--   * FOUR EYES AT THE PERSON LEVEL: an actor holding BOTH capabilities is
--     still refused on an incident they recorded themselves
--   * a final determination cannot be re-adjudicated, only corrected
--   * correction demands a motif, preserves the displaced determination, and
--     CLEARS finality — so the incident stops counting for NINC until somebody
--     other than the corrector confirms it
--   * the corrector may never revalidate their own correction
--   * the correction history is append-only
--   * treatment is a DISTINCT act (R1) stamped with DATABASE time (R2)
--   * NINC eligibility is exactly TRAITE + NON + final: untreated, cancelled,
--     imputable and under-correction incidents all fail to qualify
--   * cross-tenant recording, adjudication and dossier reference are refused
--   * neither capability reaches Performance or SYSTEM_ADMIN
--   * the register has no write policy — the RPCs are the only door
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture. The actors hold the REAL seeded roles, so the grants themselves are
-- under test — a suite that invents its own roles proves only its own SQL.
--   super    — OPS_SUPERVISOR: records, treats. No adjudication.
--   qualite  — COMPLIANCE_HSSE: adjudicates, corrects, revalidates.
--   qualite2 — a second Responsable Qualite; corrects, so cannot confirm it.
--   both     — holds BOTH roles: the person-level four-eyes probe.
--   noperm   — holds neither.
--   xtenant  — another tenant, fully permissioned THERE.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ca001', 'inc-super@test.local'),
  ('00000000-0000-0000-0000-0000000ca002', 'inc-qualite@test.local'),
  ('00000000-0000-0000-0000-0000000ca003', 'inc-qualite2@test.local'),
  ('00000000-0000-0000-0000-0000000ca004', 'inc-noperm@test.local'),
  ('00000000-0000-0000-0000-0000000ca005', 'inc-xtenant@test.local'),
  ('00000000-0000-0000-0000-0000000ca006', 'inc-both@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000ca0b2', 'ICAM2 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000ca001', '00000000-0000-0000-0000-000000000001', 'inc-super@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ca002', '00000000-0000-0000-0000-000000000001', 'inc-qualite@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ca003', '00000000-0000-0000-0000-000000000001', 'inc-qualite2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ca004', '00000000-0000-0000-0000-000000000001', 'inc-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ca006', '00000000-0000-0000-0000-000000000001', 'inc-both@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ca005', '00000000-0000-0000-0000-0000000ca0b2', 'inc-xtenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select s.u, r.id, '00000000-0000-0000-0000-000000000001'
from public.role r,
     (values ('00000000-0000-0000-0000-0000000ca001'::uuid),
             ('00000000-0000-0000-0000-0000000ca006'::uuid)) as s(u)
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select s.u, r.id, '00000000-0000-0000-0000-000000000001'
from public.role r,
     (values ('00000000-0000-0000-0000-0000000ca002'::uuid),
             ('00000000-0000-0000-0000-0000000ca003'::uuid),
             ('00000000-0000-0000-0000-0000000ca006'::uuid)) as s(u)
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;

-- The seeded grants must actually be there, or every refusal below would pass
-- for the wrong reason — a missing capability looks exactly like a governance
-- rule from the outside.
do $$
declare v_n int;
begin
  select count(*) into v_n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000ca001' and p.code = 'incident:record';
  if v_n = 0 then raise exception 'ICAM2 FIXTURE: OPS_SUPERVISOR does not carry incident:record'; end if;

  select count(*) into v_n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000ca002' and p.code = 'incident:adjudicate';
  if v_n = 0 then raise exception 'ICAM2 FIXTURE: COMPLIANCE_HSSE does not carry incident:adjudicate'; end if;

  select count(distinct p.code) into v_n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000ca006'
     and p.code in ('incident:record', 'incident:adjudicate');
  if v_n < 2 then raise exception 'ICAM2 FIXTURE: the four-eyes probe must hold BOTH capabilities, has %', v_n; end if;
  insert into _r values ('fixture_seeded_grants_present', 1);
end $$;

-- Tenant B holds both capabilities IN ITS OWN TENANT, so its refusals prove
-- tenant isolation rather than a missing permission.
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000ca0c9', '00000000-0000-0000-0000-0000000ca0b2', 'INC_BOTH_B', 'Incidents B (test)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000ca0c9', p.id from public.permission p
 where p.code in ('incident:record', 'incident:adjudicate')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000ca005', '00000000-0000-0000-0000-0000000ca0c9', '00000000-0000-0000-0000-0000000ca0b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ca0d1', '00000000-0000-0000-0000-000000000001', 'ICAM2 Client')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-93001', 'IMP', '00000000-0000-0000-0000-0000000ca0d1')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Recording: authority, tenant integrity, database time, honest defaults.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid; v_row record;
  noperm boolean := false; xtenant boolean := false;
begin
  begin
    perform public.record_operational_incident(
      '00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-0000000ca004',
      'RETOUR', 'sans autorisation');
  exception when others then noperm := true; end;

  begin
    perform public.record_operational_incident(
      '00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-0000000ca005',
      'RETOUR', 'cross-tenant');
  exception when others then xtenant := true; end;

  v_id := (public.record_operational_incident(
    '00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-0000000ca001',
    'RETOUR', 'Retour client sur emballage') ->> 'incident_id')::uuid;

  select * into v_row from public.operational_incident where id = v_id;

  insert into _r values
    ('record_without_capability_refused', case when noperm then 1 else 0 end),
    ('record_cross_tenant_refused', case when xtenant then 1 else 0 end),
    ('recorded', case when v_row.id is not null then 1 else 0 end),
    ('recorded_at_is_database_time', case when v_row.recorded_at = transaction_timestamp() then 1 else 0 end),
    ('starts_en_analyse', case when v_row.imputability = 'EN_ANALYSE' then 1 else 0 end),
    ('starts_ouvert', case when v_row.status = 'OUVERT' then 1 else 0 end),
    ('recorder_attributed', case when v_row.recorded_by = '00000000-0000-0000-0000-0000000ca001' then 1 else 0 end);

  if not (noperm and xtenant) then
    raise exception 'ICAM2 FAIL: record guards noperm=% xtenant=%', noperm, xtenant;
  end if;
  if v_row.imputability <> 'EN_ANALYSE' or v_row.status <> 'OUVERT' then
    raise exception 'ICAM2 FAIL: a new incident must start EN_ANALYSE/OUVERT — an unadjudicated incident is not a fault';
  end if;
  perform set_config('inc.id', v_id::text, true);
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE PERSON-LEVEL FOUR EYES.
--
-- The probe holds BOTH capabilities, so its refusal can only be the identity
-- rule. Then a colleague adjudicates the same incident, proving the RPC works
-- and the refusal was about WHO, not about what.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; self_ text := ''; v_row record;
begin
  v_id := (public.record_operational_incident(
    '00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-0000000ca006',
    'NON_CONFORMITE', 'Signale par une personne qui detient aussi le pouvoir de statuer') ->> 'incident_id')::uuid;

  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca006', 'NON');
  exception when others then self_ := SQLERRM; end;

  -- Same incident, different person: accepted.
  perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'NON');
  select * into v_row from public.operational_incident where id = v_id;

  insert into _r values
    ('recorder_holding_BOTH_caps_cannot_adjudicate_own',
     case when self_ like '%may not adjudicate it%' then 1 else 0 end),
    ('a_colleague_can_adjudicate_the_same_incident',
     case when v_row.imputability = 'NON' then 1 else 0 end);

  if self_ not like '%may not adjudicate it%' then
    raise exception 'ICAM2 FAIL: the recorder adjudicated their own incident (err=%)',
      coalesce(nullif(self_, ''), 'ACCEPTED');
  end if;
  if v_row.imputability <> 'NON' then
    raise exception 'ICAM2 FAIL: an authorised colleague could not adjudicate';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Adjudication vocabulary and authority.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := current_setting('inc.id')::uuid;
  noperm boolean := false; xtenant boolean := false;
  en_analyse text := ''; invented text := ''; recorder_no_cap boolean := false;
  v_row record;
begin
  -- The Superviseur records but does not rule: capability, not identity.
  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca001', 'NON');
  exception when others then recorder_no_cap := true; end;

  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca004', 'NON');
  exception when others then noperm := true; end;

  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca005', 'NON');
  exception when others then xtenant := true; end;

  -- EN_ANALYSE is the absence of a decision and may not be submitted as one.
  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'EN_ANALYSE');
  exception when others then en_analyse := SQLERRM; end;

  -- An invented category is refused: the vocabulary is the ratified four.
  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'IMPUTABLE_EFFITRANS');
  exception when others then invented := SQLERRM; end;

  perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'NON');
  select * into v_row from public.operational_incident where id = v_id;

  insert into _r values
    ('ops_supervisor_holds_no_adjudication', case when recorder_no_cap then 1 else 0 end),
    ('adjudicate_without_capability_refused', case when noperm then 1 else 0 end),
    ('adjudicate_cross_tenant_refused', case when xtenant then 1 else 0 end),
    ('en_analyse_refused_as_a_verdict', case when en_analyse like '%not a decision%' then 1 else 0 end),
    ('invented_category_refused', case when invented like '%must be one of%' then 1 else 0 end),
    ('adjudicated_non', case when v_row.imputability = 'NON' then 1 else 0 end),
    ('adjudicator_attributed',
     case when v_row.imputability_decided_by = '00000000-0000-0000-0000-0000000ca002' then 1 else 0 end),
    ('decided_at_is_database_time',
     case when v_row.imputability_decided_at = transaction_timestamp() then 1 else 0 end);

  if not (recorder_no_cap and noperm and xtenant) then
    raise exception 'ICAM2 FAIL: adjudication authority recorder_no_cap=% noperm=% xtenant=%',
      recorder_no_cap, noperm, xtenant;
  end if;
  if en_analyse not like '%not a decision%' then
    raise exception 'ICAM2 FAIL: EN_ANALYSE was accepted as a verdict (err=%)',
      coalesce(nullif(en_analyse, ''), 'ACCEPTED');
  end if;
  if invented not like '%must be one of%' then
    raise exception 'ICAM2 FAIL: an invented imputability category was accepted (err=%)',
      coalesce(nullif(invented, ''), 'ACCEPTED');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. NINC eligibility — adjudicated NON but NOT treated does not qualify.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('inc.id')::uuid; n int;
begin
  select count(*) into n from public.operational_incident
   where id = v_id and status = 'TRAITE' and imputability = 'NON'
     and imputability_decided_at is not null;
  insert into _r values ('non_imputable_but_untreated_does_not_qualify', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'ICAM2 FAIL: an untreated incident qualified — traite is a second condition (R1)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Treatment — a distinct act, database-timed, and THEN it qualifies.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('inc.id')::uuid; v_row record; n int; twice boolean := false;
begin
  perform public.complete_operational_incident_treatment(v_id, '00000000-0000-0000-0000-0000000ca001');
  select * into v_row from public.operational_incident where id = v_id;

  begin
    perform public.complete_operational_incident_treatment(v_id, '00000000-0000-0000-0000-0000000ca001');
  exception when others then twice := true; end;

  select count(*) into n from public.operational_incident
   where id = v_id and status = 'TRAITE' and imputability = 'NON'
     and imputability_decided_at is not null;

  insert into _r values
    ('treated', case when v_row.status = 'TRAITE' then 1 else 0 end),
    ('treated_at_is_database_time', case when v_row.treated_at = transaction_timestamp() then 1 else 0 end),
    ('treated_by_attributed', case when v_row.treated_by = '00000000-0000-0000-0000-0000000ca001' then 1 else 0 end),
    ('double_treatment_refused', case when twice then 1 else 0 end),
    ('non_imputable_AND_treated_qualifies', n);

  if v_row.treated_at is distinct from transaction_timestamp() then
    raise exception 'ICAM2 FAIL: treated_at is not database time — it is the instant Q9 attributes against';
  end if;
  if n <> 1 then raise exception 'ICAM2 FAIL: a treated non-imputable incident must qualify for NINC'; end if;
  if not twice then raise exception 'ICAM2 FAIL: a second treatment was accepted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Correction — motif required, determination preserved, finality cleared.
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := current_setting('inc.id')::uuid;
  readjudicate text := ''; noreason boolean := false; nochange boolean := false;
  v_row record; v_corr record; n int;
begin
  begin
    perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca003', 'OUI');
  exception when others then readjudicate := SQLERRM; end;

  begin
    perform public.correct_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca003', '   ', 'OUI');
  exception when others then noreason := true; end;

  begin
    perform public.correct_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca003', 'motif', 'NON');
  exception when others then nochange := true; end;

  perform public.correct_operational_incident(
    v_id, '00000000-0000-0000-0000-0000000ca003',
    'Analyse complementaire : la cause est interne', 'OUI');

  select * into v_row from public.operational_incident where id = v_id;
  select * into v_corr from public.operational_incident_correction where incident_id = v_id;

  select count(*) into n from public.operational_incident
   where id = v_id and status = 'TRAITE' and imputability = 'NON'
     and imputability_decided_at is not null;

  insert into _r values
    ('final_cannot_be_readjudicated', case when readjudicate like '%governed correction%' then 1 else 0 end),
    ('correction_requires_a_motif', case when noreason then 1 else 0 end),
    ('correction_must_change_something', case when nochange then 1 else 0 end),
    ('displaced_determination_preserved', case when v_corr.imputability_before = 'NON' then 1 else 0 end),
    ('displaced_adjudicator_preserved',
     case when v_corr.decided_by_before = '00000000-0000-0000-0000-0000000ca002' then 1 else 0 end),
    ('displaced_instant_preserved', case when v_corr.decided_at_before is not null then 1 else 0 end),
    ('change_traced_old_to_new',
     case when (v_corr.changes->'imputability'->>'old') = 'NON'
           and (v_corr.changes->'imputability'->>'new') = 'OUI' then 1 else 0 end),
    ('corrector_attributed', case when v_corr.corrected_by = '00000000-0000-0000-0000-0000000ca003' then 1 else 0 end),
    ('finality_cleared_by_correction', case when v_row.imputability_decided_at is null then 1 else 0 end),
    ('corrected_incident_STOPS_qualifying', case when n = 0 then 1 else 0 end);

  if readjudicate not like '%governed correction%' then
    raise exception 'ICAM2 FAIL: a final determination was silently re-adjudicated (err=%)',
      coalesce(nullif(readjudicate, ''), 'ACCEPTED');
  end if;
  if not (noreason and nochange) then
    raise exception 'ICAM2 FAIL: correction guards noreason=% nochange=%', noreason, nochange;
  end if;
  if v_row.imputability_decided_at is not null then
    raise exception 'ICAM2 FAIL: the correction left the determination final';
  end if;
  if n <> 0 then
    raise exception 'ICAM2 FAIL: a corrected incident still counted for NINC before anyone confirmed it';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The correction history is append-only.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('inc.id')::uuid; upd boolean := false; del boolean := false;
begin
  begin
    update public.operational_incident_correction set reason = 'rewritten' where incident_id = v_id;
  exception when others then upd := true; end;
  begin
    delete from public.operational_incident_correction where incident_id = v_id;
  exception when others then del := true; end;

  insert into _r values ('correction_update_refused', case when upd then 1 else 0 end),
                        ('correction_delete_refused', case when del then 1 else 0 end);
  if not (upd and del) then raise exception 'ICAM2 WORM FAIL: upd=% del=%', upd, del; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Revalidation — never by the corrector.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid := current_setting('inc.id')::uuid; self_ text := ''; v_row record; n int;
begin
  begin
    perform public.revalidate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca003');
  exception when others then self_ := SQLERRM; end;

  perform public.revalidate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002');
  select * into v_row from public.operational_incident where id = v_id;

  -- The determination is now OUI and final, so it must NOT qualify: an
  -- AM-caused rework never increments a counter (F-ICAM-06).
  select count(*) into n from public.operational_incident
   where id = v_id and status = 'TRAITE' and imputability = 'NON'
     and imputability_decided_at is not null;

  insert into _r values
    ('corrector_cannot_revalidate_own', case when self_ like '%own correction%' then 1 else 0 end),
    ('revalidated_by_an_independent_actor',
     case when v_row.imputability_decided_by = '00000000-0000-0000-0000-0000000ca002'
           and v_row.imputability_decided_at is not null then 1 else 0 end),
    ('imputable_incident_never_qualifies', case when n = 0 then 1 else 0 end);

  if self_ not like '%own correction%' then
    raise exception 'ICAM2 FAIL: the corrector confirmed their own correction (err=%)',
      coalesce(nullif(self_, ''), 'ACCEPTED');
  end if;
  if v_row.imputability_decided_at is null then raise exception 'ICAM2 FAIL: revalidation did not take'; end if;
  if n <> 0 then raise exception 'ICAM2 FAIL: an imputable incident qualified for NINC'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Cancellation never qualifies, and clears the treatment it invalidates.
-- ---------------------------------------------------------------------------
do $$
declare v_id uuid; v_row record; n int; noreason boolean := false;
begin
  v_id := (public.record_operational_incident(
    '00000000-0000-0000-0000-0000000ca0f1', '00000000-0000-0000-0000-0000000ca001',
    'NON_CONFORMITE', 'Doublon a annuler') ->> 'incident_id')::uuid;
  perform public.adjudicate_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'NON');
  perform public.complete_operational_incident_treatment(v_id, '00000000-0000-0000-0000-0000000ca001');

  begin
    perform public.cancel_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', '  ');
  exception when others then noreason := true; end;

  perform public.cancel_operational_incident(v_id, '00000000-0000-0000-0000-0000000ca002', 'Doublon');
  select * into v_row from public.operational_incident where id = v_id;
  select count(*) into n from public.operational_incident
   where id = v_id and status = 'TRAITE' and imputability = 'NON'
     and imputability_decided_at is not null;

  insert into _r values
    ('cancellation_requires_a_reason', case when noreason then 1 else 0 end),
    ('cancelled', case when v_row.status = 'ANNULE' then 1 else 0 end),
    ('cancellation_clears_the_treatment',
     case when v_row.treated_at is null and v_row.treated_by is null then 1 else 0 end),
    ('cancelled_incident_never_qualifies', case when n = 0 then 1 else 0 end);
  if n <> 0 then raise exception 'ICAM2 FAIL: a cancelled incident qualified for NINC'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Several qualifying incidents on one dossier are allowed (Q10) — the
--     frozen plafond does the bounding, not a uniqueness rule.
-- ---------------------------------------------------------------------------
do $$
declare v_a uuid; v_b uuid; n int;
begin
  v_a := (public.record_operational_incident('00000000-0000-0000-0000-0000000ca0f1',
    '00000000-0000-0000-0000-0000000ca001', 'RETOUR', 'Retour A') ->> 'incident_id')::uuid;
  v_b := (public.record_operational_incident('00000000-0000-0000-0000-0000000ca0f1',
    '00000000-0000-0000-0000-0000000ca001', 'RETOUR', 'Retour B') ->> 'incident_id')::uuid;
  perform public.adjudicate_operational_incident(v_a, '00000000-0000-0000-0000-0000000ca002', 'NON');
  perform public.adjudicate_operational_incident(v_b, '00000000-0000-0000-0000-0000000ca002', 'NON');
  perform public.complete_operational_incident_treatment(v_a, '00000000-0000-0000-0000-0000000ca001');
  perform public.complete_operational_incident_treatment(v_b, '00000000-0000-0000-0000-0000000ca001');

  select count(*) into n from public.operational_incident
   where file_id = '00000000-0000-0000-0000-0000000ca0f1'
     and status = 'TRAITE' and imputability = 'NON' and imputability_decided_at is not null;

  insert into _r values ('several_qualifying_incidents_on_one_dossier', case when n >= 2 then 1 else 0 end);
  if n < 2 then
    raise exception 'ICAM2 FAIL: F-ICAM-03 uses NINC=3, so the register must admit several events (found %)', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Tenant integrity and capability containment.
-- ---------------------------------------------------------------------------
do $$
declare foreign_dossier boolean := false; n int; offender text;
begin
  begin
    insert into public.operational_incident (tenant_id, file_id, kind, description, recorded_by)
    values ('00000000-0000-0000-0000-0000000ca0b2', '00000000-0000-0000-0000-0000000ca0f1',
            'RETOUR', 'foreign', '00000000-0000-0000-0000-0000000ca005');
  exception when others then foreign_dossier := true; end;
  insert into _r values ('foreign_dossier_refused', case when foreign_dossier then 1 else 0 end);
  if not foreign_dossier then
    raise exception 'ICAM2 FAIL: an incident was attached to another tenant dossier';
  end if;

  select count(*), min(r.code) into n, offender
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code in ('incident:record', 'incident:adjudicate')
     and r.code in ('PERFORMANCE_MANAGEMENT', 'PERFORMANCE_PUBLISHER', 'SYSTEM_ADMIN');
  insert into _r values ('no_performance_or_sysadmin_holder', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'ICAM2 FAIL: % forbidden holder(s) of an incident capability (e.g. %) — Performance consumes results, SYSTEM_ADMIN administers roles; neither decides who caused an incident', n, offender;
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('operational_incident', 'operational_incident_correction')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');
  insert into _r values ('no_write_policy_on_the_register', case when n = 0 then 1 else 0 end);
  if n <> 0 then raise exception 'ICAM2 FAIL: % write policy(ies) on the incident tables', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Every recorded check must be 1 — a check that quietly wrote 0 without
--     raising would otherwise pass unnoticed.
-- ---------------------------------------------------------------------------
do $$
declare v_n int; v_bad text;
begin
  select count(*), min(check_name) into v_n, v_bad from _r where value <> 1;
  if v_n <> 0 then raise exception 'ICAM2 FAIL: % check(s) did not hold (e.g. %)', v_n, v_bad; end if;
  select count(*) into v_n from _r;
  raise notice 'ICAM2 OK: % checks held', v_n;
end $$;

select * from _r order by check_name;
rollback;
