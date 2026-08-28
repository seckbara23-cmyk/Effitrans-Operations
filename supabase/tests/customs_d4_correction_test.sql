-- Behaviour test — D4: governed capture, correction and recertification.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the DATABASE enforces the ratified rule, not merely the UI:
--   * the five governed columns exist, are nullable, and reject bad vocabulary
--   * a « DPE » declaration_type CANNOT be stored (D1)
--   * an actor without customs:correct is refused
--   * an UNVALIDATED record cannot pass through the correction door
--   * a correction without a motif is refused
--   * a correction that changes nothing is refused
--   * a valid correction records old → new, actor, timestamp, and the
--     certification it displaced
--   * the correction CLEARS the validation and attributes the edit
--   * exactly one CUSTOMS_CORRECTED event is appended
--   * the history is APPEND-ONLY: update and delete both raise
--   * the corrector cannot revalidate their own correction
--   * the corrector cannot use the ORDINARY validation either (they are now
--     the last editor — migrations 104 and this one compose)
--   * the Déclarant CAN revalidate, and PG-6 is intact (no customs:validate)
--   * a never-corrected record cannot be revalidated
--   * cross-tenant actors are refused on both doors
--   * both RPCs are service_role only
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture.
--   declarant — holds customs:update + customs:revalidate (never validate)
--   chief     — holds customs:validate + customs:correct + customs:revalidate
--   chief2    — a second chief; corrects, so cannot recertify his own work
--   noperm    — holds nothing
--   xtenant   — another tenant, fully permissioned there
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d4001', 'd4-declarant@test.local'),
  ('00000000-0000-0000-0000-0000000d4002', 'd4-chief@test.local'),
  ('00000000-0000-0000-0000-0000000d4003', 'd4-noperm@test.local'),
  ('00000000-0000-0000-0000-0000000d4004', 'd4-xtenant@test.local'),
  ('00000000-0000-0000-0000-0000000d4005', 'd4-chief2@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000d40b2', 'D4 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000d4001', '00000000-0000-0000-0000-000000000001', 'd4-declarant@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d4002', '00000000-0000-0000-0000-000000000001', 'd4-chief@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d4003', '00000000-0000-0000-0000-000000000001', 'd4-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d4005', '00000000-0000-0000-0000-000000000001', 'd4-chief2@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000d4004', '00000000-0000-0000-0000-0000000d40b2', 'd4-xtenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000d40c1', '00000000-0000-0000-0000-000000000001', 'D4_DECLARANT', 'Déclarant (test D4)'),
  ('00000000-0000-0000-0000-0000000d40c2', '00000000-0000-0000-0000-000000000001', 'D4_CHIEF', 'Chef (test D4)'),
  ('00000000-0000-0000-0000-0000000d40c3', '00000000-0000-0000-0000-0000000d40b2', 'D4_CHIEF_B', 'Chef B (test D4)')
on conflict (tenant_id, code) do nothing;

-- The declarant deliberately does NOT get customs:validate — PG-6.
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d40c1', p.id from public.permission p
 where p.code in ('customs:update', 'customs:revalidate')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d40c2', p.id from public.permission p
 where p.code in ('customs:validate', 'customs:correct', 'customs:revalidate', 'customs:update')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000d40c3', p.id from public.permission p
 where p.code in ('customs:validate', 'customs:correct', 'customs:revalidate')
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000d4001', '00000000-0000-0000-0000-0000000d40c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d4002', '00000000-0000-0000-0000-0000000d40c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d4005', '00000000-0000-0000-0000-0000000d40c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000d4004', '00000000-0000-0000-0000-0000000d40c3', '00000000-0000-0000-0000-0000000d40b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000d40d1', '00000000-0000-0000-0000-000000000001', 'D4 Client')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000d40f1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-94001', 'IMP', '00000000-0000-0000-0000-0000000d40d1'),
  ('00000000-0000-0000-0000-0000000d40f2', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-94002', 'IMP', '00000000-0000-0000-0000-0000000d40d1')
on conflict (id) do nothing;

-- The DECLARANT captured the five elements; nobody has validated yet.
insert into public.customs_record
  (id, tenant_id, file_id, status, created_by, updated_by,
   sh_position_count, declaration_type, dpi_regime, exemption_title_origin, tariff_classification_origin)
values
  ('00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d40f1',
   'DECLARED', '00000000-0000-0000-0000-0000000d4001', '00000000-0000-0000-0000-0000000d4001',
   5, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS'),
  ('00000000-0000-0000-0000-0000000d40e2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d40f2',
   'DECLARED', '00000000-0000-0000-0000-0000000d4001', '00000000-0000-0000-0000-0000000d4001',
   3, 'APE', 'EFFITRANS', 'CLIENT', 'CLIENT')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape and vocabulary.
-- ---------------------------------------------------------------------------
do $$
declare n int; bad_type boolean := false; bad_dpi boolean := false; dpe boolean := false;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='customs_record'
     and column_name in ('sh_position_count','declaration_type','dpi_regime',
                         'exemption_title_origin','tariff_classification_origin')
     and is_nullable='YES';
  insert into _r values ('five_columns_present_and_nullable', n);
  if n <> 5 then raise exception 'D4 shape FAIL: expected 5 nullable governed columns, got %', n; end if;

  -- D1: DPE must be UNSTORABLE.
  begin
    update public.customs_record set declaration_type = 'DPE'
     where id = '00000000-0000-0000-0000-0000000d40e1';
  exception when check_violation then dpe := true; end;

  begin
    update public.customs_record set declaration_type = 'INVENTED'
     where id = '00000000-0000-0000-0000-0000000d40e1';
  exception when check_violation then bad_type := true; end;

  begin
    update public.customs_record set dpi_regime = 'MAYBE'
     where id = '00000000-0000-0000-0000-0000000d40e1';
  exception when check_violation then bad_dpi := true; end;

  insert into _r values ('dpe_cannot_be_stored', case when dpe then 1 else 0 end),
                        ('invented_type_rejected', case when bad_type then 1 else 0 end),
                        ('invented_dpi_rejected', case when bad_dpi then 1 else 0 end);
  if not (dpe and bad_type and bad_dpi) then
    raise exception 'D4 vocabulary FAIL: dpe=% type=% dpi=%', dpe, bad_type, bad_dpi;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The correction door refuses everything it should, BEFORE validation.
-- ---------------------------------------------------------------------------
do $$
declare unvalidated boolean := false; noperm boolean := false;
begin
  -- Not validated yet: the correction door is not the entry door.
  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4002',
      'motif', 6, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then unvalidated := true; end;

  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4003',
      'motif', 6, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then noperm := true; end;

  insert into _r values ('unvalidated_record_refused', case when unvalidated then 1 else 0 end),
                        ('actor_without_customs_correct_refused', case when noperm then 1 else 0 end);
  if not (unvalidated and noperm) then
    raise exception 'D4 pre-validation FAIL: unvalidated=% noperm=%', unvalidated, noperm;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The Chef validates (the ordinary door), then corrects.
-- ---------------------------------------------------------------------------
do $$
declare no_reason boolean := false; blank_reason boolean := false; no_change boolean := false;
        xtenant boolean := false; v_at timestamptz;
begin
  perform public.record_customs_validation(
    '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4002');
  select reviewed_at into v_at from public.customs_record
   where id = '00000000-0000-0000-0000-0000000d40e1';
  insert into _r values ('chief_validated', case when v_at is not null then 1 else 0 end);
  if v_at is null then raise exception 'D4 FAIL: validation did not take'; end if;

  -- A motif is obligatory.
  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005',
      null, 6, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then no_reason := true; end;
  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005',
      '    ', 6, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then blank_reason := true; end;

  -- A correction must change something.
  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005',
      'rien ne change', 5, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then no_change := true; end;

  -- Cross-tenant actor, fully permissioned in HIS tenant.
  begin
    perform public.record_customs_correction(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4004',
      'motif', 6, 'DEP', 'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');
  exception when others then xtenant := true; end;

  insert into _r values ('null_reason_refused', case when no_reason then 1 else 0 end),
                        ('blank_reason_refused', case when blank_reason then 1 else 0 end),
                        ('no_op_correction_refused', case when no_change then 1 else 0 end),
                        ('cross_tenant_correction_refused', case when xtenant then 1 else 0 end);
  if not (no_reason and blank_reason and no_change and xtenant) then
    raise exception 'D4 guard FAIL: reason=% blank=% nochange=% xtenant=%',
      no_reason, blank_reason, no_change, xtenant;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A real correction: old → new, actor, timestamp, displaced certification.
-- ---------------------------------------------------------------------------
do $$
declare v_corr record; v_rec record; n int;
begin
  perform public.record_customs_correction(
    '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005',
    'Position SH corrigée après contrôle documentaire', 7, 'OG',
    'SANS_DPI', 'SANS_OBJET', 'EFFITRANS');

  select * into v_corr from public.customs_correction
   where customs_id = '00000000-0000-0000-0000-0000000d40e1';
  select * into v_rec from public.customs_record
   where id = '00000000-0000-0000-0000-0000000d40e1';

  insert into _r values
    ('correction_row_written', case when v_corr.id is not null then 1 else 0 end),
    ('reason_preserved', case when v_corr.reason = 'Position SH corrigée après contrôle documentaire' then 1 else 0 end),
    ('actor_recorded', case when v_corr.corrected_by = '00000000-0000-0000-0000-0000000d4005' then 1 else 0 end),
    ('timestamp_recorded', case when v_corr.corrected_at is not null then 1 else 0 end),
    ('old_value_traced', case when (v_corr.changes->'sh_position_count'->>'old') = '5' then 1 else 0 end),
    ('new_value_traced', case when (v_corr.changes->'sh_position_count'->>'new') = '7' then 1 else 0 end),
    ('type_change_traced', case when (v_corr.changes->'declaration_type'->>'old') = 'DEP'
                             and (v_corr.changes->'declaration_type'->>'new') = 'OG' then 1 else 0 end),
    ('unchanged_field_absent', case when v_corr.changes ? 'dpi_regime' then 0 else 1 end),
    ('displaced_validator_kept', case when v_corr.validated_by_before = '00000000-0000-0000-0000-0000000d4002' then 1 else 0 end),
    ('displaced_instant_kept', case when v_corr.validated_at_before is not null then 1 else 0 end),
    ('new_values_applied', case when v_rec.sh_position_count = 7 and v_rec.declaration_type = 'OG' then 1 else 0 end),
    ('certification_cleared', case when v_rec.reviewed_at is null and v_rec.reviewed_by is null then 1 else 0 end),
    ('corrector_is_last_editor', case when v_rec.updated_by = '00000000-0000-0000-0000-0000000d4005' then 1 else 0 end);

  if v_corr.id is null then raise exception 'D4 FAIL: no correction row'; end if;
  if (v_corr.changes->'sh_position_count'->>'old') <> '5' then raise exception 'D4 FAIL: old value not traced'; end if;
  if v_rec.reviewed_at is not null then raise exception 'D4 FAIL: certification not cleared'; end if;
  if v_corr.changes ? 'dpi_regime' then raise exception 'D4 FAIL: unchanged field recorded as changed'; end if;

  select count(*) into n from public.business_event
   where subject_id = '00000000-0000-0000-0000-0000000d40e1' and event_type = 'CUSTOMS_CORRECTED';
  insert into _r values ('one_corrected_event', n);
  if n <> 1 then raise exception 'D4 FAIL: expected exactly 1 CUSTOMS_CORRECTED, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The history is APPEND-ONLY.
-- ---------------------------------------------------------------------------
do $$
declare upd boolean := false; del boolean := false;
begin
  begin
    update public.customs_correction set reason = 'rewritten'
     where customs_id = '00000000-0000-0000-0000-0000000d40e1';
  exception when others then upd := true; end;
  begin
    delete from public.customs_correction
     where customs_id = '00000000-0000-0000-0000-0000000d40e1';
  exception when others then del := true; end;

  insert into _r values ('history_update_refused', case when upd then 1 else 0 end),
                        ('history_delete_refused', case when del then 1 else 0 end);
  if not (upd and del) then raise exception 'D4 WORM FAIL: update=% delete=%', upd, del; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Recertification — and the separation of duties around it.
-- ---------------------------------------------------------------------------
do $$
declare self_reval boolean := false; ordinary boolean := false;
        never_corrected boolean := false; xtenant boolean := false; v_at timestamptz; n int;
begin
  -- The corrector may not recertify his own correction.
  begin
    perform public.record_customs_revalidation(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005');
  exception when others then self_reval := true; end;

  -- Nor may he slip through the ORDINARY validation: he is now the last
  -- editor, and migration 104 already refuses that. The two compose.
  begin
    perform public.record_customs_validation(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4005');
  exception when others then ordinary := true; end;

  -- A record that was never corrected cannot be revalidated.
  begin
    perform public.record_customs_revalidation(
      '00000000-0000-0000-0000-0000000d40e2', '00000000-0000-0000-0000-0000000d4002');
  exception when others then never_corrected := true; end;

  begin
    perform public.record_customs_revalidation(
      '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4004');
  exception when others then xtenant := true; end;

  insert into _r values ('corrector_cannot_revalidate_own', case when self_reval then 1 else 0 end),
                        ('corrector_cannot_use_ordinary_validation', case when ordinary then 1 else 0 end),
                        ('never_corrected_cannot_revalidate', case when never_corrected then 1 else 0 end),
                        ('cross_tenant_revalidation_refused', case when xtenant then 1 else 0 end);
  if not (self_reval and ordinary and never_corrected and xtenant) then
    raise exception 'D4 revalidation guard FAIL: self=% ordinary=% never=% xtenant=%',
      self_reval, ordinary, never_corrected, xtenant;
  end if;

  -- THE RATIFIED CASE: the Déclarant recertifies the Chef's correction.
  perform public.record_customs_revalidation(
    '00000000-0000-0000-0000-0000000d40e1', '00000000-0000-0000-0000-0000000d4001');
  select reviewed_at into v_at from public.customs_record
   where id = '00000000-0000-0000-0000-0000000d40e1';
  insert into _r values ('declarant_revalidated', case when v_at is not null then 1 else 0 end);
  if v_at is null then raise exception 'D4 FAIL: the declarant could not revalidate'; end if;

  select count(*) into n from public.business_event
   where subject_id = '00000000-0000-0000-0000-0000000d40e1' and event_type = 'CUSTOMS_REVALIDATED';
  insert into _r values ('one_revalidated_event', n);
  if n <> 1 then raise exception 'D4 FAIL: expected exactly 1 CUSTOMS_REVALIDATED, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. PG-6 is intact: the declarant holds no first-validation authority.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000d4001'
     and p.code = 'customs:validate';
  insert into _r values ('declarant_holds_no_customs_validate', case when n = 0 then 1 else 0 end);
  if n <> 0 then raise exception 'D4 FAIL: the declarant acquired customs:validate'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. OPS-SEC-1 grants on both new RPCs.
-- ---------------------------------------------------------------------------
do $$
declare r record; anon_ok boolean; auth_ok boolean; svc_ok boolean;
begin
  for r in select unnest(array['record_customs_correction','record_customs_revalidation']) as fname loop
    select has_function_privilege('anon', p.oid, 'execute') into anon_ok
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=r.fname;
    select has_function_privilege('authenticated', p.oid, 'execute') into auth_ok
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=r.fname;
    select has_function_privilege('service_role', p.oid, 'execute') into svc_ok
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname=r.fname;
    insert into _r values (r.fname || '_anon_cannot_execute', case when anon_ok then 0 else 1 end),
                          (r.fname || '_authenticated_cannot_execute', case when auth_ok then 0 else 1 end),
                          (r.fname || '_service_role_can_execute', case when svc_ok then 1 else 0 end);
    if anon_ok or auth_ok or not svc_ok then
      raise exception 'D4 GRANT FAIL on %: anon=% auth=% svc=%', r.fname, anon_ok, auth_ok, svc_ok;
    end if;
  end loop;
end $$;

select * from _r order by check_name;
rollback;
