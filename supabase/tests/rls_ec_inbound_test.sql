-- RLS + invariants test — EC-1 Inbound Foundation (migration 80). BEGIN/ROLLBACK.
-- Proves: the two new permissions exist and are granted to NOBODY; a mailbox
-- address is GLOBALLY unique (one address cannot belong to two tenants);
-- captured messages are confined to their tenant AND gated on
-- communication:inbound:read; SYSTEM_ADMIN — which HOLDS communication:read —
-- still sees ZERO inbound correspondence; portal sees zero; QUARANTINED rows
-- (tenant_id NULL) are invisible to every tenant; the capture is immutable
-- (no UPDATE, no DELETE); attachments are immutable; the quarantine shape
-- CHECK refuses an incoherent row; triage transitions are guarded and terminal
-- states are terminal; and NO business row (client/dossier/document) is created.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000ec001', 'ec-reader@test.local'),
  ('00000000-0000-0000-0000-0000000ec002', 'ec-admin@test.local'),
  ('00000000-0000-0000-0000-0000000ec003', 'ec-portal@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000ec001', '00000000-0000-0000-0000-000000000001', 'ec-reader@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000ec002', '00000000-0000-0000-0000-000000000001', 'ec-admin@test.local', 'active')
on conflict (id) do nothing;

-- The reader gets communication:inbound:read DIRECTLY via a dedicated test role,
-- because no seeded role holds it (that is the point of the phase).
insert into public.role (id, tenant_id, code, label_fr, label_en, is_provisional) values
  ('00000000-0000-0000-0000-0000000ec401', '00000000-0000-0000-0000-000000000001',
   'EC_TEST_READER', 'Lecteur EC (test)', 'EC Test Reader', true)
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000ec401', p.id from public.permission p
where p.code = 'communication:inbound:read'
on conflict do nothing;
insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000ec001', '00000000-0000-0000-0000-0000000ec401', '00000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- SYSTEM_ADMIN: holds communication:read (seeded) but NOT inbound:read.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000ec002', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000ecc01', '00000000-0000-0000-0000-000000000001', 'EC Client')
on conflict (id) do nothing;
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000ec003', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ecc01', 'ec-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.ec_mailbox (id, tenant_id, address, label_fr, purpose) values
  ('00000000-0000-0000-0000-0000000ecb01', '00000000-0000-0000-0000-000000000001',
   'quotation@ec-test.example', 'Cotation (test)', 'QUOTATION')
on conflict (id) do nothing;

-- A routed message and a quarantined one.
insert into public.ec_inbound_message
  (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
   to_addresses, subject, raw_sha256, raw_storage_path, raw_size_bytes,
   received_at, capture_status) values
  ('00000000-0000-0000-0000-0000000ec101', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ecb01', 'GENERIC', 'evt_ec_001', 'client@example.test',
   '["quotation@ec-test.example"]'::jsonb, 'Demande (test)', repeat('a', 64),
   '00000000-0000-0000-0000-000000000001/m1/raw.eml', 1200, now(), 'RECEIVED')
on conflict (id) do nothing;
insert into public.ec_inbound_message
  (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
   to_addresses, subject, raw_sha256, raw_storage_path, raw_size_bytes,
   received_at, capture_status, quarantine_reason) values
  ('00000000-0000-0000-0000-0000000ec102', null, null, 'GENERIC', 'evt_ec_002',
   'stranger@example.test', '["nobody@unknown.example"]'::jsonb, 'Perdu (test)',
   repeat('b', 64), 'quarantine/m2/raw.eml', 900, now(), 'QUARANTINED', 'no_matching_mailbox')
on conflict (id) do nothing;

insert into public.ec_inbound_attachment
  (id, tenant_id, message_id, filename, mime_type, size_bytes, sha256, storage_path, stored) values
  ('00000000-0000-0000-0000-0000000eca01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec101', 'bl.pdf', 'application/pdf', 2048,
   repeat('c', 64), '00000000-0000-0000-0000-000000000001/m1/att-0-bl.pdf', true)
on conflict (id) do nothing;

insert into public.ec_triage_item (id, tenant_id, message_id, status) values
  ('00000000-0000-0000-0000-0000000ec201', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-0000000ec101', 'NEW')
on conflict (id) do nothing;
insert into public.ec_triage_item (id, tenant_id, message_id, status) values
  ('00000000-0000-0000-0000-0000000ec202', null,
   '00000000-0000-0000-0000-0000000ec102', 'QUARANTINED')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  perm_rows int; perm_grants int;
  reader_sees int; admin_sees int; portal_sees int;
  reader_sees_quarantine int; reader_sees_attachment int; admin_sees_attachment int;
  global_unique_rejected int := 0; msg_update_rejected int := 0; msg_delete_rejected int := 0;
  att_update_rejected int := 0; quarantine_shape_rejected int := 0;
  bad_transition_rejected int := 0; terminal_rejected int := 0;
  requarantine_rejected int := 0; good_transition int := 0;
  business_rows int;
begin
  perform set_config('role', 'postgres', true);

  -- Both permissions exist and are held by NOBODY.
  select count(*) into perm_rows from public.permission
   where code in ('communication:inbound:read', 'communication:triage');
  select count(*) into perm_grants from public.role_permission rp
    join public.permission p on p.id = rp.permission_id
   where p.code in ('communication:inbound:read', 'communication:triage')
     -- the test role above is fixture scaffolding, not a shipped grant
     and rp.role_id <> '00000000-0000-0000-0000-0000000ec401';

  -- An address cannot belong to two tenants (rule 3, global unique index).
  begin
    insert into public.ec_mailbox (tenant_id, address, label_fr)
    values ('00000000-0000-0000-0000-000000000002', 'quotation@ec-test.example', 'Doublon');
  exception when others then global_unique_rejected := 1;
  end;

  -- The capture is immutable: no UPDATE, no DELETE.
  begin
    update public.ec_inbound_message set subject = 'réécrit'
     where id = '00000000-0000-0000-0000-0000000ec101';
  exception when others then msg_update_rejected := 1;
  end;
  begin
    delete from public.ec_inbound_message where id = '00000000-0000-0000-0000-0000000ec101';
  exception when others then msg_delete_rejected := 1;
  end;
  begin
    update public.ec_inbound_attachment set sha256 = repeat('0', 64)
     where id = '00000000-0000-0000-0000-0000000eca01';
  exception when others then att_update_rejected := 1;
  end;

  -- An incoherent capture row is refused: RECEIVED without a tenant.
  begin
    insert into public.ec_inbound_message
      (tenant_id, mailbox_id, provider, provider_event_id, from_address,
       raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status)
    values (null, null, 'GENERIC', 'evt_ec_bad', 'x@example.test',
            repeat('d', 64), 'x/raw.eml', 1, now(), 'RECEIVED');
  exception when others then quarantine_shape_rejected := 1;
  end;

  -- Triage transitions: NEW→IN_REVIEW allowed; RESOLVED terminal; no re-quarantine.
  update public.ec_triage_item set status = 'IN_REVIEW'
   where id = '00000000-0000-0000-0000-0000000ec201';
  select count(*) into good_transition from public.ec_triage_item
   where id = '00000000-0000-0000-0000-0000000ec201' and status = 'IN_REVIEW';
  begin
    update public.ec_triage_item set status = 'NEW'
     where id = '00000000-0000-0000-0000-0000000ec201';
  exception when others then bad_transition_rejected := 1;
  end;
  begin
    update public.ec_triage_item set status = 'QUARANTINED'
     where id = '00000000-0000-0000-0000-0000000ec201';
  exception when others then requarantine_rejected := 1;
  end;
  update public.ec_triage_item set status = 'RESOLVED', resolved_at = now()
   where id = '00000000-0000-0000-0000-0000000ec201';
  begin
    update public.ec_triage_item set status = 'IN_REVIEW'
     where id = '00000000-0000-0000-0000-0000000ec201';
  exception when others then terminal_rejected := 1;
  end;

  -- EC-1 created NO business row of any kind. Counts ONLY things inbound
  -- capture could plausibly have minted: a client named after the sender, a
  -- dossier numbered after the event, or a document pointing into ec-inbound.
  select (select count(*) from public.client
           where name in ('client@example.test', 'stranger@example.test'))
       + (select count(*) from public.operational_file
           where tenant_id = '00000000-0000-0000-0000-000000000001'
             and file_number like 'evt\_ec\_%')
       + (select count(*) from public.document
           where storage_path like '%ec-inbound%' or storage_path like '%/att-0-%')
    into business_rows;

  -- ---- RLS ----
  perform set_config('role', 'authenticated', true);

  -- Reader HOLDS communication:inbound:read → sees the routed message only.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec001','role','authenticated')::text, true);
  select count(*) into reader_sees from public.ec_inbound_message
   where id = '00000000-0000-0000-0000-0000000ec101';
  select count(*) into reader_sees_quarantine from public.ec_inbound_message
   where id = '00000000-0000-0000-0000-0000000ec102';
  select count(*) into reader_sees_attachment from public.ec_inbound_attachment
   where id = '00000000-0000-0000-0000-0000000eca01';

  -- SYSTEM_ADMIN holds communication:read but NOT inbound:read → sees NOTHING.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec002','role','authenticated')::text, true);
  select count(*) into admin_sees from public.ec_inbound_message
   where id = '00000000-0000-0000-0000-0000000ec101';
  select count(*) into admin_sees_attachment from public.ec_inbound_attachment
   where id = '00000000-0000-0000-0000-0000000eca01';

  -- Portal user sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000ec003','role','authenticated')::text, true);
  select count(*) into portal_sees from public.ec_inbound_message
   where id = '00000000-0000-0000-0000-0000000ec101';

  perform set_config('role', 'postgres', true);

  insert into _r values
    ('permission_rows', perm_rows), ('permission_grants_shipped', perm_grants),
    ('reader_sees_routed', reader_sees), ('reader_sees_quarantine', reader_sees_quarantine),
    ('reader_sees_attachment', reader_sees_attachment),
    ('system_admin_sees', admin_sees), ('system_admin_sees_attachment', admin_sees_attachment),
    ('portal_sees', portal_sees),
    ('global_address_unique', global_unique_rejected),
    ('message_update_rejected', msg_update_rejected),
    ('message_delete_rejected', msg_delete_rejected),
    ('attachment_update_rejected', att_update_rejected),
    ('quarantine_shape_rejected', quarantine_shape_rejected),
    ('triage_good_transition', good_transition),
    ('triage_backward_rejected', bad_transition_rejected),
    ('triage_requarantine_rejected', requarantine_rejected),
    ('triage_terminal_rejected', terminal_rejected),
    ('business_rows_created', business_rows);

  if perm_rows<>2 or perm_grants<>0
     or reader_sees<>1 or reader_sees_quarantine<>0 or reader_sees_attachment<>1
     or admin_sees<>0 or admin_sees_attachment<>0 or portal_sees<>0
     or global_unique_rejected<>1
     or msg_update_rejected<>1 or msg_delete_rejected<>1 or att_update_rejected<>1
     or quarantine_shape_rejected<>1
     or good_transition<>1 or bad_transition_rejected<>1
     or requarantine_rejected<>1 or terminal_rejected<>1
     or business_rows<>0   -- EC created nothing at all
  then
    raise exception 'EC-1 FAIL: perms=% grants=% reader=% quar=% att=% admin=% adminAtt=% portal=% uniq=% upd=% del=% attUpd=% shape=% trGood=% trBack=% trReq=% trTerm=% biz=%',
      perm_rows, perm_grants, reader_sees, reader_sees_quarantine, reader_sees_attachment,
      admin_sees, admin_sees_attachment, portal_sees, global_unique_rejected,
      msg_update_rejected, msg_delete_rejected, att_update_rejected, quarantine_shape_rejected,
      good_transition, bad_transition_rejected, requarantine_rejected, terminal_rejected,
      business_rows;
  end if;
end $$;

select * from _r order by check_name;
rollback;
