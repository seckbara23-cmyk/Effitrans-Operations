-- ATTR-CUSTOMS-01 — `reviewed_by` means the Step 7 validator, and nothing else.
-- ===========================================================================
-- THE DEFECT, as UAT found it on EFT-IMP-2026-00011.
--
-- The Chef de Transit validated the customs record at step 7
-- (record_customs_validation wrote reviewed_by = Chef, reviewed_at = the
-- instant). Four acts later the field agent finalised the release, and
-- `record_customs_release` — written in WES-4E, BEFORE migration 20260825000001
-- gave `reviewed_by` its validation meaning — still carried
-- `reviewed_by = p_actor` from the days when « the reviewer » was whoever
-- pressed release. The field agent silently became the step 7 validator, next
-- to a `reviewed_at` that was still the Chef's instant. The dossier screen then
-- read « Validé par agterrain ».
--
-- AND THE LEDGER WAS WRONG IN THE SAME WAY, for the same reason. The WES-9
-- customs trigger (20260726000004, re-issued atomic in 20260727000001) had no
-- actor column for any customs act except creation, so it took `reviewed_by`
-- for EVERY status and BAE event. On 00011 that attributed BAE_RECORDED to the
-- Chef (the validator at the moment the field agent recorded it), and
-- CUSTOMS_RELEASE_COMPLETED to the field agent only BY ACCIDENT — because the
-- release had just overwritten the column the trigger was reading.
--
-- THE INVARIANT THIS MIGRATION MAKES TRUE.
--
--   reviewed_by = the actor who performed the governed customs validation
--                 (step 7 — or, after a governed correction, its
--                 recertification). Never the last customs actor, the BAE
--                 recorder, the release approver, the release finaliser, or a
--                 generic event actor.
--
-- Each of the four step 7 → 13 facts now has ONE column, written by ONE act:
--
--   Step 7 validator     reviewed_by          record_customs_validation
--   BAE recorder         bae_recorded_by      record_customs_bae
--   release approver     release_approval_by  record_customs_release_approval
--   release finaliser    released_by   (NEW)  record_customs_release
--
-- WHAT CHANGES.
--   1. `released_by` — additive, nullable, no default, NOT backfilled. The
--      finaliser was never on the record; inventing it for history would be a
--      fact nobody recorded at the time. (The ledger event already names the
--      finaliser of every release since WES-9.)
--   2. `record_customs_release` stops writing `reviewed_by`, writes
--      `released_by`, and refuses a missing actor — a release that cannot be
--      attributed is exactly what this slice exists to end. Signature, grants,
--      status, reference and release-date behaviour are unchanged.
--   3. `emit_customs_events` derives each actor from the column THAT act
--      writes, and reads `reviewed_by` for nothing:
--        CUSTOMS_RELEASE_COMPLETED / STATUS_CHANGED→RELEASED  ← released_by
--        BAE_RECORDED                                         ← bae_recorded_by
--        any other status move                                ← NULL
--      NULL is the honest answer for the last line: no customs column records
--      who moved the lifecycle (changeCustomsStatus writes only `status`), and
--      an unknown actor is safer in an immutable ledger than a wrong one.
--      Each derived actor is also guarded so it can never be STALE: it counts
--      only when the same UPDATE stamped it.
--
-- WHAT DOES NOT CHANGE. Who may record, approve or release; maker/checker on
-- the BAE (`bae_recorded_by` ≠ approver); the step 13 CUSTOMS_RELEASE and
-- BON_A_ENLEVER evidence; reconciliation; the pickup gate. No event type is
-- added, removed or renamed; every emission still happens on exactly the
-- transitions it did, with the same metadata. Atomicity (WES-9A Model A) is
-- preserved verbatim.
--
-- NO DATA IS CORRECTED HERE. EFT-IMP-2026-00011 is repaired by a separate,
-- operator-run, fail-closed script (supabase/data-corrections/), because a
-- schema migration replays in CI and on every fresh database, where that
-- dossier does not exist.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The release finaliser, as its own fact.
-- ---------------------------------------------------------------------------
alter table public.customs_record
  -- WHO finalised the release into RELEASED. Written only by
  -- record_customs_release. Separate from release_approval_by on purpose: the
  -- Chef approves, the step 13 claimant finalises, and a record that cannot
  -- name both cannot prove the separation.
  add column if not exists released_by uuid references public.app_user (id);

-- ---------------------------------------------------------------------------
-- 2. record_customs_release — the release fact, attributed to its finaliser.
-- ---------------------------------------------------------------------------
create or replace function public.record_customs_release(
  p_customs_id    uuid,
  p_bae_reference text,
  p_actor         uuid,
  p_release_date  date default null,
  p_policy_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid; v_file uuid; v_status text; v_existing text;
begin
  if coalesce(btrim(p_bae_reference), '') = '' then
    raise exception 'a BAE reference is required to record a customs release';
  end if;
  -- The finaliser is the fact this function now owns. Unattributed, the
  -- release event would carry no actor at all.
  if p_actor is null then
    raise exception 'an actor is required to record a customs release';
  end if;

  select tenant_id, file_id, status, bae_reference
    into v_tenant, v_file, v_status, v_existing
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;
  if v_status = 'RELEASED' then raise exception 'customs release is already recorded'; end if;
  if v_status in ('CANCELLED') then raise exception 'a % customs record cannot be released', v_status; end if;

  -- The step 7 validation column is deliberately ABSENT from this list. It
  -- belongs to the validation act; the release has its own column.
  update public.customs_record
     set status        = 'RELEASED',
         bae_reference = btrim(p_bae_reference),
         release_date  = coalesce(p_release_date, current_date),
         released_by   = p_actor
   where id = p_customs_id;

  -- The WES-9 customs trigger emits CUSTOMS_RELEASE_COMPLETED (and BAE_RECORDED
  -- on a first reference) in this same transaction, attributed from
  -- released_by. They are NOT re-emitted here: one fact, one event.

  return jsonb_build_object(
    'customs_id', p_customs_id, 'file_id', v_file,
    'bae_reference', btrim(p_bae_reference));
end; $$;

revoke execute on function public.record_customs_release(uuid, text, uuid, date, uuid) from public;
revoke execute on function public.record_customs_release(uuid, text, uuid, date, uuid) from anon;
revoke execute on function public.record_customs_release(uuid, text, uuid, date, uuid) from authenticated;
grant  execute on function public.record_customs_release(uuid, text, uuid, date, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. emit_customs_events — each actor from the column its act writes.
--
-- Same transitions, same event types, same metadata, same exception contract
-- as 20260727000001. Only the actor argument changes.
-- ---------------------------------------------------------------------------
create or replace function public.emit_customs_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release_actor uuid;
  v_bae_actor     uuid;
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_RECORD_CREATED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.created_by,
      jsonb_build_object('required', new.required));
    return null;
  end if;

  if new.status is distinct from old.status then
    -- The finaliser, and only when THIS update released the record: a
    -- released_by already present before the move is not this act's author.
    -- Every other lifecycle move has no recorded author, so it names none.
    v_release_actor := case
      when new.status = 'RELEASED' and old.released_by is null then new.released_by
    end;

    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_STATUS_CHANGED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, v_release_actor,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'DECLARED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_DECLARED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, null::uuid,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.declaration_number));
    elsif new.status = 'RELEASED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_RELEASE_COMPLETED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, v_release_actor,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.bae_reference));
    end if;
  end if;

  -- BAE is its own milestone and does not always coincide with a status move.
  if new.bae_reference is not null and old.bae_reference is null then
    -- The recorder, and only when THIS update stamped the recording. A path
    -- that sets the reference without naming its author (the legacy
    -- record_bae_reference) yields an honest NULL, never a borrowed identity.
    v_bae_actor := case
      when new.bae_recorded_at is distinct from old.bae_recorded_at then new.bae_recorded_by
    end;

    perform public.emit_business_event(
      new.tenant_id, 'BAE_RECORDED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, v_bae_actor,
      jsonb_build_object('reference', new.bae_reference));
  end if;

  return null;
exception
  -- NOT SWALLOWED. Logs the underlying cause for operators, then RE-RAISES
  -- so the domain write rolls back with its event (ADR-WES-014, Model A).
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on customs_record (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Self-assertions. Function bodies are read with their COMMENTS STRIPPED:
--    the comments above name `reviewed_by` on purpose, and a guard that
--    matched prose would prove nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  n         int;
  v_release text;
  v_trigger text;
  v_writers text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name = 'released_by' and is_nullable = 'YES' and column_default is null;
  if n <> 1 then raise exception 'ATTR-CUSTOMS-01: released_by must exist, nullable, with no default'; end if;

  -- Nothing was backfilled: a finaliser nobody recorded is not invented.
  select count(*) into n from public.customs_record where released_by is not null;
  if n <> 0 then raise exception 'ATTR-CUSTOMS-01: released_by must start empty, found % rows', n; end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_release
    from pg_proc p
   where p.oid = to_regprocedure('public.record_customs_release(uuid,text,uuid,date,uuid)');
  if v_release is null then raise exception 'ATTR-CUSTOMS-01: record_customs_release is missing'; end if;
  if v_release ~ 'reviewed_by' then
    raise exception 'ATTR-CUSTOMS-01: record_customs_release still touches reviewed_by';
  end if;
  if v_release !~ 'released_by\s*=\s*p_actor' then
    raise exception 'ATTR-CUSTOMS-01: record_customs_release must attribute the release to p_actor';
  end if;

  select regexp_replace(p.prosrc, '--[^\n]*', '', 'g') into v_trigger
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'emit_customs_events';
  if v_trigger ~ 'reviewed_by' then
    raise exception 'ATTR-CUSTOMS-01: the customs trigger still derives an actor from reviewed_by';
  end if;
  if v_trigger !~ 'new\.released_by' or v_trigger !~ 'new\.bae_recorded_by' then
    raise exception 'ATTR-CUSTOMS-01: the customs trigger must attribute from released_by and bae_recorded_by';
  end if;

  -- THE INVARIANT, across the whole schema: only the validation door, its
  -- recertification and the correction that clears it write customs reviewed_by.
  select string_agg(p.proname, ', ') into v_writers
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public'
     and regexp_replace(p.prosrc, '--[^\n]*', '', 'g')
         ~* 'update\s+public\.customs_record\s+set[^;]*reviewed_by\s*='
     and p.proname not in ('record_customs_validation', 'record_customs_revalidation', 'record_customs_correction');
  if v_writers is not null then
    raise exception 'ATTR-CUSTOMS-01: customs reviewed_by has an unauthorised writer: %', v_writers;
  end if;

  -- The release RPC stays unreachable from a browser session (OPS-SEC-1).
  select count(*) into n from information_schema.role_routine_grants
   where routine_schema = 'public' and routine_name = 'record_customs_release'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'ATTR-CUSTOMS-01: record_customs_release must not be publicly executable'; end if;
end $$;
