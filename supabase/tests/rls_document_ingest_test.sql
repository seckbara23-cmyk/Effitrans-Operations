-- rls_document_ingest_test.sql
-- EMP-4 — attachment → document ingestion, proven against a real database.
--
-- Three properties that only a database can demonstrate:
--   1. the same attachment cannot become two documents (the unique index);
--   2. an ingested document emits DOCUMENT_UPLOADED EXACTLY ONCE, from the
--      existing trigger and from nowhere else;
--   3. the inbound attachment row and its hash are untouched by ingestion —
--      the capture remains evidence.

begin;

create temp table _r (check_name text, value text) on commit drop;

do $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_type     text;
  v_msg      uuid;
  v_att      uuid;
  v_doc      uuid;
  v_doc2     uuid;
  v_events   int;
  v_before   text;
  v_after    text;
  v_mailbox  uuid;
begin
  select id, tenant_id into v_file, v_tenant from public.operational_file limit 1;
  select code into v_type from public.document_type limit 1;
  if v_file is null or v_type is null then
    insert into _r values ('ingest_invariants', 'skipped_no_fixture');
    return;
  end if;

  -- A captured message + attachment to ingest. Built here rather than assumed,
  -- so the suite is independent of whatever mail happens to exist.
  insert into public.ec_mailbox (tenant_id, address, label_fr)
  values (v_tenant, 'emp4-ingest@test.local', 'EMP-4 test')
  on conflict (address) do update set label_fr = excluded.label_fr
  returning id into v_mailbox;

  insert into public.ec_inbound_message
    (tenant_id, mailbox_id, provider, provider_event_id, from_address,
     raw_sha256, raw_storage_path, raw_size_bytes, received_at, capture_status)
  values (v_tenant, v_mailbox, 'GENERIC', 'emp4-evt-1', 'sender@test.local',
          'aa' , 'ec/emp4/raw.eml', 10, now(), 'RECEIVED')
  returning id into v_msg;

  insert into public.ec_inbound_attachment
    (tenant_id, message_id, filename, mime_type, size_bytes, sha256, storage_path, stored)
  values (v_tenant, v_msg, 'facture.pdf', 'application/pdf', 100,
          'abc123', 'ec/emp4/facture.pdf', true)
  returning id into v_att;

  select sha256 into v_before from public.ec_inbound_attachment where id = v_att;

  -- ---- 1. Ingestion creates the document ---------------------------------
  insert into public.document
    (tenant_id, file_id, type_code, title, status, storage_path,
     mime_type, size_bytes, content_sha256, source_attachment_id)
  values (v_tenant, v_file, v_type, 'facture.pdf', 'UPLOADED', 'docs/emp4/facture.pdf',
          'application/pdf', 100, 'abc123', v_att)
  returning id into v_doc;

  -- ---- 2. The SAME attachment cannot be ingested again --------------------
  begin
    insert into public.document
      (tenant_id, file_id, type_code, status, storage_path, source_attachment_id)
    values (v_tenant, v_file, v_type, 'UPLOADED', 'docs/emp4/again.pdf', v_att)
    returning id into v_doc2;
    raise exception 'EMP-4 RLS FAIL: the same attachment produced a second document';
  exception
    when unique_violation then
      insert into _r values ('attachment_ingested_at_most_once', 'ok');
  end;

  -- Not even into a different dossier: "already ingested" is a fact about the
  -- attachment, not about one dossier.
  begin
    insert into public.document
      (tenant_id, file_id, type_code, status, storage_path, source_attachment_id)
    values (v_tenant, v_file, v_type, 'UPLOADED', 'docs/emp4/other.pdf', v_att);
    raise exception 'EMP-4 RLS FAIL: attachment ingested twice across dossiers';
  exception
    when unique_violation then
      insert into _r values ('no_second_ingestion_anywhere', 'ok');
  end;

  -- ---- 3. DOCUMENT_UPLOADED emitted EXACTLY ONCE --------------------------
  select count(*) into v_events
    from public.business_event
   where event_type = 'DOCUMENT_UPLOADED' and subject_id = v_doc;
  if v_events <> 1 then
    raise exception 'EMP-4 RLS FAIL: DOCUMENT_UPLOADED emitted % times, expected exactly once', v_events;
  end if;
  insert into _r values ('document_uploaded_emitted_once', 'ok');

  -- It came from the trigger, not from an application emitter.
  if not exists (
    select 1 from public.business_event
     where event_type = 'DOCUMENT_UPLOADED' and subject_id = v_doc and source = 'db_trigger'
  ) then
    raise exception 'EMP-4 RLS FAIL: DOCUMENT_UPLOADED did not come from the db trigger';
  end if;
  insert into _r values ('emitted_by_trigger_only', 'ok');

  -- And no other event type was invented for ingestion.
  if exists (
    select 1 from public.business_event
     where subject_id = v_doc and event_type <> 'DOCUMENT_UPLOADED'
  ) then
    raise exception 'EMP-4 RLS FAIL: an extra business event was emitted for the ingested document';
  end if;
  insert into _r values ('no_extra_business_event', 'ok');

  -- ---- 4. The inbound evidence is untouched -------------------------------
  select sha256 into v_after from public.ec_inbound_attachment where id = v_att;
  if v_after is distinct from v_before then
    raise exception 'EMP-4 RLS FAIL: the inbound attachment hash changed';
  end if;
  if not exists (select 1 from public.ec_inbound_attachment where id = v_att and stored) then
    raise exception 'EMP-4 RLS FAIL: the inbound attachment was altered or removed';
  end if;
  insert into _r values ('inbound_attachment_unchanged', 'ok');

  -- The copy carries the same content hash as the source: same bytes, two
  -- stored objects, each honestly describing its own.
  if (select content_sha256 from public.document where id = v_doc) is distinct from v_before then
    raise exception 'EMP-4 RLS FAIL: copied hash does not equal the inbound hash';
  end if;
  insert into _r values ('copied_hash_equals_inbound_hash', 'ok');

  -- ---- 5. The document lifecycle is independent of the evidence -----------
  -- Superseding or soft-deleting the document must not touch the attachment.
  update public.document set status = 'APPROVED' where id = v_doc;
  update public.document set deleted_at = now() where id = v_doc;
  if not exists (select 1 from public.ec_inbound_attachment where id = v_att and stored) then
    raise exception 'EMP-4 RLS FAIL: document lifecycle affected the inbound attachment';
  end if;
  insert into _r values ('document_lifecycle_independent', 'ok');

  -- Even after soft delete, the attachment stays ingested: the refusal is a
  -- fact about the attachment, not about the document's current status.
  begin
    insert into public.document
      (tenant_id, file_id, type_code, status, storage_path, source_attachment_id)
    values (v_tenant, v_file, v_type, 'UPLOADED', 'docs/emp4/after-delete.pdf', v_att);
    raise exception 'EMP-4 RLS FAIL: soft delete re-opened ingestion';
  exception
    when unique_violation then
      insert into _r values ('soft_delete_does_not_reopen_ingestion', 'ok');
  end;

  -- ---- 6. Ordinary uploads are unaffected ---------------------------------
  insert into public.document (tenant_id, file_id, type_code, status, storage_path)
  values (v_tenant, v_file, v_type, 'UPLOADED', 'docs/emp4/manual-1.pdf');
  insert into public.document (tenant_id, file_id, type_code, status, storage_path)
  values (v_tenant, v_file, v_type, 'UPLOADED', 'docs/emp4/manual-2.pdf');
  insert into _r values ('null_provenance_unconstrained', 'ok');
end $$;

select * from _r order by check_name;
rollback;
