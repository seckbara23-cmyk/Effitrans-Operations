-- rls_mailbox_membership_test.sql
-- EMP-4A — mailbox membership as an RLS gate, proven against a real database.
--
-- THIS SUITE EXERCISES THE PATH THE MIGRATION'S OWN PROBE CANNOT REACH IN CI.
-- At migration time CI's `organization` table is empty (seed runs afterwards),
-- so the probe inside migration 89 returns early there and is only ever
-- executed on a database that already has data — which is how the append-only
-- cleanup defect reached production without CI seeing it. This suite runs AFTER
-- seed, with organizations present, so the six-persona matrix is genuinely
-- exercised on every CI run.
--
-- Like the probe, it persists nothing: the whole file is BEGIN/ROLLBACK, and it
-- never DELETEs from an append-only table.

begin;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_mb uuid; v_msg uuid; v_att uuid; v_tri uuid;
  v_role_probe uuid; v_role_mail uuid;
  v_member uuid; v_noread uuid; v_admin uuid; v_norights uuid; v_revoked uuid;
  m_norights int; m_mbx int; m_msg int; m_att int; m_tri int; m_hook int;
  m_noread_msg int; m_noread_att int; m_revoked int; m_bootstrap int; n int;
begin
  -- ---- fixtures ----------------------------------------------------------
  insert into public.ec_mailbox (tenant_id, address, label_fr, provisioning_status)
  values (v_tenant, 'emp4a-suite@test.local', 'EMP-4A suite', 'ACTIVE')
  returning id into v_mb;

  insert into public.ec_inbound_message
    (tenant_id, mailbox_id, provider, provider_event_id, from_address,
     raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status)
  values (v_tenant, v_mb, 'GENERIC', 'emp4a-suite-evt', 'c@test.local',
          repeat('a',64), 't/emp4a/raw.eml', 10, now(), 'RECEIVED')
  returning id into v_msg;

  insert into public.ec_inbound_attachment
    (tenant_id, message_id, filename, mime_type, size_bytes, sha256, storage_path, stored)
  values (v_tenant, v_msg, 'p.pdf', 'application/pdf', 10, repeat('b',64), 't/emp4a/p.pdf', true)
  returning id into v_att;

  insert into public.ec_triage_item (tenant_id, message_id, status)
  values (v_tenant, v_msg, 'NEW') returning id into v_tri;

  -- The correspondence authority belongs to no real role (RATIFY-EC1-1), so the
  -- "authorized reader" persona is constructed here and rolled back with the rest.
  insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
  values (v_tenant, '__EMP4A_SUITE_PROBE', 'Sonde', 'Probe', true)
  returning id into v_role_probe;
  insert into public.role_permission (role_id, permission_id)
  select v_role_probe, p.id from public.permission p
   where p.code = 'communication:inbound:read';
  select id into v_role_mail from public.role where code = 'MAIL_ADMIN' and tenant_id = v_tenant;

  v_member := gen_random_uuid(); v_noread := gen_random_uuid();
  v_admin := gen_random_uuid();  v_norights := gen_random_uuid();
  v_revoked := gen_random_uuid();

  insert into auth.users (id, email) values
    (v_member, 'e4a-m@test.local'), (v_noread, 'e4a-r@test.local'),
    (v_admin, 'e4a-a@test.local'), (v_norights, 'e4a-x@test.local'),
    (v_revoked, 'e4a-v@test.local');
  insert into public.app_user (id, tenant_id, email, status) values
    (v_member, v_tenant, 'e4a-m@test.local', 'active'),
    (v_noread, v_tenant, 'e4a-r@test.local', 'active'),
    (v_admin, v_tenant, 'e4a-a@test.local', 'active'),
    (v_norights, v_tenant, 'e4a-x@test.local', 'active'),
    (v_revoked, v_tenant, 'e4a-v@test.local', 'active');

  insert into public.ec_mailbox_member (tenant_id, mailbox_id, user_id, can_read) values
    (v_tenant, v_mb, v_member, true),
    (v_tenant, v_mb, v_noread, false);
  -- A revoked member: had access, has none now.
  insert into public.ec_mailbox_member
    (tenant_id, mailbox_id, user_id, can_read, revoked_at, revoked_by, revoke_reason)
  values (v_tenant, v_mb, v_revoked, true, now(), v_admin, 'départ');

  insert into public.user_role (user_id, role_id, tenant_id) values
    (v_member, v_role_probe, v_tenant),
    (v_noread, v_role_probe, v_tenant),
    (v_revoked, v_role_probe, v_tenant),
    (v_admin, v_role_probe, v_tenant);
  if v_role_mail is not null then
    insert into public.user_role (user_id, role_id, tenant_id)
    values (v_admin, v_role_mail, v_tenant);
  end if;

  -- ---- exercise ----------------------------------------------------------
  -- Measurements go into VARIABLES while the session is `authenticated`, and
  -- are recorded into _r only after the role is reset. `authenticated` holds no
  -- privilege on a temp table owned by postgres, so writing results mid-exercise
  -- fails with "permission denied for table _r" — which is what the first
  -- version of this suite did. The other RLS suites collect the same way.
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_norights::text, 'role', 'authenticated')::text, true);
  select count(*) into m_norights from public.ec_inbound_message where id = v_msg;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member::text, 'role', 'authenticated')::text, true);
  select count(*) into m_mbx      from public.ec_mailbox            where id = v_mb;
  select count(*) into m_msg      from public.ec_inbound_message    where id = v_msg;
  select count(*) into m_att      from public.ec_inbound_attachment where id = v_att;
  select count(*) into m_tri      from public.ec_triage_item        where id = v_tri;
  select count(*) into m_hook     from public.ec_webhook_event      where tenant_id = v_tenant;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_noread::text, 'role', 'authenticated')::text, true);
  select count(*) into m_noread_msg from public.ec_inbound_message    where id = v_msg;
  select count(*) into m_noread_att from public.ec_inbound_attachment where id = v_att;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_revoked::text, 'role', 'authenticated')::text, true);
  select count(*) into m_revoked from public.ec_inbound_message where id = v_msg;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into m_bootstrap from public.ec_mailbox where id = v_mb;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ---- judge, back as postgres so _r is writable --------------------------
  if m_norights <> 0 then
    raise exception 'EMP-4A RLS FAIL: no-rights user read a message (got %)', m_norights;
  end if;
  insert into _r values ('no_rights_denied', 'ok');

  if m_mbx <> 1 or m_msg <> 1 or m_att <> 1 or m_tri <> 1 then
    raise exception 'EMP-4A RLS FAIL: member denied on one of the four policies (mbx=% msg=% att=% tri=%)',
      m_mbx, m_msg, m_att, m_tri;
  end if;
  insert into _r values ('member_allowed_all_four', 'ok');

  if m_noread_msg <> 0 or m_noread_att <> 0 then
    raise exception 'EMP-4A RLS FAIL: can_read=false read something (msg=% att=%)', m_noread_msg, m_noread_att;
  end if;
  insert into _r values ('can_read_false_denied', 'ok');

  if m_revoked <> 0 then
    raise exception 'EMP-4A RLS FAIL: a revoked member still read the message (got %)', m_revoked;
  end if;
  insert into _r values ('revoked_member_denied', 'ok');

  if m_bootstrap <> 1 then
    raise exception 'EMP-4A RLS FAIL: bootstrap failed, no first membership could be granted';
  end if;
  insert into _r values ('admin_bootstrap_allowed', 'ok');

  -- The webhook journal is diagnostics-only: membership does not open it, and
  -- the probe role does not hold communication:diagnostics:read.
  if m_hook <> 0 then
    raise exception 'EMP-4A RLS FAIL: a mailbox member read the webhook journal (got %)', m_hook;
  end if;
  insert into _r values ('webhook_journal_not_membership_scoped', 'ok');


  -- ---- constraints bite ---------------------------------------------------
  begin
    insert into public.ec_mailbox_alias (tenant_id, mailbox_id, address)
    values (v_tenant, v_mb, 'emp4a-suite@test.local');
    raise exception 'EMP-4A RLS FAIL: an alias took a mailbox address';
  exception
    when unique_violation then insert into _r values ('alias_collision_denied', 'ok');
  end;

  begin
    insert into public.ec_mailbox_member (tenant_id, mailbox_id, user_id, can_send, is_default_sender)
    values (v_tenant, v_mb, v_norights, false, true);
    raise exception 'EMP-4A RLS FAIL: a default sender that cannot send was accepted';
  exception
    when check_violation then insert into _r values ('default_sender_requires_send', 'ok');
  end;

  -- Routing follows the lifecycle: is_active is derived, never written directly.
  update public.ec_mailbox set provisioning_status = 'DISABLED' where id = v_mb;
  select count(*) into n from public.ec_mailbox where id = v_mb and is_active = false;
  if n <> 1 then raise exception 'EMP-4A RLS FAIL: is_active did not follow the status'; end if;
  insert into _r values ('is_active_derived_from_status', 'ok');
end $$;

select * from _r order by check_name;
rollback;
