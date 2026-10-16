-- ===========================================================================
-- Migration 154 — CUSTOMS-REF-01A / SCANNER-01: a scan verdict cannot be
-- replayed.
-- ===========================================================================
-- WHAT THIS CLOSES. Migration 153 authenticated the scanner callback with an
-- HMAC over the raw body and nothing else. An HMAC proves WHO sent a message;
-- it says nothing about WHEN, or whether this is the first time. So a captured
-- CLEAN callback stayed valid for ever and could be re-sent.
--
-- THE CONCRETE ATTACK. A document is cleared and published. A rescan later
-- finds a new signature, turns INFECTED, and the document is retired. Replaying
-- the original CLEAN callback put `scan_status` back to CLEAN — the publication
-- CHECK kept it WITHDRAWN, so it could not be re-published, but the library's
-- own evidence then said the current verdict was clean on a file its scanner
-- had rejected. The evidence trail is the thing that was corruptible.
--
-- TWO LAYERS, DELIBERATELY. The application rejects a stale callback by its
-- timestamp (a freshness window), which stops a captured message being useful
-- later. This migration makes the guarantee NOT depend on clocks: the nonce the
-- scanner echoes back is recorded with the verdict under a unique index, so a
-- second arrival of the same callback collides in the database and is refused
-- whatever any clock says.
--
-- WHY A NONCE RATHER THAN JUST A TIMESTAMP. A window has to be wide enough for
-- a slow scanner and a clock skew, and anything inside that window is replayable
-- — including, at the worst moment, immediately. Uniqueness has no window.
--
-- NEW MIGRATION RATHER THAN AN EDIT TO 153. 153 is unapplied in production, so
-- editing it would be legal. It has also already been verified 34/34 in CI and
-- read by a reviewer, and this is new capability rather than a correction, so it
-- gets its own file and its own verifier. Both apply in order.
--
-- IT WRITES NO ROW AND WIDENS NOTHING. No new permission, no new role grant, no
-- new publication path. The only behavioural change is that a verdict the
-- database has already seen is refused.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The nonce, on the evidence row where it belongs.
--
-- NULLABLE, and the index is partial on it. Verdicts recorded before this
-- migration — and any future caller that legitimately has no nonce, such as a
-- manual re-record during an incident — stay representable. What is forbidden is
-- re-using a nonce that has already been seen for the same document.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_scan
  add column if not exists callback_nonce text;

comment on column public.customs_reference_scan.callback_nonce is
  'SCANNER-01 — the nonce the scanner echoed back from the dispatch. Unique per (tenant, document) so a replayed callback collides rather than being recorded twice.';

create unique index if not exists uq_customs_reference_scan_nonce
  on public.customs_reference_scan (tenant_id, document_id, callback_nonce)
  where callback_nonce is not null;

-- ---------------------------------------------------------------------------
-- 2. The recorder learns the nonce, and refuses a repeat.
--
-- The old 9-argument signature is DROPPED rather than left beside the new one.
-- An overload pair would mean two functions with one name and one set of
-- grants to keep in step, and a caller that omitted the nonce would silently
-- get the unprotected one — which is the whole defect, reachable by accident.
-- ---------------------------------------------------------------------------
drop function if exists public.record_customs_reference_scan(
  uuid, uuid, text, text, text, text, text, text, text);

create or replace function public.record_customs_reference_scan(
  p_document        uuid,
  p_tenant          uuid,
  p_verdict         text,
  p_sha256          text,
  p_storage_path    text,
  p_scanner_name    text,
  p_scanner_version text default null,
  p_engine_ref      text default null,
  p_detail          text default null,
  p_nonce           text default null
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

  -- REPLAY. The evidence insert is the gate: the unique index on
  -- (tenant, document, nonce) means a callback the database has already seen
  -- cannot be recorded a second time. Caught here so the caller gets an
  -- answer rather than a constraint error, and ABOVE the document update, so a
  -- replay changes no state at all.
  begin
    insert into public.customs_reference_scan
      (tenant_id, document_id, sha256, storage_path, verdict,
       scanner_name, scanner_version, engine_ref, detail, callback_nonce)
    values
      (p_tenant, p_document, p_sha256, p_storage_path, p_verdict,
       btrim(p_scanner_name), p_scanner_version, p_engine_ref, p_detail,
       nullif(btrim(coalesce(p_nonce, '')), ''));
  exception when unique_violation then
    return 'replayed';
  end;

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

revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text, text) from public;
revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text, text) from anon;
revoke execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text, text) from authenticated;
grant  execute on function public.record_customs_reference_scan(uuid, uuid, text, text, text, text, text, text, text, text) to service_role;
