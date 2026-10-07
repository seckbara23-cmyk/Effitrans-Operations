-- migrate:executor db-query
-- ===========================================================================
-- UAT-RECEVABILITE-01 — PRODUCTION PARITY for record_customs_receivability
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG, AND IT WAS NOT IN THIS REPOSITORY. Production's live
-- `record_customs_receivability` passed `p_source => 'rpc'` to
-- `emit_business_event`. `business_event_source_check` has never admitted
-- 'rpc' — it shipped in 20260726000004 as
-- check (source in ('db_trigger','policy_rpc','app_action')), a month BEFORE
-- the receivability RPC existed, and 20260811000001 widened it only to seven
-- named lanes, none of them a bare 'rpc'.
--
-- So every call raised 23514 inside the definer function, which aborted its
-- implicit transaction and rolled back the decision it had just written. The
-- action layer collapses that into `record_failed` and the Déclarant read
-- « Enregistrement impossible. » Recevabilité has NEVER been recorded
-- successfully in production, on any dossier: `business_event` holds zero
-- CUSTOMS_RECEIVABILITY_DECIDED rows.
--
-- WHY NO TEST CAUGHT IT. 20260824000001 — the migration that owns this
-- function — says 'policy_rpc', and `git show` proves it said 'policy_rpc' in
-- both of the only two commits that ever touched it. 'rpc' has never existed
-- in this repository. CI's `db reset` therefore builds a CORRECT function from
-- a CORRECT file, and the existing suite — including
-- supabase/tests/maya_p07a_receivability_test.sql, which already asserts the
-- event is appended — exercises a function production does not have. The bug
-- was visible only in the live body, via pg_get_functiondef.
--
-- A SECOND DIVERGENCE, FOUND THE SAME WAY, AND THE REASON THIS RE-APPLIES THE
-- WHOLE FUNCTION RATHER THAN EDITING ONE STRING. Production's body is missing
-- `assert_actor_authority(p_actor, v_tenant, 'customs:update', 'SERVICE')`
-- entirely — the OPS-SEC-2A trust contract added by commit 4efa8c0, « the RPC
-- must verify the actor it was handed, not believe it ». Production's function
-- is therefore not an edited copy of either commit: it matches no committed
-- version, and has been trusting its caller's word about who was acting.
-- Restoring the repository definition closes both gaps in one statement, and
-- that is the point of parity over patching.
--
-- PROVEN SAFE TO RESTORE, READ-ONLY, BEFORE WRITING THIS FILE:
--   * assert_actor_authority(uuid,uuid,text,text) EXISTS in production, with
--     exactly the signature this body calls.
--   * record_declaration_reference — a function that WORKS in production —
--     already calls the identical assertion, same permission, same lane:
--     assert_actor_authority(p_actor, v_tenant, 'customs:update', 'SERVICE').
--     It succeeded for this very Déclarant on 2026-10-05 14:36:39, so the
--     assertion this restores is empirically known to pass for that actor
--     through that lane.
--   * The Déclarant holds `customs:update` under the tenant-scoped
--     get_user_permissions.
--   * Live privileges are already at parity — prosecdef, owner postgres, acl
--     exactly {postgres, service_role}. The revoke/grant block below is
--     idempotent and re-states that; it widens nothing.
--
-- WHAT THIS MIGRATION DOES NOT DO
--   * It does not widen business_event_source_check. The constraint is RIGHT
--     and the function was WRONG; admitting 'rpc' would legitimise an
--     unclassified provenance in an immutable ledger.
--   * It does not edit 20260824000001. That migration is applied and
--     immutable; editing it would "fix" a CI run that is already green and
--     would never reach production.
--   * It touches NO data. No dossier, no customs_record, no receivability
--     decision, no workflow state. EFT-IMP-2026-00014 is not referenced.
--   * It invents no implementation. The body below is the repository's own,
--     reproduced from 20260824000001 without a character changed, so parity is
--     something you can diff rather than something you have to trust.
-- ===========================================================================

create or replace function public.record_customs_receivability(
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
  v_prev   text;
  v_prev_note text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_status is null or p_status not in ('RECEVABLE', 'NON_RECEVABLE', 'SOUS_RESERVE') then
    raise exception 'invalid receivability outcome';
  end if;
  if p_status <> 'RECEVABLE' and v_note is null then
    raise exception 'a reason is required for %', p_status;
  end if;
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  select tenant_id, file_id, receivability_status, receivability_note
    into v_tenant, v_file, v_prev, v_prev_note
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  -- OPS-SEC-2A trust contract. p_actor is CALLER-DECLARED, so the database
  -- verifies it rather than believing it: the nomination is checked against
  -- app_user and get_user_permissions, and must hold the same permission the
  -- server action gated on. A definer function that trusted its caller's word
  -- about who is acting would assert authority it never established.
  --
  -- 'SERVICE' is hard-coded rather than accepted, which is safe BECAUSE the
  -- primitive validates the declaration: reached from an authenticated session
  -- instead of the service role, the lane check refuses it.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:update', 'SERVICE');

  -- Same outcome AND same reason as the standing decision: nothing changed, so
  -- nothing is recorded. Refused rather than silently ignored, so the caller
  -- can tell the operator their decision was already on file.
  if v_prev is not distinct from p_status
     and coalesce(v_prev_note, '') = coalesce(v_note, '') then
    raise exception 'identical receivability decision already recorded';
  end if;

  update public.customs_record
     set receivability_status = p_status,
         receivability_at     = now(),
         receivability_by     = p_actor,
         receivability_note   = v_note
   where id = p_customs_id;

  -- The reason TEXT stays out of the immutable ledger — the same rule WES-9A
  -- applied to assignment reasons. The event states that a decision was taken
  -- and what it was; the reason lives on the record, where it can be corrected.
  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_RECEIVABILITY_DECIDED',
    p_event_domain  => 'customs',
    -- The ledger's own vocabulary: source must be one of db_trigger /
    -- policy_rpc / app_action. A decision RPC is policy_rpc.
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    p_metadata      => jsonb_build_object(
      'to_status',   p_status,
      'from_status', v_prev,
      'has_reason',  v_note is not null
    )
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file, 'status', p_status);
end; $$;

-- OPS-SEC-1: definer functions are never anon-executable. The action layer runs
-- on the service role behind assertPermission('customs:update').
revoke execute on function public.record_customs_receivability(uuid, text, text, uuid) from public;
revoke execute on function public.record_customs_receivability(uuid, text, text, uuid) from anon;
revoke execute on function public.record_customs_receivability(uuid, text, text, uuid) from authenticated;
grant  execute on function public.record_customs_receivability(uuid, text, text, uuid) to service_role;

-- ===========================================================================
-- Self-assertions. A migration that cannot prove what it did is a migration
-- nobody can trust.
--
-- Every `like` below runs on the body with `--` comments STRIPPED. This file's
-- own prose says 'rpc' repeatedly, pg_get_functiondef returns body comments,
-- and the authoritative body carries a comment naming the legal lanes — so an
-- unstripped match would pass on prose and fail on nothing.
--
-- The quoting is load-bearing too: 'policy_rpc' CONTAINS the substring rpc, so
-- the negative assertion is anchored on the quoted literal ''rpc'' via a
-- regex, never on a bare `like '%rpc%'` that would fire on the correct value.
-- ===========================================================================
do $$
declare
  v_def  text;
  v_code text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'record_customs_receivability'
     -- regprocedure, NOT pg_get_function_identity_arguments: the identity form
     -- includes PARAMETER NAMES on this server, so a types-only comparison
     -- against it matches nothing and this block would abort a correct apply.
     and p.oid::regprocedure::text = 'record_customs_receivability(uuid,text,text,uuid)';
  if v_def is null then
    raise exception 'UAT-RECEVABILITE-01: record_customs_receivability(uuid,text,text,uuid) is absent after replacement';
  end if;

  v_code := regexp_replace(v_def, '--[^\n]*', '', 'g');

  if v_code !~ 'p_source\s*=>\s*''policy_rpc''' then
    raise exception 'UAT-RECEVABILITE-01: the restored body does not emit source policy_rpc';
  end if;
  if v_code ~ 'p_source\s*=>\s*''rpc''' then
    raise exception 'UAT-RECEVABILITE-01: the restored body still emits the illegal source rpc';
  end if;
  if v_code !~ 'assert_actor_authority\s*\(\s*p_actor\s*,\s*v_tenant\s*,\s*''customs:update''\s*,\s*''SERVICE''\s*\)' then
    raise exception 'UAT-RECEVABILITE-01: the restored body does not assert actor authority';
  end if;

  -- The source it now emits must be one the ledger actually admits. Read from
  -- the live constraint rather than restated here, so this cannot drift from
  -- the thing it is checking against.
  if not exists (
    select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname = 'business_event'
       and con.conname = 'business_event_source_check'
       and pg_get_constraintdef(con.oid) like '%''policy_rpc''%'
  ) then
    raise exception 'UAT-RECEVABILITE-01: business_event_source_check does not admit policy_rpc — refusing';
  end if;

  -- And it must still refuse the bare lane. If a well-meaning hand had widened
  -- the constraint instead of fixing the function, this migration would be
  -- papering over that; it refuses to.
  if exists (
    select 1 from pg_constraint con
      join pg_class c on c.oid = con.conrelid
     where c.relname = 'business_event'
       and con.conname = 'business_event_source_check'
       and pg_get_constraintdef(con.oid) ~ '[^_]''rpc'''
  ) then
    raise exception 'UAT-RECEVABILITE-01: business_event_source_check has been widened to admit rpc — refusing';
  end if;

  -- Privileges: definer, and executable by the service role only. Each role is
  -- probed only where it exists — a bare Postgres has no `anon`, and a
  -- migration that crashed on a missing role would fail for a reason that has
  -- nothing to do with what it is asserting.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_customs_receivability'
       and p.prosecdef
       and (to_regrole('service_role') is null
            or has_function_privilege('service_role', p.oid, 'EXECUTE'))
       and (to_regrole('anon') is null
            or not has_function_privilege('anon', p.oid, 'EXECUTE'))
       and (to_regrole('authenticated') is null
            or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'UAT-RECEVABILITE-01: privilege shape is wrong after replacement';
  end if;

  raise notice 'UAT-RECEVABILITE-01 applied: record_customs_receivability restored to repository parity (policy_rpc, actor authority asserted); no data touched.';
end $$;
