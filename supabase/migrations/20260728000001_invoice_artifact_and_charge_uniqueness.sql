-- 20260728000001_invoice_artifact_and_charge_uniqueness.sql
-- Effitrans Operations Platform — UAT-2B: accounting invariants in the database.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Two invariants that application code cannot be trusted to hold,
-- because losing either one corrupts the books rather than the UI.
--
-- ===========================================================================
-- 1. ONE BILLING CHARGE MAY BE BILLED ONCE (ratified, Option A)
-- ===========================================================================
-- A `billing_charge` represents one billable economic event. Converting it to
-- an `invoice_line` twice bills a customer twice for the same work. Until now
-- NOTHING prevented that: `invoice_line.charge_id` existed and was written, but
-- carried no uniqueness at all — only `idx_invoice_line_invoice`.
--
-- The invariant lives HERE, not in a service, because a concurrency window in
-- application code is exactly how double-billing happens in practice.
--
-- DELIBERATELY NOT scoped to non-VOID invoices. Voiding an invoice must never
-- silently return its charges to the billing pool — the historical accounting
-- relationship is immutable. Corrections create a NEW charge and a NEW invoice
-- (see the doctrine note below).
--
-- DRAFT DELETION IS THE ONE LEGITIMATE RELEASE, AND IT IS INTENTIONAL.
-- `invoice_line.invoice_id` is ON DELETE CASCADE and `deleteInvoice` is
-- permitted only while the invoice is DRAFT (`canDeleteInvoice`). Deleting an
-- abandoned draft therefore deletes its lines and the charge becomes billable
-- again. That is CORRECT: no accounting document was ever issued, so no
-- accounting relationship existed to preserve. The index still holds, because
-- the row is genuinely gone.
--
-- Future developers: this cascade-release is a deliberate accounting decision,
-- not an oversight. An explicit, audited release action is a later
-- auditability improvement; it does not change this invariant.
create unique index uq_invoice_line_charge_once
  on public.invoice_line (charge_id)
  where charge_id is not null;

comment on index public.uq_invoice_line_charge_once is
  'UAT-2B: one billing charge may become at most ONE invoice line, ever. '
  'Not scoped to non-VOID invoices: cancellation never returns a charge to the '
  'billing pool. Deleting a DRAFT invoice releases the charge by cascade, which '
  'is intentional — no accounting document existed yet.';

-- ===========================================================================
-- 1b. THE ACCOUNTING DOCUMENT TYPE
--
--     `document.type_code` is a foreign key to `document_type`, so the official
--     invoice needs its own catalogue row or no artifact could ever be stored.
--
--     It is registered with `required_for = '{}'`: an official invoice is never
--     a REQUIRED dossier document — the platform authors it when Finance issues
--     an invoice, and demanding it as evidence would be incoherent. It is also
--     deliberately DISTINCT from COMMERCIAL_INVOICE, which is the customer's or
--     supplier's external trade invoice (customs evidence, often in EUR,
--     uploaded by someone else). Nothing may ever resolve from one to the other.
-- ===========================================================================
insert into public.document_type
  (code, label_fr, label_en, category, required_for, conditional, active, sort_order)
values
  ('OFFICIAL_INVOICE', 'Facture Effitrans', 'Effitrans Invoice', 'finance',
   '{}', true, true, 95)
on conflict (code) do nothing;

-- ===========================================================================
-- 2. AN ISSUED INVOICE HAS EXACTLY ONE, NEVER-REGENERATED PDF
-- ===========================================================================
-- WES-4G's artifact model supersedes by (file_id, artifact_code): generating a
-- new TRANSPORT_ORDER closes the previous one. That is right for operational
-- artifacts and WRONG for accounting documents, twice over:
--
--   * a dossier may carry SEVERAL invoices, so keying on file_id alone would
--     make issuing invoice #2 supersede invoice #1's PDF;
--   * an issued invoice's PDF must NEVER be regenerated at all.
--
-- So the invoice artifact is keyed on the INVOICE, and uniqueness is absolute.
alter table public.document
  add column if not exists invoice_id uuid references public.invoice (id);

-- Exactly one official invoice artifact per invoice. A second attempt cannot
-- insert — the retry path must return the existing artifact instead.
create unique index uq_document_official_invoice
  on public.document (invoice_id)
  where invoice_id is not null and artifact_code = 'OFFICIAL_INVOICE';

create index idx_document_invoice on public.document (invoice_id) where invoice_id is not null;

comment on column public.document.invoice_id is
  'UAT-2B: set ONLY on OFFICIAL_INVOICE artifacts. The accounting document is '
  'bound to its invoice, not merely to the dossier, because one dossier may '
  'carry several invoices and each keeps its own immutable PDF.';

-- ===========================================================================
-- 3. IMMUTABILITY, ENFORCED
-- ===========================================================================
-- WES-4G's `protect_generated_artifact` guards generated artifacts generally.
-- An official invoice is stricter: once written, its bytes, its hash, its
-- invoice link and its status may never change, and it may never be superseded
-- or soft-deleted. There is no legitimate UPDATE.
create or replace function public.protect_official_invoice_artifact()
returns trigger
language plpgsql
as $$
begin
  -- On DELETE, NEW is NULL — returning it from a BEFORE DELETE trigger would
  -- CANCEL the delete. Every non-invoice row must be passed through with the
  -- correct record for its operation, or this guard would silently block the
  -- deletion of unrelated documents.
  if old.artifact_code is distinct from 'OFFICIAL_INVOICE' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'Un document comptable ne peut pas être supprimé. La facture % reste archivée.',
      coalesce(old.title, old.id::text);
  end if;

  if new.storage_path is distinct from old.storage_path
     or new.content_sha256 is distinct from old.content_sha256
     or new.invoice_id is distinct from old.invoice_id
     or new.version is distinct from old.version
     or new.superseded_by_id is distinct from old.superseded_by_id
     or new.deleted_at is distinct from old.deleted_at
     or new.status is distinct from old.status
  then
    raise exception
      'Une facture officielle émise est immuable : ni son PDF, ni son empreinte, '
      'ni son statut ne peuvent être modifiés. Utilisez l''annulation puis une '
      'nouvelle facture.';
  end if;

  return new;
end; $$;

create trigger trg_protect_official_invoice_update
  before update on public.document
  for each row execute function public.protect_official_invoice_artifact();

create trigger trg_protect_official_invoice_delete
  before delete on public.document
  for each row execute function public.protect_official_invoice_artifact();

-- ===========================================================================
-- 4. finalize_official_invoice — allocate-once, never-regenerate
-- ===========================================================================
-- Deliberately NOT `finalize_generated_artifact`: that function supersedes a
-- previous version, which is precisely what an accounting document forbids.
-- IDEMPOTENT: a retry after a crash returns the artifact already stored rather
-- than rendering a second one.
create or replace function public.finalize_official_invoice(
  p_document_id     uuid,
  p_tenant_id       uuid,
  p_file_id         uuid,
  p_invoice_id      uuid,
  p_invoice_number  text,
  p_storage_path    text,
  p_content_sha256  text,
  p_source_snapshot jsonb,
  p_renderer_version text,
  p_actor           uuid,
  p_size_bytes      bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing uuid;
  v_hash     text;
begin
  if coalesce(btrim(p_content_sha256), '') = '' then
    raise exception 'un document comptable doit porter une empreinte de contenu';
  end if;
  if coalesce(btrim(p_invoice_number), '') = '' then
    raise exception 'un document comptable doit porter un numéro de facture officiel';
  end if;

  -- IDEMPOTENT: the invoice already has its artifact. Return it untouched —
  -- never render, never supersede, never overwrite.
  select id, content_sha256 into v_existing, v_hash
    from public.document
   where invoice_id = p_invoice_id
     and artifact_code = 'OFFICIAL_INVOICE'
   limit 1;
  if v_existing is not null then
    return jsonb_build_object(
      'document_id', v_existing, 'content_sha256', v_hash, 'already', true);
  end if;

  insert into public.document (
    id, tenant_id, file_id, invoice_id, type_code, title, status, version,
    storage_path, mime_type, size_bytes,
    content_sha256, source_snapshot, renderer_version,
    artifact_code, artifact_provenance,
    generated_by, generated_at, uploaded_by, provenance)
  values (
    p_document_id, p_tenant_id, p_file_id, p_invoice_id,
    'OFFICIAL_INVOICE', p_invoice_number,
    -- Authoritative on creation: the platform authored it from its own
    -- accounting records. There is no external claim to verify.
    'VERIFIED', 1,
    p_storage_path, 'application/pdf', p_size_bytes,
    p_content_sha256, p_source_snapshot, p_renderer_version,
    'OFFICIAL_INVOICE', 'GENERATED',
    p_actor, now(), p_actor, 'GOVERNED');

  perform public.emit_business_event(
    p_tenant_id, 'INTERNAL_DOCUMENT_GENERATED', 'document', 'document_rpc',
    'document', p_document_id, p_file_id, p_actor,
    jsonb_build_object(
      'type_code', 'OFFICIAL_INVOICE',
      'artifact_code', 'OFFICIAL_INVOICE',
      'renderer_version', p_renderer_version,
      'artifact_version', 1));

  return jsonb_build_object(
    'document_id', p_document_id, 'content_sha256', p_content_sha256, 'already', false);
end; $$;

revoke execute on function public.finalize_official_invoice(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, bigint) from public;
grant execute on function public.finalize_official_invoice(uuid, uuid, uuid, uuid, text, text, text, jsonb, text, uuid, bigint) to service_role;
