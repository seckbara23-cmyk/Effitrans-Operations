-- ============================================================================
-- Migration 120 — finalize_generated_artifact accepts the generation timestamp
-- ============================================================================
-- RQ / Alternative B (ratified 2026-08-21): the ORDRE DE TRANSPORT prints
-- « Émis le : DD/MM/YYYY ». The date must be the artifact's OWN frozen
-- generation timestamp, so that the printed document and `document.generated_at`
-- can never disagree, and so an archived version can be re-rendered byte-for-byte
-- from its stored inputs.
--
-- The obstacle this removes: the RPC set `generated_at` to `now()` at INSERT
-- time, while the PDF is rendered BEFORE the insert. Two clocks, read moments
-- apart, cannot be relied on to agree — and across a midnight boundary they
-- would print one date and store another. So the caller now mints the timestamp
-- ONCE and supplies it to both the renderer and this function.
--
-- NO TABLE CHANGE. No new column, no `issued_at`, no backfill. `generated_at`
-- already exists on `public.document`; only the way it is FILLED changes.
--
-- COMPATIBILITY. `p_generated_at` is appended LAST and defaults to NULL, and the
-- body falls back to `now()` when it is absent — so every existing caller keeps
-- working unchanged and keeps its previous behaviour exactly.
--
-- Why DROP + CREATE rather than CREATE OR REPLACE: adding a parameter changes
-- the identity arguments, so a replace would leave the 14-argument function in
-- place beside the new one and every 14-argument call would become ambiguous
-- ("function is not unique"). Dropping first is what keeps exactly one function.
-- Both statements run in the migration's single transaction, so no window exists
-- in which the function is missing.
-- ============================================================================

drop function if exists public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid);

create function public.finalize_generated_artifact(
  p_document_id      uuid,
  p_tenant_id        uuid,
  p_file_id          uuid,
  p_artifact_code    text,
  p_type_code        text,
  p_storage_path     text,
  p_content_sha256   text,
  p_source_sha256    text,
  p_source_snapshot  jsonb,
  p_renderer_version text,
  p_provenance       text,
  p_actor            uuid,
  p_size_bytes       bigint,
  p_policy_id        uuid,
  -- RQ / Alternative B. NULL keeps the historical behaviour for every caller
  -- that does not supply it.
  p_generated_at     timestamptz default null)
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
    -- RQ / Alternative B — the SUPPLIED timestamp is authoritative. `now()` is
    -- only the fallback for callers that pass nothing; it is never a second
    -- source of truth for a caller that did supply one.
    p_actor, coalesce(p_generated_at, now()), p_actor,
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
end;
$$;

-- Authority posture preserved EXACTLY as before: service_role only. A DROP takes
-- the old grants with it, so they are restated rather than assumed.
revoke all on function public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid, timestamptz)
  from public;
revoke all on function public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid, timestamptz)
  from anon, authenticated;
grant execute on function public.finalize_generated_artifact(
  uuid, uuid, uuid, text, text, text, text, text, jsonb, text, text, uuid, bigint, uuid, timestamptz)
  to service_role;

-- ============================================================================
-- Self-assertions — this migration refuses to report success on a wrong state.
-- ============================================================================
do $assert$
declare
  v_count int;
  v_src   text;
  v_args  text;
begin
  -- 1. EXACTLY ONE function survives: the ambiguity trap the DROP exists to avoid.
  select count(*) into v_count from pg_proc
   where proname = 'finalize_generated_artifact'
     and pronamespace = 'public'::regnamespace;
  if v_count <> 1 then
    raise exception 'expected exactly 1 finalize_generated_artifact, found %', v_count;
  end if;

  -- 2. It takes the new parameter, appended last.
  --
  -- Matched against BOTH spellings on purpose: `pg_get_function_identity_arguments`
  -- returns the CANONICAL type name, so `timestamptz` comes back as
  -- `timestamp with time zone`. The first version of this assertion checked only
  -- the short spelling and aborted a correct migration — which is the assertion
  -- doing its job (it refused to claim success on a state it could not verify),
  -- but the check itself was wrong. The actual argument list is included in the
  -- message so the next reader is not left guessing as I was.
  select pg_get_function_identity_arguments(oid) into v_args
    from pg_proc
   where proname = 'finalize_generated_artifact'
     and pronamespace = 'public'::regnamespace;
  if v_args not like '%p_generated_at timestamp with time zone'
     and v_args not like '%p_generated_at timestamptz' then
    raise exception 'p_generated_at is not the final parameter (args: %)', v_args;
  end if;

  -- 3. The supplied timestamp is authoritative, with now() only as fallback.
  select prosrc into v_src from pg_proc
   where proname = 'finalize_generated_artifact' and pronamespace = 'public'::regnamespace;
  if position('coalesce(p_generated_at, now())' in v_src) = 0 then
    raise exception 'the supplied generation timestamp is not honoured';
  end if;

  -- 4. Security posture intact.
  if not (select prosecdef from pg_proc where proname = 'finalize_generated_artifact'
            and pronamespace = 'public'::regnamespace) then
    raise exception 'finalize_generated_artifact must remain SECURITY DEFINER';
  end if;

  -- 5. NOT executable by anonymous or logged-in roles — service_role only.
  if has_function_privilege('anon',
       (select oid from pg_proc where proname = 'finalize_generated_artifact'
          and pronamespace = 'public'::regnamespace), 'EXECUTE')
   or has_function_privilege('authenticated',
       (select oid from pg_proc where proname = 'finalize_generated_artifact'
          and pronamespace = 'public'::regnamespace), 'EXECUTE') then
    raise exception 'finalize_generated_artifact must not be executable by anon/authenticated';
  end if;

  -- 6. No table change was made: generated_at is the SAME pre-existing column.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'document' and column_name = 'generated_at') then
    raise exception 'document.generated_at is missing — this migration must not create it';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'document' and column_name = 'issued_at') then
    raise exception 'issued_at must not exist — Alternative B reuses generated_at';
  end if;
end
$assert$;
