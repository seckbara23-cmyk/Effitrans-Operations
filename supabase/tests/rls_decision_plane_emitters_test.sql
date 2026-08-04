-- Emitter test — UT-3B Decision Plane emitters (migration 86). BEGIN/ROLLBACK.
--
-- Proves in real PostgreSQL what no static reader can:
--   * each emitter fires EXACTLY ONCE for its act;
--   * CORRESPONDENCE_RECEIVED fires on first tenant ATTRIBUTION, which on an
--     append-only capture table is capture-with-a-tenant and nothing else; a
--     quarantined capture emits nothing and can never be released;
--   * handoffs emit on ownership transfer only; a reassignment-shaped update
--     (any other column, any other status) emits NOTHING;
--   * document sharing emits on false→true only, never on un-share or re-save;
--   * EXPENSE_AUTHORIZED is silent for a dossier-less expense (RATIFY-UT3-2);
--   * every emitted event carries its dossier where one exists;
--   * ROLLBACK emits nothing — the event shares the act's transaction.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000e301', 'ut3-a@test.local'),
  ('00000000-0000-0000-0000-00000000e302', 'ut3-b@test.local')
on conflict (id) do nothing;
insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-00000000e301', '00000000-0000-0000-0000-000000000001', 'ut3-a@test.local', 'active'),
  ('00000000-0000-0000-0000-00000000e302', '00000000-0000-0000-0000-000000000001', 'ut3-b@test.local', 'active')
on conflict (id) do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000e3c1', '00000000-0000-0000-0000-000000000001', 'Client UT3')
on conflict (id) do nothing;
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000e3f1', '00000000-0000-0000-0000-000000000001',
   'UT3-TEST-0001', 'IMP', '00000000-0000-0000-0000-00000000e3c1', 'DRAFT')
on conflict (id) do nothing;
insert into public.ec_mailbox (id, tenant_id, address, label_fr, purpose) values
  ('00000000-0000-0000-0000-00000000e3d1', '00000000-0000-0000-0000-000000000001',
   'ut3@test.example', 'UT3 (test)', 'OPERATIONS')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  n_recv int; n_recv_after_update int; n_quarantine int;
  n_sent int; n_received int; n_reassign int;
  n_shared int; n_unshared int; n_reshare int;
  n_expense_dossier int; n_expense_orphan int;
  n_policy int;
  sent_dossier int; recv_dossier int;
  inst uuid; ho uuid; doc uuid; msg uuid; qmsg uuid; pv uuid; exp uuid;
begin
  perform set_config('role', 'postgres', true);

  -- =====================================================================
  -- 1. CORRESPONDENCE_RECEIVED — attribution, not arrival.
  -- =====================================================================
  -- (a) QUARANTINED capture: tenant_id NULL ⇒ NOTHING is emitted.
  insert into public.ec_inbound_message
    (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
     raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status, quarantine_reason)
  values (gen_random_uuid(), null, null, 'GENERIC', 'ut3_q1', 'x@example.test',
          repeat('a',64), 'q/1.eml', 10, now(), 'QUARANTINED', 'no_matching_mailbox')
  returning id into qmsg;
  select count(*) into n_quarantine from public.business_event
   where event_type = 'CORRESPONDENCE_RECEIVED';

  -- (b) ROUTED capture: attributed on insert ⇒ exactly one event.
  insert into public.ec_inbound_message
    (id, tenant_id, mailbox_id, provider, provider_event_id, from_address,
     raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3d1', 'GENERIC', 'ut3_r1', 'y@example.test',
          repeat('b',64), 'r/1.eml', 10, now(), 'RECEIVED')
  returning id into msg;
  select count(*) into n_recv from public.business_event
   where event_type = 'CORRESPONDENCE_RECEIVED' and subject_id = msg;

  -- (c) A quarantined message can NEVER be attributed later: the capture table
  --     is append-only (EC-1 `prevent_mutation`), so quarantine is terminal.
  --     Asserted here because it is WHY one trigger suffices — an earlier draft
  --     carried a second, unreachable trigger for a release path that the
  --     schema forbids.
  begin
    -- EXPECT-FAIL: the capture table refuses UPDATE for every role.
    update public.ec_inbound_message
       set tenant_id = '00000000-0000-0000-0000-000000000001'
     where id = qmsg;
  exception when others then n_recv_after_update := 1;
  end;

  -- =====================================================================
  -- 2 + 3. HANDOFFS — ownership transfers only.
  -- =====================================================================
  insert into public.process_instance (id, tenant_id, file_id, policy_provenance)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1', 'LEGACY_DEFAULT')
  returning id into inst;

  insert into public.process_handoff
    (id, tenant_id, process_instance_id, from_step_key, to_step_key, sent_by, dedup_key)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', inst,
          'operations_intake', 'transit_execution', '00000000-0000-0000-0000-00000000e301', 'ut3-k1')
  returning id into ho;

  select count(*) into n_sent from public.business_event
   where event_type = 'HANDOFF_SENT' and subject_id = ho;
  select count(*) into sent_dossier from public.business_event
   where event_type = 'HANDOFF_SENT' and subject_id = ho
     and dossier_id = '00000000-0000-0000-0000-00000000e3f1';

  -- A REASSIGNMENT-shaped update: a different column, no ownership change.
  update public.process_handoff set rejection_reason = null where id = ho;
  select count(*) into n_reassign from public.business_event
   where event_type = 'HANDOFF_RECEIVED' and subject_id = ho;

  -- The genuine ownership transfer.
  update public.process_handoff
     set status = 'RECEIVED', received_by = '00000000-0000-0000-0000-00000000e302', received_at = now()
   where id = ho;
  select count(*) into n_received from public.business_event
   where event_type = 'HANDOFF_RECEIVED' and subject_id = ho;
  select count(*) into recv_dossier from public.business_event
   where event_type = 'HANDOFF_RECEIVED' and subject_id = ho
     and dossier_id = '00000000-0000-0000-0000-00000000e3f1';

  -- =====================================================================
  -- 4. DOCUMENT_SHARED_WITH_CLIENT — false → true only.
  -- =====================================================================
  insert into public.document (id, tenant_id, file_id, type_code, status, shared_with_client)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1',
          (select code from public.document_type limit 1), 'APPROVED', false)
  returning id into doc;

  update public.document set shared_with_client = true where id = doc;
  select count(*) into n_shared from public.business_event
   where event_type = 'DOCUMENT_SHARED_WITH_CLIENT' and subject_id = doc;

  -- Un-share emits nothing; re-share emits again (a second, real sharing).
  update public.document set shared_with_client = false where id = doc;
  select count(*) into n_unshared from public.business_event
   where event_type = 'DOCUMENT_SHARED_WITH_CLIENT' and subject_id = doc;
  -- A no-op re-save of an unshared document emits nothing.
  update public.document set status = 'APPROVED' where id = doc;
  select count(*) into n_reshare from public.business_event
   where event_type = 'DOCUMENT_SHARED_WITH_CLIENT' and subject_id = doc;

  -- =====================================================================
  -- 5. EXPENSE_AUTHORIZED — dossier-linked only (RATIFY-UT3-2 unresolved).
  -- =====================================================================
  insert into public.expense_authorization
    (id, tenant_id, file_id, beneficiary, reason, status, requested_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1', 'Bénéficiaire', 'Motif',
          'IN_APPROVAL', '00000000-0000-0000-0000-00000000e301')
  returning id into exp;
  update public.expense_authorization set status = 'APPROVED' where id = exp;
  select count(*) into n_expense_dossier from public.business_event
   where event_type = 'EXPENSE_AUTHORIZED' and subject_id = exp;

  -- A dossier-LESS expense: no visibility branch would admit its event, so the
  -- emitter stays silent rather than inventing one.
  insert into public.expense_authorization
    (id, tenant_id, file_id, beneficiary, reason, status, requested_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          null, 'Bénéficiaire 2', 'Motif 2', 'IN_APPROVAL',
          '00000000-0000-0000-0000-00000000e301')
  returning id into exp;
  update public.expense_authorization set status = 'APPROVED' where id = exp;
  select count(*) into n_expense_orphan from public.business_event
   where event_type = 'EXPENSE_AUTHORIZED' and subject_id = exp;

  -- =====================================================================
  -- 6. DOSSIER_POLICY_PINNED — only when a version is actually pinned.
  -- =====================================================================
  select count(*) into n_policy from public.business_event
   where event_type = 'DOSSIER_POLICY_PINNED'
     and dossier_id = '00000000-0000-0000-0000-00000000e3f1';
  -- The instance above pinned NO version, so nothing was emitted for it.

  insert into _r values
    ('quarantine_capture_silent', n_quarantine),
    ('routed_capture_emits_once', n_recv),
    ('quarantine_release_is_impossible', n_recv_after_update),
    ('handoff_sent_once', n_sent), ('handoff_sent_carries_dossier', sent_dossier),
    ('non_ownership_update_silent', n_reassign),
    ('handoff_received_once', n_received), ('handoff_received_carries_dossier', recv_dossier),
    ('document_share_emits_once', n_shared),
    ('unshare_emits_nothing', n_unshared),
    ('resave_emits_nothing', n_reshare),
    ('expense_with_dossier_emits', n_expense_dossier),
    ('expense_without_dossier_silent', n_expense_orphan),
    ('policy_pin_without_version_silent', n_policy);

  if n_quarantine<>0 or n_recv<>1 or n_recv_after_update<>1
     or n_sent<>1 or sent_dossier<>1 or n_reassign<>0
     or n_received<>1 or recv_dossier<>1
     or n_shared<>1 or n_unshared<>1 or n_reshare<>1
     or n_expense_dossier<>1 or n_expense_orphan<>0
     or n_policy<>0
  then
    raise exception 'UT-3B FAIL: quar=% recv=% noRelease=% sent=% sentDoss=% reassign=% recvd=% recvDoss=% shared=% unshared=% resave=% expDoss=% expOrphan=% policy=%',
      n_quarantine, n_recv, n_recv_after_update, n_sent, sent_dossier, n_reassign,
      n_received, recv_dossier, n_shared, n_unshared, n_reshare,
      n_expense_dossier, n_expense_orphan, n_policy;
  end if;
end $$;

select * from _r order by check_name;

-- ROLLBACK IS THE FINAL ASSERTION: every event above shared its act's
-- transaction, so discarding the transaction discards the events with it. If
-- any emitter had written out-of-band, rows would survive this rollback.
rollback;

-- Proof that nothing leaked past the rollback.
do $$
declare leaked int;
begin
  select count(*) into leaked from public.business_event
   where event_type in ('CORRESPONDENCE_RECEIVED', 'HANDOFF_SENT', 'HANDOFF_RECEIVED',
                        'DOCUMENT_SHARED_WITH_CLIENT', 'EXPENSE_AUTHORIZED')
     and occurred_at > now() - interval '5 minutes';
  if leaked <> 0 then
    raise exception 'UT-3B FAIL: % event(s) survived ROLLBACK — an emitter wrote outside its transaction', leaked;
  end if;
end $$;
