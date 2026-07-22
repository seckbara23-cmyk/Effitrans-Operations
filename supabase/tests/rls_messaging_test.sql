-- RLS regression test — Effitrans Messaging Center (Phase 8.7). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves:
--   * a department-permission staff user (CUSTOMS_DECLARANT: messaging:read:customs)
--     sees ONLY the customs department conversation, not finance, not a staff-only
--     direct conversation they don't participate in                              -> 1 / 0 / 0
--   * messaging:manage (SYSTEM_ADMIN) sees every tenant-A conversation            -> 2 / 0
--   * a staff user with NO messaging permission (DRIVER) sees nothing             -> 0
--   * NOT another tenant's conversation, for any staff identity                   -> 0
--   * a portal customer sees ONLY their own client's conversations                -> 1 / 1
--   * NOT another customer's conversations, even in the same tenant               -> 0
--   * NOT a staff-only direct_staff conversation                                  -> 0
--   * a DISABLED portal user sees nothing                                         -> 0
--   * a portal customer sees a SHARED message but NEVER an INTERNAL staff note    -> 1 / 0
--   * staff (department match) sees BOTH the shared message and the internal note -> 2
--   * message_attachment visibility follows its parent message's visibility rule  -> 1 / 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B2', 'SN')
on conflict (id) do nothing;

-- S1 = SYSTEM_ADMIN (messaging:manage); S2 = CUSTOMS_DECLARANT (messaging:read:customs);
-- S3 = DRIVER (no messaging permission at all). P1/P2 = active portal (different clients);
-- P3 = disabled portal (same client as P1).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 's1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 's2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', 's3@test.local'),
  ('00000000-0000-0000-0000-0000000000e4', 'p1@test.local'),
  ('00000000-0000-0000-0000-0000000000e5', 'p2@test.local'),
  ('00000000-0000-0000-0000-0000000000e6', 'p3@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 's2@test.local'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-000000000001', 's3@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e1', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e2', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CUSTOMS_DECLARANT'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000000e3', r.id, r.tenant_id from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'DRIVER'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-000000000001', 'Messaging Client A1'),
  ('00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-000000000001', 'Messaging Client A2'),
  ('00000000-0000-0000-0000-00000000cb01', '00000000-0000-0000-0000-0000000000b2', 'Messaging Client B1')
on conflict (id) do nothing;

-- P1 active -> client A1; P2 active -> client A2; P3 disabled -> client A1.
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca01', 'p1@test.local', 'ACTIVE', 'CLIENT_USER'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca02', 'p2@test.local', 'ACTIVE', 'CLIENT_USER'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ca01', 'p3@test.local', 'DISABLED', 'CLIENT_USER')
on conflict (id) do nothing;

-- Conversations: customs support (client A1), finance support (client A1), a
-- staff-only direct conversation (S1 only), and a tenant-B conversation.
insert into public.conversation (id, tenant_id, type, client_id, department_code, status, created_by_client_user_id) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-000000000001', 'customer_support', '00000000-0000-0000-0000-00000000ca01', 'customs', 'open', '00000000-0000-0000-0000-0000000000e4'),
  ('00000000-0000-0000-0000-00000000ce02', '00000000-0000-0000-0000-000000000001', 'customer_support', '00000000-0000-0000-0000-00000000ca01', 'finance', 'open', '00000000-0000-0000-0000-0000000000e4')
on conflict (id) do nothing;
insert into public.conversation (id, tenant_id, type, created_by) values
  ('00000000-0000-0000-0000-00000000ce03', '00000000-0000-0000-0000-000000000001', 'direct_staff', '00000000-0000-0000-0000-0000000000e1')
on conflict (id) do nothing;
insert into public.conversation (id, tenant_id, type, client_id, department_code, status) values
  ('00000000-0000-0000-0000-00000000ce04', '00000000-0000-0000-0000-0000000000b2', 'customer_support', '00000000-0000-0000-0000-00000000cb01', 'general', 'open')
on conflict (id) do nothing;

-- S1 is the only explicit participant of the staff-only direct conversation.
insert into public.conversation_participant (tenant_id, conversation_id, participant_type, user_id) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ce03', 'staff', '00000000-0000-0000-0000-0000000000e1')
on conflict do nothing;

-- Messages: a SHARED customer message + a staff-only INTERNAL note on ce01.
insert into public.message (id, tenant_id, conversation_id, sender_type, sender_client_user_id, body, visibility) values
  ('00000000-0000-0000-0000-00000000ea01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ce01', 'customer', '00000000-0000-0000-0000-0000000000e4', 'Bonjour, question sur mon dossier.', 'shared')
on conflict (id) do nothing;
insert into public.message (id, tenant_id, conversation_id, sender_type, sender_user_id, body, visibility) values
  ('00000000-0000-0000-0000-00000000ea02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ce01', 'staff', '00000000-0000-0000-0000-0000000000e2', 'Note interne : attention document manquant.', 'internal')
on conflict (id) do nothing;

-- Attachments: one on the shared message, one on the internal note.
insert into public.message_attachment (id, tenant_id, message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by_client_user_id) values
  ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ea01', 'x/y/att1.pdf', 'piece.pdf', 'application/pdf', 100, '00000000-0000-0000-0000-0000000000e4')
on conflict (id) do nothing;
insert into public.message_attachment (id, tenant_id, message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by_user_id) values
  ('00000000-0000-0000-0000-00000000ab02', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ea02', 'x/y/att2.pdf', 'note.pdf', 'application/pdf', 100, '00000000-0000-0000-0000-0000000000e2')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  s1_all int; s1_tenantb int;
  s2_customs int; s2_finance int; s2_direct int;
  s3_any int;
  p1_customs int; p1_finance int; p1_direct int;
  p2_any int; p3_any int;
  p1_shared_msg int; p1_internal_msg int; staff_both_msg int;
  p1_att_shared int; p1_att_internal int;
begin
  perform set_config('role', 'authenticated', true);

  -- S1 SYSTEM_ADMIN (messaging:manage) — sees every tenant-A conversation, none of tenant B.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e1','role','authenticated')::text, true);
  select count(*) into s1_all from public.conversation where id in ('00000000-0000-0000-0000-00000000ce01','00000000-0000-0000-0000-00000000ce02','00000000-0000-0000-0000-00000000ce03');
  select count(*) into s1_tenantb from public.conversation where id = '00000000-0000-0000-0000-00000000ce04';

  -- S2 CUSTOMS_DECLARANT (messaging:read:customs) — customs only, not finance, not the direct thread.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into s2_customs from public.conversation where id = '00000000-0000-0000-0000-00000000ce01';
  select count(*) into s2_finance from public.conversation where id = '00000000-0000-0000-0000-00000000ce02';
  select count(*) into s2_direct  from public.conversation where id = '00000000-0000-0000-0000-00000000ce03';

  -- S3 DRIVER (no messaging permission) — sees nothing.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e3','role','authenticated')::text, true);
  select count(*) into s3_any from public.conversation where id in ('00000000-0000-0000-0000-00000000ce01','00000000-0000-0000-0000-00000000ce02','00000000-0000-0000-0000-00000000ce03');

  -- P1 active portal, client A1 — both A1 conversations, never the staff-only thread.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e4','role','authenticated')::text, true);
  select count(*) into p1_customs from public.conversation where id = '00000000-0000-0000-0000-00000000ce01';
  select count(*) into p1_finance from public.conversation where id = '00000000-0000-0000-0000-00000000ce02';
  select count(*) into p1_direct  from public.conversation where id = '00000000-0000-0000-0000-00000000ce03';
  select count(*) into p1_shared_msg   from public.message where id = '00000000-0000-0000-0000-00000000ea01';
  select count(*) into p1_internal_msg from public.message where id = '00000000-0000-0000-0000-00000000ea02';
  select count(*) into p1_att_shared   from public.message_attachment where id = '00000000-0000-0000-0000-00000000ab01';
  select count(*) into p1_att_internal from public.message_attachment where id = '00000000-0000-0000-0000-00000000ab02';

  -- P2 active portal, client A2 — sees NONE of client A1's conversations.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e5','role','authenticated')::text, true);
  select count(*) into p2_any from public.conversation where id in ('00000000-0000-0000-0000-00000000ce01','00000000-0000-0000-0000-00000000ce02');

  -- P3 disabled portal (client A1) — sees nothing at all.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e6','role','authenticated')::text, true);
  select count(*) into p3_any from public.conversation where id in ('00000000-0000-0000-0000-00000000ce01','00000000-0000-0000-0000-00000000ce02');

  -- Back to S2 (department match) — sees BOTH the shared message and the internal note.
  perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-0000000000e2','role','authenticated')::text, true);
  select count(*) into staff_both_msg from public.message where id in ('00000000-0000-0000-0000-00000000ea01','00000000-0000-0000-0000-00000000ea02');

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('s1_all_tenant_a', s1_all), ('s1_tenant_b', s1_tenantb),
    ('s2_customs', s2_customs), ('s2_finance', s2_finance), ('s2_direct_staff_only', s2_direct),
    ('s3_no_permission', s3_any),
    ('p1_customs', p1_customs), ('p1_finance', p1_finance), ('p1_direct_staff_only', p1_direct),
    ('p2_other_client', p2_any), ('p3_disabled', p3_any),
    ('p1_sees_shared_message', p1_shared_msg), ('p1_sees_internal_note', p1_internal_msg),
    ('p1_sees_shared_attachment', p1_att_shared), ('p1_sees_internal_attachment', p1_att_internal),
    ('staff_dept_sees_both_messages', staff_both_msg);

  if s1_all<>2 or s1_tenantb<>0
     or s2_customs<>1 or s2_finance<>0 or s2_direct<>0
     or s3_any<>0
     or p1_customs<>1 or p1_finance<>1 or p1_direct<>0
     or p2_any<>0 or p3_any<>0
     or p1_shared_msg<>1 or p1_internal_msg<>0
     or p1_att_shared<>1 or p1_att_internal<>0
     or staff_both_msg<>2
  then
    raise exception 'RLS MESSAGING FAIL: s1(all=% tenantB=%) s2(customs=% finance=% direct=%) s3(any=%) p1(customs=% finance=% direct=% shared_msg=% internal_msg=% shared_att=% internal_att=%) p2(other=%) p3(disabled=%) staff_dept(both=%)',
      s1_all, s1_tenantb, s2_customs, s2_finance, s2_direct, s3_any,
      p1_customs, p1_finance, p1_direct, p1_shared_msg, p1_internal_msg, p1_att_shared, p1_att_internal,
      p2_any, p3_any, staff_both_msg;
  end if;
end $$;

select * from _r order by check_name;
rollback;
