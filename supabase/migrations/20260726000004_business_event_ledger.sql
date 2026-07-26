-- 20260726000004_business_event_ledger.sql
-- Effitrans Operations Platform — PHASE WES-9: immutable business event ledger.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Implements ADR-WES-014. One canonical cross-domain operational
-- timeline. It is a RECORD of what happened, never an authority on what may
-- happen: nothing reads it to make a decision, and no workflow behaviour
-- changes because of it.
--
-- ===========================================================================
-- WHY EMISSION LIVES IN THE DATABASE (the WES-9D transactionality decision)
-- ===========================================================================
-- The audit of this repository found, without exception:
--
--   * There is NO transactional outbox. Nothing in 61 migrations resembles one.
--   * Every domain action is an APPLICATION MULTI-WRITE: `.update(...)` on the
--     domain table, then `writeAudit(...)` as a separate PostgREST request.
--   * The supabase-js service-role client CANNOT hold a multi-statement
--     transaction — PostgREST runs each request in its own. So an app-layer
--     "write the row, then write the event" is a DUAL WRITE by construction: a
--     crash between the two produces a committed business fact with no event,
--     which is precisely the silent, permanent gap an immutable ledger must not
--     have. `audit_log` already lives with that risk; a timeline consumers are
--     told to trust must not inherit it.
--   * Of 68 RPCs, only `provision_tenant`, `activate_workflow_policy` and the
--     `next_*` counters are transaction-capable business functions.
--
-- Two emission patterns therefore exist, and ONLY two:
--
--   A. RPC EMISSION — for actions already performed inside a security-definer
--      RPC. `activate_workflow_policy` is extended below to emit in the same
--      transaction that retires and promotes the versions.
--
--   B. TRIGGER EMISSION — an AFTER trigger on the domain table. It runs inside
--      the same transaction as the domain write: the event commits if and only
--      if the fact commits. Not "usually" — structurally.
--
-- The WES-9D caution against "a trigger on every table" is respected: these
-- triggers fire on EXPLICIT, ENUMERATED transitions only. An arbitrary column
-- edit emits nothing. A status moving to a value not listed emits only the
-- generic *_STATUS_CHANGED fact, never an invented milestone.
--
-- ACTOR. PostgREST's per-request transactions mean a `set_config` GUC set by
-- the app cannot survive to the trigger, and the service role's `auth.uid()`
-- is NULL. Actor is therefore read from the ROW's own actor columns
-- (created_by, uploaded_by, reviewed_by, assigned_by, recorded_by, issued_by) —
-- data the domain already commits atomically with the fact. Where the schema
-- records no actor for a transition (task completion), actor is NULL. It is
-- never guessed.
--
-- WHAT IS DELIBERATELY NOT INTEGRATED. Handoffs, expense visas and document
-- sharing are real features whose write paths are app-layer multi-writes with
-- no single domain row transition to hang a trigger on. Their types are
-- declared "reserved" in lib/workflow/events/types.ts and NOTHING emits them.
-- Per WES-9J: fewer trustworthy events beat broad unreliable coverage.
--
-- SCOPE: ledger, emission, read paths. NO retention job (WES-9M: retention is
-- UNCONFIGURED), NO external broker, NO subscriptions, NO event sourcing.

-- ===========================================================================
-- 1. business_event — the ledger.
--
--    NO FOREIGN KEYS except tenant_id. This is intentional and load-bearing:
--    `document`, `customs_record`, `transport_record`, `task` and `invoice` all
--    reference operational_file with ON DELETE CASCADE. A FK from an event to
--    any of them would make history deletable through a cascade — the one thing
--    an immutable ledger may never permit. References are plain uuid columns.
--    They point; they do not bind.
-- ===========================================================================
create table public.business_event (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. FK to organization only (NO ACTION — a tenant with events cannot
  -- be hard-deleted, which is the correct outcome).
  tenant_id         uuid not null references public.organization (id),

  -- ------------------------------------------------------------- envelope 9B
  -- Closed vocabulary, mirrored by lib/workflow/events/types.ts. Kept as text +
  -- an application-side registry rather than a CHECK listing every type: adding
  -- a type must not require a migration, but an UNKNOWN type must still be
  -- unwritable — enforced by emit_business_event() below, which is the only
  -- insertion path.
  event_type        text not null,
  event_domain      text not null check (event_domain in (
                      'dossier', 'document', 'customs', 'transport',
                      'task', 'handoff', 'finance', 'policy', 'ledger')),
  -- Consumers dispatch on (event_type, event_version). Bumped when the metadata
  -- shape changes incompatibly; old rows keep their original version forever.
  event_version     int not null default 1 check (event_version > 0),

  -- Which subsystem produced it — how much it can be trusted, recorded.
  source            text not null check (source in ('db_trigger', 'policy_rpc', 'app_action')),

  -- ------------------------------------------------------------- subject 9B
  -- The dossier this belongs to, when there is one. Config-scope events
  -- (policy activation) have none.
  dossier_id        uuid,
  -- The row the event is about, and which table it lives in.
  subject_type      text not null,
  subject_id        uuid,

  -- --------------------------------------------------------------- actor 9B
  -- NULL is meaningful: "the domain does not record who did this". It is never
  -- a stand-in for a user we could have identified.
  actor_user_id     uuid references public.app_user (id),

  -- ------------------------------------------- correlation / causation 9F
  -- correlation_id groups everything belonging to one business thread. The
  -- dossier IS that thread for dossier-scoped work, so correlation_id defaults
  -- to dossier_id rather than inventing a parallel identifier nothing else
  -- knows about. causation_id points at the event that caused this one.
  correlation_id    uuid,
  causation_id      uuid references public.business_event (id),

  -- ------------------------------------------------------------ metadata 9C
  -- Identifiers and status codes ONLY. Validated against a per-type allow-list
  -- and a prohibited-key deny-list in lib/workflow/events/metadata.ts. Never
  -- free text, money, personal data, file content or a row snapshot.
  metadata          jsonb not null default '{}'::jsonb,

  -- ------------------------------------------------------------- policy 9G
  -- Which policy version governed the dossier when this happened. NULL means
  -- "not recorded", which for events predating WES-7 pinning is the truth.
  policy_version_id uuid references public.workflow_policy_version (id),
  policy_provenance text check (policy_provenance in ('PINNED', 'LEGACY_DEFAULT', 'MIGRATED')),

  -- When the FACT happened, which is when its transaction committed.
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- Read patterns: one dossier's timeline (the dominant query), a tenant-wide
-- feed, correlation walks, and subject lookups.
create index idx_business_event_dossier
  on public.business_event (dossier_id, occurred_at desc)
  where dossier_id is not null;
create index idx_business_event_tenant_time
  on public.business_event (tenant_id, occurred_at desc);
create index idx_business_event_type
  on public.business_event (tenant_id, event_type, occurred_at desc);
create index idx_business_event_subject
  on public.business_event (subject_type, subject_id);
create index idx_business_event_correlation
  on public.business_event (correlation_id)
  where correlation_id is not null;

comment on table public.business_event is
  'WES-9 immutable business event ledger. Append-only, never updated, never deleted. '
  'Emitted only by emit_business_event() from DB triggers and security-definer RPCs, '
  'so an event commits if and only if the domain fact commits. Records history; '
  'authorizes nothing.';

-- ===========================================================================
-- 2. Immutability (WES-9H) — append-only for EVERY role, service role included.
--
--    Reuses public.prevent_mutation(), the same guard the other append-only
--    ledgers use. No correction path, no soft delete, no admin escape hatch:
--    a wrong event is corrected by appending, exactly as with a real ledger.
-- ===========================================================================
create trigger trg_business_event_no_update
  before update on public.business_event
  for each row execute function public.prevent_mutation();

create trigger trg_business_event_no_delete
  before delete on public.business_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 3. RLS (WES-9H) — SELECT only, tenant-scoped, dossier-visibility-gated.
--
--    There is NO authenticated INSERT policy anywhere: the ONLY way a row is
--    created is emit_business_event(), which is security definer and reached
--    exclusively from triggers and RPCs. The application cannot insert an event
--    even with the service role's PostgREST client, because it has no reason to
--    and no code path that does.
--
--    Portal users get NO policy at all. The client feed is a server-side
--    projection over the clientSafe allow-list, never a relaxed row filter —
--    a filter would leak any type someone later forgot to classify.
-- ===========================================================================
alter table public.business_event enable row level security;

create policy business_event_select on public.business_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      -- Dossier events follow the dossier's own visibility rules exactly. No
      -- second, weaker notion of "who can see this dossier" is introduced.
      (dossier_id is not null and public.can_read_file(dossier_id))
      -- Config-scope events (policy activation) are configuration history.
      or (dossier_id is null and public.has_permission('admin:config:manage'))
    )
  );

grant select on public.business_event to authenticated;

-- ===========================================================================
-- 4. emit_business_event — the SINGLE insertion path (WES-9I).
--
--    Security definer so triggers and RPCs can write past RLS, and the only
--    function granted the ability to. It validates the envelope, resolves the
--    governing policy version, and defaults correlation to the dossier.
--
--    It NEVER raises on bad input from a trigger context — see the exception
--    block at the emission sites. WES-9D is explicit: a ledger problem must not
--    fail a legitimate business action. But it DOES reject a structurally
--    invalid envelope so the failure is visible rather than silently stored.
-- ===========================================================================
create or replace function public.emit_business_event(
  p_tenant_id      uuid,
  p_event_type     text,
  p_event_domain   text,
  p_source         text,
  p_subject_type   text,
  p_subject_id     uuid    default null,
  p_dossier_id     uuid    default null,
  p_actor_user_id  uuid    default null,
  p_metadata       jsonb   default '{}'::jsonb,
  p_causation_id   uuid    default null,
  p_event_version  int     default 1
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id           uuid;
  v_policy_id    uuid;
  v_provenance   text;
begin
  if p_tenant_id is null or p_event_type is null or p_source is null then
    raise exception 'business_event: tenant, type and source are required';
  end if;

  -- WES-9G: record which policy governed the dossier at the moment of the fact.
  -- Best-effort by design — a dossier with no process instance yet simply has
  -- no governing version, and that is recorded as NULL rather than guessed.
  if p_dossier_id is not null then
    select pi.policy_version_id, pi.policy_provenance
      into v_policy_id, v_provenance
      from public.process_instance pi
     where pi.file_id = p_dossier_id
     order by pi.created_at desc
     limit 1;
  end if;

  insert into public.business_event (
    tenant_id, event_type, event_domain, event_version, source,
    dossier_id, subject_type, subject_id, actor_user_id,
    correlation_id, causation_id, metadata,
    policy_version_id, policy_provenance
  ) values (
    p_tenant_id, p_event_type, p_event_domain, coalesce(p_event_version, 1), p_source,
    p_dossier_id, p_subject_type, p_subject_id, p_actor_user_id,
    -- The dossier IS the business thread (WES-9F).
    p_dossier_id, p_causation_id, coalesce(p_metadata, '{}'::jsonb),
    v_policy_id, v_provenance
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.emit_business_event(
  uuid, text, text, text, text, uuid, uuid, uuid, jsonb, uuid, int) from public;

-- ===========================================================================
-- 5. Emission triggers (WES-9J).
--
--    Each wraps its emit call so a ledger failure can NEVER roll back a
--    legitimate business write. That is the one place the "same transaction"
--    guarantee is deliberately relaxed, and only in the direction that is safe:
--    the fact may exist without the event, never the event without the fact.
-- ===========================================================================

-- 5.1 operational_file -------------------------------------------------------
create or replace function public.emit_dossier_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'DOSSIER_OPENED', 'dossier', 'db_trigger',
      'operational_file', new.id, new.id, new.created_by,
      jsonb_build_object('file_number', new.file_number, 'file_type', new.type));

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'DOSSIER_STATUS_CHANGED', 'dossier', 'db_trigger',
      'operational_file', new.id, new.id, null,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'CLOSED' then
      perform public.emit_business_event(
        new.tenant_id, 'DOSSIER_CLOSED', 'dossier', 'db_trigger',
        'operational_file', new.id, new.id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception when others then
  raise warning 'business_event emission failed for operational_file %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_dossier_events
  after insert or update on public.operational_file
  for each row execute function public.emit_dossier_events();

-- 5.2 document ---------------------------------------------------------------
create or replace function public.emit_document_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'DOCUMENT_UPLOADED', 'document', 'db_trigger',
      'document', new.id, new.file_id, new.uploaded_by,
      jsonb_build_object('type_code', new.type_code));

  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Only the two decisions that matter operationally. UPLOADED ->
    -- PENDING_REVIEW is workflow noise and emits nothing.
    if new.status = 'APPROVED' then
      perform public.emit_business_event(
        new.tenant_id, 'DOCUMENT_VERIFIED', 'document', 'db_trigger',
        'document', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('type_code', new.type_code,
                           'previous_status', old.status, 'new_status', new.status));
    elsif new.status = 'REJECTED' then
      -- review_note is deliberately NOT copied: it is free text about a person's
      -- work and would be unredactable here forever.
      perform public.emit_business_event(
        new.tenant_id, 'DOCUMENT_REJECTED', 'document', 'db_trigger',
        'document', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('type_code', new.type_code,
                           'previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception when others then
  raise warning 'business_event emission failed for document %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_document_events
  after insert or update on public.document
  for each row execute function public.emit_document_events();

-- 5.3 customs_record ---------------------------------------------------------
create or replace function public.emit_customs_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_RECORD_CREATED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.created_by,
      jsonb_build_object('required', new.required));
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'CUSTOMS_STATUS_CHANGED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    if new.status = 'DECLARED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_DECLARED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.declaration_number));
    elsif new.status = 'RELEASED' then
      perform public.emit_business_event(
        new.tenant_id, 'CUSTOMS_RELEASE_COMPLETED', 'customs', 'db_trigger',
        'customs_record', new.id, new.file_id, new.reviewed_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status,
                           'reference', new.bae_reference));
    end if;
  end if;

  -- BAE is its own milestone and does not always coincide with a status move.
  if new.bae_reference is not null and old.bae_reference is null then
    perform public.emit_business_event(
      new.tenant_id, 'BAE_RECORDED', 'customs', 'db_trigger',
      'customs_record', new.id, new.file_id, new.reviewed_by,
      jsonb_build_object('reference', new.bae_reference));
  end if;

  return null;
exception when others then
  raise warning 'business_event emission failed for customs_record %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_customs_events
  after insert or update on public.customs_record
  for each row execute function public.emit_customs_events();

-- 5.4 transport_record -------------------------------------------------------
create or replace function public.emit_transport_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_milestone text;
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'TRANSPORT_PLANNING_CREATED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.created_by, '{}'::jsonb);
    return null;
  end if;

  if new.status is distinct from old.status then
    perform public.emit_business_event(
      new.tenant_id, 'TRANSPORT_STATUS_CHANGED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by,
      jsonb_build_object('previous_status', old.status, 'new_status', new.status));

    v_milestone := case new.status
      when 'PLANNED'      then 'TRANSPORT_PLANNED'
      when 'PICKED_UP'    then 'PICKUP_CONFIRMED'
      when 'IN_TRANSIT'   then 'TRANSPORT_STARTED'
      when 'DELIVERED'    then 'DELIVERY_COMPLETED'
      when 'POD_RECEIVED' then 'POD_RECEIVED'
      else null
    end;

    if v_milestone is not null then
      perform public.emit_business_event(
        new.tenant_id, v_milestone, 'transport', 'db_trigger',
        'transport_record', new.id, new.file_id, new.assigned_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;

  -- Driver assignment is a distinct fact from the status ladder.
  if new.driver_name is not null and old.driver_name is null then
    perform public.emit_business_event(
      new.tenant_id, 'DRIVER_ASSIGNED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by, '{}'::jsonb);
  elsif new.driver_name is null and old.driver_name is not null then
    perform public.emit_business_event(
      new.tenant_id, 'DRIVER_UNASSIGNED', 'transport', 'db_trigger',
      'transport_record', new.id, new.file_id, new.assigned_by, '{}'::jsonb);
  end if;

  return null;
exception when others then
  raise warning 'business_event emission failed for transport_record %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_transport_events
  after insert or update on public.transport_record
  for each row execute function public.emit_transport_events();

-- 5.5 task -------------------------------------------------------------------
create or replace function public.emit_task_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.emit_business_event(
      new.tenant_id, 'TASK_CREATED', 'task', 'db_trigger',
      'task', new.id, new.file_id, new.created_by,
      jsonb_build_object('priority', new.priority));

  elsif new.status is distinct from old.status then
    -- actor NULL: `task` records assigned_to and created_by, but not who marked
    -- it done. Naming the assignee would be an inference, not a fact.
    if new.status = 'DONE' then
      perform public.emit_business_event(
        new.tenant_id, 'TASK_COMPLETED', 'task', 'db_trigger',
        'task', new.id, new.file_id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    elsif new.status = 'CANCELLED' then
      perform public.emit_business_event(
        new.tenant_id, 'TASK_CANCELLED', 'task', 'db_trigger',
        'task', new.id, new.file_id, null,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;
  end if;
  return null;
exception when others then
  raise warning 'business_event emission failed for task %: %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_task_events
  after insert or update on public.task
  for each row execute function public.emit_task_events();

-- 5.6 invoice / payment ------------------------------------------------------
create or replace function public.emit_finance_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'invoice' then
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'ISSUED' then
      perform public.emit_business_event(
        new.tenant_id, 'INVOICE_ISSUED', 'finance', 'db_trigger',
        'invoice', new.id, new.file_id, new.issued_by,
        jsonb_build_object('previous_status', old.status, 'new_status', new.status));
    end if;

  elsif tg_table_name = 'payment' and tg_op = 'INSERT' then
    -- The AMOUNT is not copied. `payment` stays the authority on money; an
    -- immutable second copy could drift from it and could never be corrected.
    perform public.emit_business_event(
      new.tenant_id, 'PAYMENT_RECORDED', 'finance', 'db_trigger',
      'payment', new.id,
      (select i.file_id from public.invoice i where i.id = new.invoice_id),
      new.recorded_by,
      jsonb_build_object('method', new.method));
  end if;
  return null;
exception when others then
  raise warning 'business_event emission failed for % %: %', tg_table_name, new.id, sqlerrm;
  return null;
end;
$$;

create trigger trg_emit_invoice_events
  after update on public.invoice
  for each row execute function public.emit_finance_events();

create trigger trg_emit_payment_events
  after insert on public.payment
  for each row execute function public.emit_finance_events();

-- ===========================================================================
-- 6. Policy activation events (WES-9J, pattern A).
--
--    activate_workflow_policy is already a security-definer RPC doing an atomic
--    retire-then-promote. Extending it is strictly better than a trigger here:
--    the RPC knows the ACTOR (passed in explicitly) and the REASON, and it can
--    emit the retirement and the activation as one causally-linked pair.
--
--    Replaced wholesale rather than patched — the body below is WES-7's,
--    unchanged except for the two emit calls and the causation link.
-- ===========================================================================
create or replace function public.activate_workflow_policy(
  p_version_id uuid,
  p_actor      uuid,
  p_reason     text,
  p_schema_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  v_retired uuid;
  v_activation uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'activation reason is required';
  end if;

  select * into v from public.workflow_policy_version where id = p_version_id for update;
  if not found then raise exception 'workflow policy version not found'; end if;

  -- Fail closed: only a validated, passing version of a KNOWN schema activates.
  if v.status <> 'VALIDATED' then
    raise exception 'only a VALIDATED version may be activated (found %)', v.status;
  end if;
  if v.validation_status <> 'PASSED' then
    raise exception 'version % has not passed validation', p_version_id;
  end if;
  if v.policy_schema_version <> p_schema_version then
    raise exception 'policy schema version mismatch: version declares %, platform expects %',
      v.policy_schema_version, p_schema_version;
  end if;

  -- Retire the current active version OF THE SAME SCOPE (NULL-safe comparison).
  update public.workflow_policy_version
     set status = 'RETIRED', retired_at = now()
   where status = 'ACTIVE'
     and tenant_id is not distinct from v.tenant_id
  returning id into v_retired;

  update public.workflow_policy_version
     set status            = 'ACTIVE',
         activated_at      = now(),
         activated_by      = p_actor,
         activation_reason = p_reason,
         effective_from    = coalesce(effective_from, now())
   where id = p_version_id;

  -- WES-9: configuration history, emitted inside the SAME transaction. A
  -- committed activation can never lack its event.
  --
  -- Platform-default activations (tenant_id IS NULL) are NOT emitted:
  -- business_event.tenant_id is NOT NULL, and attributing a platform-wide
  -- change to one arbitrary tenant would be false. Platform activations stay
  -- recorded in workflow_policy_version, which is already immutable.
  if v.tenant_id is not null then
    v_activation := public.emit_business_event(
      v.tenant_id, 'POLICY_ACTIVATED', 'policy', 'policy_rpc',
      'workflow_policy_version', p_version_id, null, p_actor,
      jsonb_build_object('scope', 'tenant', 'version', v.version));

    if v_retired is not null then
      -- Causation: the retirement happened BECAUSE of this activation.
      perform public.emit_business_event(
        v.tenant_id, 'POLICY_RETIRED', 'policy', 'policy_rpc',
        'workflow_policy_version', v_retired, null, p_actor,
        jsonb_build_object('scope', 'tenant', 'version', v.version),
        v_activation);
    end if;
  end if;

  return jsonb_build_object(
    'activated_id', p_version_id,
    'retired_id',   v_retired,
    'tenant_id',    v.tenant_id,
    'version',      v.version
  );
end; $$;

revoke execute on function public.activate_workflow_policy(uuid, uuid, text, int) from public;
grant execute on function public.activate_workflow_policy(uuid, uuid, text, int) to service_role;
