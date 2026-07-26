-- 20260726000001_expense_attachments.sql
-- Effitrans Operations Platform — PHASE 11.0C: expense supporting documents.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Completes the 11.0A §14 / DEC-C22 plan that 11.0B deliberately left
-- for the phase that would actually consume it: the « Pièces jointes » of an
-- Autorisation de Dépenses (invoice, quote, receipt, proforma…).
--
-- WHY A DEDICATED TABLE AND BUCKET (DEC-C22 — not a new pattern, the ratified one):
--   * public.document is STRICTLY dossier-bound (file_id NOT NULL) and its RLS
--     inherits DOSSIER visibility. Expense evidence must NOT be visible to every
--     dossier reader (supplier quotes, beneficiary details), and a general
--     administrative expense has no dossier at all (file_id nullable, DEC-C15).
--   * So: a finance-classified attachment table + its own private bucket, with
--     the exact storage doctrine the platform already uses for `documents` —
--     deny-by-default bucket (NO storage.objects policies for authenticated),
--     service-role-mediated uploads, short-TTL signed download URLs.
--
-- Shaped for 11.0D from the start: BOTH parent FKs are present with the same
-- one-parent CHECK as expense_visa/expense_approval_attempt, so the Bon de
-- Dépenses reuses this table with no schema change.
--
-- NO existing table, policy, permission, role or grant is modified. No new
-- permission is introduced — attachments are governed by the existing
-- finance:expense:read / :create family from 11.0B.

-- ===========================================================================
-- 1. expense_attachment — finance-classified supporting documents.
--    Rows are RETIRED, never deleted (8.1A archive-not-delete doctrine): the
--    evidence set of a submitted document must stay reconstructible forever.
-- ===========================================================================
create table public.expense_attachment (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),

  -- Exactly one parent (CHECK below). voucher_id is unused in 11.0C.
  document_type    text not null check (document_type in ('EXPENSE_AUTHORIZATION', 'EXPENSE_VOUCHER')),
  authorization_id uuid references public.expense_authorization (id) on delete cascade,
  voucher_id       uuid references public.expense_voucher (id) on delete cascade,

  -- Free-text classification, deliberately NOT an enum: the required-evidence
  -- matrix is a business decision that is still open (11.0A §14). Same doctrine
  -- as expense_type (DEC-C25) — a controlled catalog can arrive later WITHOUT
  -- replacing historical values.
  kind             text,

  file_name        text not null,
  mime_type        text,
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  -- Object key inside the private finance-expense bucket. Immutable per row:
  -- a replacement is a NEW row (versioned by re-upload, DEC-C22).
  storage_path     text not null,
  checksum         text,

  retired_at       timestamptz,
  retired_by       uuid references public.app_user (id),

  uploaded_by      uuid not null references public.app_user (id),
  created_at       timestamptz not null default now(),

  constraint expense_attachment_one_parent check (
    (document_type = 'EXPENSE_AUTHORIZATION' and authorization_id is not null and voucher_id is null) or
    (document_type = 'EXPENSE_VOUCHER'       and voucher_id is not null and authorization_id is null)
  ),
  -- One object key is owned by exactly one row.
  unique (tenant_id, storage_path)
);
create index idx_expense_attachment_auth on public.expense_attachment (authorization_id)
  where authorization_id is not null;
create index idx_expense_attachment_voucher on public.expense_attachment (voucher_id)
  where voucher_id is not null;

-- Tenant integrity — reuses the 11.0B shared child function (it checks whichever
-- parent FK is set, which is exactly this table's shape).
create trigger trg_expense_attachment_tenant before insert or update on public.expense_attachment
  for each row execute function public.enforce_expense_child_tenant();

-- The uploader must belong to the row's tenant (app_user actor-tenant doctrine).
create or replace function public.enforce_expense_attachment_actor_tenant()
returns trigger language plpgsql as $$
declare t uuid;
begin
  select tenant_id into t from public.app_user where id = new.uploaded_by;
  if t is distinct from new.tenant_id then raise exception 'expense_attachment uploader belongs to another tenant'; end if;
  if new.retired_by is not null then
    select tenant_id into t from public.app_user where id = new.retired_by;
    if t is distinct from new.tenant_id then raise exception 'expense_attachment retirer belongs to another tenant'; end if;
  end if;
  return new;
end; $$;
create trigger trg_expense_attachment_actor_tenant before insert or update on public.expense_attachment
  for each row execute function public.enforce_expense_attachment_actor_tenant();

-- ===========================================================================
-- 2. RLS — SELECT-only for tenant staff holding finance:expense:read. Exactly
--    the 11.0B expense doctrine: finance-internal, NO portal policy (customers
--    never see expense evidence), NO dossier-visibility widening. Every write
--    goes through the service-role actions in lib/finance/expense/attachments.
-- ===========================================================================
alter table public.expense_attachment enable row level security;

create policy expense_attachment_select on public.expense_attachment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:expense:read'));

grant select on public.expense_attachment to authenticated;

-- ===========================================================================
-- 3. Private storage bucket. Deny-by-default: NO storage.objects policies for
--    authenticated ⇒ direct client access is denied; the ONLY path is the
--    server actions (service role), which mint 60-second signed URLs. Separate
--    from the `documents` bucket so finance evidence never shares a namespace
--    (or a future policy) with dossier documents.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-expense', 'finance-expense', false, 26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do nothing;

-- ===========================================================================
-- 4. Register the Autorisation template v1 in the GLOBAL metadata catalog, so
--    the DB mirrors the code-managed registry (lib/finance/expense/templates.ts)
--    exactly as 11.0A §10 specified.
--
--    checksum stays NULL: the master raster of the original paper form is STILL
--    NOT in the repository (11.0A §8 named it the first 11.0B prerequisite; it
--    was never committed). The renderer therefore draws the form chrome from the
--    coordinate map. When the asset lands, this row gains its checksum and the
--    registry gains its background — no coordinate and no document data changes.
--    See docs/finance/phase-11.0c-expense-authorization.md § Open conflict.
--
--    expense_template is GLOBAL reference data (no tenant_id), so this literal
--    insert is clean-replay safe.
-- ===========================================================================
insert into public.expense_template (template_code, version, checksum, page_count, status, active_from)
values ('EXPENSE_AUTHORIZATION', 1, null, 1, 'ACTIVE', date '2026-07-26')
on conflict (template_code, version) do nothing;
