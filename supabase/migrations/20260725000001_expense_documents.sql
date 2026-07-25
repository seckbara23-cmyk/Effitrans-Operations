-- 20260725000001_expense_documents.sql
-- Effitrans Operations Platform — PHASE 11.0B: Finance Expense Documents foundation.
-- ---------------------------------------------------------------------------
-- ADDITIVE. The permanent data model + document infrastructure for the two real
-- paper Finance documents (docs/finance/phase-11.0a-expense-authorization-
-- architecture.md; decisions DEC-C05..C25). This phase builds the FOUNDATION
-- ONLY — no forms, no PDF rendering, no signature capture, no approval workflow,
-- no payment execution, no treasury. Every later phase (11.0C..11.0G) consumes
-- what is created here.
--
-- The two documents are a DEDICATED bounded context (DEC-C05/C23) — NOT an
-- overload of finance_request (one reviewer slot; six paper fields absent),
-- caisse, the invoice workflow, or the dossier process engine (registry-fixed,
-- welded to operational_file). The engine's PROVEN doctrine is replicated, not
-- reused: pure transition tables (lib/finance/expense/*), compare-and-set server
-- actions, append-only ledger + immutable versions (the invoice_deposit_event
-- precedent), tenant-integrity triggers, safe audit.
--
-- CORE INVARIANTS ENFORCED IN THE SCHEMA:
--   * ONE-TO-ONE (DEC-C07): expense_voucher.authorization_id is UNIQUE NOT NULL —
--     one authorization produces AT MOST one voucher; no split, no consolidated
--     vouchers. A voucher may be created only from an APPROVED authorization
--     (DEC-C06; enforced in the server action's CAS).
--   * IMMUTABLE VERSIONS: expense_authorization_version / expense_voucher_version
--     are append-only (UPDATE/DELETE hard-blocked) — a signed version is never
--     overwritten. A material edit creates a NEW version (DEC-C13).
--   * APPEND-ONLY VISA LEDGER: expense_visa is UPDATE/DELETE hard-blocked — one
--     immutable row per approval action (authenticated electronic approval,
--     DEC-C12). No signatures are WRITTEN in 11.0B (approvals are 11.0C/D); the
--     ledger exists for them to append to.
--   * ATTEMPT ≠ VERSION: a rejection opens a NEW expense_approval_attempt without
--     destroying history (the process-engine correction-as-new-attempt idiom).
--   * FIELD SEMANTICS (DEC-C25): account_number / registration_number /
--     expense_type are FLEXIBLE TEXT (no enum, no bank/GL assumption); weight_kg
--     is an OPTIONAL non-negative decimal in kilograms.
--
-- PERMISSIONS: a new finance:expense:* family (module 'finance_expense' — kept
-- OUT of the module='finance' auto-grant so segregation of duties is explicit).
-- finance:expense:sign ships in the CATALOG but is granted to NO role in 11.0B —
-- the visa signer-map + its grants are 11.0C/D (VISA_RECEPTION / VISA_OPERATIONS
-- remain unmapped business blockers BLK-FIN-1 / BLK-FIN-2).
--
-- ROLES: four ratified finance authorizer seats — ACCOUNTANT (Comptable),
-- TREASURER (Trésorière), DAF, DGA — mapped to the FINANCE canonical department
-- (metadata only, lib/organization/departments.ts). FINANCE_OFFICER and CASHIER
-- already exist; CASHIER stays EXECUTION-ONLY (gains finance:expense:execute, no
-- authorization). VISA_AGENT = FINANCE_OFFICER, never CASHIER (DEC-C11).
--
-- Clean-replay safe: role inserts are guarded backfills (no-op on an empty DB —
-- seed.sql owns creation there); grants are select-driven. NO existing table,
-- role, permission or grant is modified.

-- ===========================================================================
-- 1. Permission catalog (GLOBAL reference data — no tenant). Module
--    'finance_expense' so the seed's module='finance' auto-grant to SYSTEM_ADMIN
--    does NOT sweep these in — every grant below is explicit (segregation).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('finance:expense:read',    'finance_expense', 'read',    'all', 'Consulter les autorisations et bons de dépenses'),
  ('finance:expense:create',  'finance_expense', 'create',  'all', 'Créer un brouillon d''autorisation ou de bon de dépenses'),
  ('finance:expense:submit',  'finance_expense', 'submit',  'all', 'Soumettre une autorisation ou un bon de dépenses au circuit d''approbation'),
  ('finance:expense:sign',    'finance_expense', 'sign',    'all', 'Apposer un visa (approbation électronique authentifiée) sur un document de dépenses'),
  ('finance:expense:export',  'finance_expense', 'export',  'all', 'Générer / exporter / imprimer le PDF d''un document de dépenses'),
  ('finance:expense:execute', 'finance_expense', 'execute', 'all', 'Exécuter le paiement d''un bon de dépenses éligible (caisse)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Numbering counters (INTERNAL — numbering only; locked down, no RLS
--    policies/grants). Mirror public.invoice_counter. Per tenant×year, atomic,
--    gaps allowed (a consumed number is never reused), assigned AT SUBMISSION
--    (never on draft creation) — DEC-C14.
-- ===========================================================================
create table public.expense_authorization_counter (
  tenant_id uuid not null references public.organization (id),
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.expense_authorization_counter enable row level security;

create table public.expense_voucher_counter (
  tenant_id uuid not null references public.organization (id),
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.expense_voucher_counter enable row level security;

-- EFT-AUT-{YEAR}-{5-digit}, e.g. EFT-AUT-2026-00001.
create or replace function public.next_expense_authorization_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into public.expense_authorization_counter (tenant_id, year, next_seq)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year)
    do update set next_seq = expense_authorization_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'EFT-AUT-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
end;
$$;
revoke execute on function public.next_expense_authorization_number(uuid) from public;
grant execute on function public.next_expense_authorization_number(uuid) to service_role;

-- EFT-BON-{YEAR}-{5-digit}, e.g. EFT-BON-2026-00001.
create or replace function public.next_expense_voucher_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into public.expense_voucher_counter (tenant_id, year, next_seq)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year)
    do update set next_seq = expense_voucher_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'EFT-BON-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
end;
$$;
revoke execute on function public.next_expense_voucher_number(uuid) from public;
grant execute on function public.next_expense_voucher_number(uuid) to service_role;

-- ===========================================================================
-- 3. expense_template — GLOBAL versioned template metadata catalog (DEC-C16).
--    Metadata ONLY (code, version, checksum, page count, lifecycle) — never PDF
--    bytes. Ships EMPTY: the master template PDF is not yet in the repo (an
--    11.0C prerequisite), so concrete versions are registered later. The typed
--    contract lives in lib/finance/expense/templates.ts.
-- ===========================================================================
create table public.expense_template (
  id            uuid primary key default gen_random_uuid(),
  template_code text not null check (template_code in ('EXPENSE_AUTHORIZATION', 'EXPENSE_VOUCHER')),
  version       int  not null check (version > 0),
  checksum      text,                 -- sha256 of the source template asset (set when the asset lands)
  page_count    int check (page_count is null or page_count > 0),
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  active_from   date,
  retired_at    date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (template_code, version)
);
alter table public.expense_template enable row level security;
create trigger trg_expense_template_updated_at before update on public.expense_template
  for each row execute function public.set_updated_at();
-- Reference metadata: readable by any tenant staff holding finance:expense:read.
create policy expense_template_select on public.expense_template
  for select to authenticated
  using (public.has_permission('finance:expense:read'));
grant select on public.expense_template to authenticated;

-- ===========================================================================
-- 4. expense_authorization — the authoritative structured record (mutable head).
--    Working field values live here (editable while DRAFT/RETURNED); each
--    submission / material edit FREEZES an immutable snapshot into
--    expense_authorization_version. NO signatures, NO payment, NO treasury here.
-- ===========================================================================
create table public.expense_authorization (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),

  -- Assigned at submission (DEC-C14); null on a draft. Unique per tenant.
  authorization_number text,

  -- Optional links. file_id NULL ⇒ general administrative expense (DEC-C15).
  file_id              uuid references public.operational_file (id) on delete set null,
  finance_request_id   uuid references public.finance_request (id) on delete set null,

  -- Ratified flexible-text fields (DEC-C25). No enum, no bank/GL assumption.
  account_number       text,
  registration_number  text,
  expense_type         text,
  -- Optional non-negative decimal weight, kilograms implicit (DEC-C25).
  weight_kg            numeric(12, 3) check (weight_kg is null or weight_kg >= 0),

  amount               numeric(14, 2) not null check (amount > 0),
  currency             text not null default 'XOF',
  amount_in_words      text,
  beneficiary          text not null,
  reason               text not null,

  -- Lifecycle (DEC-C18 machine; pure table in lib/finance/expense/status.ts).
  status               text not null default 'DRAFT' check (status in
                         ('DRAFT', 'SUBMITTED', 'IN_APPROVAL', 'RETURNED',
                          'REJECTED', 'APPROVED', 'CANCELLED', 'SUPERSEDED')),
  -- Points at the latest frozen snapshot (null until first submission).
  current_version_id   uuid,

  requested_by         uuid not null references public.app_user (id),
  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index idx_expense_auth_tenant_status on public.expense_authorization (tenant_id, status);
create index idx_expense_auth_file on public.expense_authorization (file_id) where file_id is not null;
create unique index uq_expense_auth_number on public.expense_authorization (tenant_id, authorization_number)
  where authorization_number is not null;
create trigger trg_expense_auth_updated_at before update on public.expense_authorization
  for each row execute function public.set_updated_at();

-- Immutable version snapshots. Append-only: a frozen version is never rewritten.
create table public.expense_authorization_version (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  authorization_id     uuid not null references public.expense_authorization (id) on delete cascade,
  version_number       int  not null check (version_number > 0),

  -- Frozen field snapshot (the exact values this version represents).
  account_number       text,
  registration_number  text,
  expense_type         text,
  weight_kg            numeric(12, 3),
  amount               numeric(14, 2) not null,
  currency             text not null,
  amount_in_words      text,
  beneficiary          text not null,
  reason               text not null,
  snapshot             jsonb not null,       -- canonical full snapshot (provenance)

  -- Template + integrity provenance (DEC-C12/C16).
  template_code        text check (template_code is null or template_code = 'EXPENSE_AUTHORIZATION'),
  template_version     int,
  content_sha256       text not null,

  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  unique (authorization_id, version_number)
);
create index idx_expense_auth_version_doc on public.expense_authorization_version (authorization_id);
-- Immutable: block UPDATE and DELETE for everyone (incl. service role).
create trigger trg_expense_auth_version_no_update before update on public.expense_authorization_version
  for each row execute function public.prevent_mutation();
create trigger trg_expense_auth_version_no_delete before delete on public.expense_authorization_version
  for each row execute function public.prevent_mutation();

-- current_version_id FK added after the version table exists.
alter table public.expense_authorization
  add constraint expense_authorization_current_version_fk
  foreign key (current_version_id) references public.expense_authorization_version (id) on delete set null;

-- ===========================================================================
-- 5. expense_voucher — the payment-preparation document (mutable head). ONE per
--    authorization (DEC-C07): authorization_id UNIQUE NOT NULL. Fields are
--    snapshot-copied from the approved authorization with version provenance.
-- ===========================================================================
create table public.expense_voucher (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.organization (id),

  -- THE one-to-one constraint (DEC-C07). One authorization ⇒ at most one voucher.
  authorization_id            uuid not null unique references public.expense_authorization (id) on delete cascade,
  -- Provenance: which authorization version the copied fields came from (DEC-C07).
  source_authorization_version int not null check (source_authorization_version > 0),

  voucher_number              text,   -- EFT-BON-…, assigned at submission

  -- Snapshot-copied then owned by the voucher.
  account_number              text,
  registration_number         text,
  amount                      numeric(14, 2) not null check (amount > 0),
  currency                    text not null default 'XOF',
  amount_in_words             text,
  beneficiary                 text not null,
  reason                      text not null,

  -- Approved payment method is part of the signed voucher (DEC-C10). FREE_MONEY
  -- widens the finance_request method vocabulary (additive).
  payment_method              text check (payment_method is null or payment_method in
                                ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'WAVE', 'ORANGE_MONEY', 'FREE_MONEY', 'OTHER')),

  status                      text not null default 'DRAFT' check (status in
                                ('DRAFT', 'IN_SIGNATURE', 'RETURNED', 'REJECTED', 'FULLY_SIGNED',
                                 'READY_FOR_PAYMENT', 'PAID', 'RECONCILED', 'CLOSED',
                                 'CANCELLED', 'SUPERSEDED')),
  current_version_id          uuid,

  entered_by                  uuid not null references public.app_user (id),
  created_by                  uuid references public.app_user (id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, voucher_number)
);
create index idx_expense_voucher_tenant_status on public.expense_voucher (tenant_id, status);
create trigger trg_expense_voucher_updated_at before update on public.expense_voucher
  for each row execute function public.set_updated_at();

create table public.expense_voucher_version (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  voucher_id           uuid not null references public.expense_voucher (id) on delete cascade,
  version_number       int  not null check (version_number > 0),

  account_number       text,
  registration_number  text,
  amount               numeric(14, 2) not null,
  currency             text not null,
  amount_in_words      text,
  beneficiary          text not null,
  reason               text not null,
  payment_method       text,
  snapshot             jsonb not null,

  template_code        text check (template_code is null or template_code = 'EXPENSE_VOUCHER'),
  template_version     int,
  content_sha256       text not null,

  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  unique (voucher_id, version_number)
);
create index idx_expense_voucher_version_doc on public.expense_voucher_version (voucher_id);
create trigger trg_expense_voucher_version_no_update before update on public.expense_voucher_version
  for each row execute function public.prevent_mutation();
create trigger trg_expense_voucher_version_no_delete before delete on public.expense_voucher_version
  for each row execute function public.prevent_mutation();

alter table public.expense_voucher
  add constraint expense_voucher_current_version_fk
  foreign key (current_version_id) references public.expense_voucher_version (id) on delete set null;

-- ===========================================================================
-- 6. expense_approval_attempt — one pass through the approval chain over a
--    specific version. A rejection CLOSES the attempt and a corrected version
--    opens a NEW attempt (attempt ≠ version). NO visas are written in 11.0B.
--    Exactly one of authorization_id / voucher_id is set.
-- ===========================================================================
create table public.expense_approval_attempt (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  document_type    text not null check (document_type in ('EXPENSE_AUTHORIZATION', 'EXPENSE_VOUCHER')),
  authorization_id uuid references public.expense_authorization (id) on delete cascade,
  voucher_id       uuid references public.expense_voucher (id) on delete cascade,
  version_id       uuid not null,             -- the version this attempt approves
  attempt_number   int  not null check (attempt_number > 0),
  status           text not null default 'IN_PROGRESS' check (status in
                     ('IN_PROGRESS', 'APPROVED', 'REJECTED', 'RETURNED', 'SUPERSEDED')),
  opened_by        uuid references public.app_user (id),
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  updated_at       timestamptz not null default now(),
  -- Exactly one parent, matching document_type.
  constraint expense_attempt_one_parent check (
    (document_type = 'EXPENSE_AUTHORIZATION' and authorization_id is not null and voucher_id is null) or
    (document_type = 'EXPENSE_VOUCHER'       and voucher_id is not null and authorization_id is null)
  )
);
create unique index uq_expense_attempt_auth on public.expense_approval_attempt (authorization_id, attempt_number)
  where authorization_id is not null;
create unique index uq_expense_attempt_voucher on public.expense_approval_attempt (voucher_id, attempt_number)
  where voucher_id is not null;
create trigger trg_expense_attempt_updated_at before update on public.expense_approval_attempt
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 7. expense_visa — APPEND-ONLY authenticated-electronic-approval ledger
--    (DEC-C12). One immutable row per approval action. NO rows are written in
--    11.0B (approvals/signatures are 11.0C/D); the ledger exists for them.
-- ===========================================================================
create table public.expense_visa (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  document_type         text not null check (document_type in ('EXPENSE_AUTHORIZATION', 'EXPENSE_VOUCHER')),
  authorization_id      uuid references public.expense_authorization (id) on delete cascade,
  voucher_id            uuid references public.expense_voucher (id) on delete cascade,
  version_id            uuid not null,        -- the exact version signed
  attempt_id            uuid not null references public.expense_approval_attempt (id) on delete cascade,

  step_code             text not null,        -- VISA_DEMANDEUR … VISA_DG (signer-map is code, 11.0C/D)
  step_ordinal          int  not null check (step_ordinal > 0),
  signer_user_id        uuid not null references public.app_user (id),
  signer_role_code      text not null,        -- role AT SIGNING (frozen)
  signer_display_name   text not null,
  decision              text not null check (decision in ('APPROVED', 'REJECTED', 'RETURNED')),
  comment               text,
  content_sha256        text not null,        -- the version hash signed
  audit_log_id          uuid references public.audit_log (id),
  decided_at            timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  constraint expense_visa_one_parent check (
    (document_type = 'EXPENSE_AUTHORIZATION' and authorization_id is not null and voucher_id is null) or
    (document_type = 'EXPENSE_VOUCHER'       and voucher_id is not null and authorization_id is null)
  )
);
create index idx_expense_visa_attempt on public.expense_visa (attempt_id);
create index idx_expense_visa_auth on public.expense_visa (authorization_id) where authorization_id is not null;
create index idx_expense_visa_voucher on public.expense_visa (voucher_id) where voucher_id is not null;
-- Append-only: block UPDATE and DELETE for everyone (incl. service role).
create trigger trg_expense_visa_no_update before update on public.expense_visa
  for each row execute function public.prevent_mutation();
create trigger trg_expense_visa_no_delete before delete on public.expense_visa
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 8. Tenant integrity — defense-in-depth (mirrors the finance/engine triggers).
--    Every referenced actor/record/parent shares the row's tenant, making
--    cross-tenant links structurally impossible even under an application bug.
-- ===========================================================================
create or replace function public.enforce_expense_authorization_tenant()
returns trigger language plpgsql as $$
declare t uuid;
begin
  select tenant_id into t from public.app_user where id = new.requested_by;
  if t is distinct from new.tenant_id then raise exception 'expense_authorization requester belongs to another tenant'; end if;
  if new.created_by is not null then
    select tenant_id into t from public.app_user where id = new.created_by;
    if t is distinct from new.tenant_id then raise exception 'expense_authorization creator belongs to another tenant'; end if;
  end if;
  if new.file_id is not null then
    select tenant_id into t from public.operational_file where id = new.file_id;
    if t is distinct from new.tenant_id then raise exception 'expense_authorization file belongs to another tenant'; end if;
  end if;
  if new.finance_request_id is not null then
    select tenant_id into t from public.finance_request where id = new.finance_request_id;
    if t is distinct from new.tenant_id then raise exception 'expense_authorization finance_request belongs to another tenant'; end if;
  end if;
  return new;
end; $$;
create trigger trg_expense_authorization_tenant before insert or update on public.expense_authorization
  for each row execute function public.enforce_expense_authorization_tenant();

create or replace function public.enforce_expense_voucher_tenant()
returns trigger language plpgsql as $$
declare t uuid;
begin
  select tenant_id into t from public.expense_authorization where id = new.authorization_id;
  if t is distinct from new.tenant_id then raise exception 'expense_voucher authorization belongs to another tenant'; end if;
  select tenant_id into t from public.app_user where id = new.entered_by;
  if t is distinct from new.tenant_id then raise exception 'expense_voucher enterer belongs to another tenant'; end if;
  if new.created_by is not null then
    select tenant_id into t from public.app_user where id = new.created_by;
    if t is distinct from new.tenant_id then raise exception 'expense_voucher creator belongs to another tenant'; end if;
  end if;
  return new;
end; $$;
create trigger trg_expense_voucher_tenant before insert or update on public.expense_voucher
  for each row execute function public.enforce_expense_voucher_tenant();

-- Version + attempt + visa: the parent document and every actor must share tenant.
create or replace function public.enforce_expense_child_tenant()
returns trigger language plpgsql as $$
declare t uuid;
begin
  if new.authorization_id is not null then
    select tenant_id into t from public.expense_authorization where id = new.authorization_id;
    if t is distinct from new.tenant_id then raise exception 'expense child authorization belongs to another tenant'; end if;
  end if;
  if new.voucher_id is not null then
    select tenant_id into t from public.expense_voucher where id = new.voucher_id;
    if t is distinct from new.tenant_id then raise exception 'expense child voucher belongs to another tenant'; end if;
  end if;
  return new;
end; $$;
create trigger trg_expense_auth_version_tenant before insert on public.expense_authorization_version
  for each row execute function public.enforce_expense_child_tenant();
create trigger trg_expense_voucher_version_tenant before insert on public.expense_voucher_version
  for each row execute function public.enforce_expense_child_tenant();
create trigger trg_expense_attempt_tenant before insert or update on public.expense_approval_attempt
  for each row execute function public.enforce_expense_child_tenant();
create trigger trg_expense_visa_tenant before insert on public.expense_visa
  for each row execute function public.enforce_expense_child_tenant();

-- ===========================================================================
-- 9. RLS — SELECT-only for tenant staff holding finance:expense:read. Finance
--    expense documents are FINANCE-INTERNAL (DEC-C22/§26): NO portal policy
--    (customers never see them) and NO dossier-visibility widening (a general
--    expense has no dossier; a dossier-linked one is still finance-only). All
--    writes go through the service-role actions in lib/finance/expense.
-- ===========================================================================
alter table public.expense_authorization         enable row level security;
alter table public.expense_authorization_version enable row level security;
alter table public.expense_voucher               enable row level security;
alter table public.expense_voucher_version       enable row level security;
alter table public.expense_approval_attempt      enable row level security;
alter table public.expense_visa                  enable row level security;

create policy expense_authorization_select on public.expense_authorization
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));
create policy expense_authorization_version_select on public.expense_authorization_version
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));
create policy expense_voucher_select on public.expense_voucher
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));
create policy expense_voucher_version_select on public.expense_voucher_version
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));
create policy expense_approval_attempt_select on public.expense_approval_attempt
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));
create policy expense_visa_select on public.expense_visa
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));

grant select on public.expense_authorization         to authenticated;
grant select on public.expense_authorization_version to authenticated;
grant select on public.expense_voucher               to authenticated;
grant select on public.expense_voucher_version       to authenticated;
grant select on public.expense_approval_attempt      to authenticated;
grant select on public.expense_visa                  to authenticated;

-- ===========================================================================
-- 10. Roles — the four ratified finance authorizer seats (DEC-C11). Guarded
--     backfill for the Effitrans tenant (no-op on an empty DB — seed.sql owns
--     creation there). Mapped to FINANCE in lib/organization/departments.ts.
-- ===========================================================================
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', v.code, v.label_fr, v.label_en, true
from (values
  ('ACCOUNTANT', 'Comptable',                              'Accountant'),
  ('TREASURER',  'Trésorier / Trésorière',                 'Treasurer'),
  ('DAF',        'Directeur administratif et financier',   'Administrative & Financial Director'),
  ('DGA',        'Directeur général adjoint',              'Deputy General Manager')
) as v(code, label_fr, label_en)
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- ===========================================================================
-- 11. Grants — LEAST PRIVILEGE (DEC-C11/C21). finance:expense:sign is granted to
--     NO role in 11.0B (visa signer-map + grants are 11.0C/D). CASHIER gets
--     execute only (execution-only; no authorization). SYSTEM_ADMIN follows the
--     finance full-admin convention EXCEPT sign (deferred with everyone else).
--
--   read/export  → the finance authoring + authorizer seats + supervisory
--   create/submit→ the finance agent (FINANCE_OFFICER) + SYSTEM_ADMIN
--   execute      → CASHIER + supervisory (mirrors caisse:manage oversight)
-- ===========================================================================
-- read: all expense actors see the documents.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER',
                 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA', 'CASHIER')
on conflict do nothing;

-- export: authoring + authorizer seats + supervisory (not CASHIER, not CEO).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:export'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER',
                 'ACCOUNTANT', 'TREASURER', 'DAF', 'DGA')
on conflict do nothing;

-- create + submit: the finance agent originates the document; SYSTEM_ADMIN convention.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code in ('finance:expense:create', 'finance:expense:submit')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'FINANCE_OFFICER')
on conflict do nothing;

-- execute: CASHIER (execution-only) + supervisory oversight (mirrors caisse:manage).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p on p.code = 'finance:expense:execute'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CASHIER')
on conflict do nothing;

-- Baseline for the four new roles (own profile) + Finance module read
-- visibility — least privilege. Their AUTHORIZATION capability (finance:expense:
-- sign) is deliberately withheld until 11.0C/D wires the visa signer-map. NO
-- finance authorization (validate/issue/void/payment), NO admin, NO delete,
-- NO process:read (added with their workspace surfacing in a later phase).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('ACCOUNTANT', 'TREASURER', 'DAF', 'DGA')
on conflict do nothing;
