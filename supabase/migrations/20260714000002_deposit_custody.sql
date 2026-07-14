-- 20260714000002_deposit_custody.sql
-- Effitrans Operations Platform — PHASE 5.0D-3: physical deposit chain of custody.
-- ---------------------------------------------------------------------------
-- Official steps 22-25: Billing -> Administration -> Courier -> proof -> Collections.
--
-- WHY A CUSTODY TABLE (the brief said: only if the existing systems cannot carry
-- this safely). They cannot, and there is direct precedent for the one we add:
--
--   audit_log        a GENERAL governance log: free-text `action`, no FK to the
--                    deposit, no typed from/to status, no actor role, no source/
--                    destination department. Reconstructing a per-deposit custody
--                    timeline would mean string-prefix filtering a mixed log. It
--                    stays exactly as it is — the governance record — and every
--                    custody transition still writes to it.
--   process_handoff  models department-to-department STEP handoffs. It cannot
--                    express intra-deposit transitions (accept, decline, start,
--                    deposit, upload) which never cross a process step.
--
--   file_state_transition  ALREADY does precisely this for the dossier:
--                    append-only from_status/to_status/actor_id/occurred_at with an
--                    FK. invoice_deposit_event mirrors it. This is a pattern the
--                    codebase already has, not a new one.
--
-- No duplicate truth: invoice_deposit.status is the CURRENT state;
-- invoice_deposit_event is the immutable HISTORY. Custody is never inferred from
-- the current status alone.
--
-- CLEAN-REPLAY (822c0d7): no literal tenant-scoped insert here.

-- ===========================================================================
-- 1. Explicit physical-deposit configuration.
--    A deposit is required only when a client is EXPLICITLY configured for it.
--    Default false => most clients are email-only, and the closure gate reports
--    the deposit requirements as `notApplicable` rather than silently skipping.
-- ===========================================================================
alter table public.client
  add column if not exists requires_physical_invoice_deposit boolean not null default false;

comment on column public.client.requires_physical_invoice_deposit is
  'Phase 5.0D-3 — explicit configuration. When false the physical deposit chain is notApplicable for this client; it is NEVER implicitly skipped.';

-- ===========================================================================
-- 2. invoice_deposit — the columns the custody chain needs.
--    Explicit ACCEPTANCE is modelled as a timestamp rather than a new status:
--    the status enum stays exactly as shipped in 5.0D-1, and "assigned but not yet
--    accepted" is ASSIGNED + accepted_at is null. A courier must accept before a
--    deposit can start — assignment alone never starts anything.
-- ===========================================================================
alter table public.invoice_deposit
  add column if not exists accepted_at        timestamptz,
  add column if not exists declined_at        timestamptz,
  add column if not exists decline_reason     text,
  add column if not exists reassignment_reason text,
  add column if not exists package_reference  text,
  add column if not exists recipient_org      text,
  add column if not exists proof_submitted_at timestamptz;

-- ===========================================================================
-- 3. invoice_deposit_event — the immutable custody chain.
--    Every transition records who, when, from where, to where, and why.
-- ===========================================================================
create table public.invoice_deposit_event (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  file_id           uuid not null references public.operational_file (id) on delete cascade,
  invoice_id        uuid not null references public.invoice (id) on delete cascade,
  deposit_id        uuid not null references public.invoice_deposit (id) on delete cascade,
  -- What happened (a typed custody event, not a free-text action).
  event             text not null
                      check (event in ('WORKFLOW_CREATED', 'HANDED_TO_ADMIN', 'ADMIN_RECEIVED',
                                       'PACKAGE_PREPARED', 'COURIER_ASSIGNED', 'COURIER_REASSIGNED',
                                       'COURIER_ACCEPTED', 'COURIER_DECLINED', 'DEPOSIT_STARTED',
                                       'DEPOSIT_FAILED', 'INVOICE_DEPOSITED', 'PROOF_UPLOADED',
                                       'PROOF_SUBMITTED', 'PROOF_ACCEPTED', 'PROOF_REJECTED',
                                       'HANDED_TO_COLLECTIONS', 'CANCELLED')),
  from_status       text,
  to_status         text not null,
  actor_id          uuid references public.app_user (id),
  -- The role the actor was acting AS. A supervisor holding several roles must not
  -- make the chain ambiguous.
  actor_role_code   text,
  from_department   text,
  to_department     text,
  -- The process_handoff this transition corresponds to, when it crosses a step.
  handoff_id        uuid references public.process_handoff (id) on delete set null,
  -- Evidence for the transitions that require it (the proof document).
  evidence_document_id uuid references public.document (id) on delete set null,
  -- Rejection / decline / failure reason. Sanitized, bounded by the app layer.
  reason            text,
  occurred_at       timestamptz not null default now()
);

create index idx_deposit_event_deposit on public.invoice_deposit_event (deposit_id, occurred_at);
create index idx_deposit_event_tenant on public.invoice_deposit_event (tenant_id, occurred_at);
create index idx_deposit_event_invoice on public.invoice_deposit_event (invoice_id);

-- APPEND-ONLY. A custody event may never be rewritten or deleted: that is the
-- whole point of a chain of custody. Same prevent_mutation() the audit log uses.
create trigger trg_deposit_event_no_update before update on public.invoice_deposit_event
  for each row execute function public.prevent_mutation();
create trigger trg_deposit_event_no_delete before delete on public.invoice_deposit_event
  for each row execute function public.prevent_mutation();

-- Integrity: the event's tenant/file/invoice must match its deposit's, the actor
-- must belong to that tenant, and an evidence document must belong to the same
-- dossier. A borrowed proof from another file is impossible.
create or replace function public.enforce_deposit_event_integrity()
returns trigger language plpgsql as $$
declare
  d_tenant  uuid;
  d_file    uuid;
  d_invoice uuid;
  u_tenant  uuid;
  doc_tenant uuid;
  doc_file  uuid;
begin
  select tenant_id, file_id, invoice_id
    into d_tenant, d_file, d_invoice
    from public.invoice_deposit where id = new.deposit_id;

  if new.tenant_id is distinct from d_tenant then
    raise exception 'custody event tenant mismatch with deposit';
  end if;
  if new.file_id is distinct from d_file then
    raise exception 'custody event dossier mismatch with deposit';
  end if;
  if new.invoice_id is distinct from d_invoice then
    raise exception 'custody event invoice mismatch with deposit';
  end if;

  if new.actor_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.actor_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'custody event actor belongs to another tenant';
    end if;
  end if;

  if new.evidence_document_id is not null then
    select tenant_id, file_id into doc_tenant, doc_file
      from public.document where id = new.evidence_document_id;
    if doc_tenant is distinct from new.tenant_id then
      raise exception 'custody evidence belongs to another tenant';
    end if;
    if doc_file is distinct from new.file_id then
      raise exception 'custody evidence belongs to another dossier';
    end if;
  end if;

  return new;
end;
$$;
create trigger trg_deposit_event_integrity before insert on public.invoice_deposit_event
  for each row execute function public.enforce_deposit_event_integrity();

-- ===========================================================================
-- 4. RLS — SELECT-only, mirroring invoice_deposit exactly.
--    Administration and Collections see the tenant's chain; a COURIER sees only
--    the custody chain of a deposit assigned to THEM. A courier can therefore
--    never read another courier's history, and never a collection record.
-- ===========================================================================
alter table public.invoice_deposit_event enable row level security;

create policy invoice_deposit_event_select_admin on public.invoice_deposit_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('admin_service:manage')
  );

create policy invoice_deposit_event_select_collections on public.invoice_deposit_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('collections:manage')
  );

create policy invoice_deposit_event_select_courier on public.invoice_deposit_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('courier:deposit')
    and exists (
      select 1 from public.invoice_deposit d
      where d.id = invoice_deposit_event.deposit_id
        and d.tenant_id = public.auth_tenant_id()
        and d.courier_user_id = auth.uid()
    )
  );

grant select on public.invoice_deposit_event to authenticated;
