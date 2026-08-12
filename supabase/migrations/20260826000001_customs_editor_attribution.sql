-- ===========================================================================
-- MAYA-P0.8-B (PG-6) — the editor half of the maker-checker separation
-- ---------------------------------------------------------------------------
-- THE HOLE THIS CLOSES, and it is one PG-1 itself created.
--
-- P0.8-A enforced that the CREATOR of a customs record may not validate it.
-- That was the strongest separation the schema could express, and the phase
-- said so plainly: `created_by` is the only authorship column, there is no
-- `updated_by`, so "someone who EDITED a record they did not create is not
-- currently distinguishable from any other checker".
--
-- Which means the control had a live hole. A checker who opens someone else's
-- customs record, corrects the declaration number, and then validates it is
-- validating their OWN work — the exact thing `customs:validate` exists to
-- prevent — and neither the server nor the database could tell.
--
-- WHY A COLUMN AND NOT `audit_log`. The editor is already recoverable from
-- `audit_log`: `updateCustoms` writes CUSTOMS_UPDATED with its actor. But that
-- store is forensic, retained on its own terms, and reading it to make a LIVE
-- AUTHORIZATION decision would make a security control depend on a retention
-- policy — if rows are ever pruned, the separation silently weakens and nothing
-- reports it. Provenance that a control depends on belongs ON the record, next
-- to `created_by`, which is exactly the shape already in use.
--
-- SCOPE, deliberately narrow. `updated_by` records who last edited the
-- DECLARATION CONTENT — the information whose exactitude the Chef de Transit
-- validates. Changing a status, recording a BAE reference or pronouncing
-- recevabilité are different acts on the same row and are NOT editorship; they
-- do not set this column, and treating them as authorship would lock legitimate
-- checkers out of validating dossiers they merely moved along.
--
-- Additive and nullable: every existing row keeps `updated_by IS NULL`, which
-- reads as "no edit attributed", and the separation then falls back to
-- `created_by` exactly as P0.8-A shipped it. No history is invented.
-- ===========================================================================

alter table public.customs_record
  add column if not exists updated_by uuid references public.app_user (id);

-- ===========================================================================
-- The validation RPC gains the second half of the separation.
--
-- CREATE OR REPLACE, not a new function: P0.8-A's signature, grants and
-- behaviour are preserved verbatim and the rule only ever becomes STRICTER.
-- Anything that was refused before is still refused; what changes is that a
-- checker who edited the record is now refused too.
-- ===========================================================================
create or replace function public.record_customs_validation(
  p_customs_id uuid,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant  uuid;
  v_file    uuid;
  v_creator uuid;
  v_editor  uuid;
  v_at      timestamptz;
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, created_by, updated_by, reviewed_at
    into v_tenant, v_file, v_creator, v_editor, v_at
    from public.customs_record
   where id = p_customs_id and deleted_at is null
     for update;
  if not found then raise exception 'customs record not found'; end if;

  -- OPS-SEC-2A trust contract (unchanged from P0.8-A). p_actor is
  -- caller-declared, so the database verifies it rather than believing it.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:validate', 'SERVICE');

  -- MAKER-CHECKER, now on BOTH halves of authorship. Either being the actor is
  -- disqualifying: whoever wrote the information may not be the one who
  -- certifies it, whether they wrote it first or last.
  if v_creator is not null and v_creator = p_actor then
    raise exception 'the preparer of a customs record may not validate it';
  end if;
  if v_editor is not null and v_editor = p_actor then
    raise exception 'the last editor of a customs record may not validate it';
  end if;

  -- The guard is on the INSTANT. A legacy row carrying a bare `reviewed_by`
  -- was never validated in this platform's sense, so it remains validatable.
  if v_at is not null then
    raise exception 'this customs record is already validated';
  end if;

  update public.customs_record
     set reviewed_by = p_actor,
         reviewed_at = now()
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_VALIDATED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    -- Records that the separation was evaluated against BOTH halves, never who
    -- the maker was: the ledger states the fact, the record holds identities.
    p_metadata      => jsonb_build_object(
      'maker_checked', v_creator is not null or v_editor is not null
    )
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file);
end; $$;

revoke execute on function public.record_customs_validation(uuid, uuid) from public;
revoke execute on function public.record_customs_validation(uuid, uuid) from anon;
revoke execute on function public.record_customs_validation(uuid, uuid) from authenticated;
grant  execute on function public.record_customs_validation(uuid, uuid) to service_role;

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name = 'updated_by' and is_nullable = 'YES';
  if n <> 1 then raise exception 'P0.8-B: updated_by must exist and be nullable'; end if;

  -- BOTH halves of the separation are in the function body.
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_validation(uuid,uuid)'))
     !~ 'v_editor = p_actor' then
    raise exception 'P0.8-B: the editor half of maker-checker is missing';
  end if;
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_validation(uuid,uuid)'))
     !~ 'v_creator = p_actor' then
    raise exception 'P0.8-B: the creator half of maker-checker was lost';
  end if;

  -- The trust contract survived the replace.
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_validation(uuid,uuid)'))
     !~ 'assert_actor_authority' then
    raise exception 'P0.8-B: the actor-authority contract was lost';
  end if;

  -- No new permission, no second validation store, no status widening.
  select count(*) into n from information_schema.tables
   where table_schema = 'public' and table_name ilike '%customs_validation%';
  if n <> 0 then raise exception 'P0.8-B: no separate validation table may exist'; end if;
end $$;
