-- ===========================================================================
-- Migration 153 — CUSTOMS-REF-01A / REF-1-PUBLISH-GATE: nothing is published
-- unscanned, and nobody publishes their own upload.
-- ===========================================================================
-- WHAT THIS CLOSES. Migration 152 shipped the library with publication gated on
-- provenance, legal version and a licence ruling. Two things it did NOT gate:
--
--   * an UNSCANNED file could be published. There is no malware scanner in this
--     platform, so quarantine was containment by process, not by schema.
--   * a single holder of `customs:reference:publish` could upload a document
--     and publish it alone — asserting that a text is the current authoritative
--     law with one pair of eyes.
--
-- Both are now unrepresentable. The CHECK constraints below mean a PUBLISHED
-- row cannot exist without a CLEAN scan BOUND TO ITS BYTES and two distinct
-- actors; publication itself moves into one definer RPC so the rule cannot be
-- half-applied by a caller that forgot a step.
--
-- A NEW MIGRATION RATHER THAN AN EDIT TO 152. 152 is still unapplied in
-- production, so editing it would have been legal — the previous hardening
-- round did exactly that for four corrections. This is not a correction: it is
-- new capability with new tables, new functions and a new authority model, and
-- a reviewer who has already read 152 should be able to read what changed
-- without re-reading what did not. Both apply in order on a fresh database.
--
-- THE SCANNER ITSELF IS NOT HERE, AND THAT IS DELIBERATE. No scanning service,
-- secret or infrastructure is configured for this project. What this migration
-- provides is the LIFECYCLE and the TRUST BOUNDARY: a place to record a verdict,
-- a rule that only the trusted recorder may record CLEAN, and a publication gate
-- that refuses everything else. With no scanner wired up the state stays
-- UNSCANNED and nothing can be published — which is the correct failure.
--
-- NO EXCEPTION, NO BYPASS. There is no "publish anyway" flag, no override
-- column and no allowlist. The brief that authorised this slice asked for a
-- general-purpose exception NOT to be built, and none is.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The scan lifecycle, and the maker's half of maker-checker.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document
  -- UNSCANNED  nothing has looked at these bytes
  -- SCANNING   handed to the scanner, verdict outstanding
  -- CLEAN      a trusted scanner cleared THESE bytes (see the binding below)
  -- INFECTED   a trusted scanner rejected them
  -- ERROR      outage, timeout or an inconclusive answer — NOT a pass
  add column if not exists scan_status text not null default 'UNSCANNED',
  add column if not exists scan_requested_at   timestamptz,
  add column if not exists scan_requested_by   uuid,
  add column if not exists scan_completed_at   timestamptz,
  -- THE BINDING. A clearance is about an object, not about a row: these record
  -- which bytes and which stored object were actually examined, and the
  -- publication CHECK compares them with the document's own.
  add column if not exists scanned_sha256       text,
  add column if not exists scanned_storage_path text,
  add column if not exists scanner_name         text,
  add column if not exists scanner_version      text,
  add column if not exists scan_detail          text,
  -- The submission that publication now answers to.
  add column if not exists submitted_for_publication_by uuid,
  add column if not exists submitted_for_publication_at timestamptz,
  -- Who ended consultability: a person, or the scanner revoking its own
  -- clearance. See the coherence rule below.
  add column if not exists withdrawn_source text;

alter table public.customs_reference_document
  drop constraint if exists customs_reference_scan_status_check;
alter table public.customs_reference_document
  add constraint customs_reference_scan_status_check
  check (scan_status in ('UNSCANNED', 'SCANNING', 'CLEAN', 'INFECTED', 'ERROR'));

alter table public.customs_reference_document
  drop constraint if exists customs_reference_withdrawn_source_check;
alter table public.customs_reference_document
  add constraint customs_reference_withdrawn_source_check
  check (withdrawn_source is null or withdrawn_source in ('OPERATOR', 'SCAN'));

-- ---------------------------------------------------------------------------
-- 2. A CLEAN verdict is meaningless unless it names what it examined.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document
  drop constraint if exists customs_reference_clean_scan_is_bound;
alter table public.customs_reference_document
  add constraint customs_reference_clean_scan_is_bound
  check (
    scan_status <> 'CLEAN'
    or (
      scanned_sha256 is not null
      and scanned_storage_path is not null
      and scan_completed_at is not null
      and scanner_name is not null
    )
  );

-- ---------------------------------------------------------------------------
-- 3. PUBLICATION REQUIRES A CLEAN SCAN OF THESE EXACT BYTES.
--
-- Comparing against `content_sha256` and `storage_path` is what makes the
-- clearance non-transferable. The identity trigger from 152 already forbids
-- changing either, so a document cannot be published on the strength of a scan
-- of something else — and a rescan that disagrees has to move the document out
-- of PUBLISHED in the same statement, because this CHECK will not let it stay.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document
  drop constraint if exists customs_reference_publication_requires_clean_scan;
alter table public.customs_reference_document
  add constraint customs_reference_publication_requires_clean_scan
  check (
    status <> 'PUBLISHED'
    or (
      scan_status = 'CLEAN'
      and scanned_sha256 = content_sha256
      and scanned_storage_path = storage_path
    )
  );

-- ---------------------------------------------------------------------------
-- 4. PUBLICATION REQUIRES TWO DISTINCT ACTORS.
--
-- Structural, on the `hr_batch_approver_differs` template: the separation is a
-- property of the ROW, so no role grant, no service-role action and no future
-- code path can publish single-handed. The submission must exist first, which
-- is what makes "approved" mean something was proposed.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document
  drop constraint if exists customs_reference_publication_requires_two_actors;
alter table public.customs_reference_document
  add constraint customs_reference_publication_requires_two_actors
  check (
    status <> 'PUBLISHED'
    or (
      submitted_for_publication_by is not null
      and submitted_for_publication_at is not null
      and published_by is not null
      and published_by <> submitted_for_publication_by
    )
  );

-- A submission is one fact in two columns; they move together.
alter table public.customs_reference_document
  drop constraint if exists customs_reference_submission_coherent;
alter table public.customs_reference_document
  add constraint customs_reference_submission_coherent
  check (
    (submitted_for_publication_by is null and submitted_for_publication_at is null)
    or (submitted_for_publication_by is not null and submitted_for_publication_at is not null)
  );

-- ---------------------------------------------------------------------------
-- 5. Withdrawal coherence, widened for the one actor that is not a person.
--
-- 152 required a human withdrawer. A rescan that turns INFECTED must retire the
-- document, and the scanner has no seat in app_user — the SYSTEM lane is
-- deliberately unimplemented (OPS-SEC-2A EFA16), so inventing a principal for
-- it would assert exactly the kind of property the schema cannot hold. A
-- SCAN-sourced withdrawal therefore carries no actor, and says so.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document
  drop constraint if exists customs_reference_withdrawal_coherent;
alter table public.customs_reference_document
  add constraint customs_reference_withdrawal_coherent
  check (
    (withdrawn_at is null and withdrawn_by is null and withdrawn_source is null)
    or (withdrawn_at is not null and withdrawn_source = 'OPERATOR' and withdrawn_by is not null)
    or (withdrawn_at is not null and withdrawn_source = 'SCAN')
  );

create index if not exists idx_customs_reference_scan_state
  on public.customs_reference_document (tenant_id, scan_status, status);

-- ---------------------------------------------------------------------------
-- 6. Scan evidence — append-only, every attempt, including rescans.
--
-- The document carries the CURRENT verdict; this carries the HISTORY. It uses
-- the foundation's `prevent_mutation()` guard, which blocks UPDATE and DELETE
-- for every role including the service role, so a verdict cannot be rewritten
-- after the fact.
-- ---------------------------------------------------------------------------
create table if not exists public.customs_reference_scan (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  document_id     uuid not null references public.customs_reference_document(id) on delete restrict,
  -- What was examined. Recorded here as well as on the document so the evidence
  -- row remains meaningful on its own.
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path    text not null,
  verdict         text not null check (verdict in ('CLEAN', 'INFECTED', 'ERROR')),
  scanner_name    text not null check (btrim(scanner_name) <> ''),
  scanner_version text,
  -- The scanner's own reference, so a verdict can be traced back to its source.
  engine_ref      text,
  detail          text,
  recorded_at     timestamptz not null default now(),
  -- NULL by design: a scanner is not a user. `audit_log.actor_id` is nullable
  -- for the same reason, and the audit action is `system.`-prefixed.
  recorded_by     uuid
);

comment on table public.customs_reference_scan is
  'CUSTOMS-REF-01A — append-only malware-scan evidence for reference documents. One row per verdict, including rescans. Never updated or deleted.';

create index if not exists idx_customs_reference_scan_document
  on public.customs_reference_scan (tenant_id, document_id, recorded_at desc);

drop trigger if exists trg_customs_reference_scan_append_only on public.customs_reference_scan;
create trigger trg_customs_reference_scan_append_only
  before update or delete on public.customs_reference_scan
  for each row execute function public.prevent_mutation();

alter table public.customs_reference_scan enable row level security;

drop policy if exists customs_reference_scan_select on public.customs_reference_scan;
create policy customs_reference_scan_select on public.customs_reference_scan
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('customs:reference:publish')
  );

grant select on public.customs_reference_scan to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ONLY THE TRUSTED RECORDER MAY RECORD CLEAN.
--
-- Every write in this platform arrives through the service-role client, so
-- "the application decides" is not a boundary: any server action could set
-- scan_status = 'CLEAN' with a PostgREST update. This trigger makes that
-- impossible. The ONLY way into CLEAN is a transaction that set the guard
-- below, and the only thing that sets it is
-- `record_customs_reference_scan`, which is revoked from public, anon and
-- authenticated.
--
-- WHAT THIS DOES AND DOES NOT PROVE. It stops CLEAN being manufactured by an
-- ordinary write, by a browser, by any authenticated client and by any code
-- path that has not gone through the recorder — which is what "users and
-- publishers must never be able to manufacture a clean result" asks for. It is
-- not a defence against service-role code deliberately calling the recorder
-- with a fabricated verdict; nothing inside the database can distinguish that,
-- which is why the recorder is reachable only from one HMAC-authenticated
-- route and why every verdict leaves an append-only evidence row.
--
-- The guard is transaction-local (`set_config(..., true)`), so it cannot leak
-- into another statement, another session or a connection returned to the pool.
-- ---------------------------------------------------------------------------
create or replace function public.guard_customs_reference_scan_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_guard text := coalesce(current_setting('effitrans.scan_recorder', true), '');
begin
  if new.scan_status = 'CLEAN'
     and (tg_op = 'INSERT' or old.scan_status is distinct from 'CLEAN')
     and v_guard <> 'customs_reference'
  then
    raise exception
      'customs_reference_document: only the trusted scan recorder may record a CLEAN verdict (document %)',
      new.id
      using errcode = 'EFR01';
  end if;

  -- A clearance may not be silently re-pointed at different bytes either: the
  -- binding columns are what the publication CHECK trusts.
  if tg_op = 'UPDATE'
     and old.scan_status = 'CLEAN'
     and new.scan_status = 'CLEAN'
     and (new.scanned_sha256 is distinct from old.scanned_sha256
          or new.scanned_storage_path is distinct from old.scanned_storage_path)
     and v_guard <> 'customs_reference'
  then
    raise exception
      'customs_reference_document: a recorded clearance cannot be re-bound (document %)', new.id
      using errcode = 'EFR02';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customs_reference_scan_guard on public.customs_reference_document;
create trigger trg_customs_reference_scan_guard
  before insert or update on public.customs_reference_document
  for each row execute function public.guard_customs_reference_scan_status();

-- ---------------------------------------------------------------------------
-- 8. record_customs_reference_scan — the one door a verdict comes through.
--
-- It takes the verdict ABOUT AN OBJECT and refuses one that does not describe
-- the document's current bytes: a scan of a previous edition cannot clear this
-- one. A non-CLEAN verdict on a PUBLISHED document retires it in the SAME
-- statement, because the publication CHECK would otherwise reject the update
-- and the infected text would stay published.
--
-- No actor assertion: there is no human here, and the SYSTEM lane fails closed
-- by ratification. Authority comes from the grant below plus the HMAC on the
-- route that calls it.
-- ---------------------------------------------------------------------------
create or replace function public.record_customs_reference_scan(
  p_document        uuid,
  p_tenant          uuid,
  p_verdict         text,
  p_sha256          text,
  p_storage_path    text,
  p_scanner_name    text,
  p_scanner_version text default null,
  p_engine_ref      text default null,
  p_detail          text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc record;
  v_withdrew boolean := false;
begin
  if p_verdict is null or p_verdict not in ('CLEAN', 'INFECTED', 'ERROR') then
    return 'invalid_verdict';
  end if;
  if p_scanner_name is null or btrim(p_scanner_name) = '' then
    return 'scanner_required';
  end if;

  select * into v_doc
    from public.customs_reference_document
   where id = p_document and tenant_id = p_tenant
     for update;
  if not found then
    return 'not_found';
  end if;

  -- THE BINDING, checked before anything is written. A verdict that does not
  -- describe the stored object is not evidence about it.
  if p_sha256 is distinct from v_doc.content_sha256
     or p_storage_path is distinct from v_doc.storage_path then
    return 'binding_mismatch';
  end if;

  -- Evidence first, and append-only, so a verdict exists even if the document
  -- update below is refused by a constraint.
  insert into public.customs_reference_scan
    (tenant_id, document_id, sha256, storage_path, verdict,
     scanner_name, scanner_version, engine_ref, detail)
  values
    (p_tenant, p_document, p_sha256, p_storage_path, p_verdict,
     btrim(p_scanner_name), p_scanner_version, p_engine_ref, p_detail);

  -- The guard: set for THIS transaction only, and only around this update.
  perform set_config('effitrans.scan_recorder', 'customs_reference', true);

  if p_verdict = 'CLEAN' then
    update public.customs_reference_document
       set scan_status         = 'CLEAN',
           scan_completed_at   = now(),
           scanned_sha256      = p_sha256,
           scanned_storage_path = p_storage_path,
           scanner_name        = btrim(p_scanner_name),
           scanner_version     = p_scanner_version,
           scan_detail         = p_detail
     where id = p_document and tenant_id = p_tenant;
  else
    -- A rescan that disagrees INVALIDATES the prior clearance, and takes the
    -- document out of publication in the same statement.
    update public.customs_reference_document
       set scan_status          = p_verdict,
           scan_completed_at    = now(),
           scanned_sha256       = null,
           scanned_storage_path = null,
           scanner_name         = btrim(p_scanner_name),
           scanner_version      = p_scanner_version,
           scan_detail          = p_detail,
           status               = case when status = 'PUBLISHED' then 'WITHDRAWN' else status end,
           withdrawn_at         = case when status = 'PUBLISHED' then now() else withdrawn_at end,
           withdrawn_source     = case when status = 'PUBLISHED' then 'SCAN' else withdrawn_source end
     where id = p_document and tenant_id = p_tenant;
    v_withdrew := v_doc.status = 'PUBLISHED';
  end if;

  perform set_config('effitrans.scan_recorder', '', true);

  if p_verdict = 'CLEAN' then return 'clean'; end if;
  if v_withdrew then return 'withdrawn_by_scan'; end if;
  return lower(p_verdict);
end;
$$;

revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text) from public;
revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text) from anon;
revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text) from authenticated;
grant  execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. submit_customs_reference_for_publication — the maker's act.
--
-- Separate from publication so the two decisions carry two actors and two
-- timestamps. The submitter's authority is asserted against the nominated
-- actor, not against the caller: the service role is transport, not authority.
-- ---------------------------------------------------------------------------
create or replace function public.submit_customs_reference_for_publication(
  p_document uuid,
  p_tenant   uuid,
  p_actor    uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_doc record;
begin
  perform public.assert_actor_authority(p_actor, p_tenant, 'customs:reference:publish', 'SERVICE');

  select * into v_doc
    from public.customs_reference_document
   where id = p_document and tenant_id = p_tenant
     for update;
  if not found then return 'not_found'; end if;
  if v_doc.status = 'WITHDRAWN' then return 'withdrawn'; end if;
  if v_doc.status = 'PUBLISHED' then return 'already_published'; end if;
  if v_doc.submitted_for_publication_by is not null then return 'already_submitted'; end if;

  update public.customs_reference_document
     set submitted_for_publication_by = p_actor,
         submitted_for_publication_at = now()
   where id = p_document and tenant_id = p_tenant
     and submitted_for_publication_by is null;

  if not found then return 'already_submitted'; end if;
  return 'submitted';
end;
$$;

revoke execute on function public.submit_customs_reference_for_publication(uuid, uuid, uuid) from public;
revoke execute on function public.submit_customs_reference_for_publication(uuid, uuid, uuid) from anon;
revoke execute on function public.submit_customs_reference_for_publication(uuid, uuid, uuid) from authenticated;
grant  execute on function public.submit_customs_reference_for_publication(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. publish_customs_reference — the checker's act, atomically.
--
-- ONE statement-scope for three things that used to be two PostgREST writes and
-- a pile of application checks:
--   * every publication precondition, named individually so a refusal is
--     actionable rather than a constraint violation;
--   * the predecessor's retirement (REF-1-HARDEN left this non-atomic: a crash
--     between the two writes left a business key with no current edition);
--   * the publication itself.
-- A failure anywhere rolls the whole thing back, which is the correction Part C
-- asked for.
-- ---------------------------------------------------------------------------
create or replace function public.publish_customs_reference(
  p_document uuid,
  p_tenant   uuid,
  p_approver uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc record;
  v_retired int;
begin
  perform public.assert_actor_authority(p_approver, p_tenant, 'customs:reference:publish', 'SERVICE');

  select * into v_doc
    from public.customs_reference_document
   where id = p_document and tenant_id = p_tenant
     for update;
  if not found then return 'not_found'; end if;

  if v_doc.status = 'PUBLISHED' then return 'already_published'; end if;
  if v_doc.status = 'WITHDRAWN' then return 'withdrawn'; end if;

  -- ---- maker-checker ----------------------------------------------------
  if v_doc.submitted_for_publication_by is null then return 'not_submitted'; end if;
  if v_doc.submitted_for_publication_by = p_approver then return 'self_approval_forbidden'; end if;

  -- ---- the 152 preconditions --------------------------------------------
  if not v_doc.provenance_verified then return 'provenance_unverified'; end if;
  if not v_doc.legal_version_verified then return 'legal_version_unverified'; end if;
  if v_doc.licence_status = 'RESTRICTED' then return 'licence_unresolved'; end if;
  if v_doc.category = 'EXPLANATORY_NOTES'
     and v_doc.licence_status <> 'APPROVED_REDISTRIBUTION' then
    return 'explanatory_notes_licence_required';
  end if;

  -- ---- the scan gate ----------------------------------------------------
  if v_doc.scan_status <> 'CLEAN' then
    return case v_doc.scan_status
             when 'UNSCANNED' then 'scan_required'
             when 'SCANNING'  then 'scan_in_progress'
             when 'INFECTED'  then 'scan_infected'
             else 'scan_error'
           end;
  end if;
  if v_doc.scanned_sha256 is distinct from v_doc.content_sha256
     or v_doc.scanned_storage_path is distinct from v_doc.storage_path then
    return 'scan_binding_mismatch';
  end if;

  -- ---- retire the predecessor, then publish, in one transaction ---------
  if v_doc.supersedes_id is not null then
    update public.customs_reference_document
       set superseded_by_id = p_document,
           superseded_at    = now()
     where id = v_doc.supersedes_id
       and tenant_id = p_tenant
       and superseded_by_id is null;
    get diagnostics v_retired = row_count;
    if v_retired <> 1 then return 'predecessor_already_superseded'; end if;
  end if;

  update public.customs_reference_document
     set status       = 'PUBLISHED',
         published_by = p_approver,
         published_at = now()
   where id = p_document and tenant_id = p_tenant
     and status = 'QUARANTINE';

  get diagnostics v_retired = row_count;
  if v_retired <> 1 then return 'already_published'; end if;

  return 'published';
end;
$$;

revoke execute on function public.publish_customs_reference(uuid, uuid, uuid) from public;
revoke execute on function public.publish_customs_reference(uuid, uuid, uuid) from anon;
revoke execute on function public.publish_customs_reference(uuid, uuid, uuid) from authenticated;
grant  execute on function public.publish_customs_reference(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 11. No new permission, and no new role grant.
--
-- `customs:reference:publish` already means "may add to and govern this
-- library". Splitting it into submit/approve codes would let a tenant grant one
-- without the other and quietly recreate single-handed publication from the
-- other side; the separation that matters is between two PEOPLE on one
-- document, and that is a row-level property enforced above. Chef de Transit
-- and System Administrator remain the eligible reviewers, exactly as 152 left
-- them.
-- ---------------------------------------------------------------------------
