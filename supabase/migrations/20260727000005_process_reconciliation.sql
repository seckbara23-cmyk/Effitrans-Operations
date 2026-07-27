-- 20260727000005_process_reconciliation.sql
-- Effitrans Operations Platform — PHASE WES-5: module / process-engine reconciliation.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Implements the doctrine:
--
--     module facts → evidence evaluation → deterministic reconciliation
--     → process-step state → canonical projection → tasks and handoffs
--
-- ===========================================================================
-- THE TRANSACTIONALITY MODEL, STATED
-- ===========================================================================
-- Module facts are already atomic: WES-9/9A made every domain write commit with
-- its business event or not at all. Reconciliation is therefore CONVERGENT, not
-- inline: it runs after the fact, is idempotent, and every write IT makes is
-- atomic (step transition + evidence consumption + event in ONE transaction,
-- through the RPC below).
--
-- Consequences, honestly:
--   * a failed reconciliation run changes NOTHING — no partial workflow
--     history can exist, because each step transition is a single transaction;
--   * a crash between the module fact and reconciliation leaves the fact
--     recorded and the step briefly stale; the next run converges. That lag is
--     the accepted cost of not putting engine writes inside module RPCs, which
--     would weld every module to the engine schema;
--   * running reconciliation twice is a no-op: the RPC treats an already-
--     COMPLETED step as success without writing anything.
--
-- ===========================================================================
-- WHAT RECONCILIATION MAY NEVER DO (mirrors lib/process/reconcile/satisfaction.ts)
-- ===========================================================================
--   * complete a SUBMITTED step — a maker-checker review is pending, and
--     completing over it would bypass the checker. Enforced HERE, in SQL.
--   * touch APPROVED / REJECTED / CANCELLED — a human decision exists.
--   * regress anything. Forward-only; conflicts are reported, never resolved.
--   * invent an actor. The completing "actor" of a reconciled step is the
--     actor of the underlying module fact where known, else NULL with
--     RECONCILED provenance — never a fabricated person.

-- ===========================================================================
-- 1. Provenance on step executions.
--
--    A step completed by reconciliation must never read as a step a person
--    ticked. LEGACY_RECONCILED marks compatibility reconciliation of dossiers
--    whose history predates the engine (WES-5J): the STATE is observed today,
--    and the timestamp is the reconciliation time — no historical business
--    timestamp is claimed.
-- ===========================================================================
alter table public.process_step_execution
  add column if not exists completion_provenance text
    check (completion_provenance is null or completion_provenance in
      ('HUMAN', 'RECONCILED', 'LEGACY_RECONCILED')),
  -- Which fact proved it, as a stable code (e.g. CUSTOMS_RELEASED). Explains
  -- the completion forever, without re-deriving.
  add column if not exists reconciled_fact text;

-- ===========================================================================
-- 2. evidence_consumption — WES-5D, append-only.
--
--    Records the EXACT document version a step relied on. Plain uuids for the
--    same reason as every WES ledger: document and execution rows can be
--    cascade-deleted by their parents, and the record of "what we relied on"
--    must survive the thing it describes.
-- ===========================================================================
create table public.evidence_consumption (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  file_id            uuid,
  step_execution_id  uuid not null,
  step_key           text not null,
  document_id        uuid not null,
  document_version   int,
  content_sha256     text,
  policy_version_id  uuid references public.workflow_policy_version (id),
  consumed_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- One consumption per (execution, document): re-running reconciliation must
-- not stack duplicates. A DIFFERENT version of the same type is a different
-- document row, so corrections still record.
create unique index uq_evidence_consumption
  on public.evidence_consumption (step_execution_id, document_id);
create index idx_evidence_consumption_file
  on public.evidence_consumption (file_id, consumed_at desc) where file_id is not null;
create index idx_evidence_consumption_document
  on public.evidence_consumption (document_id);

comment on table public.evidence_consumption is
  'WES-5D: which exact document version satisfied which process step, under which '
  'pinned policy. Append-only; supersession of the document never erases this record.';

create trigger trg_evidence_consumption_no_update
  before update on public.evidence_consumption
  for each row execute function public.prevent_mutation();
create trigger trg_evidence_consumption_no_delete
  before delete on public.evidence_consumption
  for each row execute function public.prevent_mutation();

alter table public.evidence_consumption enable row level security;

create policy evidence_consumption_select on public.evidence_consumption
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and file_id is not null
    and public.can_read_file(file_id)
  );

grant select on public.evidence_consumption to authenticated;

-- ===========================================================================
-- 3. Event vocabulary: the process domain and the reconcile source.
-- ===========================================================================
alter table public.business_event drop constraint if exists business_event_event_domain_check;
alter table public.business_event
  add constraint business_event_event_domain_check
  check (event_domain in (
    'dossier', 'document', 'customs', 'transport',
    'task', 'handoff', 'finance', 'policy', 'ledger', 'process'));

alter table public.business_event drop constraint if exists business_event_source_check;
alter table public.business_event
  add constraint business_event_source_check
  check (source in ('db_trigger', 'policy_rpc', 'app_action', 'assignment_rpc',
                    'document_rpc', 'reconcile_rpc'));

-- ===========================================================================
-- 4. reconcile_step_completion — the atomic unit (WES-5E).
--
--    step transition + evidence consumption + business event = ONE transaction.
--    Idempotent by design: COMPLETED → returns already=true, writes nothing.
-- ===========================================================================
create or replace function public.reconcile_step_completion(
  p_execution_id     uuid,
  p_tenant_id        uuid,
  p_fact_code        text,
  p_actor            uuid default null,          -- the module fact's actor, when known
  p_evidence_doc_id  uuid default null,
  p_policy_id        uuid default null,
  p_legacy           boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_state    text;
  v_step_key text;
  v_file     uuid;
  v_doc_ver  int;
  v_doc_sha  text;
  v_now      timestamptz := now();
begin
  if coalesce(btrim(p_fact_code), '') = '' then
    raise exception 'a reconciliation must name the fact that proves the step';
  end if;

  select e.state, e.step_key, i.file_id
    into v_state, v_step_key, v_file
    from public.process_step_execution e
    join public.process_instance i on i.id = e.process_instance_id
   where e.id = p_execution_id and e.tenant_id = p_tenant_id
   for update of e;
  if not found then raise exception 'step execution not found'; end if;

  -- IDEMPOTENT: already done is success, not an error, and writes nothing.
  if v_state in ('COMPLETED', 'SKIPPED', 'APPROVED') then
    return jsonb_build_object('execution_id', p_execution_id, 'already', true);
  end if;

  -- NEVER over a pending review, never over a human decision.
  if v_state = 'SUBMITTED' then
    raise exception 'step % awaits maker-checker review; reconciliation must not bypass it', v_step_key;
  end if;
  if v_state in ('REJECTED', 'CANCELLED') then
    raise exception 'step % carries a human decision (%); reconciliation cannot override it', v_step_key, v_state;
  end if;

  update public.process_step_execution
     set state = 'COMPLETED',
         completed_at = v_now,
         completion_provenance = case when p_legacy then 'LEGACY_RECONCILED' else 'RECONCILED' end,
         reconciled_fact = p_fact_code
   where id = p_execution_id;

  -- WES-5D: consume the exact evidence version, once.
  if p_evidence_doc_id is not null then
    select version, content_sha256 into v_doc_ver, v_doc_sha
      from public.document where id = p_evidence_doc_id;

    insert into public.evidence_consumption (
      tenant_id, file_id, step_execution_id, step_key,
      document_id, document_version, content_sha256, policy_version_id)
    values (
      p_tenant_id, v_file, p_execution_id, v_step_key,
      p_evidence_doc_id, v_doc_ver, v_doc_sha, p_policy_id)
    on conflict (step_execution_id, document_id) do nothing;

    -- The document now carries its consumed state. Forward-only: VERIFIED (or
    -- the legacy alias) → CONSUMED_AS_EVIDENCE; anything else is left alone.
    update public.document
       set status = 'CONSUMED_AS_EVIDENCE'
     where id = p_evidence_doc_id
       and status in ('VERIFIED', 'APPROVED');

    perform public.emit_business_event(
      p_tenant_id, 'EVIDENCE_CONSUMED', 'process', 'reconcile_rpc',
      'document', p_evidence_doc_id, v_file, p_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'workflow_step_key', v_step_key,
        'artifact_version', v_doc_ver)));
  end if;

  perform public.emit_business_event(
    p_tenant_id, 'PROCESS_STEP_COMPLETED', 'process', 'reconcile_rpc',
    'process_step_execution', p_execution_id, v_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'workflow_step_key', v_step_key,
      'reason_code', p_fact_code,
      'is_override', nullif(coalesce(p_legacy, false), false))));

  return jsonb_build_object(
    'execution_id', p_execution_id, 'step_key', v_step_key,
    'file_id', v_file, 'already', false);
end; $$;

revoke execute on function public.reconcile_step_completion(uuid, uuid, text, uuid, uuid, uuid, boolean) from public;
grant execute on function public.reconcile_step_completion(uuid, uuid, text, uuid, uuid, uuid, boolean) to service_role;
