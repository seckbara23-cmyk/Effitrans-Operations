-- TRANSIT-CUSTODY-05 — the Chef de Transit's final release to Transport.
-- ===========================================================================
-- THE RATIFIED BUSINESS FACT. Recording the BAE and authorizing release from
-- Transit into physical Transportation are two acts, not one. An authorized
-- field actor performs the customs field work and records the mainlevée; the
-- Chef de Transit then verifies independently, and only that verification puts
-- the dossier into RELEASED — which is what `canPickup` has always required
-- before goods may physically move.
--
-- WHAT WAS TRUE BEFORE. `recordBae` called `releaseCustoms`, so whoever wrote
-- the reference down produced RELEASED in the same breath. The two halves
-- already existed separately in the customs module (WES-4E: record_bae_reference
-- records, record_customs_release releases) — the Transit surface simply used
-- the releasing one. There was no place to say « recorded, awaiting
-- verification », and therefore no verification.
--
-- WHY THESE COLUMNS AND NOT A NEW STATUS. `customs_record.status` is a
-- lifecycle ladder read by the pickup gate, the reconciliation fact rules, the
-- projections and the performance modules. Adding PENDING_RELEASE to it would
-- oblige every one of those to learn a state that is not a lifecycle stage but
-- a verification verdict. The platform already ratified the right shape for
-- exactly this once — MAYA-P0.7-A's recevabilité quad (migration
-- 20260824000001) — and this follows it: additive nullable columns beside the
-- fact they qualify, decided by a definer RPC, with the status ladder untouched.
--
-- WHY NOT A NEW PERMISSION. `customs:validate` already names precisely the
-- ratified approvers and is held by neither the Déclarant nor the field agent.
-- The narrower question — that the CHEF and not merely any holder approves — is
-- a role scope in the application layer, where the platform already expresses
-- that kind of rule.
--
-- Additive, tenant-safe, re-run safe. No table is created, no policy is
-- touched, no RLS rule changes, and every existing RELEASED dossier stays valid
-- with all six columns null: nothing is backfilled, because inventing a
-- verification that never happened would be the one thing worse than not having
-- had one.
-- ===========================================================================

alter table public.customs_record
  -- WHO did the field work and wrote the reference down. Separate from
  -- release_approval_by on purpose: the whole control is that these are two
  -- people, and a record that cannot name both cannot prove it.
  add column if not exists bae_recorded_by uuid references public.app_user (id),
  -- WHEN. Set by the RPC on recording, never by hand.
  add column if not exists bae_recorded_at timestamptz,
  -- The Chef's verdict on releasing to Transport.
  --   NULL     — no BAE recorded yet; nothing to verify
  --   PENDING  — BAE recorded, awaiting the Chef de Transit
  --   APPROVED — verified; the release may proceed
  --   REJECTED — refused with a mandatory reason; the field work is redone
  add column if not exists release_approval_status text
    check (release_approval_status is null
           or release_approval_status in ('PENDING', 'APPROVED', 'REJECTED')),
  -- WHICH Chef decided. Attribution is permanent and never cleared; a departed
  -- user keeps their decision, since app_user rows are archived, not deleted.
  add column if not exists release_approval_by uuid references public.app_user (id),
  add column if not exists release_approval_at timestamptz,
  -- The Chef's stated reason. Mandatory on REJECTED — a refusal nobody can
  -- explain is a refusal nobody can act on — and optional on APPROVED.
  add column if not exists release_approval_note text;

-- ---------------------------------------------------------------------------
-- Consistency. Each constraint states one thing that must always be true, so a
-- violation names itself instead of arriving as a puzzle.
-- ---------------------------------------------------------------------------
do $$
begin
  -- A recorded BAE carries its author and its date, or none of the three. Half
  -- a record is what makes NULL ambiguous.
  if not exists (select 1 from pg_constraint where conname = 'customs_bae_recording_complete') then
    alter table public.customs_record
      add constraint customs_bae_recording_complete check (
        (bae_recorded_by is null and bae_recorded_at is null)
        or (bae_recorded_by is not null and bae_recorded_at is not null)
      );
  end if;

  -- A decision carries its decider and its moment; PENDING carries neither,
  -- because nobody has decided yet.
  if not exists (select 1 from pg_constraint where conname = 'customs_release_decision_complete') then
    alter table public.customs_record
      add constraint customs_release_decision_complete check (
        release_approval_status is null
        or release_approval_status = 'PENDING'
        or (release_approval_by is not null and release_approval_at is not null)
      );
  end if;

  -- A refusal always says why.
  if not exists (select 1 from pg_constraint where conname = 'customs_release_rejection_reasoned') then
    alter table public.customs_record
      add constraint customs_release_rejection_reasoned check (
        release_approval_status is distinct from 'REJECTED'
        or nullif(btrim(coalesce(release_approval_note, '')), '') is not null
      );
  end if;
end $$;

-- ===========================================================================
-- record_customs_bae — the FIELD act. Records the reference, names its author,
-- and opens the verification. Never releases.
--
-- Supersedes the Transit surface's use of the releasing path. A re-recording
-- after a refusal keeps the previous reference in the ledger event, so the
-- correction is auditable and the earlier evidence is never silently lost.
-- ===========================================================================
create or replace function public.record_customs_bae(
  p_customs_id    uuid,
  p_bae_reference text,
  p_actor         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_file   uuid;
  v_status text;
  v_prev_ref text;
  v_prev_decision text;
  v_ref    text := nullif(btrim(coalesce(p_bae_reference, '')), '');
begin
  if v_ref is null then
    raise exception 'reason_required: a BAE reference is required';
  end if;
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, status, bae_reference, release_approval_status
    into v_tenant, v_file, v_status, v_prev_ref, v_prev_decision
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  -- A released dossier is finished. Re-recording its BAE would reopen a
  -- verification for goods that have already left.
  if v_status = 'RELEASED' then
    raise exception 'invalid_transition: this dossier is already released';
  end if;

  -- OPS-SEC-2A trust contract (INV-7). p_actor is CALLER-DECLARED, so the
  -- database verifies the nomination against app_user and get_user_permissions
  -- rather than believing it, and requires the same permission the server
  -- action gated on.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:release', 'SERVICE');

  -- Recording NEVER changes the customs status. That separation is the control.
  update public.customs_record
     set bae_reference           = v_ref,
         bae_recorded_by         = p_actor,
         bae_recorded_at         = now(),
         -- A correction after a refusal returns the dossier to the Chef.
         release_approval_status = 'PENDING',
         release_approval_by     = null,
         release_approval_at     = null,
         release_approval_note   = null
   where id = p_customs_id;

  -- The ledger keeps the REPLACEMENT visible: which reference gave way to which,
  -- and whether this followed a refusal. The reason text stays on the record
  -- (WES-9A), the event states that the act happened.
  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object(
      'previous_reference', v_prev_ref,
      'replaced',           v_prev_ref is not null and v_prev_ref is distinct from v_ref,
      'after_rejection',    v_prev_decision = 'REJECTED'
    )
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file, 'status', 'PENDING');
end; $$;

revoke execute on function public.record_customs_bae(uuid, text, uuid) from public;
revoke execute on function public.record_customs_bae(uuid, text, uuid) from anon;
revoke execute on function public.record_customs_bae(uuid, text, uuid) from authenticated;
grant  execute on function public.record_customs_bae(uuid, text, uuid) to service_role;

-- ===========================================================================
-- record_customs_release_approval — the CHEF's independent verification.
--
-- It decides; it does not release. The release itself stays where it has always
-- been, behind `record_customs_release` and its ratified control gate, which
-- this migration neither weakens nor bypasses — it only adds a precondition
-- that gate had no way to express.
-- ===========================================================================
create or replace function public.record_customs_release_approval(
  p_customs_id uuid,
  p_status     text,
  p_note       text,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_file   uuid;
  v_ref    text;
  v_recorder uuid;
  v_prev   text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status is null or p_status not in ('APPROVED', 'REJECTED') then
    raise exception 'invalid_transition: invalid release decision';
  end if;
  if p_status = 'REJECTED' and v_note is null then
    raise exception 'reason_required: a reason is required to refuse the release';
  end if;
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, bae_reference, bae_recorded_by, release_approval_status
    into v_tenant, v_file, v_ref, v_recorder, v_prev
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  -- Verification rests on evidence. There is nothing to verify without a BAE.
  if v_ref is null then raise exception 'bae_required: no BAE has been recorded'; end if;
  if v_prev is null then raise exception 'invalid_transition: no verification is pending'; end if;

  -- MAKER / CHECKER. The person whose field work is being verified may not be
  -- the person verifying it — the separation is the entire purpose of the
  -- control, and a permission cannot substitute for a second pair of eyes.
  if v_recorder is not null and v_recorder = p_actor then
    raise exception 'self_approval_forbidden: the actor who recorded the BAE may not approve it';
  end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:validate', 'SERVICE');

  -- Idempotent: the same verdict twice records nothing and says so.
  if v_prev = p_status then
    raise exception 'already_decided: this release decision is already recorded';
  end if;

  update public.customs_record
     set release_approval_status = p_status,
         release_approval_by     = p_actor,
         release_approval_at     = now(),
         release_approval_note   = v_note
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => case when p_status = 'APPROVED'
                            then 'CUSTOMS_RELEASE_APPROVED'
                            else 'CUSTOMS_RELEASE_REJECTED' end,
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object(
      'from_status', v_prev,
      'to_status',   p_status,
      'has_reason',  v_note is not null,
      'recorded_by', v_recorder
    )
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file, 'status', p_status);
end; $$;

revoke execute on function public.record_customs_release_approval(uuid, text, text, uuid) from public;
revoke execute on function public.record_customs_release_approval(uuid, text, text, uuid) from anon;
revoke execute on function public.record_customs_release_approval(uuid, text, text, uuid) from authenticated;
grant  execute on function public.record_customs_release_approval(uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- Self-assertions. A migration that cannot prove what it did is a migration
-- nobody can trust.
-- ===========================================================================
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name in ('bae_recorded_by','bae_recorded_at','release_approval_status',
                         'release_approval_by','release_approval_at','release_approval_note');
  if n <> 6 then raise exception 'TC-05: expected 6 approval columns, found %', n; end if;

  -- All six nullable: no existing dossier is invalidated, and every already
  -- RELEASED dossier stays valid untouched.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name in ('bae_recorded_by','bae_recorded_at','release_approval_status',
                         'release_approval_by','release_approval_at','release_approval_note')
     and is_nullable = 'NO';
  if n <> 0 then raise exception 'TC-05: approval columns must all be nullable'; end if;

  -- The status ladder was NOT widened. A verification verdict is not a
  -- lifecycle stage, and every reader of `status` keeps working unchanged.
  select count(*) into n from pg_constraint
   where conrelid = 'public.customs_record'::regclass
     and pg_get_constraintdef(oid) ilike '%PENDING_RELEASE%';
  if n <> 0 then raise exception 'TC-05: no new customs status may exist'; end if;

  -- The three consistency constraints exist.
  select count(*) into n from pg_constraint
   where conname in ('customs_bae_recording_complete',
                     'customs_release_decision_complete',
                     'customs_release_rejection_reasoned');
  if n <> 3 then raise exception 'TC-05: expected 3 consistency constraints, found %', n; end if;

  -- Neither definer function is reachable by an unauthenticated or ordinary
  -- session (OPS-SEC-1).
  select count(*) into n from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in ('record_customs_bae', 'record_customs_release_approval')
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if n <> 0 then raise exception 'TC-05: approval RPCs must not be publicly executable'; end if;
end $$;
