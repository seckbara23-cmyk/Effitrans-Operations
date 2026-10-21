-- migrate:executor db-query
-- ===========================================================================
-- Migration 161 — CEO-ALIGNMENT WP1-E: governed changes to a document's
-- expiry date.
-- ===========================================================================
-- CEO-010 — Abdoul's annotation on the SOP Interactif, step 6:
--
--     « Le declarant doit pouvoir inscrire ou mettre a jour les dates
--       d'echeances des documents (ex ; Dpi, Titre d'exo, sommiers etc.) »
--
-- (CEO-006 asks the same of the Account Manager at step 3.)
--
-- WHAT WAS WRONG BEFORE. A document's `expiry_date` could be set at upload and
-- never changed afterwards — a wrong date meant uploading a new version of
-- unchanged bytes. And nothing in the DATABASE governed it either:
-- `protect_decided_document()` freezes bytes, version, supersession and the
-- status of a superseded row, but not `expiry_date`. Any service-role update
-- could have rewritten the expiry of verified evidence silently.
--
-- WHAT THIS ADDS.
--   1. `document_expiry_change` — the append-only history of every change:
--      who, when, the value before and after, and why. Four kinds:
--        APPLIED    a direct change to an UNVERIFIED document
--        PROPOSED   a requested change to a VERIFIED document (changes nothing)
--        CONFIRMED  an independent approver applied a proposal
--        REJECTED   an independent approver refused a proposal
--      UPDATE and DELETE are refused by the foundation's `prevent_mutation()`,
--      the same function that makes `audit_log` append-only.
--   2. `record_document_expiry_change` / `decide_document_expiry_change` — the
--      only writers. SECURITY DEFINER, executable by the service role only,
--      and each re-proves its actor through `assert_actor_authority` (SERVICE
--      lane): `document:update` to change or propose, `document:approve` to
--      decide. The proposer can never decide their own proposal.
--   3. `trg_document_expiry_governed` on `document` — the control that makes
--      the history COMPLETE BY CONSTRUCTION rather than by convention: an
--      UPDATE that moves `expiry_date` is refused unless, in the SAME
--      transaction, a history row records exactly that move — and on a
--      verified document only a CONFIRMED row qualifies. A silent rewrite of
--      approved evidence becomes impossible, whoever holds the service key.
--
-- WHAT IT DOES NOT DO.
--   * No validity durations, no new document types, no `has_validity` change:
--     those are DEC-CEO-04/05, the Chef de Transit's to give.
--   * No change to `document.status`, ever — a corrected date is not a new
--     verification, and an approved document stays approved.
--   * No backfill: the history starts empty, and existing dates are left as
--     uploaded.
--   * No new permission: changing is `document:update`, deciding is
--     `document:approve`, both of which already exist.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The history.
-- ---------------------------------------------------------------------------
create table if not exists public.document_expiry_change (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  -- Denormalised from the document so the read policy can ask the dossier's
  -- own visibility rule (`can_read_file`) without a join.
  file_id      uuid not null references public.operational_file (id),
  document_id  uuid not null references public.document (id),
  kind         text not null
                 constraint document_expiry_change_kind
                 check (kind in ('APPLIED', 'PROPOSED', 'CONFIRMED', 'REJECTED')),
  -- A decision points at the proposal it decides; nothing else points anywhere.
  proposal_id  uuid references public.document_expiry_change (id),
  old_expiry   date,
  new_expiry   date,
  -- Mandatory for every kind except CONFIRMED: the proposal already carries
  -- the reason the approver is agreeing with.
  reason       text,
  actor_id     uuid not null references public.app_user (id),
  occurred_at  timestamptz not null default now(),

  constraint document_expiry_change_decision_links_proposal check (
    (kind in ('CONFIRMED', 'REJECTED')) = (proposal_id is not null)
  ),
  constraint document_expiry_change_reason check (
    kind = 'CONFIRMED'
    or (reason is not null and btrim(reason) <> '' and length(reason) <= 500)
  ),
  constraint document_expiry_change_reason_bounded check (
    reason is null or length(reason) <= 500
  ),
  -- A change that changes nothing is not a change.
  constraint document_expiry_change_moves check (
    old_expiry is distinct from new_expiry
  )
);

comment on table public.document_expiry_change is
  'CEO-ALIGNMENT WP1-E: append-only history of document expiry changes (APPLIED / PROPOSED / CONFIRMED / REJECTED). Written only by record_/decide_document_expiry_change; a document''s expiry_date cannot move without a matching row in the same transaction (trg_document_expiry_governed).';

create index if not exists idx_document_expiry_change_document
  on public.document_expiry_change (tenant_id, document_id, occurred_at desc);

-- One decision per proposal. The RPC also checks this under a row lock; the
-- index is what makes it true even if two deciders raced past the check.
create unique index if not exists uq_document_expiry_change_decision
  on public.document_expiry_change (proposal_id)
  where proposal_id is not null;

-- Append-only, with the SAME function that protects audit_log.
drop trigger if exists trg_document_expiry_change_no_update on public.document_expiry_change;
create trigger trg_document_expiry_change_no_update
  before update on public.document_expiry_change
  for each row execute function public.prevent_mutation();

drop trigger if exists trg_document_expiry_change_no_delete on public.document_expiry_change;
create trigger trg_document_expiry_change_no_delete
  before delete on public.document_expiry_change
  for each row execute function public.prevent_mutation();

-- Integrity: the row's tenant and dossier are the document's, never a caller's.
create or replace function public.check_document_expiry_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.document d
     where d.id = new.document_id
       and d.tenant_id = new.tenant_id
       and d.file_id = new.file_id
  ) then
    raise exception 'document_expiry_change: tenant or dossier does not match the document'
      using errcode = 'EFX02';
  end if;
  if new.proposal_id is not null and not exists (
    select 1 from public.document_expiry_change p
     where p.id = new.proposal_id
       and p.kind = 'PROPOSED'
       and p.document_id = new.document_id
  ) then
    raise exception 'document_expiry_change: a decision must decide a proposal on the same document'
      using errcode = 'EFX03';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_expiry_change_check on public.document_expiry_change;
create trigger trg_document_expiry_change_check
  before insert on public.document_expiry_change
  for each row execute function public.check_document_expiry_change();

-- ---------------------------------------------------------------------------
-- 2. Read access: the dossier's own visibility, and nothing more.
-- ---------------------------------------------------------------------------
-- No INSERT/UPDATE/DELETE policy: writes happen only inside the definer RPCs.
-- The client portal has no policy at all — the history explains internal
-- review decisions about the customer's evidence and is not addressed to them.
alter table public.document_expiry_change enable row level security;

drop policy if exists document_expiry_change_select on public.document_expiry_change;
create policy document_expiry_change_select on public.document_expiry_change
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('document:read')
    and public.can_read_file(file_id)
  );

grant select on public.document_expiry_change to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The governing control on `document`.
-- ---------------------------------------------------------------------------
-- `now()` is the TRANSACTION timestamp, so `occurred_at = now()` matches only a
-- history row written in the same transaction as this UPDATE. A row from an
-- earlier change cannot be replayed to license a later one.
create or replace function public.govern_document_expiry_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verified boolean;
  v_kind     text;
begin
  if new.expiry_date is not distinct from old.expiry_date then
    return new;
  end if;

  -- Verified evidence (and the legacy APPROVED spelling, and anything that was
  -- verified before being consumed or marked expired) needs an independent
  -- confirmation. Everything else needs the direct, reasoned change.
  v_verified := old.status in ('VERIFIED', 'APPROVED', 'CONSUMED_AS_EVIDENCE', 'EXPIRED');
  v_kind := case when v_verified then 'CONFIRMED' else 'APPLIED' end;

  if not exists (
    select 1 from public.document_expiry_change c
     where c.document_id = new.id
       and c.tenant_id   = new.tenant_id
       and c.kind        = v_kind
       and c.occurred_at = now()
       and c.old_expiry is not distinct from old.expiry_date
       and c.new_expiry is not distinct from new.expiry_date
  ) then
    raise exception
      'document: an expiry date changes only through its governed history (expected a % row in this transaction)',
      v_kind
      using errcode = 'EFX01';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_document_expiry_governed on public.document;
create trigger trg_document_expiry_governed
  before update of expiry_date on public.document
  for each row execute function public.govern_document_expiry_change();

-- ---------------------------------------------------------------------------
-- 4. The two writers.
-- ---------------------------------------------------------------------------
-- Result codes, not exceptions, for every refusal the operator can cause: the
-- server action maps each to a French sentence. Exceptions are reserved for
-- authority failures (assert_actor_authority) and broken invariants.

create or replace function public.record_document_expiry_change(
  p_document   uuid,
  p_tenant     uuid,
  p_actor      uuid,
  p_new_expiry date,
  p_reason     text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_doc      record;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_verified boolean;
begin
  perform public.assert_actor_authority(p_actor, p_tenant, 'document:update', 'SERVICE');

  if v_reason is null then return 'reason_required'; end if;
  if length(v_reason) > 500 then return 'reason_too_long'; end if;

  select d.id, d.file_id, d.status, d.expiry_date, d.superseded_by_id, d.deleted_at,
         t.has_validity
    into v_doc
    from public.document d
    join public.document_type t on t.code = d.type_code
   where d.id = p_document
     and d.tenant_id = p_tenant
     for update of d;
  if not found or v_doc.deleted_at is not null then return 'not_found'; end if;

  if v_doc.status = 'SUPERSEDED' or v_doc.superseded_by_id is not null then
    return 'document_superseded';
  end if;
  if p_new_expiry is null and v_doc.has_validity then return 'expiry_required'; end if;
  if p_new_expiry is not distinct from v_doc.expiry_date then return 'expiry_unchanged'; end if;

  -- One open proposal at a time per document. Checked under the row lock above,
  -- so two requesters serialise rather than both opening one.
  if exists (
    select 1 from public.document_expiry_change p
     where p.document_id = p_document
       and p.kind = 'PROPOSED'
       and not exists (select 1 from public.document_expiry_change d2 where d2.proposal_id = p.id)
  ) then
    return 'proposal_pending';
  end if;

  v_verified := v_doc.status in ('VERIFIED', 'APPROVED', 'CONSUMED_AS_EVIDENCE', 'EXPIRED');

  if v_verified then
    insert into public.document_expiry_change
      (tenant_id, file_id, document_id, kind, old_expiry, new_expiry, reason, actor_id)
    values
      (p_tenant, v_doc.file_id, p_document, 'PROPOSED', v_doc.expiry_date, p_new_expiry, v_reason, p_actor);
    return 'proposed';
  end if;

  insert into public.document_expiry_change
    (tenant_id, file_id, document_id, kind, old_expiry, new_expiry, reason, actor_id)
  values
    (p_tenant, v_doc.file_id, p_document, 'APPLIED', v_doc.expiry_date, p_new_expiry, v_reason, p_actor);

  update public.document
     set expiry_date = p_new_expiry
   where id = p_document
     and tenant_id = p_tenant;

  return 'applied';
end;
$$;

revoke execute on function public.record_document_expiry_change(uuid, uuid, uuid, date, text) from public;
revoke execute on function public.record_document_expiry_change(uuid, uuid, uuid, date, text) from anon;
revoke execute on function public.record_document_expiry_change(uuid, uuid, uuid, date, text) from authenticated;

create or replace function public.decide_document_expiry_change(
  p_proposal uuid,
  p_tenant   uuid,
  p_actor    uuid,
  p_decision text,
  p_reason   text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prop   record;
  v_doc    record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.assert_actor_authority(p_actor, p_tenant, 'document:approve', 'SERVICE');

  if p_decision is null or p_decision not in ('CONFIRMED', 'REJECTED') then
    return 'invalid_decision';
  end if;
  if p_decision = 'REJECTED' and v_reason is null then return 'reason_required'; end if;
  if v_reason is not null and length(v_reason) > 500 then return 'reason_too_long'; end if;

  select * into v_prop
    from public.document_expiry_change
   where id = p_proposal
     and tenant_id = p_tenant
     and kind = 'PROPOSED';
  if not found then return 'not_found'; end if;

  -- Maker ≠ checker, person-level, as everywhere on this platform.
  if v_prop.actor_id = p_actor then return 'self_approval_forbidden'; end if;

  select d.id, d.status, d.expiry_date, d.superseded_by_id, d.deleted_at
    into v_doc
    from public.document d
   where d.id = v_prop.document_id
     and d.tenant_id = p_tenant
     for update;
  if not found or v_doc.deleted_at is not null then return 'not_found'; end if;

  -- Under the lock: a second decider waits here, then sees the first decision.
  if exists (select 1 from public.document_expiry_change d2 where d2.proposal_id = p_proposal) then
    return 'already_decided';
  end if;

  if p_decision = 'REJECTED' then
    insert into public.document_expiry_change
      (tenant_id, file_id, document_id, kind, proposal_id, old_expiry, new_expiry, reason, actor_id)
    values
      (p_tenant, v_prop.file_id, v_prop.document_id, 'REJECTED', p_proposal,
       v_prop.old_expiry, v_prop.new_expiry, v_reason, p_actor);
    return 'rejected';
  end if;

  if v_doc.status = 'SUPERSEDED' or v_doc.superseded_by_id is not null then
    return 'document_superseded';
  end if;
  -- The date the proposal was made against must still be the date on file.
  if v_doc.expiry_date is distinct from v_prop.old_expiry then return 'proposal_stale'; end if;

  insert into public.document_expiry_change
    (tenant_id, file_id, document_id, kind, proposal_id, old_expiry, new_expiry, reason, actor_id)
  values
    (p_tenant, v_prop.file_id, v_prop.document_id, 'CONFIRMED', p_proposal,
     v_prop.old_expiry, v_prop.new_expiry, v_reason, p_actor);

  update public.document
     set expiry_date = v_prop.new_expiry
   where id = v_prop.document_id
     and tenant_id = p_tenant;

  return 'confirmed';
end;
$$;

revoke execute on function public.decide_document_expiry_change(uuid, uuid, uuid, text, text) from public;
revoke execute on function public.decide_document_expiry_change(uuid, uuid, uuid, text, text) from anon;
revoke execute on function public.decide_document_expiry_change(uuid, uuid, uuid, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-assertions, exercised at migration time.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.document_expiry_change') is null then
    raise exception 'MIGRATION FAILED: document_expiry_change not created';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'document_expiry_change'
       and policyname = 'document_expiry_change_select' and cmd = 'SELECT'
  ) then
    raise exception 'MIGRATION FAILED: the read policy is missing — the history must be visible to reviewers';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'document_expiry_change'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'MIGRATION FAILED: a write policy exists — writes belong to the definer RPCs only';
  end if;

  if (select count(*) from pg_trigger
       where tgrelid = 'public.document_expiry_change'::regclass
         and tgname in ('trg_document_expiry_change_no_update', 'trg_document_expiry_change_no_delete')) <> 2 then
    raise exception 'MIGRATION FAILED: the append-only triggers are not both present';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.document'::regclass and tgname = 'trg_document_expiry_governed'
  ) then
    raise exception 'MIGRATION FAILED: the governing trigger on document is missing';
  end if;

  raise notice 'WP1-E document expiry governance installed';
end $$;
