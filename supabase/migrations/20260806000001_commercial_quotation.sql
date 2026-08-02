-- 20260806000001_commercial_quotation.sql
-- Effitrans — EC-3B: Commercial / Quotation foundation (dark).
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 82. Migrations 1–81 untouched.
--
-- EIGHT RULES THIS MIGRATION ENCODES, EACH ONE FROZEN IN EC-3A:
--
-- 1. MAKER-CHECKER IS STRUCTURAL. `validated_by <> prepared_by` is a CHECK, not
--    a convention and not a role rule — role separation fails the moment one
--    person holds both seats. Precedent: contract_verifier_differs (HR-3),
--    evaluation_finalizer_differs_from_manager (HR-6).
--
-- 2. ACT 2 GETS THE PERMISSION IT NEVER HAD. The EC-3A audit found that
--    `quotation:approve` means "record the CLIENT'S approval" (its shipped
--    description, corroborated by the process registry's client_approval_actor
--    evidence) — so INTERNAL validation was unrepresented. `quotation:validate`
--    is added here, catalogued and GRANTED TO NOBODY.
--    The existing blanket grant of create+send+approve to SYSTEM_ADMIN,
--    OPS_SUPERVISOR and QUOTATION_MANAGER is REVOKED (§2): it was a Phase-5.0D
--    placeholder that never distinguished the verbs, and SYSTEM_ADMIN must hold
--    none of the four (DEC-B25 doctrine applied to commercial authority).
--
-- 3. NO PRICING RULE, NO TAX RULE, NO STATUTORY VALUE. A line carries a
--    description, a quantity, a unit amount and a tax RATE FIELD defaulting to
--    ZERO. No rate is defaulted, no cascade is encoded, no total is mandated,
--    and nothing here knows what TVA or CA are. A quotation must render
--    correctly with no tax line at all.
--
-- 4. INTEGER MINOR UNITS ONLY. Money is `bigint` minor units (XOF centimes);
--    the tax rate is integer BASIS POINTS. No numeric, no float, anywhere.
--    Finance's numeric(14,2) columns are converted at the boundary, in the
--    conversion step (EC-3D) — never here.
--
-- 5. A SENT QUOTATION IS IMMUTABLE. Revision = a NEW VERSION row; the previous
--    row survives as SUPERSEDED and stays permanently visible. Only ONE
--    non-terminal version may exist per request (partial unique index), so
--    "only the latest active version may be accepted" is a database fact.
--
-- 6. ACCEPTANCE IS EVIDENCE, NEVER INFERRED. Three ratified kinds; a recorded
--    actor and date; optional document and optional inbound-message reference.
--    Nothing in this schema can derive acceptance from a message arriving.
--
-- 7. COMMERCIAL OWNS NO DOSSIER, NO INVOICE, NO COMMUNICATION. The only foreign
--    keys leaving this context point at organization, app_user, client, and —
--    for evidence only — ec_inbound_message and document. Conversion writes
--    `converted_file_id` as a RECORD of what Operations created; it does not
--    create it. There is no invoice reference and no billing table touched.
--
-- 8. EVERY TRANSITION EMITS. The RPCs below change state and emit the timeline
--    event in ONE transaction (ADR-HR2-01 as hardened since HR-4).
--
-- Dark: the new permission is granted to nobody, so every action denies
-- everyone until RATIFY-EC3-1.

-- ===========================================================================
-- 1. EVENT VOCABULARY — add the `commercial` domain (WES-5 precedent).
-- ===========================================================================
alter table public.business_event drop constraint if exists business_event_event_domain_check;
alter table public.business_event
  add constraint business_event_event_domain_check
  check (event_domain in (
    'dossier', 'document', 'customs', 'transport',
    'task', 'handoff', 'finance', 'policy', 'ledger', 'process',
    'communication',
    -- EC-3B: the commercial offer that precedes the dossier.
    'commercial'));

-- ===========================================================================
-- 2. PERMISSIONS — add act 2; REVOKE the placeholder blanket grant.
--
--    The revoke is deliberate and safe: no quotation module has ever existed
--    (0 tables until this migration), so the grant governs nothing today. It is
--    corrected now precisely because it is dormant — correcting a live
--    authority would be a different, riskier conversation.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('quotation:validate', 'quotation', 'validate', 'all',
   'Valider une cotation en interne avant envoi (autorité distincte de la préparation)')
on conflict (code) do nothing;

-- Correct the misleading description of the EXISTING code. Its meaning is
-- unchanged — recording the CLIENT'S acceptance — but the wording invited the
-- reading that it was an internal approval. The CODE is deliberately not
-- renamed: it is referenced by the process registry and the role templates,
-- and a rename is a high-blast-radius change for a cosmetic gain.
update public.permission
   set description = 'Enregistrer l''acceptation du client (preuve), jamais une validation interne'
 where code = 'quotation:approve';

-- Withdraw the Phase-5.0D placeholder grant from every role that holds it.
-- Re-granting is a ratification step (RATIFY-EC3-1), not a migration.
delete from public.role_permission rp
 using public.permission p
 where p.id = rp.permission_id
   and p.code in ('quotation:create', 'quotation:send', 'quotation:approve');

-- ===========================================================================
-- 3. NUMBERING — the SIXTH instance of the established counter pattern.
--    Deliberately NOT generalised into a shared engine: that refactor would
--    touch invoice numbering, and invoice numbers are accounting artifacts.
--    Also deliberately WITHOUT a hardcoded tenant prefix — next_invoice_number
--    bakes in 'EFT-', which is wrong in a multi-tenant platform. 'DEV' is a
--    document-type abbreviation (devis), not a tenant name.
-- ===========================================================================
create table if not exists public.quotation_counter (
  tenant_id uuid not null references public.organization (id),
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.quotation_counter enable row level security;

create or replace function public.next_quotation_number(p_tenant uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_year int := extract(year from now())::int; v_seq int;
begin
  insert into public.quotation_counter (tenant_id, year, next_seq)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year)
    do update set next_seq = quotation_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'DEV-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
end $$;

revoke execute on function public.next_quotation_number(uuid) from public;
grant execute on function public.next_quotation_number(uuid) to service_role;

-- ===========================================================================
-- 4. QUOTATION REQUEST — the pre-dossier commercial entity (EC-2's handoff
--    finally has somewhere to land). It references the triage item as
--    PROVENANCE; EC keeps owning the correspondence.
--
--    client_id is NOT NULL, deliberately: conversion needs a client
--    (operational_file.client_id is NOT NULL), and relaxing a NOT NULL later is
--    trivial while tightening one is not. Whether a quotation may address a
--    PROSPECT who is not yet a client remains MD-Q13 — unanswered, so the
--    conservative, reversible choice is taken.
-- ===========================================================================
create table if not exists public.quotation_request (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.organization (id),
  client_id       uuid not null references public.client (id),
  reference       text,
  subject         text,
  -- Provenance when the request came from triaged correspondence. A reference,
  -- never a copy: EC owns the message.
  triage_item_id  uuid references public.ec_triage_item (id),
  status          text not null default 'OPEN'
                    check (status in ('OPEN', 'QUOTED', 'WON', 'LOST', 'ABANDONED')),
  opened_by       uuid references public.app_user (id),
  closed_at       timestamptz,
  closure_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_quotation_request_tenant
  on public.quotation_request (tenant_id, status, created_at desc);
create index if not exists idx_quotation_request_client
  on public.quotation_request (tenant_id, client_id);
create index if not exists idx_quotation_request_triage
  on public.quotation_request (triage_item_id) where triage_item_id is not null;
drop trigger if exists trg_quotation_request_updated_at on public.quotation_request;
create trigger trg_quotation_request_updated_at before update on public.quotation_request
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 5. QUOTATION — versioned, maker-checked, immutable once sent.
-- ===========================================================================
create table if not exists public.quotation (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  request_id         uuid not null references public.quotation_request (id),
  client_id          uuid not null references public.client (id),
  quotation_number   text,                                   -- null until sent
  version            int  not null default 1 check (version >= 1),
  supersedes_id      uuid references public.quotation (id),

  status             text not null default 'DRAFT'
                       check (status in ('DRAFT', 'PENDING_VALIDATION', 'VALIDATED',
                                         'SENT', 'ACCEPTED', 'DECLINED',
                                         'SUPERSEDED', 'CANCELLED', 'CONVERTED')),

  -- Currency: the existing convention (text, XOF default). No currency table,
  -- no FX — nothing in the platform converts between currencies.
  currency           text not null default 'XOF',
  -- Free-text commercial terms. NEVER a computed total, never a tax rule.
  terms              text,
  validity_note      text,   -- rule 4 of EC-3A: NO expiry date, no scheduler.

  -- Act 1 — prepare.
  prepared_by        uuid references public.app_user (id),
  submitted_at       timestamptz,
  -- Act 2 — internal validation (the permission that did not exist).
  validated_by       uuid references public.app_user (id),
  validated_at       timestamptz,
  rejection_reason_code text,
  -- Act 3 — send.
  sent_by            uuid references public.app_user (id),
  sent_at            timestamptz,
  -- Act 4 — record the CUSTOMER's acceptance. Evidence, never inference.
  acceptance_kind    text check (acceptance_kind is null or acceptance_kind in
                       ('SIGNED_QUOTATION', 'EMAIL', 'WRITTEN_AGREEMENT')),
  accepted_on        date,
  acceptance_recorded_by uuid references public.app_user (id),
  -- Optional evidence. Both are REFERENCES to contexts that own them.
  acceptance_document_id uuid references public.document (id),
  acceptance_message_id  uuid references public.ec_inbound_message (id),
  declined_on        date,
  decline_reason_code text,

  -- Conversion RECORD. Operations creates the dossier; this remembers which.
  converted_file_id  uuid references public.operational_file (id),
  converted_at       timestamptz,
  converted_by       uuid references public.app_user (id),

  cancelled_at       timestamptz,
  cancellation_reason_code text,

  -- The generated PDF, kept with the immutable-artifact discipline. NOT a
  -- public.document row: that table requires a dossier (file_id NOT NULL) and a
  -- quotation exists before any dossier. Registration into the governed
  -- registry happens at conversion, when a dossier exists (EC-3D).
  artifact_storage_path text,
  artifact_sha256       text,
  artifact_renderer_version text,
  artifact_generated_at timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- RULE 1 — maker-checker, structural.
  constraint quotation_validator_differs
    check (validated_by is null or prepared_by is null or validated_by <> prepared_by),
  constraint quotation_validated_has_actor
    check (status <> 'VALIDATED' or (validated_by is not null and validated_at is not null)),
  constraint quotation_sent_has_number
    check (status not in ('SENT','ACCEPTED','DECLINED','CONVERTED')
           or (quotation_number is not null and sent_at is not null)),
  -- RULE 6 — acceptance carries its evidence kind, its date and its recorder.
  constraint quotation_accepted_has_evidence
    check (status <> 'ACCEPTED'
           or (acceptance_kind is not null and accepted_on is not null
               and acceptance_recorded_by is not null)),
  constraint quotation_declined_has_date
    check (status <> 'DECLINED' or declined_on is not null),
  constraint quotation_converted_has_file
    check (status <> 'CONVERTED'
           or (converted_file_id is not null and converted_at is not null)),
  constraint quotation_cancelled_has_reason
    check (status <> 'CANCELLED'
           or coalesce(btrim(cancellation_reason_code), '') <> ''),
  constraint quotation_supersedes_not_self
    check (supersedes_id is null or supersedes_id <> id),
  unique (tenant_id, quotation_number),
  unique (request_id, version)
);

create index if not exists idx_quotation_request on public.quotation (request_id, version desc);
create index if not exists idx_quotation_tenant_status on public.quotation (tenant_id, status);
create index if not exists idx_quotation_client on public.quotation (tenant_id, client_id);
create index if not exists idx_quotation_converted
  on public.quotation (converted_file_id) where converted_file_id is not null;

-- RULE 5 — at most ONE non-terminal version per request, so "only the latest
-- active version may be accepted" is enforced rather than hoped for.
create unique index if not exists uq_quotation_one_live_version
  on public.quotation (request_id)
  where status in ('DRAFT','PENDING_VALIDATION','VALIDATED','SENT');

-- One dossier may originate from at most one quotation.
create unique index if not exists uq_quotation_converted_file
  on public.quotation (converted_file_id) where converted_file_id is not null;

drop trigger if exists trg_quotation_updated_at on public.quotation;
create trigger trg_quotation_updated_at before update on public.quotation
  for each row execute function public.set_updated_at();

-- RULE 5 — a SENT quotation is customer-facing evidence. After SENT, the
-- commercial content is frozen: only the outcome fields may still move.
create or replace function public.quotation_immutable_once_sent()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('SENT','ACCEPTED','DECLINED','SUPERSEDED','CANCELLED','CONVERTED') then
    if new.currency         is distinct from old.currency
       or new.terms         is distinct from old.terms
       or new.validity_note is distinct from old.validity_note
       or new.client_id     is distinct from old.client_id
       or new.request_id    is distinct from old.request_id
       or new.version       is distinct from old.version
       or new.quotation_number is distinct from old.quotation_number
       or new.prepared_by   is distinct from old.prepared_by
       or new.validated_by  is distinct from old.validated_by
       or new.artifact_sha256 is distinct from old.artifact_sha256 then
      raise exception 'une cotation envoyée est immuable' using errcode = 'QT610';
    end if;
  end if;
  if old.status in ('SUPERSEDED','CANCELLED','CONVERTED')
     and new.status is distinct from old.status then
    raise exception 'une cotation % est terminale', old.status using errcode = 'QT611';
  end if;
  return new;
end $$;
drop trigger if exists trg_quotation_immutable on public.quotation;
create trigger trg_quotation_immutable before update on public.quotation
  for each row execute function public.quotation_immutable_once_sent();

-- ===========================================================================
-- 6. QUOTATION LINE — the shape reused from invoice_line/billing_charge, in
--    INTEGER MINOR UNITS (rule 4). Nothing computes a total here: a total is a
--    presentation concern until pricing and tax rules are ratified.
-- ===========================================================================
create table if not exists public.quotation_line (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  quotation_id   uuid not null references public.quotation (id) on delete cascade,
  position       int  not null default 1 check (position >= 1),
  description    text not null,
  -- Quantity in THOUSANDTHS, so 1.5 units is 1500 — integer, like day_tenths.
  quantity_milli bigint not null default 1000 check (quantity_milli > 0),
  -- Unit price in MINOR UNITS (XOF centimes). Integer. Never numeric.
  unit_amount_minor bigint not null default 0 check (unit_amount_minor >= 0),
  -- Tax RATE in basis points. Defaults to ZERO: the platform encodes no tax
  -- rule, and a quotation must render correctly with no tax at all (rule 3).
  tax_rate_bp    int not null default 0 check (tax_rate_bp >= 0 and tax_rate_bp <= 100000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (quotation_id, position)
);
create index if not exists idx_quotation_line_quotation on public.quotation_line (quotation_id);
drop trigger if exists trg_quotation_line_updated_at on public.quotation_line;
create trigger trg_quotation_line_updated_at before update on public.quotation_line
  for each row execute function public.set_updated_at();

-- Lines follow their quotation: once it is sent, they are frozen.
create or replace function public.quotation_line_frozen_guard()
returns trigger
language plpgsql
as $$
declare v_status text; v_q uuid;
begin
  v_q := coalesce(new.quotation_id, old.quotation_id);
  select status into v_status from public.quotation where id = v_q;
  if v_status in ('SENT','ACCEPTED','DECLINED','SUPERSEDED','CANCELLED','CONVERTED') then
    raise exception 'les lignes d''une cotation envoyée sont immuables' using errcode = 'QT612';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_quotation_line_frozen on public.quotation_line;
create trigger trg_quotation_line_frozen
  before insert or update or delete on public.quotation_line
  for each row execute function public.quotation_line_frozen_guard();

-- ===========================================================================
-- 7. TRANSACTIONAL RPCs — state change + timeline event, together or not at
--    all. Authorization is checked by the APPLICATION; service-role only.
-- ===========================================================================

-- Act 1a — create the first version of a quotation for a request.
-- An RPC rather than a plain INSERT so the row and its creation event commit
-- TOGETHER: an application-level insert-then-emit is two round trips and cannot
-- claim the registry's "rpc" guarantee, which is a statement about how much the
-- event can be trusted.
create or replace function public.quotation_create(
  p_tenant uuid, p_request uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_client uuid; v_id uuid;
begin
  select client_id into v_client from public.quotation_request
   where id = p_request and tenant_id = p_tenant;
  if v_client is null then
    raise exception 'demande de cotation introuvable' using errcode = 'QT600';
  end if;

  insert into public.quotation (tenant_id, request_id, client_id, version, status, prepared_by)
  values (p_tenant, p_request, v_client, 1, 'DRAFT', p_actor)
  returning id into v_id;

  perform public.emit_business_event(
    p_tenant, 'QUOTATION_CREATED', 'commercial', 'policy_rpc',
    'quotation', v_id, null, p_actor,
    jsonb_build_object('quotation_id', v_id, 'request_id', p_request));
  return v_id;
end $$;

-- Act 1 — submit for validation.
create or replace function public.quotation_submit(
  p_tenant uuid, p_quotation uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_lines int; v_request uuid;
begin
  select status, request_id into v_status, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status <> 'DRAFT' then
    raise exception 'seule une cotation en brouillon peut être soumise' using errcode = 'QT602';
  end if;
  select count(*) into v_lines from public.quotation_line where quotation_id = p_quotation;
  if v_lines = 0 then
    raise exception 'une cotation doit comporter au moins une ligne' using errcode = 'QT603';
  end if;

  update public.quotation
     set status = 'PENDING_VALIDATION', prepared_by = coalesce(prepared_by, p_actor),
         submitted_at = now()
   where id = p_quotation;

  perform public.emit_business_event(
    p_tenant, 'QUOTATION_SUBMITTED', 'commercial', 'policy_rpc',
    'quotation', p_quotation, null, p_actor,
    jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request));
  return p_quotation;
end $$;

-- Act 2 — internal validation. THE maker-checker gate.
create or replace function public.quotation_validate(
  p_tenant uuid, p_quotation uuid, p_actor uuid,
  p_decision text, p_reason_code text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_prepared uuid; v_request uuid;
begin
  if p_decision not in ('VALIDATED','REJECTED') then
    raise exception 'décision de validation invalide' using errcode = 'QT604';
  end if;
  select status, prepared_by, request_id into v_status, v_prepared, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status <> 'PENDING_VALIDATION' then
    raise exception 'cette cotation n''est pas en attente de validation' using errcode = 'QT605';
  end if;
  -- RULE 1, enforced here with a named error as well as by the CHECK.
  if v_prepared is not null and v_prepared = p_actor then
    raise exception 'séparation des tâches : le validateur doit différer du préparateur'
      using errcode = 'QT606';
  end if;

  if p_decision = 'VALIDATED' then
    update public.quotation
       set status = 'VALIDATED', validated_by = p_actor, validated_at = now()
     where id = p_quotation;
    perform public.emit_business_event(
      p_tenant, 'QUOTATION_VALIDATED', 'commercial', 'policy_rpc',
      'quotation', p_quotation, null, p_actor,
      jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request));
  else
    if coalesce(btrim(p_reason_code), '') = '' then
      raise exception 'motif de rejet obligatoire' using errcode = 'QT607';
    end if;
    update public.quotation
       set status = 'DRAFT', rejection_reason_code = btrim(p_reason_code)
     where id = p_quotation;
    perform public.emit_business_event(
      p_tenant, 'QUOTATION_REJECTED', 'commercial', 'policy_rpc',
      'quotation', p_quotation, null, p_actor,
      jsonb_build_object('quotation_id', p_quotation, 'reason_code', btrim(p_reason_code)));
  end if;
  return p_quotation;
end $$;

-- Act 3 — send. Mints the number; the quotation becomes immutable evidence.
create or replace function public.quotation_send(
  p_tenant uuid, p_quotation uuid, p_actor uuid)
returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_number text; v_request uuid;
begin
  select status, quotation_number, request_id into v_status, v_number, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status <> 'VALIDATED' then
    raise exception 'seule une cotation validée peut être envoyée' using errcode = 'QT608';
  end if;

  if v_number is null then
    v_number := public.next_quotation_number(p_tenant);
  end if;

  update public.quotation
     set status = 'SENT', quotation_number = v_number, sent_by = p_actor, sent_at = now()
   where id = p_quotation;

  update public.quotation_request set status = 'QUOTED'
   where id = v_request and status = 'OPEN';

  perform public.emit_business_event(
    p_tenant, 'QUOTATION_SENT', 'commercial', 'policy_rpc',
    'quotation', p_quotation, null, p_actor,
    jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request));
  return v_number;
end $$;

-- Act 4 — record the CUSTOMER's decision. Evidence in, never inference.
create or replace function public.quotation_record_decision(
  p_tenant uuid, p_quotation uuid, p_actor uuid, p_decision text,
  p_acceptance_kind text default null, p_on date default null,
  p_document uuid default null, p_message uuid default null,
  p_reason_code text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_request uuid;
begin
  if p_decision not in ('ACCEPTED','DECLINED') then
    raise exception 'décision client invalide' using errcode = 'QT604';
  end if;
  select status, request_id into v_status, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status <> 'SENT' then
    raise exception 'seule une cotation envoyée peut recevoir une décision client'
      using errcode = 'QT609';
  end if;

  if p_decision = 'ACCEPTED' then
    if p_acceptance_kind not in ('SIGNED_QUOTATION','EMAIL','WRITTEN_AGREEMENT') then
      raise exception 'type de preuve d''acceptation invalide' using errcode = 'QT613';
    end if;
    update public.quotation
       set status = 'ACCEPTED', acceptance_kind = p_acceptance_kind,
           accepted_on = coalesce(p_on, current_date),
           acceptance_recorded_by = p_actor,
           acceptance_document_id = p_document,
           acceptance_message_id = p_message
     where id = p_quotation;
    update public.quotation_request set status = 'WON' where id = v_request;
    perform public.emit_business_event(
      p_tenant, 'QUOTATION_ACCEPTED', 'commercial', 'policy_rpc',
      'quotation', p_quotation, null, p_actor,
      jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request,
                         'acceptance_kind', p_acceptance_kind));
  else
    update public.quotation
       set status = 'DECLINED', declined_on = coalesce(p_on, current_date),
           decline_reason_code = nullif(btrim(coalesce(p_reason_code,'')), '')
     where id = p_quotation;
    update public.quotation_request set status = 'LOST', closed_at = now() where id = v_request;
    perform public.emit_business_event(
      p_tenant, 'QUOTATION_DECLINED', 'commercial', 'policy_rpc',
      'quotation', p_quotation, null, p_actor,
      jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request));
  end if;
  return p_quotation;
end $$;

-- RULE 5 — revision. A NEW version row; the old one becomes SUPERSEDED and
-- stays permanently visible. Lines are copied so the new version starts from
-- the previous one rather than from nothing.
create or replace function public.quotation_revise(
  p_tenant uuid, p_quotation uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old record; v_new uuid;
begin
  select * into v_old from public.quotation
   where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_old.status in ('SUPERSEDED','CANCELLED','CONVERTED','ACCEPTED') then
    raise exception 'cette cotation ne peut plus être révisée' using errcode = 'QT614';
  end if;

  -- Close the old one FIRST, so the one-live-version index is never violated.
  update public.quotation set status = 'SUPERSEDED' where id = p_quotation;

  insert into public.quotation (
    tenant_id, request_id, client_id, version, supersedes_id, status,
    currency, terms, validity_note, prepared_by)
  values (
    p_tenant, v_old.request_id, v_old.client_id, v_old.version + 1, p_quotation, 'DRAFT',
    v_old.currency, v_old.terms, v_old.validity_note, p_actor)
  returning id into v_new;

  insert into public.quotation_line
    (tenant_id, quotation_id, position, description, quantity_milli, unit_amount_minor, tax_rate_bp)
  select tenant_id, v_new, position, description, quantity_milli, unit_amount_minor, tax_rate_bp
    from public.quotation_line where quotation_id = p_quotation
   order by position;

  perform public.emit_business_event(
    p_tenant, 'QUOTATION_REVISED', 'commercial', 'policy_rpc',
    'quotation', v_new, null, p_actor,
    jsonb_build_object('quotation_id', v_new, 'supersedes_id', p_quotation,
                       'request_id', v_old.request_id));
  return v_new;
end $$;

-- Governed cancellation, from any non-terminal state.
create or replace function public.quotation_cancel(
  p_tenant uuid, p_quotation uuid, p_actor uuid, p_reason_code text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_request uuid;
begin
  if coalesce(btrim(p_reason_code), '') = '' then
    raise exception 'motif d''annulation obligatoire' using errcode = 'QT615';
  end if;
  select status, request_id into v_status, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status in ('SUPERSEDED','CANCELLED','CONVERTED') then
    raise exception 'cotation déjà terminale' using errcode = 'QT611';
  end if;

  update public.quotation
     set status = 'CANCELLED', cancelled_at = now(),
         cancellation_reason_code = btrim(p_reason_code)
   where id = p_quotation;

  perform public.emit_business_event(
    p_tenant, 'QUOTATION_CANCELLED', 'commercial', 'policy_rpc',
    'quotation', p_quotation, null, p_actor,
    jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request,
                       'reason_code', btrim(p_reason_code)));
  return p_quotation;
end $$;

-- Conversion RECORD. Operations creates the dossier and passes its id here;
-- this function records the link and emits the keystone event. It deliberately
-- does NOT insert into operational_file — Commercial owns no dossier (rule 7).
create or replace function public.quotation_record_conversion(
  p_tenant uuid, p_quotation uuid, p_actor uuid, p_file uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_status text; v_request uuid; v_file uuid;
begin
  select status, request_id into v_status, v_request
    from public.quotation where id = p_quotation and tenant_id = p_tenant for update;
  if not found then raise exception 'cotation introuvable' using errcode = 'QT601'; end if;
  if v_status <> 'ACCEPTED' then
    raise exception 'seule une cotation acceptée peut être convertie' using errcode = 'QT616';
  end if;
  select id into v_file from public.operational_file
   where id = p_file and tenant_id = p_tenant;
  if v_file is null then
    raise exception 'dossier introuvable dans ce tenant' using errcode = 'QT617';
  end if;

  update public.quotation
     set status = 'CONVERTED', converted_file_id = v_file,
         converted_at = now(), converted_by = p_actor
   where id = p_quotation;

  -- THE keystone event: the DOSSIER is the subject, so the shipment's timeline
  -- begins with its commercial provenance and Tracking never queries a
  -- Commercial table to learn it.
  perform public.emit_business_event(
    p_tenant, 'QUOTATION_CONVERTED_TO_DOSSIER', 'commercial', 'policy_rpc',
    'operational_file', v_file, v_file, p_actor,
    jsonb_build_object('quotation_id', p_quotation, 'request_id', v_request));
  return p_quotation;
end $$;

revoke execute on function public.quotation_create(uuid,uuid,uuid) from public;
revoke execute on function public.quotation_submit(uuid,uuid,uuid) from public;
revoke execute on function public.quotation_validate(uuid,uuid,uuid,text,text) from public;
revoke execute on function public.quotation_send(uuid,uuid,uuid) from public;
revoke execute on function public.quotation_record_decision(uuid,uuid,uuid,text,text,date,uuid,uuid,text) from public;
revoke execute on function public.quotation_revise(uuid,uuid,uuid) from public;
revoke execute on function public.quotation_cancel(uuid,uuid,uuid,text) from public;
revoke execute on function public.quotation_record_conversion(uuid,uuid,uuid,uuid) from public;
grant execute on function public.quotation_create(uuid,uuid,uuid) to service_role;
grant execute on function public.quotation_submit(uuid,uuid,uuid) to service_role;
grant execute on function public.quotation_validate(uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.quotation_send(uuid,uuid,uuid) to service_role;
grant execute on function public.quotation_record_decision(uuid,uuid,uuid,text,text,date,uuid,uuid,text) to service_role;
grant execute on function public.quotation_revise(uuid,uuid,uuid) to service_role;
grant execute on function public.quotation_cancel(uuid,uuid,uuid,text) to service_role;
grant execute on function public.quotation_record_conversion(uuid,uuid,uuid,uuid) to service_role;

-- ===========================================================================
-- 8. RLS — reads on `quotation:create` (the commercial audience), writes via
--    the service role only. No portal policy: a customer sees a quotation
--    through a governed surface, not through this table (EC-3D / MD-Q8).
-- ===========================================================================
alter table public.quotation_request enable row level security;
alter table public.quotation         enable row level security;
alter table public.quotation_line    enable row level security;

drop policy if exists quotation_request_select on public.quotation_request;
create policy quotation_request_select on public.quotation_request
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('quotation:create'));

drop policy if exists quotation_select on public.quotation;
create policy quotation_select on public.quotation
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('quotation:create'));

drop policy if exists quotation_line_select on public.quotation_line;
create policy quotation_line_select on public.quotation_line
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('quotation:create'));

grant select on public.quotation_request, public.quotation, public.quotation_line
  to authenticated;
