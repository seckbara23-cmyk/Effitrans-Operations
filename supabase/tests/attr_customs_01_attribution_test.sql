-- Behaviour test — ATTR-CUSTOMS-01: customs actor attribution.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
-- ---------------------------------------------------------------------------
-- Proves, in the DATABASE, through the real RPCs and the real trigger:
--
--   THE SEQUENCE (asserted after EVERY act)
--   1  Chef validates step 7            reviewed_by = Chef, CUSTOMS_VALIDATED → Chef
--   2  field agent records the BAE      BAE_RECORDED → field agent   (was: Chef)
--   3  Chef refuses with a motif        CUSTOMS_RELEASE_REJECTED → Chef
--   4  field agent re-records the BAE   no second BAE_RECORDED; replacement → field agent
--   5  Chef approves                    CUSTOMS_RELEASE_APPROVED → Chef
--   6  field agent finalises            reviewed_by STILL Chef       (was: field agent)
--                                       released_by = field agent
--                                       CUSTOMS_RELEASE_COMPLETED → field agent
--   Throughout: reviewed_at never moves; recorder, approver and finaliser are
--   each on their own column.
--
--   NEGATIVES
--   8  a status move after validation is NOT attributed to the validator
--   9  maker/checker: the BAE recorder may not approve it (unchanged)
--   10 an unattributed release is refused and changes nothing
--   11 the legacy reference path yields an honest NULL, never the validator
--
--   THE PRODUCTION CORRECTION (supabase/data-corrections/…00011.sql), UNMODIFIED
--   12 a reviewed_by-only UPDATE emits no business event
--   13 the correction restores the validator, changes no other column
--      (updated_at included), emits no event, writes one trace — under the
--      pre-ATTR trigger production runs today AND under the new one
--   14 a second run is refused (fail-closed once the defect is gone)
--
-- The fixture deliberately reuses EFT-IMP-2026-00011's production identifiers,
-- so the correction script is exercised byte-for-byte as it would run in
-- production. Test emails only; everything is rolled back.

begin;

create temp table _attr_r (check_name text, value text) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture.
--   chef      f12f6fdf… — customs:validate only
--   field     38ff054a… — customs:release only (the step 13 field agent)
--   declarant b00dce7b… — customs:update only (the maker)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('f12f6fdf-9f05-4768-b5cd-224ce2a06167', 'attr-chef@test.local'),
  ('38ff054a-2a14-4f65-bb5a-1902050bc48f', 'attr-field@test.local'),
  ('b00dce7b-6c3b-42da-ac9c-45ab0b241e06', 'attr-declarant@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('f12f6fdf-9f05-4768-b5cd-224ce2a06167', '00000000-0000-0000-0000-000000000001', 'attr-chef@test.local', 'active'),
  ('38ff054a-2a14-4f65-bb5a-1902050bc48f', '00000000-0000-0000-0000-000000000001', 'attr-field@test.local', 'active'),
  ('b00dce7b-6c3b-42da-ac9c-45ab0b241e06', '00000000-0000-0000-0000-000000000001', 'attr-declarant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-00000a77c0c1', '00000000-0000-0000-0000-000000000001', 'ATTR_DECLARANT', 'Déclarant (test ATTR)'),
  ('00000000-0000-0000-0000-00000a77c0c2', '00000000-0000-0000-0000-000000000001', 'ATTR_CHIEF', 'Chef de Transit (test ATTR)'),
  ('00000000-0000-0000-0000-00000a77c0c3', '00000000-0000-0000-0000-000000000001', 'ATTR_FIELD', 'Agent de Terrain (test ATTR)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000a77c0c1', p.id from public.permission p where p.code = 'customs:update'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000a77c0c2', p.id from public.permission p where p.code = 'customs:validate'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000a77c0c3', p.id from public.permission p where p.code = 'customs:release'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('b00dce7b-6c3b-42da-ac9c-45ab0b241e06', '00000000-0000-0000-0000-00000a77c0c1', '00000000-0000-0000-0000-000000000001'),
  ('f12f6fdf-9f05-4768-b5cd-224ce2a06167', '00000000-0000-0000-0000-00000a77c0c2', '00000000-0000-0000-0000-000000000001'),
  ('38ff054a-2a14-4f65-bb5a-1902050bc48f', '00000000-0000-0000-0000-00000a77c0c3', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000a77cd01', '00000000-0000-0000-0000-000000000001', 'ATTR Client')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('7f8e6fb8-aafd-4932-b87a-b34cdca177f3', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2026-00011', 'IMP', '00000000-0000-0000-0000-00000a77cd01'),
  ('00000000-0000-0000-0000-00000a77cf02', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97102', 'IMP', '00000000-0000-0000-0000-00000a77cd01'),
  ('00000000-0000-0000-0000-00000a77cf03', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97103', 'IMP', '00000000-0000-0000-0000-00000a77cd01');

-- The Déclarant prepared all three; nobody has validated yet.
insert into public.customs_record (id, tenant_id, file_id, status, created_by, updated_by) values
  ('91d80919-8aaa-43cb-a5d3-24002b72850b', '00000000-0000-0000-0000-000000000001', '7f8e6fb8-aafd-4932-b87a-b34cdca177f3',
   'INSPECTION', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06'),
  ('00000000-0000-0000-0000-00000a77ce02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000a77cf02',
   'INSPECTION', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06'),
  ('00000000-0000-0000-0000-00000a77ce03', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000a77cf03',
   'DECLARED', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06', 'b00dce7b-6c3b-42da-ac9c-45ab0b241e06');

-- ---------------------------------------------------------------------------
-- Helpers. Events are ordered by `ordinal`, never `occurred_at`: every event
-- in this single transaction shares one occurred_at.
-- ---------------------------------------------------------------------------
create function pg_temp.attr_actor(p_subject uuid, p_type text) returns uuid
language sql as $$
  select actor_user_id from public.business_event
   where subject_type = 'customs_record' and subject_id = p_subject and event_type = p_type
   order by ordinal desc limit 1
$$;

create function pg_temp.attr_count(p_subject uuid, p_type text) returns int
language sql as $$
  select count(*)::int from public.business_event
   where subject_type = 'customs_record' and subject_id = p_subject and event_type = p_type
$$;

create function pg_temp.attr_expect_actor(p_stage text, p_subject uuid, p_type text, p_actor uuid) returns void
language plpgsql as $$
declare v_actor uuid;
begin
  if pg_temp.attr_count(p_subject, p_type) = 0 then
    raise exception 'ATTR FAIL [%]: no % event was emitted', p_stage, p_type;
  end if;
  v_actor := pg_temp.attr_actor(p_subject, p_type);
  if v_actor is distinct from p_actor then
    raise exception 'ATTR FAIL [%]: % is attributed to %, expected %', p_stage, p_type, v_actor, p_actor;
  end if;
  insert into _attr_r values ('actor  ' || p_stage || ' — ' || p_type, coalesce(p_actor::text, 'NULL'));
end $$;

-- The four facts, each on its own column, plus the validation instant.
create function pg_temp.attr_facts(
  p_stage text, p_customs uuid, p_reviewer uuid, p_reviewed_at timestamptz,
  p_recorder uuid, p_approver uuid, p_finaliser uuid
) returns void
language plpgsql as $$
declare r record;
begin
  select reviewed_by, reviewed_at, bae_recorded_by, release_approval_by, released_by
    into r from public.customs_record where id = p_customs;
  if r.reviewed_by is distinct from p_reviewer then
    raise exception 'ATTR FAIL [%]: reviewed_by is %, expected the step 7 validator %', p_stage, r.reviewed_by, p_reviewer;
  end if;
  if r.reviewed_at is distinct from p_reviewed_at then
    raise exception 'ATTR FAIL [%]: the validation instant moved (% -> %)', p_stage, p_reviewed_at, r.reviewed_at;
  end if;
  if r.bae_recorded_by is distinct from p_recorder then
    raise exception 'ATTR FAIL [%]: bae_recorded_by is %, expected %', p_stage, r.bae_recorded_by, p_recorder;
  end if;
  if r.release_approval_by is distinct from p_approver then
    raise exception 'ATTR FAIL [%]: release_approval_by is %, expected %', p_stage, r.release_approval_by, p_approver;
  end if;
  if r.released_by is distinct from p_finaliser then
    raise exception 'ATTR FAIL [%]: released_by is %, expected %', p_stage, r.released_by, p_finaliser;
  end if;
  insert into _attr_r values ('facts  ' || p_stage, 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- 1–6. The sequence, on the dossier production UAT ran.
-- ---------------------------------------------------------------------------
do $$
declare
  c_chef  constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167';
  c_field constant uuid := '38ff054a-2a14-4f65-bb5a-1902050bc48f';
  c_cust  constant uuid := '91d80919-8aaa-43cb-a5d3-24002b72850b';
  v_at    timestamptz;
  v_meta  jsonb;
  v_status text;
begin
  -- 1. The Chef validates step 7.
  perform public.record_customs_validation(c_cust, c_chef);
  select reviewed_at into v_at from public.customs_record where id = c_cust;
  if v_at is null then raise exception 'ATTR FAIL [1]: the validation recorded no instant'; end if;
  perform pg_temp.attr_facts('1 Chef validates step 7', c_cust, c_chef, v_at, null, null, null);
  perform pg_temp.attr_expect_actor('1', c_cust, 'CUSTOMS_VALIDATED', c_chef);

  -- 2. The field agent records the BAE.
  perform public.record_customs_bae(c_cust, 'BAE-ATTR-0001', c_field);
  perform pg_temp.attr_facts('2 field agent records BAE', c_cust, c_chef, v_at, c_field, null, null);
  -- THE LEDGER HALF OF THE DEFECT: the trigger used to name the step 7 Chef here.
  perform pg_temp.attr_expect_actor('2', c_cust, 'BAE_RECORDED', c_field);
  perform pg_temp.attr_expect_actor('2', c_cust, 'CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION', c_field);

  -- 3. The Chef refuses, with a motif.
  perform public.record_customs_release_approval(c_cust, 'REJECTED', 'Référence illisible (test ATTR)', c_chef);
  perform pg_temp.attr_facts('3 Chef refuses the release', c_cust, c_chef, v_at, c_field, c_chef, null);
  perform pg_temp.attr_expect_actor('3', c_cust, 'CUSTOMS_RELEASE_REJECTED', c_chef);

  -- 4. The field agent corrects the BAE: a re-recording, not a first one.
  perform public.record_customs_bae(c_cust, 'BAE-ATTR-0002', c_field);
  perform pg_temp.attr_facts('4 field agent re-records BAE', c_cust, c_chef, v_at, c_field, null, null);
  if pg_temp.attr_count(c_cust, 'BAE_RECORDED') <> 1 then
    raise exception 'ATTR FAIL [4]: a re-recording must not emit a second BAE_RECORDED (found %)', pg_temp.attr_count(c_cust, 'BAE_RECORDED');
  end if;
  if pg_temp.attr_count(c_cust, 'CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION') <> 2 then
    raise exception 'ATTR FAIL [4]: expected two recordings in the ledger';
  end if;
  select metadata into v_meta from public.business_event
   where subject_id = c_cust and event_type = 'CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION'
   order by ordinal desc limit 1;
  if (v_meta ->> 'replaced')::boolean is not true or (v_meta ->> 'after_rejection')::boolean is not true then
    raise exception 'ATTR FAIL [4]: the replacement is not recorded as one: %', v_meta;
  end if;
  perform pg_temp.attr_expect_actor('4', c_cust, 'CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION', c_field);
  perform pg_temp.attr_expect_actor('4', c_cust, 'BAE_RECORDED', c_field);

  -- 5. The Chef approves.
  perform public.record_customs_release_approval(c_cust, 'APPROVED', null, c_chef);
  perform pg_temp.attr_facts('5 Chef approves the release', c_cust, c_chef, v_at, c_field, c_chef, null);
  perform pg_temp.attr_expect_actor('5', c_cust, 'CUSTOMS_RELEASE_APPROVED', c_chef);

  -- 6. The field agent finalises. THE RECORD HALF OF THE DEFECT: reviewed_by
  --    used to become the field agent here.
  perform public.record_customs_release(c_cust, 'BAE-ATTR-0002', c_field, null, null);
  select status into v_status from public.customs_record where id = c_cust;
  if v_status <> 'RELEASED' then raise exception 'ATTR FAIL [6]: status is %, expected RELEASED', v_status; end if;
  perform pg_temp.attr_facts('6 field agent finalises the release', c_cust, c_chef, v_at, c_field, c_chef, c_field);
  perform pg_temp.attr_expect_actor('6', c_cust, 'CUSTOMS_RELEASE_COMPLETED', c_field);
  perform pg_temp.attr_expect_actor('6', c_cust, 'CUSTOMS_STATUS_CHANGED', c_field);

  -- …and nothing earlier was re-attributed or re-emitted.
  perform pg_temp.attr_expect_actor('6', c_cust, 'CUSTOMS_VALIDATED', c_chef);
  perform pg_temp.attr_expect_actor('6', c_cust, 'BAE_RECORDED', c_field);
  perform pg_temp.attr_expect_actor('6', c_cust, 'CUSTOMS_RELEASE_APPROVED', c_chef);
  if pg_temp.attr_count(c_cust, 'CUSTOMS_VALIDATED') <> 1
     or pg_temp.attr_count(c_cust, 'BAE_RECORDED') <> 1
     or pg_temp.attr_count(c_cust, 'CUSTOMS_RELEASE_COMPLETED') <> 1 then
    raise exception 'ATTR FAIL [6]: a milestone was emitted more than once';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8–10. Negatives on a second record.
-- ---------------------------------------------------------------------------
do $$
declare
  c_chef  constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167';
  c_field constant uuid := '38ff054a-2a14-4f65-bb5a-1902050bc48f';
  c_r2    constant uuid := '00000000-0000-0000-0000-00000a77ce02';
  v_at    timestamptz;
  v_raised boolean;
  v_msg   text;
begin
  perform public.record_customs_validation(c_r2, c_chef);
  select reviewed_at into v_at from public.customs_record where id = c_r2;

  -- 8. A lifecycle move nobody attributed is NOT the validator's.
  update public.customs_record set status = 'DUTIES_ASSESSED' where id = c_r2;
  perform pg_temp.attr_expect_actor('8 status move after validation', c_r2, 'CUSTOMS_STATUS_CHANGED', null);
  perform pg_temp.attr_facts('8 status move after validation', c_r2, c_chef, v_at, null, null, null);

  -- 9. Maker/checker on the BAE is unchanged: its recorder may not approve it.
  perform public.record_customs_bae(c_r2, 'BAE-ATTR-R2', c_field);
  v_raised := false;
  begin
    perform public.record_customs_release_approval(c_r2, 'APPROVED', null, c_field);
  exception when others then v_raised := true; v_msg := sqlerrm;
  end;
  if not v_raised or v_msg not like 'self_approval_forbidden%' then
    raise exception 'ATTR FAIL [9]: the recorder approving their own BAE must be refused, got: %', coalesce(v_msg, 'no error');
  end if;
  insert into _attr_r values ('guard  9 recorder may not approve', 'refused');

  -- 10. An unattributed release is refused and leaves the record untouched.
  v_raised := false; v_msg := null;
  begin
    perform public.record_customs_release(c_r2, 'BAE-ATTR-R2', null, null, null);
  exception when others then v_raised := true; v_msg := sqlerrm;
  end;
  if not v_raised or v_msg not like '%actor is required%' then
    raise exception 'ATTR FAIL [10]: a release without an actor must be refused, got: %', coalesce(v_msg, 'no error');
  end if;
  if (select status from public.customs_record where id = c_r2) = 'RELEASED' then
    raise exception 'ATTR FAIL [10]: the refused release still released';
  end if;
  perform pg_temp.attr_facts('10 unattributed release refused', c_r2, c_chef, v_at, c_field, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- 11. The legacy reference path names nobody — never the validator.
-- ---------------------------------------------------------------------------
do $$
declare
  c_chef  constant uuid := 'f12f6fdf-9f05-4768-b5cd-224ce2a06167';
  c_field constant uuid := '38ff054a-2a14-4f65-bb5a-1902050bc48f';
  c_r3    constant uuid := '00000000-0000-0000-0000-00000a77ce03';
  v_at    timestamptz;
begin
  perform public.record_customs_validation(c_r3, c_chef);
  select reviewed_at into v_at from public.customs_record where id = c_r3;
  perform public.record_bae_reference(c_r3, 'BAE-ATTR-LEGACY', c_field);
  perform pg_temp.attr_expect_actor('11 legacy reference path', c_r3, 'BAE_RECORDED', null);
  perform pg_temp.attr_facts('11 legacy reference path', c_r3, c_chef, v_at, null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- 12. Reproduce EFT-IMP-2026-00011 exactly as production holds it.
-- ---------------------------------------------------------------------------
-- Provenance B, as recordCustomsValidation's writeAudit records the step 7 act.
insert into public.audit_log (tenant_id, actor_id, action, entity, entity_id, after)
values ('00000000-0000-0000-0000-000000000001', 'f12f6fdf-9f05-4768-b5cd-224ce2a06167',
        'customs.updated', 'customs_record', '91d80919-8aaa-43cb-a5d3-24002b72850b',
        jsonb_build_object('reviewed_by', 'f12f6fdf-9f05-4768-b5cd-224ce2a06167'));

do $$
declare n_before bigint; n_after bigint;
begin
  select count(*) into n_before from public.business_event;
  -- What the pre-ATTR record_customs_release wrote on 00011, and nothing more.
  update public.customs_record set reviewed_by = '38ff054a-2a14-4f65-bb5a-1902050bc48f'
   where id = '91d80919-8aaa-43cb-a5d3-24002b72850b';
  select count(*) into n_after from public.business_event;
  if n_after <> n_before then
    raise exception 'ATTR FAIL [12]: a reviewed_by-only update emitted % business events', n_after - n_before;
  end if;
  insert into _attr_r values ('K      12 reviewed_by-only update emits nothing', '0 events');
end $$;

create temp table _attr_before on commit drop as
  select to_jsonb(c) as snapshot,
         c.updated_at,
         (select count(*) from public.business_event) as events,
         (select count(*) from public.audit_log) as audits
    from public.customs_record c
   where c.id = '91d80919-8aaa-43cb-a5d3-24002b72850b';

create function pg_temp.attr_assert_corrected(p_label text) returns void
language plpgsql as $$
declare b record; r public.customs_record%rowtype; n bigint;
begin
  select * into b from _attr_before;
  select * into r from public.customs_record where id = '91d80919-8aaa-43cb-a5d3-24002b72850b';
  if r.reviewed_by is distinct from 'f12f6fdf-9f05-4768-b5cd-224ce2a06167'::uuid then
    raise exception 'ATTR FAIL [13 %]: reviewed_by is % after the correction', p_label, r.reviewed_by;
  end if;
  if (to_jsonb(r) - 'reviewed_by') is distinct from (b.snapshot - 'reviewed_by') then
    raise exception 'ATTR FAIL [13 %]: a column other than reviewed_by changed', p_label;
  end if;
  if r.updated_at is distinct from b.updated_at then
    raise exception 'ATTR FAIL [13 %]: updated_at moved (% -> %)', p_label, b.updated_at, r.updated_at;
  end if;
  select count(*) into n from public.business_event;
  if n <> b.events then
    raise exception 'ATTR FAIL [13 %]: the correction appended % business events', p_label, n - b.events;
  end if;
  select count(*) into n from public.audit_log;
  if n <> b.audits + 1 then
    raise exception 'ATTR FAIL [13 %]: expected exactly one audit trace, audit_log grew by %', p_label, n - b.audits;
  end if;
  select count(*) into n from public.audit_log
   where entity_id = '91d80919-8aaa-43cb-a5d3-24002b72850b'
     and action = 'customs.attribution_corrected' and actor_id is null;
  if n <> 1 then
    raise exception 'ATTR FAIL [13 %]: the trace row is missing or borrows an identity', p_label;
  end if;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.customs_record'::regclass and not tgisinternal and tgenabled <> 'O';
  if n <> 0 then
    raise exception 'ATTR FAIL [13 %]: % customs_record triggers were left disabled', p_label, n;
  end if;
  insert into _attr_r values ('fix    13 correction ' || p_label, 'ok');
end $$;

-- ---------------------------------------------------------------------------
-- 13a. Under the customs trigger PRODUCTION RUNS TODAY — 20260727000001,
--      verbatim — because the correction may be applied before #143.
-- ---------------------------------------------------------------------------
savepoint attr_pre_migration_trigger;

create or replace function public.emit_customs_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_RECORD_CREATED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.created_by,
      jsonb_build_object('required', new.required));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_STATUS_CHANGED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'DECLARED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_DECLARED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.declaration_number));
    elsif new.status = 'RELEASED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_RELEASE_COMPLETED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.bae_reference));
    end if;
  end if;

  if new.bae_reference is not null and old.bae_reference is null then
    perform public.emit_business_event(
      new.tenant_id, 'BAE_RECORDED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('reference', new.bae_reference));
  end if;

  return null;
exception
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on customs_record (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

\ir ../data-corrections/attr_customs_01_eft_imp_2026_00011.sql
select pg_temp.attr_assert_corrected('under the pre-ATTR trigger');

rollback to savepoint attr_pre_migration_trigger;

-- ---------------------------------------------------------------------------
-- 13b. Under the ATTR-CUSTOMS-01 trigger, with the defect restored by the
--      savepoint rollback.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select reviewed_by from public.customs_record where id = '91d80919-8aaa-43cb-a5d3-24002b72850b')
     is distinct from '38ff054a-2a14-4f65-bb5a-1902050bc48f'::uuid then
    raise exception 'ATTR FAIL [13b]: the savepoint did not restore the simulated defect';
  end if;
  if (select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'emit_customs_events') ~ 'reviewed_by' then
    raise exception 'ATTR FAIL [13b]: the ATTR-CUSTOMS-01 trigger is not the one installed';
  end if;
end $$;

\ir ../data-corrections/attr_customs_01_eft_imp_2026_00011.sql
select pg_temp.attr_assert_corrected('under the ATTR-CUSTOMS-01 trigger');

-- ---------------------------------------------------------------------------
-- 14. A second run is refused: the defect is gone, so there is nothing the
--     script is allowed to touch.
-- ---------------------------------------------------------------------------
\set ON_ERROR_STOP 0
savepoint attr_rerun;
\ir ../data-corrections/attr_customs_01_eft_imp_2026_00011.sql
\if :ERROR
  rollback to savepoint attr_rerun;
  insert into _attr_r values ('fix    14 a second run is refused', 'refused');
\else
  \set ON_ERROR_STOP 1
  do $$ begin raise exception 'ATTR FAIL [14]: the correction ran a second time — it must refuse once reviewed_by is correct'; end $$;
\endif
\set ON_ERROR_STOP 1

-- ---------------------------------------------------------------------------
-- Verdict.
-- ---------------------------------------------------------------------------
select check_name, value from _attr_r order by check_name;

do $$
declare n int;
begin
  -- EXACTLY 27: 9 fact checks, 14 actor checks, the maker/checker guard, the
  -- reviewed_by-only update, the correction under the new trigger, and the
  -- refused rerun. (The pre-ATTR-trigger run records its row inside a savepoint
  -- that is rolled back, by design.) Fewer means a block silently did not run.
  select count(*) into n from _attr_r;
  if n <> 27 then
    raise exception 'ATTR FAIL: % checks recorded, expected 27 — a block was skipped', n;
  end if;
  raise notice 'ATTR-CUSTOMS-01 OK: % attribution checks hold', n;
end $$;

rollback;
