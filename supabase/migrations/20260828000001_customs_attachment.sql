-- ===========================================================================
-- MAYA-P1.11 — Rattachement: the Declarant attaches the documents (CEO step 9)
-- ---------------------------------------------------------------------------
-- THE BLOCKER IS GONE, AND SO IS THE MAPPING CONFLICT. P1.3 stopped at
-- classification E because no source said what « rattachement » attaches, and
-- because two first-party artifacts disagreed about which step it even is: the
-- phase-9 architecture doc mapped CEO step 9 to an engine step
-- `electronic_attachment` that was never built.
--
-- Effitrans has now answered, and the answer resolves both at once:
--
--   « Il scanne les documents et fait lui-même le rattachement »  — the actor
--   « Facture, BL, toutes autorisations nécessaires »             — the objects
--   « Dans GAINDE et dans ORBUS »                                 — the systems
--   « Non » (synchronisation automatique)                         — manual only
--
-- That is registry step 11 `gainde_document_submission`, which already exists
-- and already says so: role CUSTOMS_DECLARANT, label « Déclarant — introduire
-- les documents dans GAINDE », internalLabel « jalon MANUEL », prerequisite
-- `gainde_registration` (CEO step 8, Finance), next `customs_followup` (→ BAE).
-- Owner, order, manual nature and position all match the ratified answers.
-- There was never a missing step — only a missing fact.
--
-- WHAT IS ADDED, AND WHY NOTHING EXISTING WOULD DO. The registry's own
-- requiredEvidence for this step is `submission_date`, `submitted_by`,
-- `submitted_document_list`. Nothing on customs_record can carry it:
--
--   declaration_number / external_ref  the Declarant's paperwork and the GAINDE
--                                      reference — neither is an attachment
--   gainde_registered_at/_by           FINANCE's act (CEO step 8, MAYA-P1.1)
--   submitted_at                       the Customs INTELLIGENCE provider clock
--                                      (7.1B) — inviting, and unrelated
--   bae_reference / release_date       CEO step 10, downstream
--
-- Reusing any of them would be exactly the proxy MAYA-P1.2 removed: a step
-- completed by a fact that does not prove its business act.
--
-- WHAT IS DELIBERATELY NOT DECIDED.
--
--   * NO STATUS MOVES. `status`, `intel_status`, `provider_code` and
--     `provider_synced_at` are untouched. BLK-1 stands: there is no GAINDE or
--     ORBUS API, Effitrans confirmed « Non », and nothing here may imply one.
--   * NO SECOND SIGNATURE. Effitrans described the Declarant doing this himself.
--     No maker-checker is invented.
--   * NO SCREENSHOT REQUIREMENT. « Peut-être faire une capture d'écran » is not
--     a rule. The evidence slot already exists as the GAINDE_SUBMISSION_EVIDENCE
--     document type, which step 11 already lists as its requiredDocument, so
--     evidence is attachable through the ordinary document path and is NEVER a
--     precondition of recording the act.
-- ===========================================================================

alter table public.customs_record
  -- WHEN the Declarant completed the attachment (`submission_date`).
  add column if not exists attachment_completed_at timestamptz,
  -- WHO completed it (`submitted_by`). Attribution is permanent.
  add column if not exists attachment_completed_by uuid references public.app_user (id),
  -- WHERE it was done. Effitrans named GAINDE and ORBUS; the platform models
  -- neither as an entity (both are unimplemented provider concepts), so this is
  -- the recorded CONTEXT of a manual act, not a system integration.
  add column if not exists attachment_systems text[];

-- Both instants move together. Safe to state symmetrically: these columns are
-- NEW, so no existing row can violate them — unlike P0.8-A's constraint, which
-- met production rows and had to be made one-sided.
--
-- RE-RUN SAFE throughout: `add column if not exists`, guarded `add constraint`,
-- `create or replace function`, revoke/grant.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customs_attachment_complete') then
    alter table public.customs_record
      add constraint customs_attachment_complete check (
        (attachment_completed_at is null and attachment_completed_by is null)
        or (attachment_completed_at is not null and attachment_completed_by is not null)
      );
  end if;
  -- A recorded attachment names at least one system, and only the two Effitrans
  -- named. An empty array would be an act performed nowhere.
  if not exists (select 1 from pg_constraint where conname = 'customs_attachment_systems_known') then
    alter table public.customs_record
      add constraint customs_attachment_systems_known check (
        attachment_systems is null
        or (array_length(attachment_systems, 1) >= 1
            and attachment_systems <@ array['GAINDE', 'ORBUS']::text[])
      );
  end if;
end $$;

-- ===========================================================================
-- The attachment RPC.
--
-- RE-RECORDING IS THE RATIFIED RETRY PATH, so it is allowed without ceremony.
-- Effitrans defined failure precisely: « En cas d'échec, la déclaration sera
-- bloquée au niveau de la section des douanes chargée de la recevabilité, le
-- déclarant rattache de nouveau. » Refusing an identical repeat — as
-- `record_gainde_registration` does for a duplicate reference — would block the
-- exact retry the business describes, because a second attempt is normally the
-- SAME documents in the SAME systems. Each recording is a fresh attempt; the
-- ledger keeps every one, so history is preserved rather than overwritten.
--
-- AUTHORITY: `customs:update`. It is the permission registry step 11 already
-- declares, and CUSTOMS_DECLARANT — the actor Effitrans named — already holds
-- it. No permission is created and no role is widened; every holder of
-- customs:update could already edit this record.
-- ===========================================================================
create or replace function public.record_customs_attachment(
  p_customs_id uuid,
  p_systems    text[],
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
  v_prev    timestamptz;
  v_systems text[];
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;

  -- Normalise before validating: trim, upper, drop blanks, de-duplicate.
  select array_agg(distinct s order by s) into v_systems
    from unnest(coalesce(p_systems, array[]::text[])) as s0(s0)
    cross join lateral (select upper(btrim(s0))) as t(s)
   where nullif(btrim(s0), '') is not null;

  if v_systems is null or array_length(v_systems, 1) is null then
    raise exception 'at least one customs system is required';
  end if;
  if not (v_systems <@ array['GAINDE', 'ORBUS']::text[]) then
    raise exception 'unknown customs system';
  end if;

  select tenant_id, file_id, attachment_completed_at
    into v_tenant, v_file, v_prev
    from public.customs_record
   where id = p_customs_id and deleted_at is null
   for update;
  if not found then raise exception 'customs record not found'; end if;

  -- OPS-SEC-2A trust contract (INV-7). p_actor is caller-declared, so the
  -- database verifies it against app_user + get_user_permissions.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:update', 'SERVICE');

  -- The attachment, and NOTHING else. No status, no intel_status, no
  -- provider_code, no provider_synced_at: nothing here synchronised with GAINDE
  -- or ORBUS, and the record must not imply that it did.
  update public.customs_record
     set attachment_completed_at = now(),
         attachment_completed_by = p_actor,
         attachment_systems      = v_systems
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'CUSTOMS_ATTACHMENT_RECORDED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    -- The systems travel; `repeated` distinguishes a first attachment from the
    -- retry Effitrans described, so the ledger shows the sequence of attempts.
    p_metadata      => jsonb_build_object(
                         'systems', to_jsonb(v_systems),
                         'repeated', v_prev is not null)
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file);
end; $$;

-- OPS-SEC-1: a definer function is never browser-executable.
revoke execute on function public.record_customs_attachment(uuid, text[], uuid) from public;
revoke execute on function public.record_customs_attachment(uuid, text[], uuid) from anon;
revoke execute on function public.record_customs_attachment(uuid, text[], uuid) from authenticated;
grant  execute on function public.record_customs_attachment(uuid, text[], uuid) to service_role;

-- ===========================================================================
-- Self-assertions.
--
-- THE ASSERTIONS READ CODE, NOT PROSE. `pg_proc.prosrc` returns the body
-- INCLUDING its comments; MAYA-P1.1's first attempt matched its own honesty
-- comment and aborted in production. `v_body` strips `--` comments first.
-- ===========================================================================
do $$
declare n int; v_src text; v_body text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name in ('attachment_completed_at', 'attachment_completed_by', 'attachment_systems')
     and is_nullable = 'YES';
  if n <> 3 then raise exception 'P1.11: the three attachment columns must exist and be nullable'; end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.record_customs_attachment(uuid,text[],uuid)');
  if v_src is null then raise exception 'P1.11: the attachment RPC was not created'; end if;
  v_body := regexp_replace(v_src, '--.*$', '', 'ng');

  if v_body !~ 'assert_actor_authority' then
    raise exception 'P1.11: the RPC must verify the caller-declared actor (INV-7)';
  end if;
  if v_body !~ 'customs:update' then
    raise exception 'P1.11: the RPC must assert the step''s declared permission';
  end if;
  -- The neighbouring customs acts stay separate (CEO steps 7, 8 and 10).
  if v_body ~ 'gainde_registered' or v_body ~ 'reviewed_' or v_body ~ 'bae_reference'
     or v_body ~ 'release_date' or v_body ~ 'receivability' then
    raise exception 'P1.11: attachment must not touch another customs act';
  end if;
  -- No fabricated synchronisation, and no status movement. BLK-1 stands.
  if v_body ~ 'provider_synced_at' or v_body ~ 'provider_code' then
    raise exception 'P1.11: attachment must not touch provider synchronisation state';
  end if;
  if v_body ~ 'intel_status' then
    raise exception 'P1.11: attachment must not move the customs lifecycle';
  end if;
  -- INV-9: the fail-closed lane is never invoked.
  if v_body ~ 'SYSTEM' then
    raise exception 'P1.11: the unratified lane must not be invoked';
  end if;
end $$;
