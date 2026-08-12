-- ===========================================================================
-- MAYA-P0.7-A — Recevabilité (Quality Control N°3, Déclarant en Douane)
-- ---------------------------------------------------------------------------
-- FIRST-PARTY EVIDENCE. The Effitrans « Manuel de Contrôle Qualité — Processus
-- Transit & Logistique » lists, under QC N°3 (Déclarant en Douane), the control
-- « Recevabilité » ahead of « Respect du délai de déclaration ». That settles
-- what MAYA-0 Q2 could not: WHO owns recevabilité and WHERE it sits. MAYA
-- itself only ever showed that a « Date de recevabilité » existed beside the
-- acceptance (Q125 §6) — existence, never semantics.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES **NOT** DO
--
--   * It does not define the checklist. The manual names the control, not the
--     criteria that make a file RECEVABLE. Inventing them would freeze an
--     undocumented rule into the schema, so no criterion is stored, referenced
--     or enforced anywhere. The outcome is recorded; how it was reached is the
--     declarant's professional judgement until Effitrans supplies the list.
--   * It does not gate anything. No customs status, no process step, no
--     document requirement and no closure rule reads these columns. A dossier
--     whose recevabilité is NON_RECEVABLE behaves today exactly as it did
--     yesterday. Wiring a gate is a separate, ratified decision — and one that
--     needs the criteria first.
--   * It does not touch the customs status ladder. Recevabilité is a judgement
--     ABOUT the file, not a position IN the declaration lifecycle, so it is not
--     a new `status` or `intel_status` value. This is the same separation
--     `record_bae_reference` already draws.
--
-- Additive, nullable, forward-only. Existing rows read NULL = "not yet
-- assessed", which is distinct from every recorded outcome.
-- ===========================================================================

alter table public.customs_record
  -- The recorded outcome. Three values, and they come from the Effitrans
  -- manual's own vocabulary — nothing here is a translation of a MAYA column.
  --   RECEVABLE     — the declarant accepts the file for declaration
  --   NON_RECEVABLE — refused; a reason is mandatory (enforced in the RPC)
  --   SOUS_RESERVE  — accepted with reservations; a reason is mandatory
  add column if not exists receivability_status text
    check (receivability_status is null
           or receivability_status in ('RECEVABLE', 'NON_RECEVABLE', 'SOUS_RESERVE')),
  -- « Date de recevabilité ». Set by the RPC on the decision, never by hand.
  add column if not exists receivability_at timestamptz,
  -- WHO decided. Attribution is permanent: this is never cleared, and a
  -- departed user keeps their decision (the app_user row is archived, not
  -- deleted, so the reference stays valid).
  add column if not exists receivability_by uuid references public.app_user (id),
  -- The declarant's stated reason. Mandatory for the two non-clean outcomes,
  -- because a refusal nobody can explain is a refusal nobody can act on.
  add column if not exists receivability_note text;

-- Every recorded outcome carries its date and its author. A row can be wholly
-- unassessed (all null) or wholly assessed — never half of either, which is
-- what makes "not yet assessed" a safe reading of NULL rather than an
-- ambiguous one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customs_receivability_complete'
  ) then
    alter table public.customs_record
      add constraint customs_receivability_complete check (
        (receivability_status is null and receivability_at is null and receivability_by is null)
        or (receivability_status is not null and receivability_at is not null and receivability_by is not null)
      );
  end if;
end $$;

-- A reason is REQUIRED for NON_RECEVABLE and SOUS_RESERVE. Enforced in the
-- database as well as the RPC, so no future caller can route around it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customs_receivability_reason_required'
  ) then
    alter table public.customs_record
      add constraint customs_receivability_reason_required check (
        receivability_status is null
        or receivability_status = 'RECEVABLE'
        or coalesce(btrim(receivability_note), '') <> ''
      );
  end if;
end $$;

-- ===========================================================================
-- The decision RPC.
--
-- ONE OWNER FOR THE FACT. The WES-9 customs trigger watches the status/BAE
-- columns and knows nothing about these four, so it cannot emit this event —
-- and this RPC is therefore the only emitter. That avoids, by construction,
-- the double-emission the document phase had to fix afterwards.
--
-- The write and the event share one transaction: if the ledger insert fails,
-- the decision does not land. A recorded decision that left no trace is what
-- EMP-5H.1 spent a phase repairing.
--
-- IDEMPOTENCE IS NOT ASSUMED. Re-deciding is legitimate — a file refused on
-- Monday can be receivable on Tuesday once the missing document arrives — so
-- this overwrites the current outcome and appends a NEW event. The ledger, not
-- the column, is the history. An identical repeat is refused below so the
-- timeline does not fill with the same decision twice (EMP-5H.1's lesson).
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
-- ===========================================================================
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name in ('receivability_status','receivability_at','receivability_by','receivability_note');
  if n <> 4 then raise exception 'P0.7-A: expected 4 receivability columns, found %', n; end if;

  -- All four nullable: no existing dossier is invalidated by this migration.
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name like 'receivability%' and is_nullable = 'NO';
  if n <> 0 then raise exception 'P0.7-A: receivability columns must all be nullable'; end if;

  -- The status ladder was NOT widened — recevabilité is not a lifecycle state.
  select count(*) into n from pg_constraint
   where conrelid = 'public.customs_record'::regclass
     and pg_get_constraintdef(oid) ilike '%RECEVABLE%'
     and pg_get_constraintdef(oid) ilike '%NOT_STARTED%';
  if n <> 0 then raise exception 'P0.7-A: receivability must not enter the status ladder'; end if;

  -- No criterion/checklist structure was created. The manual names the control,
  -- not the criteria, and nothing here may imply otherwise.
  select count(*) into n from information_schema.tables
   where table_schema = 'public'
     and (table_name like '%receivability%criteri%' or table_name like '%recevabilite%');
  if n <> 0 then raise exception 'P0.7-A: no receivability criteria structure may exist yet'; end if;
end $$;
