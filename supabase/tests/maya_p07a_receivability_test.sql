-- Schema/behaviour test — MAYA-P0.7-A recevabilité. Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Quality Control N°3 (Déclarant en Douane). Proves the DATABASE enforces what
-- the application promises, so no future caller can route around it:
--   * the four columns exist and are all nullable (null = not yet assessed)
--   * an outcome outside the ratified three is refused
--   * NON_RECEVABLE / SOUS_RESERVE without a reason are refused
--   * the decision writes its own date and author (never trusted from input)
--   * a business_event is appended in the SAME transaction as the decision
--   * the identical repeat is refused, but a genuine change is accepted
--   * the RPC is service_role only — never anon, never authenticated
--   * recevabilité changes NO customs status: it gates nothing
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

-- SELF-CONTAINED ACTOR. The RPC now carries an OPS-SEC-2A trust contract, so
-- p_actor must be a real, active user of the target tenant who genuinely holds
-- customs:update. This suite provisions its own rather than borrowing another
-- suite's fixture id — the same id means different things in different suites.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000007a0a01', 'qc3-declarant@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000007a0a01', '00000000-0000-0000-0000-000000000001', 'qc3-declarant@test.local', 'active')
on conflict (id) do nothing;
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000007a0b01', '00000000-0000-0000-0000-000000000001', 'QC3_TEST_DECLARANT', 'Déclarant (test QC3)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000007a0b01', p.id from public.permission p
 where p.code = 'customs:update'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000007a0a01', '00000000-0000-0000-0000-0000007a0b01', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000c7a01', '00000000-0000-0000-0000-000000000001', 'QC3 Client')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-0000000f7a01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-97001', 'IMP', '00000000-0000-0000-0000-0000000c7a01')
on conflict (id) do nothing;
insert into public.customs_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000d7a01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000f7a01', 'DOCUMENTS_PENDING')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape: four columns, all nullable.
-- ---------------------------------------------------------------------------
do $$
declare n int; nn int;
begin
  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='customs_record'
     and column_name in ('receivability_status','receivability_at','receivability_by','receivability_note');
  select count(*) into nn from information_schema.columns
   where table_schema='public' and table_name='customs_record'
     and column_name like 'receivability%' and is_nullable='NO';
  insert into _r values ('columns_present', n), ('columns_not_null', nn);
  if n <> 4 or nn <> 0 then raise exception 'QC3 shape FAIL: n=% notnull=%', n, nn; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. An unassessed record reads NULL — never a default outcome.
-- ---------------------------------------------------------------------------
do $$
declare v text;
begin
  select receivability_status into v from public.customs_record
   where id='00000000-0000-0000-0000-0000000d7a01';
  insert into _r values ('unassessed_is_null', case when v is null then 1 else 0 end);
  if v is not null then raise exception 'QC3 FAIL: a fresh record must be unassessed, got %', v; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Invalid outcome, and missing reasons, are refused.
-- ---------------------------------------------------------------------------
do $$
declare bad_outcome boolean := false; no_reason_nr boolean := false; no_reason_sr boolean := false;
begin
  begin
    perform public.record_customs_receivability('00000000-0000-0000-0000-0000000d7a01', 'MAYBE', 'x', '00000000-0000-0000-0000-0000007a0a01');
  exception when others then bad_outcome := true; end;
  begin
    perform public.record_customs_receivability('00000000-0000-0000-0000-0000000d7a01', 'NON_RECEVABLE', '   ', '00000000-0000-0000-0000-0000007a0a01');
  exception when others then no_reason_nr := true; end;
  begin
    perform public.record_customs_receivability('00000000-0000-0000-0000-0000000d7a01', 'SOUS_RESERVE', null, '00000000-0000-0000-0000-0000007a0a01');
  exception when others then no_reason_sr := true; end;

  insert into _r values ('invalid_outcome_refused', case when bad_outcome then 1 else 0 end),
                        ('non_recevable_needs_reason', case when no_reason_nr then 1 else 0 end),
                        ('sous_reserve_needs_reason', case when no_reason_sr then 1 else 0 end);
  if not (bad_outcome and no_reason_nr and no_reason_sr) then
    raise exception 'QC3 guard FAIL: bad=% nr=% sr=%', bad_outcome, no_reason_nr, no_reason_sr;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. A valid decision writes outcome + date + author, and appends ONE event.
--    The status is captured before and after: recevabilité gates nothing.
-- ---------------------------------------------------------------------------
do $$
declare v_status text; v_at timestamptz; v_by uuid; v_note text;
        ev_before int; ev_after int; st_before text; st_after text;
begin
  select status into st_before from public.customs_record where id='00000000-0000-0000-0000-0000000d7a01';
  select count(*) into ev_before from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED' and subject_id='00000000-0000-0000-0000-0000000d7a01';

  perform public.record_customs_receivability(
    '00000000-0000-0000-0000-0000000d7a01', 'NON_RECEVABLE', '  facture manquante  ',
    '00000000-0000-0000-0000-0000007a0a01');

  select receivability_status, receivability_at, receivability_by, receivability_note, status
    into v_status, v_at, v_by, v_note, st_after
    from public.customs_record where id='00000000-0000-0000-0000-0000000d7a01';
  select count(*) into ev_after from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED' and subject_id='00000000-0000-0000-0000-0000000d7a01';

  insert into _r values
    ('decision_recorded', case when v_status='NON_RECEVABLE' then 1 else 0 end),
    ('date_written_by_server', case when v_at is not null then 1 else 0 end),
    ('author_recorded', case when v_by='00000000-0000-0000-0000-0000007a0a01' then 1 else 0 end),
    ('reason_trimmed', case when v_note='facture manquante' then 1 else 0 end),
    ('one_event_appended', ev_after - ev_before),
    ('status_unchanged', case when st_before is not distinct from st_after then 1 else 0 end);

  if v_status <> 'NON_RECEVABLE' or v_at is null or v_by is null or v_note <> 'facture manquante' then
    raise exception 'QC3 write FAIL: status=% at=% by=% note=%', v_status, v_at, v_by, v_note;
  end if;
  if ev_after - ev_before <> 1 then
    raise exception 'QC3 event FAIL: expected exactly 1 appended event, got %', ev_after - ev_before;
  end if;
  if st_before is distinct from st_after then
    raise exception 'QC3 GATE FAIL: recevabilite must not move the customs status (% -> %)', st_before, st_after;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The reason TEXT must not reach the immutable ledger (WES-9A rule) —
--    only whether one was given.
-- ---------------------------------------------------------------------------
do $$
declare md jsonb; leaked int;
begin
  -- Selected by OUTCOME, not by time. `occurred_at` defaults to now(), which is
  -- TRANSACTION START time, so every event this suite writes shares one value
  -- and `order by occurred_at desc` cannot break a tie. Only one event exists
  -- at this point today, so the old form passed — but it was a latent flake,
  -- and the identical pattern failed in CI #450 in the P1.1 suite.
  select metadata into md from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED'
     and subject_id='00000000-0000-0000-0000-0000000d7a01'
     and metadata->>'to_status' = 'NON_RECEVABLE';
  select count(*) into leaked from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED'
     and metadata::text ilike '%facture manquante%';

  insert into _r values ('has_reason_flag', case when md->>'has_reason' = 'true' then 1 else 0 end),
                        ('to_status_in_event', case when md->>'to_status' = 'NON_RECEVABLE' then 1 else 0 end),
                        ('reason_text_leaked', leaked);
  if md->>'has_reason' <> 'true' or md->>'to_status' <> 'NON_RECEVABLE' then
    raise exception 'QC3 metadata FAIL: %', md;
  end if;
  if leaked <> 0 then raise exception 'QC3 LEAK: the reason text reached the ledger'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The identical repeat is refused; a genuine change is accepted.
-- ---------------------------------------------------------------------------
do $$
declare dup boolean := false; ev_before int; ev_after int; v_status text;
begin
  select count(*) into ev_before from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED' and subject_id='00000000-0000-0000-0000-0000000d7a01';
  begin
    perform public.record_customs_receivability(
      '00000000-0000-0000-0000-0000000d7a01', 'NON_RECEVABLE', 'facture manquante',
      '00000000-0000-0000-0000-0000007a0a01');
  exception when others then dup := true; end;
  select count(*) into ev_after from public.business_event
   where event_type='CUSTOMS_RECEIVABILITY_DECIDED' and subject_id='00000000-0000-0000-0000-0000000d7a01';

  -- …but the file becoming receivable later is a legitimate NEW decision.
  perform public.record_customs_receivability(
    '00000000-0000-0000-0000-0000000d7a01', 'RECEVABLE', null,
    '00000000-0000-0000-0000-0000007a0a01');
  select receivability_status into v_status from public.customs_record
   where id='00000000-0000-0000-0000-0000000d7a01';

  insert into _r values ('identical_repeat_refused', case when dup then 1 else 0 end),
                        ('repeat_appended_nothing', ev_after - ev_before),
                        ('redecision_accepted', case when v_status='RECEVABLE' then 1 else 0 end);
  if not dup then raise exception 'QC3 FAIL: an identical repeat must be refused'; end if;
  if ev_after <> ev_before then raise exception 'QC3 FAIL: a refused repeat must append no event'; end if;
  if v_status <> 'RECEVABLE' then raise exception 'QC3 FAIL: re-deciding must be allowed, got %', v_status; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. OPS-SEC-1: the definer RPC is service_role only.
-- ---------------------------------------------------------------------------
do $$
declare anon_ok boolean; auth_ok boolean; svc_ok boolean;
begin
  select has_function_privilege('anon', p.oid, 'execute') into anon_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_receivability';
  select has_function_privilege('authenticated', p.oid, 'execute') into auth_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_receivability';
  select has_function_privilege('service_role', p.oid, 'execute') into svc_ok
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='record_customs_receivability';

  insert into _r values ('anon_cannot_execute', case when anon_ok then 0 else 1 end),
                        ('authenticated_cannot_execute', case when auth_ok then 0 else 1 end),
                        ('service_role_can_execute', case when svc_ok then 1 else 0 end);
  if anon_ok or auth_ok or not svc_ok then
    raise exception 'QC3 GRANT FAIL: anon=% auth=% svc=%', anon_ok, auth_ok, svc_ok;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 8. No criteria structure was created, and the status ladder is untouched.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  -- PRECISE, deliberately. An earlier '%receivab%' matched
  -- `legacy_receivable_link` (FIN-AGING-2) — an ACCOUNTS-RECEIVABLE table with
  -- nothing to do with recevabilité. The concept being guarded is
  -- "receivability"/"recevabilite", and neither substring occurs in
  -- "receivable", so this says what it means.
  select count(*) into n from information_schema.tables
   where table_schema='public'
     and (table_name ilike '%receivability%' or table_name ilike '%recevabilite%');
  insert into _r values ('no_receivability_table', case when n=0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'QC3 FAIL: no receivability table may exist (found %)', n;
  end if;

  select count(*) into n from pg_constraint
   where conrelid='public.customs_record'::regclass
     and pg_get_constraintdef(oid) ilike '%NOT_STARTED%'
     and pg_get_constraintdef(oid) ilike '%RECEVABLE%';
  insert into _r values ('status_ladder_untouched', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'QC3 FAIL: recevabilite must not enter the status ladder'; end if;
end $$;

select * from _r order by check_name;
rollback;
