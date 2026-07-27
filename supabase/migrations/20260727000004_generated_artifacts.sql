-- 20260727000004_generated_artifacts.sql
-- Effitrans Operations Platform — PHASE WES-4G: generated internal artifacts.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Closes the WES-4 gaps: internal artifacts are now GENERATED from
-- structured data, uploads carry a verified byte hash, and generated versions
-- are immutable and reproducible.
--
-- ===========================================================================
-- THE STORAGE / DATABASE BOUNDARY (WES-4G.10)
-- ===========================================================================
-- Object storage cannot join a PostgreSQL transaction, so "one transaction"
-- has to mean something precise. It means this:
--
--   1. RENDER the PDF in memory and hash the final bytes.
--   2. PUT the object at a deterministic key. At this moment the object exists
--      and NOTHING references it — it is not an artifact, it is a blob.
--   3. FINALIZE atomically: `finalize_generated_artifact` inserts the document
--      row, supersedes the previous current artifact, and emits
--      INTERNAL_DOCUMENT_GENERATED, in ONE transaction.
--
-- AN ARTIFACT BECOMES AUTHORITATIVE AT STEP 3, NEVER BEFORE. The document row
-- is what makes bytes an artifact; until it exists, the object is unreferenced
-- and invisible to every reader.
--
-- Failure modes, stated rather than hoped about:
--   * storage succeeds, finalization fails  -> the object is orphaned. The
--     caller deletes it best-effort; if that delete also fails, the object sits
--     unreferenced and harmless. NO row, NO event, NO artifact. Re-running
--     generation writes a NEW key and succeeds.
--   * finalization succeeds, object missing -> the row points at nothing and
--     the download fails loudly. This is why the object is written FIRST: the
--     ordering makes the survivable failure the one that actually happens.
--   * the event fails -> the whole finalization rolls back (WES-9A Model A),
--     so there is no row and the object is orphaned as above.
--
-- Orphans are detectable: an object under `<tenant>/<file>/<uuid>` with no
-- `document` row of that id. No sweeper ships here — inventing a deletion job
-- against a storage bucket is exactly the kind of destructive automation this
-- programme keeps refusing to add without a ratified retention policy.

-- ===========================================================================
-- 1. The DEMANDE DE TRANSPORT type.
--
--    NEW. The audit found no document type, no request record and no code path
--    for it anywhere — the artifact did not exist as a concept, while every
--    input it needs already did.
-- ===========================================================================
insert into public.document_type
  (code, label_fr, label_en, category, required_for, conditional, active, sort_order)
values
  ('DEMANDE_TRANSPORT', 'Demande de transport', 'Transport Request', 'transport',
   '{}', true, true, 75)
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Artifact identity on `document`.
--
--    The version/hash/renderer columns arrived with WES-4 (migration 65) and
--    already have a home. What is added here is the ARTIFACT CODE and the
--    normalized SOURCE SNAPSHOT, so an artifact can be explained and
--    reproduced without re-reading five tables as they stand today.
-- ===========================================================================
alter table public.document
  -- Which internal artifact this is. NULL for external evidence.
  add column if not exists artifact_code   text,
  -- The exact normalized structured facts the PDF was rendered from. Safe
  -- fields only: no notes, no phone numbers, no unrelated client data.
  add column if not exists source_snapshot jsonb,
  -- How trustworthy the driver identity on the artifact is (WES-4G.4).
  add column if not exists artifact_provenance text
    check (artifact_provenance is null or artifact_provenance in (
      'AUTHENTICATED_DRIVER', 'LEGACY_TEXT_DRIVER', 'NO_DRIVER'));

create index if not exists idx_document_artifact
  on public.document (file_id, artifact_code)
  where artifact_code is not null and superseded_by_id is null and deleted_at is null;

-- Historical manual uploads of an internal type are NOT retro-labelled as
-- generated. They keep their honest provenance from migration 65 and gain no
-- artifact_code — a generator existing now does not make them its output.
-- (WES-4G.7 / WES-4G.12: "do not relabel historical files as system generated".)

-- ===========================================================================
-- 3. A generated artifact can never be replaced by hand.
--
--    WES-4G.7 requires manual replacement to be rejected SERVER-SIDE. The
--    application refuses it too, but a trigger is the layer no future caller
--    can forget.
-- ===========================================================================
create or replace function public.protect_generated_artifact()
returns trigger
language plpgsql
as $$
begin
  -- An upload (no generator metadata) may not claim to supersede a generated
  -- artifact: corrections happen on the structured record, then regeneration.
  if new.supersedes_id is not null and new.generated_at is null then
    if exists (
      select 1 from public.document d
       where d.id = new.supersedes_id and d.artifact_code is not null
    ) then
      raise exception
        'a generated artifact is replaced by regeneration, not by manual upload';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_document_protect_generated
  before insert on public.document
  for each row execute function public.protect_generated_artifact();

-- ===========================================================================
-- 4. finalize_generated_artifact — the atomic step 3 (WES-4G.10).
--
--    Row + supersession + event, in ONE transaction. The caller has already
--    written the object; this is the moment the bytes become an artifact.
-- ===========================================================================
create or replace function public.finalize_generated_artifact(
  p_document_id     uuid,
  p_tenant_id       uuid,
  p_file_id         uuid,
  p_artifact_code   text,
  p_type_code       text,
  p_storage_path    text,
  p_content_sha256  text,
  p_source_sha256   text,
  p_source_snapshot jsonb,
  p_renderer_version text,
  p_provenance      text,
  p_actor           uuid,
  p_size_bytes      bigint default null,
  p_policy_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous uuid;
  v_version  int := 1;
begin
  if coalesce(btrim(p_content_sha256), '') = '' then
    raise exception 'a generated artifact must carry a content hash';
  end if;

  -- The current artifact of this type, if any. Locked so two concurrent
  -- regenerations cannot both believe they are superseding it.
  select id, version into v_previous, v_version
    from public.document
   where tenant_id = p_tenant_id
     and file_id = p_file_id
     and artifact_code = p_artifact_code
     and superseded_by_id is null
     and deleted_at is null
   order by version desc
   limit 1
   for update;

  v_version := coalesce(v_version, 0) + 1;

  insert into public.document (
    id, tenant_id, file_id, type_code, title, status, version,
    supersedes_id, storage_path, mime_type, size_bytes,
    content_sha256, source_sha256, source_snapshot, renderer_version,
    artifact_code, artifact_provenance,
    generated_by, generated_at, uploaded_by,
    policy_version_id, provenance)
  values (
    p_document_id, p_tenant_id, p_file_id, p_type_code,
    p_artifact_code || ' v' || v_version,
    -- A generated artifact is authoritative on creation: the platform authored
    -- it from its own records, so there is no external claim to verify.
    'VERIFIED', v_version,
    v_previous, p_storage_path, 'application/pdf', p_size_bytes,
    p_content_sha256, p_source_sha256, p_source_snapshot, p_renderer_version,
    p_artifact_code, p_provenance,
    p_actor, now(), p_actor,
    p_policy_id, 'GOVERNED');

  -- Close the previous version. Explicit supersession, both directions.
  if v_previous is not null then
    update public.document
       set superseded_by_id = p_document_id, status = 'SUPERSEDED'
     where id = v_previous;

    perform public.emit_business_event(
      p_tenant_id, 'DOCUMENT_SUPERSEDED', 'document', 'document_rpc',
      'document', v_previous, p_file_id, p_actor,
      jsonb_build_object('type_code', p_type_code));
  end if;

  -- WES-4G.10 — the mandatory event. Metadata carries identifiers and hashes
  -- only; the snapshot itself stays on the row, never in the ledger.
  perform public.emit_business_event(
    p_tenant_id, 'INTERNAL_DOCUMENT_GENERATED', 'document', 'document_rpc',
    'document', p_document_id, p_file_id, p_actor,
    jsonb_build_object(
      'type_code', p_type_code,
      'artifact_code', p_artifact_code,
      'renderer_version', p_renderer_version,
      'artifact_version', v_version));

  return jsonb_build_object(
    'document_id', p_document_id,
    'version', v_version,
    'superseded_id', v_previous);
end; $$;

revoke execute on function public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid) from public;
grant execute on function public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid) to service_role;
