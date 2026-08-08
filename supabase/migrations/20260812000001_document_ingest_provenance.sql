-- 20260812000001_document_ingest_provenance.sql
-- Effitrans — EMP-4: provenance for a document created from inbound mail.
--
-- THE WHOLE MIGRATION IS ONE NULLABLE COLUMN AND ONE PARTIAL UNIQUE INDEX.
-- Everything else EMP-4 needs already exists: the `document` table and its
-- `content_sha256`, the `documents` bucket, `uploadObject`/`sha256Hex`, the
-- `DOCUMENT_UPLOADED` trigger, and the `document:*` permission family. The audit
-- (docs/mail/emp-4-audit.md) enumerates it.
--
-- WHY A COLUMN AT ALL, WHEN BOTH SIDES ALREADY CARRY A SHA-256 (RATIFY-EMP4-1).
-- The hash proves CONTENT identity: these bytes are those bytes. It cannot
-- prove BUSINESS provenance — two customers can send the same PDF, and matching
-- on hash alone would attribute a document to whichever attachment happened to
-- share its content. The FK names the attachment this document actually came
-- from. Both are kept, because they answer different questions.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--   * no new table — the document model and the attachment model both stand;
--   * no new bucket — bytes are copied into the existing `documents` bucket;
--   * no RLS policy and no permission — ingestion composes `document:create`
--     and `communication:inbound:read`, which both already exist;
--   * no emitter — `emit_document_events()` already fires DOCUMENT_UPLOADED on
--     INSERT, and a second producer is forbidden (RATIFY-EMP4-5);
--   * no trigger, no RPC, no queue, no background job.

-- ===========================================================================
-- 1. PROVENANCE
-- ===========================================================================
alter table public.document
  add column if not exists source_attachment_id uuid
    references public.ec_inbound_attachment (id);

comment on column public.document.source_attachment_id is
  'EMP-4: the inbound mail attachment this document was created from. NULL for every document not created by ingestion, which is all of them before EMP-4. The inbound row itself is never modified — provenance is recorded on the copy, not on the evidence.';

-- ===========================================================================
-- 2. IDEMPOTENCY
-- ===========================================================================
-- THE invariant: one inbound attachment yields at most one business document.
--
-- Enforced by the database rather than by a check in the service, because the
-- service could be raced by two operators clicking at the same moment and a
-- read-then-insert would let both through. A unique index cannot be raced.
--
-- PARTIAL, so the millions of documents that came from an upload — every row
-- that exists today — are unaffected: they share NULL, and NULL is not equal to
-- NULL for uniqueness purposes. This also makes the index cheap to build and
-- safe to validate, unlike a narrowing CHECK.
--
-- It deliberately does NOT exclude soft-deleted documents. A soft-deleted
-- document still records that this attachment was ingested; allowing a second
-- ingestion after deletion would make the refusal depend on lifecycle state,
-- and "already ingested" is a fact about the attachment, not about the current
-- status of its copy. Deliberate duplication, if the business ever needs it,
-- is an explicit override path with its own audit evidence — never the default.
create unique index if not exists uq_document_source_attachment
  on public.document (source_attachment_id)
  where source_attachment_id is not null;

-- Finding the documents that came from mail, and answering "was this attachment
-- ingested?" without scanning.
create index if not exists idx_document_ingested
  on public.document (tenant_id, source_attachment_id)
  where source_attachment_id is not null;

-- ===========================================================================
-- 3. ASSERTIONS — exercised at migration time.
-- ===========================================================================
-- Deliberately narrow. EMP-3 taught two lessons that apply directly here:
-- assert the property that actually matters, and do not assert a grant when the
-- effective control is elsewhere. This migration changes no privilege and no
-- policy, so it asserts only what it did change.
do $$
declare
  v_bad text;
begin
  -- The column exists and is NULLABLE. A NOT NULL column here would have been
  -- unaddable — every existing document has no source attachment.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'document'
       and column_name = 'source_attachment_id' and is_nullable = 'YES'
  ) then
    raise exception 'EMP-4 assertion FAILED: source_attachment_id missing or NOT NULL';
  end if;

  -- The idempotency index exists and is PARTIAL. A non-partial unique index
  -- would allow exactly one NULL row in the whole table — i.e. one document.
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'uq_document_source_attachment'
       and indexdef like '%WHERE (source_attachment_id IS NOT NULL)%'
  ) then
    raise exception 'EMP-4 assertion FAILED: uq_document_source_attachment missing or not partial';
  end if;

  -- No new policy was introduced on either table.
  select string_agg(tablename || '/' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename in ('document', 'ec_inbound_attachment')
     and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'EMP-4 assertion FAILED: a write policy exists: %', v_bad;
  end if;

  -- The trigger EMP-4 depends on is still the only producer of the event, and
  -- is still attached. If this ever fails, ingestion would create documents
  -- that never reach the timeline.
  if not exists (
    select 1 from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_proc p on p.oid = t.tgfoid
     where c.relname = 'document' and p.proname = 'emit_document_events'
       and not t.tgisinternal
  ) then
    raise exception 'EMP-4 assertion FAILED: emit_document_events is not attached to document';
  end if;

  raise notice 'EMP-4 OK: nullable provenance FK, partial unique index, no new policy, DOCUMENT_UPLOADED trigger intact.';
end $$;

-- ===========================================================================
-- 4. BEHAVIOURAL ASSERTION — the idempotency actually bites.
-- ===========================================================================
do $$
declare
  v_tenant uuid;
  v_file   uuid;
  v_att    uuid;
  v_type   text;
begin
  select id, tenant_id into v_file, v_tenant
    from public.operational_file limit 1;
  select code into v_type from public.document_type limit 1;
  select id into v_att from public.ec_inbound_attachment limit 1;

  if v_file is null or v_type is null or v_att is null then
    raise notice 'EMP-4: no fixture data present, skipping behavioural assertion.';
    return;
  end if;

  insert into public.document
    (tenant_id, file_id, type_code, storage_path, source_attachment_id)
  values (v_tenant, v_file, v_type, 'emp4/assert/a.pdf', v_att);

  -- The second ingestion of the same attachment must be impossible.
  begin
    insert into public.document
      (tenant_id, file_id, type_code, storage_path, source_attachment_id)
    values (v_tenant, v_file, v_type, 'emp4/assert/b.pdf', v_att);
    raise exception 'EMP-4 assertion FAILED: the same attachment was ingested twice';
  exception
    when unique_violation then null;
  end;

  -- Two documents with NO source attachment must remain perfectly legal —
  -- otherwise the partial predicate is wrong and ordinary uploads break.
  insert into public.document (tenant_id, file_id, type_code, storage_path)
  values (v_tenant, v_file, v_type, 'emp4/assert/c.pdf');
  insert into public.document (tenant_id, file_id, type_code, storage_path)
  values (v_tenant, v_file, v_type, 'emp4/assert/d.pdf');

  delete from public.document where storage_path like 'emp4/assert/%';
  raise notice 'EMP-4 behavioural assertion OK: one attachment -> one document; NULL provenance unconstrained.';
end $$;
