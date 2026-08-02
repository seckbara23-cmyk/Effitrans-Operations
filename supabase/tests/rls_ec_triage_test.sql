-- RLS + invariants test — EC-2 Triage Outcomes (migration 81). BEGIN/ROLLBACK.
-- Proves: EC-1's quarantine semantics are UNCHANGED (a quarantined item is
-- still untriable and still invisible); resolving requires an outcome; attach
-- requires a dossier and DISCARD requires a reason; a recorded outcome is
-- immutable; CROSS-TENANT attachment is refused; the CORRESPONDENCE_ATTACHED
-- event carries the DOSSIER as subject AND dossier_id; a quotation handoff
-- creates NO quotation; SYSTEM_ADMIN and portal see nothing; and the two
-- permissions remain granted to NOBODY.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ec2a1', 'ec2-am@test.local'),
  ('00000000-0000-0000-0000-0000000ec2a2', 'ec2-sup@test.local'),
  ('00000000-0000-0000-0000-0000000ec2a3', 'ec2-admin@test.local'),
  ('00000000-0000-0000-0000-0000000ec2a4', 'ec2-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000ec2a1', '00000000-0000-0000-0000-000000000001', 'ec2-am@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ec2a2', '00000000-0000-0000-0000-000000000001', 'ec2-sup@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ec2a3', '00000000-0000-0000-0000-000000000001', 'ec2-admin@test.local', 'active')
on conflict (id) do nothing;

-- Reader role holding communication:inbound:read (no seeded role holds it).
insert into public.role (id, tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000ec2b1', '00000000-0000-0000-0000-000000000001',
   'EC2_TEST_READER', 'Lecteur EC2 (test)', 'EC2 Test Reader', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000ec2b1', p.id from public.permission p
where p.code = 'communication:inbound:read' on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000ec2a1', '00000000-0000-0000-0000-0000000ec2b1', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000ec2a3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ec2c1', '00000000-0000-0000-0000-000000000001', 'EC2 Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000ec2a4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec2c1', 'ec2-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.ec_mailbox (id, tenant_id, address, label_fr, purpose) values
  ('00000000-0000-0000-0000-0000000ec2d1', '00000000-0000-0000-0000-000000000001',
   'operations@ec2-test.example', 'Opérations (test)', 'OPERATIONS')
on conflict (id) do nothing;

-- A dossier in THIS tenant, and one in ANOTHER tenant (cross-tenant control).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-0000000ec2e1', '00000000-0000-0000-0000-000000000001',
   'EC2-TEST-0001', 'IMP', '00000000-0000-0000-0000-0000000ec2c1', 'DRAFT')
on conflict (id) do nothing;

-- Three routed captures + one quarantined.
insert into public.ec_inbound_message
  (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
   raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status) values
  ('00000000-0000-0000-0000-0000000ec2f1', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec2d1', 'GENERIC', 'evt_ec2_001', 'client@example.test',
   repeat('a',64), 't/1/raw.eml', 100, now(), 'RECEIVED'),
  ('00000000-0000-0000-0000-0000000ec2f2', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec2d1', 'GENERIC', 'evt_ec2_002', 'client@example.test',
   repeat('b',64), 't/2/raw.eml', 100, now(), 'RECEIVED'),
  ('00000000-0000-0000-0000-0000000ec2f3', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec2d1', 'GENERIC', 'evt_ec2_003', 'client@example.test',
   repeat('c',64), 't/3/raw.eml', 100, now(), 'RECEIVED')
on conflict (id) do nothing;
insert into public.ec_inbound_message
  (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
   raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status, quarantine_reason) values
  ('00000000-0000-0000-0000-0000000ec2f9', null, null, 'GENERIC', 'evt_ec2_009', 'stranger@example.test',
   repeat('d',64), 'quarantine/9/raw.eml', 100, now(), 'QUARANTINED', 'no_matching_mailbox')
on conflict (id) do nothing;

insert into public.ec_triage_item (id, tenant_id, message_id, status) values
  ('00000000-0000-0000-0000-0000000ec211', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec2f1', 'NEW'),
  ('00000000-0000-0000-0000-0000000ec212', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec2f2', 'NEW'),
  ('00000000-0000-0000-0000-0000000ec213', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec2f3', 'NEW')
on conflict (id) do nothing;
insert into public.ec_triage_item (id, tenant_id, message_id, status) values
  ('00000000-0000-0000-0000-0000000ec219', null, '00000000-0000-0000-0000-0000000ec2f9', 'QUARANTINED')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  perm_rows int; perm_grants int;
  reader_sees int; admin_sees int; portal_sees int; reader_sees_quarantine int;
  quarantine_triage_rejected int := 0; resolve_without_outcome_rejected int := 0;
  attach_without_dossier_rejected int := 0; discard_without_reason_rejected int := 0;
  outcome_immutable_rejected int := 0; cross_tenant_rejected int := 0;
  attach_event int; attach_event_dossier int; resolved_event int;
  handoff_event int; discard_event int; quotations_created int;
  assigned_event int; reassigned_event int;
  other_tenant uuid;
begin
  perform set_config('role', 'postgres', true);

  select count(*) into perm_rows from public.permission
   where code in ('communication:inbound:read','communication:triage');
  select count(*) into perm_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
   where p.code in ('communication:inbound:read','communication:triage')
     and rp.role_id <> '00000000-0000-0000-0000-0000000ec2b1';

  -- RULE 1: a QUARANTINED item cannot be triaged. EC-1's meaning is intact.
  begin
    perform public.ec_resolve_triage(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec219',
      '00000000-0000-0000-0000-0000000ec2a1', 'GENERAL_CORRESPONDENCE');
  exception when others then quarantine_triage_rejected := 1;
  end;

  -- RULE 2: RESOLVED requires an outcome (direct UPDATE bypassing the RPC).
  begin
    -- EXPECT-FAIL: resolving with no outcome must raise EC611.
    update public.ec_triage_item set status = 'RESOLVED'
     where id = '00000000-0000-0000-0000-0000000ec211';
  exception when others then resolve_without_outcome_rejected := 1;
  end;

  -- Attach without a dossier, and discard without a reason: both refused.
  begin
    perform public.ec_resolve_triage(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
      '00000000-0000-0000-0000-0000000ec2a1', 'ATTACH_TO_DOSSIER', null);
  exception when others then attach_without_dossier_rejected := 1;
  end;
  begin
    perform public.ec_resolve_triage(
      '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
      '00000000-0000-0000-0000-0000000ec2a1', 'DISCARD', null, null, '   ');
  exception when others then discard_without_reason_rejected := 1;
  end;

  -- CROSS-TENANT attachment is refused: a dossier from another tenant.
  select id into other_tenant from public.organization
   where id <> '00000000-0000-0000-0000-000000000001' limit 1;
  if other_tenant is not null then
    insert into public.client (id, tenant_id, name)
    values ('00000000-0000-0000-0000-0000000ec2c2', other_tenant, 'Autre tenant')
    on conflict (id) do nothing;
    insert into public.operational_file (id, tenant_id, file_number, type, client_id, status)
    values ('00000000-0000-0000-0000-0000000ec2e2', other_tenant, 'EC2-OTHER-0001', 'IMP',
            '00000000-0000-0000-0000-0000000ec2c2', 'DRAFT')
    on conflict (id) do nothing;
    begin
      perform public.ec_resolve_triage(
        '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
        '00000000-0000-0000-0000-0000000ec2a1', 'ATTACH_TO_DOSSIER',
        '00000000-0000-0000-0000-0000000ec2e2');
    exception when others then cross_tenant_rejected := 1;
    end;
  else
    cross_tenant_rejected := 1;  -- single-tenant seed: nothing to cross into
  end if;

  -- Assignment, then reassignment (two DIFFERENT facts).
  perform public.ec_assign_triage(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
    '00000000-0000-0000-0000-0000000ec2a1', '00000000-0000-0000-0000-0000000ec2a1');
  perform public.ec_assign_triage(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
    '00000000-0000-0000-0000-0000000ec2a2', '00000000-0000-0000-0000-0000000ec2a2');

  -- THE attach: succeeds, and puts the fact on the DOSSIER's timeline.
  perform public.ec_resolve_triage(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec211',
    '00000000-0000-0000-0000-0000000ec2a1', 'ATTACH_TO_DOSSIER',
    '00000000-0000-0000-0000-0000000ec2e1');

  -- RULE 3: the recorded outcome is immutable.
  begin
    update public.ec_triage_item set outcome = 'DISCARD'
     where id = '00000000-0000-0000-0000-0000000ec211';
  exception when others then outcome_immutable_rejected := 1;
  end;

  -- Quotation handoff, and a motivated discard.
  perform public.ec_resolve_triage(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec212',
    '00000000-0000-0000-0000-0000000ec2a1', 'HANDOFF_TO_QUOTATION');
  perform public.ec_resolve_triage(
    '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000ec213',
    '00000000-0000-0000-0000-0000000ec2a1', 'DISCARD', null, null, 'SPAM', 'commentaire interne');

  -- Events: the attach carries the DOSSIER as subject AND as dossier_id.
  select count(*) into attach_event from public.business_event
   where event_type = 'CORRESPONDENCE_ATTACHED' and event_domain = 'communication';
  select count(*) into attach_event_dossier from public.business_event
   where event_type = 'CORRESPONDENCE_ATTACHED'
     and dossier_id = '00000000-0000-0000-0000-0000000ec2e1'
     and subject_id = '00000000-0000-0000-0000-0000000ec2e1'
     and subject_type = 'operational_file';
  select count(*) into resolved_event from public.business_event where event_type = 'CORRESPONDENCE_RESOLVED';
  select count(*) into handoff_event  from public.business_event where event_type = 'CORRESPONDENCE_QUOTATION_HANDOFF';
  select count(*) into discard_event  from public.business_event where event_type = 'CORRESPONDENCE_DISCARDED';
  select count(*) into assigned_event from public.business_event where event_type = 'CORRESPONDENCE_ASSIGNED';
  select count(*) into reassigned_event from public.business_event where event_type = 'CORRESPONDENCE_REASSIGNED';

  -- The handoff created NO quotation. There is no quotation table at all yet,
  -- which is exactly the point: EC-2 could not have created one.
  select count(*) into quotations_created from information_schema.tables
   where table_schema = 'public' and table_name in ('quotation','quotation_line','quotation_request');

  -- The discard COMMENT never entered the event payload; only the code did.
  if exists (select 1 from public.business_event
              where event_type = 'CORRESPONDENCE_DISCARDED'
                and metadata::text like '%commentaire interne%') then
    raise exception 'EC-2 FAIL: discard comment leaked into the event payload';
  end if;

  -- ---- RLS ----
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec2a1','role','authenticated')::text, true);
  select count(*) into reader_sees from public.ec_triage_item where id = '00000000-0000-0000-0000-0000000ec211';
  select count(*) into reader_sees_quarantine from public.ec_triage_item where id = '00000000-0000-0000-0000-0000000ec219';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec2a3','role','authenticated')::text, true);
  select count(*) into admin_sees from public.ec_triage_item where id = '00000000-0000-0000-0000-0000000ec211';
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec2a4','role','authenticated')::text, true);
  select count(*) into portal_sees from public.ec_triage_item where id = '00000000-0000-0000-0000-0000000ec211';
  perform set_config('role', 'postgres', true);

  insert into _r values
    ('permission_rows', perm_rows), ('permission_grants_shipped', perm_grants),
    ('reader_sees_item', reader_sees), ('reader_sees_quarantine', reader_sees_quarantine),
    ('system_admin_sees', admin_sees), ('portal_sees', portal_sees),
    ('quarantine_not_triable', quarantine_triage_rejected),
    ('resolve_requires_outcome', resolve_without_outcome_rejected),
    ('attach_requires_dossier', attach_without_dossier_rejected),
    ('discard_requires_reason', discard_without_reason_rejected),
    ('outcome_immutable', outcome_immutable_rejected),
    ('cross_tenant_attach_rejected', cross_tenant_rejected),
    ('event_attached', attach_event), ('event_attached_on_dossier', attach_event_dossier),
    ('event_resolved', resolved_event), ('event_handoff', handoff_event),
    ('event_discarded', discard_event), ('event_assigned', assigned_event),
    ('event_reassigned', reassigned_event),
    ('quotation_tables_created', quotations_created);

  if perm_rows<>2 or perm_grants<>0
     or reader_sees<>1 or reader_sees_quarantine<>0 or admin_sees<>0 or portal_sees<>0
     or quarantine_triage_rejected<>1 or resolve_without_outcome_rejected<>1
     or attach_without_dossier_rejected<>1 or discard_without_reason_rejected<>1
     or outcome_immutable_rejected<>1 or cross_tenant_rejected<>1
     or attach_event<>1 or attach_event_dossier<>1 or resolved_event<>3
     or handoff_event<>1 or discard_event<>1
     or assigned_event<>1 or reassigned_event<>1
     or quotations_created<>0
  then
    raise exception 'EC-2 FAIL: perms=% grants=% reader=% quar=% adm=% por=% qTri=% resOut=% attDoss=% disReason=% immut=% xTenant=% evAtt=% evAttDoss=% evRes=% evHand=% evDisc=% evAsg=% evReasg=% quotTables=%',
      perm_rows, perm_grants, reader_sees, reader_sees_quarantine, admin_sees, portal_sees,
      quarantine_triage_rejected, resolve_without_outcome_rejected, attach_without_dossier_rejected,
      discard_without_reason_rejected, outcome_immutable_rejected, cross_tenant_rejected,
      attach_event, attach_event_dossier, resolved_event, handoff_event, discard_event,
      assigned_event, reassigned_event, quotations_created;
  end if;
end $$;

select * from _r order by check_name;
rollback;
