-- ===========================================================================
-- MAYA-P0.8-A (PG-1) — the Chef de Transit validation event
-- ---------------------------------------------------------------------------
-- THE GAP THIS CLOSES. `customs:validate` has existed since the customs module
-- shipped. It is held by CHIEF_OF_TRANSIT, OPS_SUPERVISOR and SYSTEM_ADMIN, and
-- is deliberately ABSENT from CUSTOMS_DECLARANT — the role template says so in
-- as many words: "the preparer must never be able to validate". And
-- `customs_record.reviewed_by` has existed just as long.
--
-- But no action ever consumed the permission, and no code path writes
-- `reviewed_by`. The permission model expressed a control the application could
-- not perform. QC4 found this and reported « Exactitude des informations » as
-- not represented; this migration gives it something true to reference.
--
-- (Production nevertheless holds at least one row WITH `reviewed_by` set —
-- discovered when the first draft of the constraint below failed to apply. Its
-- provenance predates any code in this repository. See the constraint note.)
--
-- WHAT IS ADDED: one nullable timestamp, and one RPC. Nothing else. There is no
-- second customs status, no validation table, no new permission.
--
-- WHAT IS DELIBERATELY NOT DECIDED HERE.
--
--   * Validation is NOT a Quality verdict. Recording that the Chef de Transit
--     validated is an operational fact; whether that fact SATISFIES the QC4
--     control « Exactitude des informations » is a business criterion nobody
--     has ratified. QC4 will report the fact and refuse the verdict.
--   * Validation moves NO lifecycle. It does not declare, release, obtain a
--     BAE, or touch `status` / `intel_status`. Nothing in the repository
--     defined such a consequence, so none is invented.
--   * Validation does NOT freeze the record. `updateCustoms` has no review
--     guard today, and quietly introducing immutability here would change a
--     behaviour nobody asked to change. Post-validation edit semantics are
--     recorded as unresolved instead.
-- ===========================================================================

alter table public.customs_record
  -- WHEN the validation happened. `reviewed_by` already records WHO; without an
  -- instant the fact cannot be placed in time, which is exactly what a control
  -- on « respect du délai » would later need.
  add column if not exists reviewed_at timestamptz;

-- AN INSTANT ALWAYS HAS AN AUTHOR — and deliberately NOT the reverse.
--
-- The first draft of this constraint required both columns to move together.
-- Applying it to production failed:
--
--   ERROR: 23514: check constraint "customs_review_complete" of relation
--          "customs_record" is violated by some row
--
-- So `reviewed_by` IS populated on at least one existing row, even though no
-- code in `lib/customs` writes it. The census that produced PG-1 read the CODE
-- and concluded the column was never written; it did not read the DATA. That
-- was the gap, and this is the correction.
--
-- The one-sided form is what can be enforced HONESTLY. What must never exist is
-- a validation INSTANT with no author — that would be an unattributable
-- control. A pre-existing `reviewed_by` with no instant is a different thing:
-- someone's reference, recorded before this platform had a validation event,
-- whose moment nobody knows. Making those rows pass by inventing a timestamp
-- (`updated_at`, `now()`, the dossier date) would fabricate evidence about a
-- control decision — precisely the sin this whole programme exists to avoid.
--
-- Those rows therefore keep their unknown state, and every surface treats
-- `reviewed_at IS NULL` as "not validated", so a legacy `reviewed_by` never
-- reads as a validation that happened. §T of the delivery report carries the
-- read-only query for the operator to inspect them.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customs_review_complete'
  ) then
    alter table public.customs_record
      add constraint customs_review_complete check (
        reviewed_at is null or reviewed_by is not null
      );
  end if;
end $$;

-- ===========================================================================
-- The validation RPC.
--
-- MAKER-CHECKER IS ENFORCED HERE, IN THE DATABASE, not in the UI and not only
-- in the server action. It matters that this is the database's rule: a
-- CHIEF_OF_TRANSIT holds BOTH `customs:update` and `customs:validate`, so the
-- same human can legitimately prepare a record and then be tempted to validate
-- it. A UI-only check would be one crafted request away from being bypassed.
--
-- THE MAKER IS `created_by`, and the scope of that choice is stated plainly:
-- it is the only authorship field on the table and it is reliably written by
-- `createCustoms`. There is NO `updated_by` column, so someone who EDITED a
-- record they did not create is not currently distinguishable from any other
-- checker. That residual gap is reported rather than papered over; it is not
-- invented authorship, and it is not silently ignored.
--
-- ONE-TIME BY CONSTRUCTION. Re-validation is refused rather than allowed to
-- overwrite the first validator's evidence. Whether a changed record should
-- invalidate its validation is a lifecycle question nobody has settled, so the
-- minimum safe behaviour ships and revalidation is recorded as a separate gap.
-- The row is locked FOR UPDATE, so two simultaneous validators cannot both win:
-- the second finds `reviewed_at` already set and is refused. Concurrency is not
-- delegated to a disabled button.
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
  v_at      timestamptz;
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, created_by, reviewed_at
    into v_tenant, v_file, v_creator, v_at
    from public.customs_record
   where id = p_customs_id and deleted_at is null
     for update;
  if not found then raise exception 'customs record not found'; end if;

  -- OPS-SEC-2A trust contract. p_actor is CALLER-DECLARED, so the database
  -- verifies it against app_user + get_user_permissions and requires the very
  -- permission the checker role exists to carry. Without this the function
  -- would assert an authority it never established (INV-7).
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:validate', 'SERVICE');

  -- The separation the role templates promise, made real.
  if v_creator is not null and v_creator = p_actor then
    raise exception 'the preparer of a customs record may not validate it';
  end if;

  -- The guard is on the INSTANT, not on reviewed_by. A legacy row carrying a
  -- bare `reviewed_by` was never validated in this platform's sense — nobody
  -- knows when or by what authority — so it remains validatable, and doing so
  -- replaces an unattributed reference with an attributed, timestamped one that
  -- the ledger and the audit log both record.
  if v_at is not null then
    raise exception 'this customs record is already validated';
  end if;

  -- The validation, and NOTHING else: status and intel_status are untouched.
  update public.customs_record
     set reviewed_by = p_actor,
         reviewed_at = now()
   where id = p_customs_id;

  -- ONE OWNER FOR THE FACT. The WES-9 customs trigger watches status and the
  -- BAE reference and knows nothing about the review columns, so this RPC is
  -- the only emitter and no double emission is possible.
  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_VALIDATED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object('maker_checked', v_creator is not null)
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file);
end; $$;

-- OPS-SEC-1: a definer function is never browser-executable.
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
     and column_name = 'reviewed_at' and is_nullable = 'YES';
  if n <> 1 then raise exception 'P0.8-A: reviewed_at must exist and be nullable'; end if;

  -- No second validation store, and no second status column, was created.
  select count(*) into n from information_schema.tables
   where table_schema = 'public' and table_name ilike '%customs_validation%';
  if n <> 0 then raise exception 'P0.8-A: no separate validation table may exist'; end if;

  -- The lifecycle vocabulary was not widened to carry a review state.
  select count(*) into n from pg_constraint
   where conrelid = 'public.customs_record'::regclass
     and pg_get_constraintdef(oid) ilike '%NOT_STARTED%'
     and pg_get_constraintdef(oid) ilike '%VALIDAT%';
  if n <> 0 then raise exception 'P0.8-A: validation must not enter the status ladder'; end if;

  -- The trust contract is present in the function body.
  if (select p.prosrc from pg_proc p
       where p.oid = to_regprocedure('public.record_customs_validation(uuid,uuid)'))
     !~ 'assert_actor_authority' then
    raise exception 'P0.8-A: the validation RPC must assert actor authority';
  end if;
end $$;
