-- Behaviour test — MAYA-P1.1 Finance GAINDE registration (CEO step 8).
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves the DATABASE enforces what the UI presents:
--   * an actor holding customs:register succeeds
--   * an actor holding ONLY customs:update is REFUSED — the broad permission
--     must never substitute for the narrow one
--   * an actor with neither is refused
--   * cross-tenant and forged actors are refused
--   * an empty reference is refused
--   * the same reference twice is refused; a correction is accepted
--   * NO customs status moves
--   * provider_code / provider_synced_at are untouched (no fake sync)
--   * Chef Transit validation state is untouched
--   * exactly one GAINDE_REGISTRATION_RECORDED per accepted act
--   * the RPC is service_role only
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

-- ---------------------------------------------------------------------------
-- Fixture. Self-contained.
--   finance  — holds customs:register (the CEO's owner)
--   updater  — holds customs:update ONLY (the broad-permission substitute test)
--   noperm   — holds neither
--   othertn  — holds customs:register in ANOTHER tenant
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b1001', 'p11-finance@test.local'),
  ('00000000-0000-0000-0000-0000000b1002', 'p11-updater@test.local'),
  ('00000000-0000-0000-0000-0000000b1003', 'p11-noperm@test.local'),
  ('00000000-0000-0000-0000-0000000b1004', 'p11-othertenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000b10b2', 'P11 Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-000000000001', 'p11-finance@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-000000000001', 'p11-updater@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000b1003', '00000000-0000-0000-0000-000000000001', 'p11-noperm@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000b1004', '00000000-0000-0000-0000-0000000b10b2', 'p11-othertenant@test.local', 'active')
on conflict (id) do nothing;

insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000b10c1', '00000000-0000-0000-0000-000000000001', 'P11_FINANCE', 'Finance douane (test P11)'),
  ('00000000-0000-0000-0000-0000000b10c2', '00000000-0000-0000-0000-000000000001', 'P11_UPDATER', 'Editeur douane (test P11)'),
  ('00000000-0000-0000-0000-0000000b10c3', '00000000-0000-0000-0000-0000000b10b2', 'P11_FINANCE_B', 'Finance douane B (test P11)')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000b10c1', p.id from public.permission p where p.code = 'customs:register'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000b10c2', p.id from public.permission p where p.code = 'customs:update'
on conflict do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000b10c3', p.id from public.permission p where p.code = 'customs:register'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-0000000b10c1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-0000000b10c2', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000b1004', '00000000-0000-0000-0000-0000000b10c3', '00000000-0000-0000-0000-0000000b10b2')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000b10d1', '00000000-0000-0000-0000-000000000001', 'P11 Client')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000b10f1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-95001', 'IMP', '00000000-0000-0000-0000-0000000b10d1')
on conflict (id) do nothing;
insert into public.customs_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000b10e1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b10f1', 'DECLARED')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='customs_record'
     and column_name in ('gainde_registered_at','gainde_registered_by')
     and is_nullable='YES';
  insert into _r values ('registration_columns_nullable', n);
  if n <> 2 then raise exception 'P11 shape FAIL: expected 2 nullable columns, got %', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Refusals — including THE key one: customs:update must not substitute.
-- ---------------------------------------------------------------------------
do $$
declare updater boolean := false; noperm boolean := false;
        xtenant boolean := false; forged boolean := false; empty_ref boolean := false;
begin
  -- THE CENTRAL CASE. This actor can already edit external_ref through
  -- updateCustoms — and must still be refused HERE, because the narrow Finance
  -- capability is the authority for the registration ACT.
  begin
    perform public.record_gainde_registration('00000000-0000-0000-0000-0000000b10e1', 'GND-X', '00000000-0000-0000-0000-0000000b1002');
  exception when others then updater := true; end;

  begin
    perform public.record_gainde_registration('00000000-0000-0000-0000-0000000b10e1', 'GND-X', '00000000-0000-0000-0000-0000000b1003');
  exception when others then noperm := true; end;

  begin
    perform public.record_gainde_registration('00000000-0000-0000-0000-0000000b10e1', 'GND-X', '00000000-0000-0000-0000-0000000b1004');
  exception when others then xtenant := true; end;

  begin
    perform public.record_gainde_registration('00000000-0000-0000-0000-0000000b10e1', 'GND-X', '00000000-0000-0000-0000-0000deadbeef');
  exception when others then forged := true; end;

  begin
    perform public.record_gainde_registration('00000000-0000-0000-0000-0000000b10e1', '   ', '00000000-0000-0000-0000-0000000b1001');
  exception when others then empty_ref := true; end;

  insert into _r values ('customs_update_cannot_substitute', case when updater then 1 else 0 end),
                        ('noperm_refused', case when noperm then 1 else 0 end),
                        ('cross_tenant_refused', case when xtenant then 1 else 0 end),
                        ('forged_actor_refused', case when forged then 1 else 0 end),
                        ('empty_reference_refused', case when empty_ref then 1 else 0 end);
  if not (updater and noperm and xtenant and forged and empty_ref) then
    raise exception 'P11 REFUSAL FAIL: update=% noperm=% xtenant=% forged=% empty=%',
      updater, noperm, xtenant, forged, empty_ref;
  end if;
end $$;

do $$
declare v_ref text; v_at timestamptz;
begin
  select external_ref, gainde_registered_at into v_ref, v_at
    from public.customs_record where id='00000000-0000-0000-0000-0000000b10e1';
  insert into _r values ('unchanged_after_refusals', case when v_ref is null and v_at is null then 1 else 0 end);
  if v_ref is not null or v_at is not null then
    raise exception 'P11 FAIL: a refused attempt wrote state (ref=% at=%)', v_ref, v_at;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Finance succeeds — status untouched, no fake sync, one event.
-- ---------------------------------------------------------------------------
do $$
declare v_ref text; v_at timestamptz; v_by uuid;
        st_before text; st_after text; pc_before text; pc_after text;
        ps_after timestamptz; rv_after timestamptz; ev_before int; ev_after int;
begin
  select status, provider_code into st_before, pc_before
    from public.customs_record where id='00000000-0000-0000-0000-0000000b10e1';
  select count(*) into ev_before from public.business_event
   where event_type='GAINDE_REGISTRATION_RECORDED' and subject_id='00000000-0000-0000-0000-0000000b10e1';

  perform public.record_gainde_registration(
    '00000000-0000-0000-0000-0000000b10e1', '  GND-2026-4417  ', '00000000-0000-0000-0000-0000000b1001');

  select external_ref, gainde_registered_at, gainde_registered_by, status,
         provider_code, provider_synced_at, reviewed_at
    into v_ref, v_at, v_by, st_after, pc_after, ps_after, rv_after
    from public.customs_record where id='00000000-0000-0000-0000-0000000b10e1';
  select count(*) into ev_after from public.business_event
   where event_type='GAINDE_REGISTRATION_RECORDED' and subject_id='00000000-0000-0000-0000-0000000b10e1';

  insert into _r values
    ('reference_recorded', case when v_ref='GND-2026-4417' then 1 else 0 end),
    ('reference_trimmed', case when v_ref='GND-2026-4417' then 1 else 0 end),
    ('registrar_recorded', case when v_by='00000000-0000-0000-0000-0000000b1001' then 1 else 0 end),
    ('instant_written_by_server', case when v_at is not null then 1 else 0 end),
    ('status_unchanged', case when st_before is not distinct from st_after then 1 else 0 end),
    ('provider_code_unchanged', case when pc_before is not distinct from pc_after then 1 else 0 end),
    ('no_fake_sync', case when ps_after is null then 1 else 0 end),
    ('validation_untouched', case when rv_after is null then 1 else 0 end),
    ('one_event_appended', ev_after - ev_before);

  if v_ref <> 'GND-2026-4417' or v_at is null or v_by is null then
    raise exception 'P11 WRITE FAIL: ref=% at=% by=%', v_ref, v_at, v_by;
  end if;
  if st_before is distinct from st_after then
    raise exception 'P11 GATE FAIL: registration moved the customs status (% -> %)', st_before, st_after;
  end if;
  if ps_after is not null or pc_before is distinct from pc_after then
    raise exception 'P11 SYNC FAIL: registration must not touch provider state';
  end if;
  if rv_after is not null then
    raise exception 'P11 FAIL: registration must not touch Chef Transit validation';
  end if;
  if ev_after - ev_before <> 1 then
    raise exception 'P11 EVENT FAIL: expected exactly 1, got %', ev_after - ev_before;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The same reference is refused; a correction is accepted and marked.
-- ---------------------------------------------------------------------------
do $$
declare dup boolean := false; v_ref text; corrected boolean; first_corrected boolean;
begin
  begin
    perform public.record_gainde_registration(
      '00000000-0000-0000-0000-0000000b10e1', 'GND-2026-4417', '00000000-0000-0000-0000-0000000b1001');
  exception when others then dup := true; end;

  perform public.record_gainde_registration(
    '00000000-0000-0000-0000-0000000b10e1', 'GND-2026-4418', '00000000-0000-0000-0000-0000000b1001');
  select external_ref into v_ref from public.customs_record where id='00000000-0000-0000-0000-0000000b10e1';
  -- SELECT THE EVENT BY ITS REFERENCE, NOT BY TIME.
  -- `business_event.occurred_at` defaults to now(), which in PostgreSQL is
  -- TRANSACTION START time — identical for every row this suite writes, since
  -- the whole file runs inside one BEGIN. `order by occurred_at desc limit 1`
  -- therefore picks arbitrarily between the two registrations, and picked the
  -- wrong one in CI #450. The reference identifies the row unambiguously.
  select (metadata->>'corrected')::boolean into corrected from public.business_event
   where event_type='GAINDE_REGISTRATION_RECORDED'
     and subject_id='00000000-0000-0000-0000-0000000b10e1'
     and metadata->>'reference' = 'GND-2026-4418';

  -- The FIRST registration must NOT be flagged as a correction. Asserting both
  -- rows is only possible because selection is by reference rather than time.
  select (metadata->>'corrected')::boolean into first_corrected from public.business_event
   where event_type='GAINDE_REGISTRATION_RECORDED'
     and subject_id='00000000-0000-0000-0000-0000000b10e1'
     and metadata->>'reference' = 'GND-2026-4417';

  insert into _r values ('duplicate_reference_refused', case when dup then 1 else 0 end),
                        ('correction_accepted', case when v_ref='GND-2026-4418' then 1 else 0 end),
                        ('correction_flagged', case when corrected then 1 else 0 end),
                        ('first_registration_not_flagged', case when first_corrected then 0 else 1 end);
  if first_corrected then
    raise exception 'P11 FAIL: the first registration must not be marked a correction';
  end if;
  if not dup then raise exception 'P11 FAIL: an identical reference must be refused'; end if;
  if v_ref <> 'GND-2026-4418' then raise exception 'P11 FAIL: a correction must be accepted'; end if;
  if not corrected then raise exception 'P11 FAIL: a correction must be marked as one'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. OPS-SEC-1 grants.
-- ---------------------------------------------------------------------------
do $$
declare anon_ok boolean; auth_ok boolean; svc_ok boolean;
begin
  select has_function_privilege('anon', p.oid, 'execute') into anon_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_gainde_registration';
  select has_function_privilege('authenticated', p.oid, 'execute') into auth_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_gainde_registration';
  select has_function_privilege('service_role', p.oid, 'execute') into svc_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_gainde_registration';
  insert into _r values ('anon_cannot_execute', case when anon_ok then 0 else 1 end),
                        ('authenticated_cannot_execute', case when auth_ok then 0 else 1 end),
                        ('service_role_can_execute', case when svc_ok then 1 else 0 end);
  if anon_ok or auth_ok or not svc_ok then
    raise exception 'P11 GRANT FAIL: anon=% auth=% svc=%', anon_ok, auth_ok, svc_ok;
  end if;
end $$;

select * from _r order by check_name;
rollback;
