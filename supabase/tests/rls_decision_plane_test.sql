-- RLS + invariants test — UT-1 Decision Plane ordering (migration 85). BEGIN/ROLLBACK.
--
-- Proves in real PostgreSQL what no static reader can:
--   * every new event receives an ordinal, strictly increasing;
--   * events emitted in ONE transaction share occurred_at (that is the defect)
--     yet receive DIFFERENT, INCREASING ordinals (that is the fix);
--   * a caller CANNOT supply an ordinal — a spoofed value is discarded;
--   * an ordinal cannot be updated afterwards, nor can any event row;
--   * a pre-existing NULL ordinal is left untouched and occurred_at unchanged;
--   * subject-based visibility: dossier / commercial prologue / correspondence
--     prologue / configuration, with SYSTEM_ADMIN NARROWED and portal at zero.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d101', 'ut1-ops@test.local'),
  ('00000000-0000-0000-0000-00000000d102', 'ut1-quote@test.local'),
  ('00000000-0000-0000-0000-00000000d103', 'ut1-mail@test.local'),
  ('00000000-0000-0000-0000-00000000d104', 'ut1-admin@test.local'),
  ('00000000-0000-0000-0000-00000000d105', 'ut1-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-000000000001', 'ut1-ops@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-000000000001', 'ut1-quote@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-000000000001', 'ut1-mail@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000d104', '00000000-0000-0000-0000-000000000001', 'ut1-admin@test.local', 'active')
on conflict (id) do nothing;

-- Real seeded roles: the point is whether the ratified matrix can see its own history.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000d102', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'QUOTATION_MANAGER'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000d104', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- A mail reader: no seeded role holds communication:inbound:read.
insert into public.role (id, tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-00000000d1b1', '00000000-0000-0000-0000-000000000001',
   'UT1_MAIL_READER', 'Lecteur courrier (test)', 'UT1 Mail Reader', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-00000000d1b1', p.id from public.permission p
where p.code = 'communication:inbound:read' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-00000000d1b1', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000d1c1', '00000000-0000-0000-0000-000000000001', 'Client UT1')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000d1f1', '00000000-0000-0000-0000-000000000001',
   'UT1-TEST-0001', 'IMP', '00000000-0000-0000-0000-00000000d1c1', 'DRAFT')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-00000000d105', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000d1c1', 'ut1-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  e1 uuid; e2 uuid; e3 uuid; legacy uuid;
  o1 bigint; o2 bigint; o3 bigint;
  t1 timestamptz; t2 timestamptz; t3 timestamptz;
  same_txn_same_time int := 0; increasing int := 0; all_assigned int := 0;
  spoof_ordinal bigint; spoof_rejected int := 0;
  update_rejected int := 0; delete_rejected int := 0;
  legacy_ordinal_null int := 0; legacy_time_unchanged int := 0;
  legacy_time_before timestamptz; legacy_time_after timestamptz;
  ops_sees int; quote_sees int; mail_sees int;
  admin_sees_commercial int; admin_sees_policy int; portal_sees int;
  nobody_sees int;
begin
  perform set_config('role', 'postgres', true);

  -- ---------------------------------------------------------------------
  -- 0. A PRE-ORDINAL row: inserted with the trigger disabled, so it looks
  --    exactly like history written before migration 85.
  -- ---------------------------------------------------------------------
  alter table public.business_event disable trigger trg_business_event_ordinal;
  insert into public.business_event
    (tenant_id, event_type, event_domain, event_version, source,
     dossier_id, subject_type, subject_id, occurred_at)
  values ('00000000-0000-0000-0000-000000000001', 'DOSSIER_OPENED', 'dossier', 1, 'db_trigger',
          '00000000-0000-0000-0000-00000000d1f1', 'operational_file',
          '00000000-0000-0000-0000-00000000d1f1', now())
  returning id, occurred_at into legacy, legacy_time_before;
  alter table public.business_event enable trigger trg_business_event_ordinal;

  -- ---------------------------------------------------------------------
  -- 1. THREE events in ONE transaction — the exact case UT-0 found broken.
  -- ---------------------------------------------------------------------
  select public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'DOSSIER_OPENED', 'dossier', 'policy_rpc',
    'operational_file', '00000000-0000-0000-0000-00000000d1f1',
    '00000000-0000-0000-0000-00000000d1f1', '00000000-0000-0000-0000-00000000d101') into e1;
  select public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'DOSSIER_STATUS_CHANGED', 'dossier', 'policy_rpc',
    'operational_file', '00000000-0000-0000-0000-00000000d1f1',
    '00000000-0000-0000-0000-00000000d1f1', '00000000-0000-0000-0000-00000000d101') into e2;
  select public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'DOSSIER_STATUS_CHANGED', 'dossier', 'policy_rpc',
    'operational_file', '00000000-0000-0000-0000-00000000d1f1',
    '00000000-0000-0000-0000-00000000d1f1', '00000000-0000-0000-0000-00000000d101') into e3;

  select ordinal, occurred_at into o1, t1 from public.business_event where id = e1;
  select ordinal, occurred_at into o2, t2 from public.business_event where id = e2;
  select ordinal, occurred_at into o3, t3 from public.business_event where id = e3;

  -- The defect: identical timestamps, because now() is transaction start.
  if t1 = t2 and t2 = t3 then same_txn_same_time := 1; end if;
  -- The fix: strictly increasing ordinals give them a truthful order anyway.
  if o1 < o2 and o2 < o3 then increasing := 1; end if;
  if o1 is not null and o2 is not null and o3 is not null then all_assigned := 1; end if;

  -- ---------------------------------------------------------------------
  -- 2. SPOOFING — a caller supplies an ordinal; the trigger discards it.
  -- ---------------------------------------------------------------------
  insert into public.business_event
    (tenant_id, event_type, event_domain, event_version, source,
     dossier_id, subject_type, subject_id, ordinal)
  values ('00000000-0000-0000-0000-000000000001', 'DOSSIER_OPENED', 'dossier', 1, 'db_trigger',
          '00000000-0000-0000-0000-00000000d1f1', 'operational_file',
          '00000000-0000-0000-0000-00000000d1f1', -999)
  returning ordinal into spoof_ordinal;
  if spoof_ordinal <> -999 and spoof_ordinal > o3 then spoof_rejected := 1; end if;

  -- ---------------------------------------------------------------------
  -- 3. IMMUTABILITY — already guaranteed by prevent_mutation(); asserted here
  --    because the ordinal's value depends on it.
  -- ---------------------------------------------------------------------
  begin
    -- EXPECT-FAIL: the ledger is append-only for every role.
    update public.business_event set ordinal = 1 where id = e1;
  exception when others then update_rejected := 1;
  end;
  begin
    -- EXPECT-FAIL: append-only means no delete either.
    delete from public.business_event where id = e1;
  exception when others then delete_rejected := 1;
  end;

  -- ---------------------------------------------------------------------
  -- 4. HISTORY IS UNTOUCHED — no synthesised ordinal, no rewritten time.
  -- ---------------------------------------------------------------------
  select (case when ordinal is null then 1 else 0 end), occurred_at
    into legacy_ordinal_null, legacy_time_after
    from public.business_event where id = legacy;
  if legacy_time_after = legacy_time_before then legacy_time_unchanged := 1; end if;

  -- ---------------------------------------------------------------------
  -- 5. A prologue event of each kind, with NO dossier.
  -- ---------------------------------------------------------------------
  perform public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'QUOTATION_CREATED', 'commercial', 'policy_rpc',
    'quotation', gen_random_uuid(), null, '00000000-0000-0000-0000-00000000d102');
  perform public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'CORRESPONDENCE_TRIAGED', 'communication', 'policy_rpc',
    'ec_triage_item', gen_random_uuid(), null, '00000000-0000-0000-0000-00000000d103');
  perform public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'POLICY_ACTIVATED', 'policy', 'policy_rpc',
    'workflow_policy_version', gen_random_uuid(), null, null);

  -- ---------------------------------------------------------------------
  -- 6. SUBJECT-BASED VISIBILITY.
  -- ---------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  -- Dossier events: unchanged, via can_read_file.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d101','role','authenticated')::text, true);
  select count(*) into ops_sees from public.business_event
   where dossier_id = '00000000-0000-0000-0000-00000000d1f1';

  -- The quotation agent sees the COMMERCIAL prologue — the D5 gap, closed.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d102','role','authenticated')::text, true);
  select count(*) into quote_sees from public.business_event
   where dossier_id is null and event_domain = 'commercial';

  -- The mail reader sees the CORRESPONDENCE prologue, and not the commercial one.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d103','role','authenticated')::text, true);
  select count(*) into mail_sees from public.business_event
   where dossier_id is null and event_domain = 'communication';
  select count(*) into nobody_sees from public.business_event
   where dossier_id is null and event_domain = 'commercial';

  -- SYSTEM_ADMIN: config history YES, commercial prologue NO. It holds no
  -- quotation authority (DEC-C32), so this is a NARROWING, and it is the point.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d104','role','authenticated')::text, true);
  select count(*) into admin_sees_commercial from public.business_event
   where dossier_id is null and event_domain = 'commercial';
  select count(*) into admin_sees_policy from public.business_event
   where dossier_id is null and event_domain = 'policy';

  -- The portal has no policy on this table at all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-00000000d105','role','authenticated')::text, true);
  select count(*) into portal_sees from public.business_event;

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('same_txn_shares_timestamp', same_txn_same_time),
    ('ordinals_strictly_increasing', increasing),
    ('every_new_event_has_ordinal', all_assigned),
    ('supplied_ordinal_discarded', spoof_rejected),
    ('update_rejected', update_rejected), ('delete_rejected', delete_rejected),
    ('legacy_ordinal_still_null', legacy_ordinal_null),
    ('legacy_occurred_at_unchanged', legacy_time_unchanged),
    ('dossier_reader_sees', ops_sees),
    ('quotation_agent_sees_prologue', quote_sees),
    ('mail_reader_sees_correspondence', mail_sees),
    ('mail_reader_sees_commercial', nobody_sees),
    ('system_admin_sees_commercial', admin_sees_commercial),
    ('system_admin_sees_policy', admin_sees_policy),
    ('portal_sees', portal_sees);

  if same_txn_same_time<>1 or increasing<>1 or all_assigned<>1
     or spoof_rejected<>1 or update_rejected<>1 or delete_rejected<>1
     or legacy_ordinal_null<>1 or legacy_time_unchanged<>1
     or ops_sees<1 or quote_sees<1 or mail_sees<1
     or nobody_sees<>0 or admin_sees_commercial<>0 or admin_sees_policy<1
     or portal_sees<>0
  then
    raise exception 'UT-1 FAIL: sameTime=% incr=% assigned=% spoof=% upd=% del=% legacyNull=% legacyTime=% ops=% quote=% mail=% mailCommercial=% adminCommercial=% adminPolicy=% portal=%',
      same_txn_same_time, increasing, all_assigned, spoof_rejected,
      update_rejected, delete_rejected, legacy_ordinal_null, legacy_time_unchanged,
      ops_sees, quote_sees, mail_sees, nobody_sees,
      admin_sees_commercial, admin_sees_policy, portal_sees;
  end if;
end $$;

select * from _r order by check_name;
rollback;
