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
--   * DOSSIER_POLICY_PINNED emits exactly once on the POSITIVE path,
--     carrying the dossier and its provenance;
--   * the app-level ledger marker's call shape is valid and lands correctly;
--   * repeating an act already in its terminal state emits NOTHING -- every
--     trigger keys on the TRANSITION, not on the value;
--   * ROLLBACK emits nothing — the event shares the act's transaction — and
--     the check now covers all seven types.

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
  n_policy int; n_policy_pinned int; policy_meta int; policy_dossier int;
  n_marker int; marker_shape int; n_dup_received int; n_dup_share int;
  sent_dossier int; recv_dossier int;
  inst uuid; inst2 uuid; ho uuid; doc uuid; msg uuid; qmsg uuid; pv uuid; exp uuid;
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
  insert into public.document
    (id, tenant_id, file_id, type_code, status, storage_path, shared_with_client)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1',
          (select code from public.document_type limit 1), 'APPROVED',
          'ut3/test/doc.pdf', false)
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
    (id, tenant_id, file_id, amount, beneficiary, reason, status, requested_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1', 150000, 'Bénéficiaire', 'Motif',
          'IN_APPROVAL', '00000000-0000-0000-0000-00000000e301')
  returning id into exp;
  update public.expense_authorization set status = 'APPROVED' where id = exp;
  select count(*) into n_expense_dossier from public.business_event
   where event_type = 'EXPENSE_AUTHORIZED' and subject_id = exp;

  -- A dossier-LESS expense: no visibility branch would admit its event, so the
  -- emitter stays silent rather than inventing one.
  insert into public.expense_authorization
    (id, tenant_id, file_id, amount, beneficiary, reason, status, requested_by)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          null, 150000, 'Bénéficiaire 2', 'Motif 2', 'IN_APPROVAL',
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

  -- POSITIVE PATH: an instance created WITH a pinned version emits exactly one
  -- event, carrying the dossier and the provenance. Without this the trigger's
  -- firing path was never exercised -- only its silence was.
  insert into public.workflow_policy_version
    (id, tenant_id, version, policy_schema_version, status, document, content_sha256,
     validation_status, activation_reason, activated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 99, 1, 'ACTIVE',
          '{"policySchemaVersion":1}'::jsonb, 'ut3b-policy-hash', 'PASSED', 'ut3b test', now())
  returning id into pv;

  insert into public.process_instance
    (id, tenant_id, file_id, policy_version_id, policy_provenance)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-00000000e3f1', pv, 'PINNED')
  returning id into inst2;

  select count(*) into n_policy_pinned from public.business_event
   where event_type = 'DOSSIER_POLICY_PINNED'
     and subject_id = '00000000-0000-0000-0000-00000000e3f1';
  select count(*) into policy_dossier from public.business_event
   where event_type = 'DOSSIER_POLICY_PINNED'
     and dossier_id = '00000000-0000-0000-0000-00000000e3f1';
  select count(*) into policy_meta from public.business_event
   where event_type = 'DOSSIER_POLICY_PINNED' and metadata->>'provenance' = 'PINNED';

  -- =====================================================================
  -- 7. THE LEDGER HONESTY MARKER -- the one app-level emitter.
  --    Called with exactly the parameters lib/workflow/events/ledger-marker.ts
  --    uses, so this proves the call SHAPE is valid against the real registry
  --    and lands a well-formed row. The once-per-tenant guard is TypeScript and
  --    is pinned separately by tests/ut-3b-ledger-marker.test.ts.
  -- =====================================================================
  perform public.emit_business_event(
    '00000000-0000-0000-0000-000000000001', 'HISTORICAL_EVENTS_NOT_BACKFILLED',
    'ledger', 'app_action', 'organization',
    '00000000-0000-0000-0000-000000000001', null,
    '00000000-0000-0000-0000-00000000e301',
    jsonb_build_object('ledger_started_at', now()::text));

  select count(*) into n_marker from public.business_event
   where event_type = 'HISTORICAL_EVENTS_NOT_BACKFILLED';
  select count(*) into marker_shape from public.business_event
   where event_type = 'HISTORICAL_EVENTS_NOT_BACKFILLED'
     and event_domain = 'ledger' and source = 'app_action'
     and dossier_id is null and metadata ? 'ledger_started_at';

  -- =====================================================================
  -- 8. DUPLICATE EMISSION IS IMPOSSIBLE -- repeating an act that is already in
  --    its terminal state fires nothing, because every trigger keys on the
  --    TRANSITION, not on the value.
  -- =====================================================================
  update public.process_handoff set status = 'RECEIVED' where id = ho;
  select count(*) into n_dup_received from public.business_event
   where event_type = 'HANDOFF_RECEIVED' and subject_id = ho;

  update public.document set shared_with_client = true where id = doc;
  update public.document set shared_with_client = true where id = doc;
  select count(*) into n_dup_share from public.business_event
   where event_type = 'DOCUMENT_SHARED_WITH_CLIENT' and subject_id = doc;

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
    ('policy_pin_without_version_silent', n_policy),
    ('policy_pinned_emits_once', n_policy_pinned),
    ('policy_pinned_carries_dossier', policy_dossier),
    ('policy_pinned_carries_provenance', policy_meta),
    ('ledger_marker_emits', n_marker),
    ('ledger_marker_shape_correct', marker_shape),
    ('handoff_received_not_duplicated', n_dup_received),
    ('document_share_not_duplicated', n_dup_share);

  if n_quarantine<>0 or n_recv<>1 or n_recv_after_update<>1
     or n_sent<>1 or sent_dossier<>1 or n_reassign<>0
     or n_received<>1 or recv_dossier<>1
     or n_shared<>1 or n_unshared<>1 or n_reshare<>1
     or n_expense_dossier<>1 or n_expense_orphan<>0
     or n_policy<>0
     or n_policy_pinned<>1 or policy_dossier<>1 or policy_meta<>1
     or n_marker<>1 or marker_shape<>1
     or n_dup_received<>1 or n_dup_share<>2
  then
    raise exception 'UT-3B FAIL: quar=% recv=% noRelease=% sent=% sentDoss=% reassign=% recvd=% recvDoss=% shared=% unshared=% resave=% expDoss=% expOrphan=% policy=% policyPinned=% policyDoss=% policyMeta=% marker=% markerShape=% dupRecv=% dupShare=%',
      n_quarantine, n_recv, n_recv_after_update, n_sent, sent_dossier, n_reassign,
      n_received, recv_dossier, n_shared, n_unshared, n_reshare,
      n_expense_dossier, n_expense_orphan, n_policy,
      n_policy_pinned, policy_dossier, policy_meta,
      n_marker, marker_shape, n_dup_received, n_dup_share;
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
                        'DOCUMENT_SHARED_WITH_CLIENT', 'EXPENSE_AUTHORIZED',
                        'DOSSIER_POLICY_PINNED', 'HISTORICAL_EVENTS_NOT_BACKFILLED')
     and occurred_at > now() - interval '5 minutes';
  if leaked <> 0 then
    raise exception 'UT-3B FAIL: % event(s) survived ROLLBACK — an emitter wrote outside its transaction', leaked;
  end if;
end $$;
