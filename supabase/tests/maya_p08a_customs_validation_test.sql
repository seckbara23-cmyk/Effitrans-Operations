-- Behaviour test — MAYA-P0.8-A (PG-1) Chef de Transit validation.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the DATABASE enforces what the UI merely presents:
--   * an actor without customs:validate is refused
--   * the PREPARER cannot validate their own record, even holding the permission
--   * the last EDITOR cannot validate either (PG-6 — the editor half)
--   * a different holder CAN validate
--   * a cross-tenant actor is refused
--   * a forged / nonexistent actor is refused
--   * validation is ONE-TIME
--   * validation moves NO customs status
--   * exactly one CUSTOMS_VALIDATED event is appended
--   * an instant always carries an author (one-sided by necessity — see §5)
--   * the RPC is service_role only
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture. Self-contained: this suite provisions its own users and roles.
--   maker   — holds customs:update AND customs:validate (the realistic danger:
--             a Chef de Transit who prepared the record himself)
--   checker — holds customs:validate, did not create the record
--   noperm  — holds neither
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000008a001', 'pg1-maker@test.local'),
  ('00000000-0000-0000-0000-00000008a002', 'pg1-checker@test.local'),
  ('00000000-0000-0000-0000-00000008a003', 'pg1-noperm@test.local'),
  ('00000000-0000-0000-0000-00000008a004', 'pg1-othertenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-00000008a0b2', 'PG1 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000008a001', '00000000-0000-0000-0000-000000000001', 'pg1-maker@test.local', 'active'),
  ('00000000-0000-0000-0000-00000008a002', '00000000-0000-0000-0000-000000000001', 'pg1-checker@test.local', 'active'),
  ('00000000-0000-0000-0000-00000008a003', '00000000-0000-0000-0000-000000000001', 'pg1-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-00000008a004', '00000000-0000-0000-0000-00000008a0b2', 'pg1-othertenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-00000008a0c1', '00000000-0000-0000-0000-000000000001', 'PG1_CHECKER', 'Valideur (test PG1)'),
  ('00000000-0000-0000-0000-00000008a0c2', '00000000-0000-0000-0000-00000008a0b2', 'PG1_CHECKER_B', 'Valideur B (test PG1)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000008a0c1', p.id from public.permission p
 where p.code in ('customs:validate', 'customs:update')
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000008a0c2', p.id from public.permission p
 where p.code = 'customs:validate'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-00000008a001', '00000000-0000-0000-0000-00000008a0c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000008a002', '00000000-0000-0000-0000-00000008a0c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000008a004', '00000000-0000-0000-0000-00000008a0c2', '00000000-0000-0000-0000-00000008a0b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000008a0d1', '00000000-0000-0000-0000-000000000001', 'PG1 Client')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000008a0f1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-00000008a0d1')
on conflict (id) do nothing;
-- created_by = the MAKER. This is what the separation is tested against.
insert into public.customs_record (id, tenant_id, file_id, status, created_by) values
  ('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000008a0f1', 'DECLARED', '00000000-0000-0000-0000-00000008a001')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='customs_record'
     and column_name='reviewed_at' and is_nullable='YES';
  insert into _r values ('reviewed_at_nullable', n);
  if n <> 1 then raise exception 'PG1 shape FAIL'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Refusals: no permission, the preparer, cross-tenant, forged actor.
-- ---------------------------------------------------------------------------
do $$
declare noperm boolean := false; maker boolean := false;
        xtenant boolean := false; forged boolean := false; nullactor boolean := false;
begin
  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a003');
  exception when others then noperm := true; end;

  -- THE CENTRAL CASE. This actor HOLDS customs:validate and would pass every
  -- permission check — and must still be refused, because he prepared it.
  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a001');
  exception when others then maker := true; end;

  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a004');
  exception when others then xtenant := true; end;

  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-0000deadbeef');
  exception when others then forged := true; end;

  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', null);
  exception when others then nullactor := true; end;

  insert into _r values ('noperm_refused', case when noperm then 1 else 0 end),
                        ('maker_self_validation_refused', case when maker then 1 else 0 end),
                        ('cross_tenant_refused', case when xtenant then 1 else 0 end),
                        ('forged_actor_refused', case when forged then 1 else 0 end),
                        ('null_actor_refused', case when nullactor then 1 else 0 end);
  if not (noperm and maker and xtenant and forged and nullactor) then
    raise exception 'PG1 REFUSAL FAIL: noperm=% maker=% xtenant=% forged=% null=%',
      noperm, maker, xtenant, forged, nullactor;
  end if;
end $$;

-- Nothing was written by any refused attempt.
do $$
declare v_by uuid; v_at timestamptz;
begin
  select reviewed_by, reviewed_at into v_by, v_at
    from public.customs_record where id='00000000-0000-0000-0000-00000008a0e1';
  insert into _r values ('unchanged_after_refusals', case when v_by is null and v_at is null then 1 else 0 end);
  if v_by is not null or v_at is not null then
    raise exception 'PG1 FAIL: a refused attempt wrote state (by=% at=%)', v_by, v_at;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2b. PG-6 — the EDITOR half. This is the hole PG-1 left open: a checker who
--     did not create the record but EDITED it would have been allowed to
--     validate their own edit. `checker` is used here precisely because he is
--     otherwise a legitimate validator.
-- ---------------------------------------------------------------------------
do $$
declare editor_blocked boolean := false;
begin
  update public.customs_record
     set updated_by = '00000000-0000-0000-0000-00000008a002'
   where id = '00000000-0000-0000-0000-00000008a0e1';

  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a002');
  exception when others then editor_blocked := true; end;

  insert into _r values ('editor_self_validation_refused', case when editor_blocked then 1 else 0 end);
  if not editor_blocked then
    raise exception 'PG6 FAIL: the last editor must not be able to validate';
  end if;

  -- Clear it so section 3 can prove the legitimate path still works.
  update public.customs_record set updated_by = null
   where id = '00000000-0000-0000-0000-00000008a0e1';
end $$;

-- ---------------------------------------------------------------------------
-- 3. The checker succeeds — and moves no status. Exactly one event.
-- ---------------------------------------------------------------------------
do $$
declare v_by uuid; v_at timestamptz; st_before text; st_after text;
        ev_before int; ev_after int;
begin
  select status into st_before from public.customs_record where id='00000000-0000-0000-0000-00000008a0e1';
  select count(*) into ev_before from public.business_event
   where event_type='CUSTOMS_VALIDATED' and subject_id='00000000-0000-0000-0000-00000008a0e1';

  perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a002');

  select reviewed_by, reviewed_at, status into v_by, v_at, st_after
    from public.customs_record where id='00000000-0000-0000-0000-00000008a0e1';
  select count(*) into ev_after from public.business_event
   where event_type='CUSTOMS_VALIDATED' and subject_id='00000000-0000-0000-0000-00000008a0e1';

  insert into _r values
    ('checker_validated', case when v_by='00000000-0000-0000-0000-00000008a002' then 1 else 0 end),
    ('instant_written_by_server', case when v_at is not null then 1 else 0 end),
    ('status_unchanged', case when st_before is not distinct from st_after then 1 else 0 end),
    ('one_event_appended', ev_after - ev_before);

  if v_by <> '00000000-0000-0000-0000-00000008a002' or v_at is null then
    raise exception 'PG1 WRITE FAIL: by=% at=%', v_by, v_at;
  end if;
  if st_before is distinct from st_after then
    raise exception 'PG1 GATE FAIL: validation moved the customs status (% -> %)', st_before, st_after;
  end if;
  if ev_after - ev_before <> 1 then
    raise exception 'PG1 EVENT FAIL: expected exactly 1, got %', ev_after - ev_before;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One-time: a second validation is refused and appends nothing.
-- ---------------------------------------------------------------------------
do $$
declare again boolean := false; ev_before int; ev_after int; v_by uuid;
begin
  select count(*) into ev_before from public.business_event
   where event_type='CUSTOMS_VALIDATED' and subject_id='00000000-0000-0000-0000-00000008a0e1';
  begin
    perform public.record_customs_validation('00000000-0000-0000-0000-00000008a0e1', '00000000-0000-0000-0000-00000008a002');
  exception when others then again := true; end;
  select count(*) into ev_after from public.business_event
   where event_type='CUSTOMS_VALIDATED' and subject_id='00000000-0000-0000-0000-00000008a0e1';
  select reviewed_by into v_by from public.customs_record where id='00000000-0000-0000-0000-00000008a0e1';

  insert into _r values ('revalidation_refused', case when again then 1 else 0 end),
                        ('revalidation_appended_nothing', ev_after - ev_before),
                        ('original_validator_preserved', case when v_by='00000000-0000-0000-0000-00000008a002' then 1 else 0 end);
  if not again then raise exception 'PG1 FAIL: re-validation must be refused'; end if;
  if ev_after <> ev_before then raise exception 'PG1 FAIL: a refused re-validation appended an event'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. An instant always has an author — and legacy rows keep their unknown state.
--
--    The constraint is deliberately ONE-SIDED. Production already held rows with
--    `reviewed_by` set and no instant, so requiring both to move together could
--    only have been satisfied by inventing a timestamp for a control decision.
--    What IS forbidden is the unattributable direction: an instant with no author.
-- ---------------------------------------------------------------------------
do $$
declare blocked boolean := false; legacy_ok boolean := true;
begin
  begin
    update public.customs_record set reviewed_by = null
     where id='00000000-0000-0000-0000-00000008a0e1';
  exception when others then blocked := true; end;

  -- The legacy shape must remain representable, or the migration could not
  -- have been applied at all.
  begin
    insert into public.customs_record (id, tenant_id, file_id, status, reviewed_by)
    values ('00000000-0000-0000-0000-00000008a0e9', '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-00000008a0f1', 'DECLARED',
            '00000000-0000-0000-0000-00000008a002');
  exception when unique_violation then null; when others then legacy_ok := false; end;

  insert into _r values ('instant_without_author_blocked', case when blocked then 1 else 0 end),
                        ('legacy_reviewer_without_instant_allowed', case when legacy_ok then 1 else 0 end);
  if not blocked then raise exception 'PG1 FAIL: an instant must always carry an author'; end if;
  if not legacy_ok then raise exception 'PG1 FAIL: legacy reviewed_by rows must stay representable'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. OPS-SEC-1 grants.
-- ---------------------------------------------------------------------------
do $$
declare anon_ok boolean; auth_ok boolean; svc_ok boolean;
begin
  select has_function_privilege('anon', p.oid, 'execute') into anon_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_validation';
  select has_function_privilege('authenticated', p.oid, 'execute') into auth_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_validation';
  select has_function_privilege('service_role', p.oid, 'execute') into svc_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_validation';
  insert into _r values ('anon_cannot_execute', case when anon_ok then 0 else 1 end),
                        ('authenticated_cannot_execute', case when auth_ok then 0 else 1 end),
                        ('service_role_can_execute', case when svc_ok then 1 else 0 end);
  if anon_ok or auth_ok or not svc_ok then
    raise exception 'PG1 GRANT FAIL: anon=% auth=% svc=%', anon_ok, auth_ok, svc_ok;
  end if;
end $$;

select * from _r order by check_name;
rollback;
