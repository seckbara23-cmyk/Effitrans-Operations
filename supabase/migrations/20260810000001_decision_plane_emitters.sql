-- ===========================================================================
-- UT-3B — Decision Plane emitters (migration 86)
--
-- AN ARCHITECTURAL MIGRATION, NOT A FEATURE MIGRATION. It adds no capability.
-- Every business act below already exists and already commits; this migration
-- only places those acts onto the sanctioned emission path so their events
-- commit IN THE SAME TRANSACTION as the act itself.
--
-- Why SQL was unavoidable: `emit_business_event` is SECURITY DEFINER and
-- revoked from public, and the registry admits only `trigger` | `rpc`. The six
-- acts here are TypeScript writes through the admin client, so the only way to
-- share their transaction is a trigger. An application-layer emit after the
-- write is a SECOND round trip — the defect the platform's own guard rejected
-- in EC-3B — and is not used here.
--
-- CONTAINS ONLY: trigger functions and triggers.
-- CONTAINS NO: table, event store, permission, RLS policy, index, column,
-- backfill, scheduler, worker, or change to any business rule. No RPC is
-- edited — the earlier proposal to modify `activate_workflow_policy` was
-- WRONG: that RPC performs tenant-scope activation (already evented as
-- POLICY_ACTIVATED), whereas a DOSSIER's policy is pinned when its
-- `process_instance` row is created. The trigger below is the correct site.
--
-- ADMIN_OVERRIDE_EXECUTED and WORKFLOW_REVERSED are deliberately absent: no
-- business act performs them, and an emitter without an act fabricates history.
--
-- Additive, idempotent, forward-only. Migrations 1–85 are untouched.
-- ===========================================================================

-- ===========================================================================
-- 1. CORRESPONDENCE_RECEIVED — "this correspondence now belongs to this
--    tenant", NOT "an email arrived".
--
--    ONE trigger, on INSERT with a tenant — and that is the WHOLE rule, because
--    `ec_inbound_message` is APPEND-ONLY (EC-1 puts `prevent_mutation` on it)
--    and no code path updates it. A quarantined row carries `tenant_id = NULL`
--    permanently: quarantine is terminal, so a message is either attributed at
--    capture or never.
--
--    An earlier draft added a second trigger for `UPDATE NULL → tenant`, on the
--    assumption that quarantined mail could later be released. CI proved that
--    branch unreachable — the table refuses UPDATE outright — so it was removed
--    rather than left as a trigger that can never fire. On an immutable capture
--    table, "first tenant attribution" and "capture with a tenant" are the same
--    instant, always.
--
--    `business_event.tenant_id` is NOT NULL, so an unattributed message cannot
--    be evented at all. That is not a limitation to work around: a message
--    belonging to no tenant belongs in no tenant's history.
--
--    It therefore never fires on quarantine, on discard, or on triage.
-- ===========================================================================
create or replace function public.emit_correspondence_received()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_business_event(
    new.tenant_id, 'CORRESPONDENCE_RECEIVED', 'communication', 'db_trigger',
    'ec_inbound_message', new.id,
    null,                       -- prologue: no dossier exists at attribution
    null,                       -- inbound capture has no acting user
    jsonb_build_object('message_id', new.id, 'mailbox_id', new.mailbox_id));
  return null;                  -- AFTER trigger; the return value is ignored
end $$;

revoke all on function public.emit_correspondence_received() from public;

drop trigger if exists trg_ec_message_received_insert on public.ec_inbound_message;
create trigger trg_ec_message_received_insert
  after insert on public.ec_inbound_message
  for each row
  when (new.tenant_id is not null)
  execute function public.emit_correspondence_received();

-- ===========================================================================
-- 2 + 3. HANDOFF_SENT / HANDOFF_RECEIVED — genuine OWNERSHIP transfers between
--        departments, and nothing else.
--
--        Sending and acknowledging are two facts, by two actors, possibly far
--        apart in time, so they are two events rather than one with a status.
--
--        `process_handoff` carries no dossier, so it is resolved through
--        `process_instance.file_id` — a key lookup, never a guess.
--
--        NOT emitted for: staff reassignment, queue changes, user assignment or
--        any other status transition. The RECEIVED trigger fires only on the
--        exact transition into RECEIVED, so a rejection, a cancellation or an
--        unrelated column edit produces nothing.
-- ===========================================================================
create or replace function public.emit_handoff_sent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_file uuid;
begin
  select pi.file_id into v_file
    from public.process_instance pi
   where pi.id = new.process_instance_id;

  perform public.emit_business_event(
    new.tenant_id, 'HANDOFF_SENT', 'handoff', 'db_trigger',
    'process_handoff', new.id, v_file, new.sent_by,
    jsonb_build_object('from_step', new.from_step_key, 'to_step', new.to_step_key));
  return null;
end $$;

create or replace function public.emit_handoff_received()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_file uuid;
begin
  select pi.file_id into v_file
    from public.process_instance pi
   where pi.id = new.process_instance_id;

  perform public.emit_business_event(
    new.tenant_id, 'HANDOFF_RECEIVED', 'handoff', 'db_trigger',
    'process_handoff', new.id, v_file, new.received_by,
    jsonb_build_object('from_step', new.from_step_key, 'to_step', new.to_step_key));
  return null;
end $$;

revoke all on function public.emit_handoff_sent() from public;
revoke all on function public.emit_handoff_received() from public;

drop trigger if exists trg_process_handoff_sent on public.process_handoff;
create trigger trg_process_handoff_sent
  after insert on public.process_handoff
  for each row
  execute function public.emit_handoff_sent();

drop trigger if exists trg_process_handoff_received on public.process_handoff;
create trigger trg_process_handoff_received
  after update on public.process_handoff
  for each row
  when (old.status is distinct from 'RECEIVED' and new.status = 'RECEIVED')
  execute function public.emit_handoff_received();

-- ===========================================================================
-- 4. DOCUMENT_SHARED_WITH_CLIENT — the moment a document becomes visible to the
--    customer. Fires on the false → true transition ONLY: un-sharing is a
--    different fact and is not this event, and re-saving a shared document
--    emits nothing.
--
--    This type is `clientSafe: true` in the registry — the first customer-facing
--    type since the freeze — so it carries only `type_code`, never a filename,
--    a path or any content.
-- ===========================================================================
create or replace function public.emit_document_shared()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_business_event(
    new.tenant_id, 'DOCUMENT_SHARED_WITH_CLIENT', 'document', 'db_trigger',
    'document', new.id, new.file_id, null,
    jsonb_build_object('type_code', new.type_code));
  return null;
end $$;

revoke all on function public.emit_document_shared() from public;

drop trigger if exists trg_document_shared_with_client on public.document;
create trigger trg_document_shared_with_client
  after update on public.document
  for each row
  when (old.shared_with_client is distinct from new.shared_with_client
        and new.shared_with_client = true)
  execute function public.emit_document_shared();

-- ===========================================================================
-- 5. EXPENSE_AUTHORIZED — the visa chain completed and the authorization
--    reached APPROVED.
--
--    SCOPED TO DOSSIER-LINKED EXPENSES ONLY, per RATIFY-UT3-2, which is
--    unresolved. `expense_authorization.file_id` is nullable (DEC-C15 permits a
--    general administrative expense), and an event with no dossier would match
--    NO branch of the business_event SELECT policy — invisible even to Finance.
--    Rather than widen a policy to make an event visible, the emitter stays
--    silent for those rows. Nothing is lost that was ever recorded, and no
--    visibility is invented. When RATIFY-UT3-2 is answered, this WHEN clause is
--    the single place that changes.
-- ===========================================================================
create or replace function public.emit_expense_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_business_event(
    new.tenant_id, 'EXPENSE_AUTHORIZED', 'finance', 'db_trigger',
    'expense_authorization', new.id, new.file_id, null,
    jsonb_build_object('previous_status', old.status, 'new_status', new.status));
  return null;
end $$;

revoke all on function public.emit_expense_authorized() from public;

drop trigger if exists trg_expense_authorized on public.expense_authorization;
create trigger trg_expense_authorized
  after update on public.expense_authorization
  for each row
  when (old.status is distinct from 'APPROVED'
        and new.status = 'APPROVED'
        and new.file_id is not null)
  execute function public.emit_expense_authorized();

-- ===========================================================================
-- 6. DOSSIER_POLICY_PINNED — which governing policy version this dossier was
--    put under, and how it came to be.
--
--    Fires when the dossier's `process_instance` is created carrying a pinned
--    version. `policy_provenance` distinguishes PINNED from LEGACY_DEFAULT and
--    MIGRATED, so a dossier that predates the registry says so instead of
--    appearing to have been governed by whatever is active today.
-- ===========================================================================
create or replace function public.emit_dossier_policy_pinned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.emit_business_event(
    new.tenant_id, 'DOSSIER_POLICY_PINNED', 'policy', 'db_trigger',
    'operational_file', new.file_id, new.file_id, null,
    jsonb_build_object('provenance', new.policy_provenance));
  return null;
end $$;

revoke all on function public.emit_dossier_policy_pinned() from public;

drop trigger if exists trg_process_instance_policy_pinned on public.process_instance;
create trigger trg_process_instance_policy_pinned
  after insert on public.process_instance
  for each row
  when (new.policy_version_id is not null)
  execute function public.emit_dossier_policy_pinned();
