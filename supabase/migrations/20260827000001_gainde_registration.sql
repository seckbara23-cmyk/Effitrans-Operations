-- ===========================================================================
-- MAYA-P1.1 — Finance records the GAINDE registration (CEO step 8)
-- ---------------------------------------------------------------------------
-- THE GAP. `customs:register` has existed since the process engine shipped
-- (migration 20260713000001), catalogued in as many words as
-- « Register the declaration in GAINDE (Finance, step 9) », and granted to
-- CUSTOMS_FINANCE_OFFICER, OPS_SUPERVISOR and SYSTEM_ADMIN. Nothing ever
-- consumed it. The CEO workflow names Finance as the owner of this act, and
-- the platform could not perform it — the same shape PG-1 closed for
-- `customs:validate`.
--
-- Note what was NOT the problem: `customs_record.external_ref` is writable
-- today through `updateCustoms`. But that path requires `customs:update`, which
-- Finance deliberately does not hold, and it is the declaration-editing
-- authority — not a Finance registration act. Widening Finance's customs rights
-- to reach one field would trade a precise permission for a broad one.
--
-- WHAT IS CAPTURED, and why exactly these fields. The process registry's step 9
-- states its own `requiredEvidence`: gainde_declaration_reference,
-- registration_date, registered_by, registration_receipt. The first three are
-- taken literally — the reference reuses the existing `external_ref`, and the
-- date and actor become the two columns below. The RECEIPT is a document and is
-- deliberately not modelled here; the document authority already owns documents.
--
-- WHAT IS DELIBERATELY NOT DECIDED.
--
--   * NO STATUS MOVES. Registration is an operational fact owned by Finance;
--     validation is a different act owned by the Chef de Transit. Neither
--     `status` nor `intel_status` is touched.
--   * NO PREREQUISITE IS ENFORCED. The registry lists step 9's prerequisite as
--     step 8, which follows Chef Transit validation — and the CEO workflow
--     agrees on that ORDER. But the registry states of itself: "This registry
--     DESCRIBES the process. It does not run it." It is a description, not a
--     gate. Turning it into one here would block Finance on every dossier in
--     flight, because PG-1 shipped on 2026-08-12 and no existing record carries
--     `reviewed_at` yet. The ordering question is reported, not invented.
--   * NO GAINDE INTEGRATION. BLK-1 stands: there is no API contract. This
--     records what an operator typed. `provider_code` stays 'manual' and
--     `provider_synced_at` is NEVER written here — setting it would assert a
--     synchronisation that did not happen.
-- ===========================================================================

alter table public.customs_record
  -- WHEN Finance registered the declaration. The registry calls this
  -- `registration_date`; it is stored as an instant so the act can be placed in
  -- time rather than only in a day.
  add column if not exists gainde_registered_at timestamptz,
  -- WHO registered it (`registered_by`). Attribution is permanent.
  add column if not exists gainde_registered_by uuid references public.app_user (id);

-- Both columns move together. Safe to state symmetrically, unlike P0.8-A's
-- constraint: these columns are NEW, so no existing row can violate them and
-- nothing has to be back-filled to make the migration apply.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customs_gainde_registration_complete'
  ) then
    alter table public.customs_record
      add constraint customs_gainde_registration_complete check (
        (gainde_registered_at is null and gainde_registered_by is null)
        or (gainde_registered_at is not null and gainde_registered_by is not null)
      );
  end if;
end $$;

-- ===========================================================================
-- The registration RPC.
--
-- CORRECTION IS ALLOWED; A DUPLICATE IS NOT. A GAINDE reference is typed by a
-- human and gets corrected in practice, so refusing all re-registration — as
-- PG-1 does for validation — would be the wrong doctrine here and would force
-- operators around the platform. Re-recording the SAME reference is refused so
-- the ledger does not accumulate the same fact twice; recording a DIFFERENT one
-- is accepted and appends a new event, exactly as `record_customs_receivability`
-- treats a re-decision. Whether a correction should require any approval is an
-- open business question and is not answered here.
-- ===========================================================================
create or replace function public.record_gainde_registration(
  p_customs_id uuid,
  p_reference  text,
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
  v_ref    text := nullif(btrim(coalesce(p_reference, '')), '');
begin
  if p_actor is null then
    raise exception 'an actor is required';
  end if;
  if v_ref is null then
    raise exception 'a GAINDE reference is required';
  end if;

  select tenant_id, file_id, external_ref
    into v_tenant, v_file, v_prev
    from public.customs_record
   where id = p_customs_id and deleted_at is null
     for update;
  if not found then raise exception 'customs record not found'; end if;

  -- OPS-SEC-2A trust contract. p_actor is caller-declared, so the database
  -- verifies it against app_user + get_user_permissions and requires
  -- `customs:register` — the narrow Finance capability, never customs:update.
  perform public.assert_actor_authority(p_actor, v_tenant, 'customs:register', 'SERVICE');

  if v_prev is not distinct from v_ref then
    raise exception 'this GAINDE reference is already recorded';
  end if;

  -- The registration, and NOTHING else. `status`, `intel_status`,
  -- `provider_code` and `provider_synced_at` are all untouched: nothing here
  -- synchronised with GAINDE, and the record must not imply that it did.
  update public.customs_record
     set external_ref          = v_ref,
         gainde_registered_at  = now(),
         gainde_registered_by  = p_actor
   where id = p_customs_id;

  perform public.emit_business_event(
    p_tenant_id     => v_tenant,
    p_event_type    => 'GAINDE_REGISTRATION_RECORDED',
    p_event_domain  => 'customs',
    p_source        => 'policy_rpc',
    p_subject_type  => 'customs_record',
    p_subject_id    => p_customs_id,
    p_dossier_id    => v_file,
    p_actor_user_id => p_actor,
    -- The reference travels, as it does for BAE_RECORDED: it is a business
    -- reference the client may quote, not personal or sensitive data.
    -- `corrected` distinguishes a first registration from a replacement.
    p_metadata      => jsonb_build_object('reference', v_ref, 'corrected', v_prev is not null)
  );

  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file);
end; $$;

-- OPS-SEC-1: a definer function is never browser-executable.
revoke execute on function public.record_gainde_registration(uuid, text, uuid) from public;
revoke execute on function public.record_gainde_registration(uuid, text, uuid) from anon;
revoke execute on function public.record_gainde_registration(uuid, text, uuid) from authenticated;
grant  execute on function public.record_gainde_registration(uuid, text, uuid) to service_role;

-- ===========================================================================
-- Self-assertions.
-- ===========================================================================
do $$
declare n int; v_src text;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'customs_record'
     and column_name in ('gainde_registered_at', 'gainde_registered_by')
     and is_nullable = 'YES';
  if n <> 2 then raise exception 'P1.1: both registration columns must exist and be nullable'; end if;

  select p.prosrc into v_src from pg_proc p
   where p.oid = to_regprocedure('public.record_gainde_registration(uuid,text,uuid)');

  -- The narrow capability, and no substitute.
  if v_src !~ 'customs:register' then
    raise exception 'P1.1: the RPC must assert customs:register';
  end if;
  if v_src ~ 'customs:update' or v_src ~ 'customs:validate' then
    raise exception 'P1.1: a broader customs permission must never substitute';
  end if;
  -- No fabricated synchronisation, and no status movement.
  if v_src ~ 'provider_synced_at' or v_src ~ 'provider_code' then
    raise exception 'P1.1: registration must not touch provider synchronisation state';
  end if;
  if v_src ~ 'intel_status' then
    raise exception 'P1.1: registration must not move the customs lifecycle';
  end if;
  -- INV-9: the fail-closed lane is never invoked.
  if v_src ~ 'SYSTEM' then
    raise exception 'P1.1: the unratified lane must not be invoked';
  end if;
end $$;
