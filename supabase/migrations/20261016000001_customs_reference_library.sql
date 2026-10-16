-- ===========================================================================
-- Migration 152 — CUSTOMS-REF-01A / REF-1: the Customs Reference Library.
-- ===========================================================================
-- WHAT THIS IS. A place for the Customs Department's REFERENCE MATERIAL — the
-- CET, the Customs Code, the regime list, circulars, and (subject to a licence
-- ruling) the HS Explanatory Notes. Documents consulted to do the work, not
-- documents produced by a dossier.
--
-- WHAT IT DELIBERATELY IS NOT. It is NOT `public.document`, and that is the
-- whole point. `document.file_id` is NOT NULL, so a reference document could
-- only have lived there by inventing a synthetic dossier to hang it from. The
-- evidence engine reads `document` by (file_id, type_code); a separate table is
-- unreachable from it. So « a library document never becomes dossier evidence »
-- is a STRUCTURAL guarantee here, not a rule somebody has to remember.
--
-- NOT A CATALOGUE OF VALUES. The sibling reasoning to migration 149's « NOT A
-- CATALOGUE TABLE, deliberately »: eleven Incoterms fixed by the ICC belong in
-- a CHECK, because they have no metadata and no lifecycle. These documents are
-- the opposite — they carry provenance, an edition, a publication date, a
-- licence, versions and a publication decision. That is exactly what a table is
-- for. The CATEGORY, being five fixed values with no metadata, is a CHECK.
--
-- PUBLICATION IS AN ACT, NEVER A SIDE EFFECT OF UPLOAD. There is no malware
-- scanner in this platform today. An uploaded file is therefore QUARANTINE and
-- nothing else can be assumed about it: it is not consultable by readers, and
-- becoming consultable requires a separate, audited decision by a holder of
-- `customs:reference:publish`. The unresolved security gate is recorded in the
-- slice report rather than papered over by an optimistic default.
--
-- AND PUBLICATION CANNOT BE CLAIMED WITHOUT VERIFICATION. Three facts must be
-- affirmed by a human before `status` may become PUBLISHED: provenance checked,
-- legal version checked, and a licence ruling that is not RESTRICTED. The CHECK
-- constraints below make « published but unverified » unrepresentable, so the
-- platform can never present a document as the current authoritative law merely
-- because somebody uploaded it.
--
-- THE EXPLANATORY NOTES ARE FENCED SEPARATELY. WCO HS Explanatory Notes are
-- copyrighted and their licence is NOT YET KNOWN. A dedicated CHECK refuses to
-- publish that category while the licence is RESTRICTED, and
-- `redistribution_allowed` defaults to false for every row regardless of
-- category. Nothing in this migration grants redistribution of anything.
--
-- WRITES NO ROW, TOUCHES NO EXISTING TABLE. New table, new bucket, two new
-- permissions. No change to `document`, `customs_record`, the 29-step process
-- graph, service scope, the customs release path, Transport or Finance.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The document record.
-- ---------------------------------------------------------------------------
create table if not exists public.customs_reference_document (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,

  -- Five fixed kinds, with no metadata of their own: a CHECK, not a table.
  -- LEGISLATION         the Customs Code and other statutory text
  -- TARIFF              the CET / tariff schedules
  -- REGIME_LIST         the regime code list as published
  -- EXPLANATORY_NOTES   WCO HS Explanatory Notes — licence-fenced below
  -- CIRCULAR            administrative circulars and notices
  category                text not null
    check (category in ('LEGISLATION', 'TARIFF', 'REGIME_LIST', 'EXPLANATORY_NOTES', 'CIRCULAR')),

  title                   text not null check (btrim(title) <> ''),
  -- WHO published the source document (« Direction Générale des Douanes »,
  -- « OMD/WCO »…). Required: a reference document with no stated authority is
  -- not a reference, and this is the field an operator checks first.
  source_authority        text not null check (btrim(source_authority) <> ''),
  -- Free text by design: « Édition 2022 », « 7e édition », « Rév. 3 ».
  edition                 text,
  -- The date the SOURCE was published by its authority — not the upload date.
  published_on            date,
  -- A stable business key for « the same document, later edition », e.g.
  -- 'CET' or 'CODE-DOUANES'.
  --
  -- MANDATORY, and that is the REF-1-HARDEN correction (F2). It was optional,
  -- and `uq_customs_reference_one_current` is a PARTIAL index predicated on it
  -- being present — so a document uploaded without a code sat outside the
  -- one-current-edition rule entirely, and « which text is in force? » had no
  -- answer for it. A reference document without a business key is not a
  -- reference; a circular has a number, and so does everything else here.
  reference_code          text not null check (btrim(reference_code) <> ''),

  -- ---- version lineage ---------------------------------------------------
  version                 integer not null default 1 check (version >= 1),
  supersedes_id           uuid references public.customs_reference_document(id) on delete restrict,
  superseded_by_id        uuid references public.customs_reference_document(id) on delete restrict,
  superseded_at           timestamptz,

  -- ---- the bytes ---------------------------------------------------------
  storage_path            text not null check (btrim(storage_path) <> ''),
  -- PDF only in REF-1. Widening this is a decision, not an oversight.
  mime_type               text not null check (mime_type = 'application/pdf'),
  size_bytes              bigint not null check (size_bytes > 0),
  -- Describes what is ACTUALLY stored: hashed from the same buffer that was
  -- uploaded, never from a separately-read stream.
  content_sha256          text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),

  -- ---- lifecycle ---------------------------------------------------------
  -- QUARANTINE  uploaded, unscanned, readers cannot see it
  -- PUBLISHED   consultable by readers
  -- WITHDRAWN   no longer consultable; the row and bytes remain
  status                  text not null default 'QUARANTINE'
    check (status in ('QUARANTINE', 'PUBLISHED', 'WITHDRAWN')),

  -- ---- licence -----------------------------------------------------------
  -- RESTRICTED               no ruling yet — the safe default for everything
  -- INTERNAL_ONLY            may be consulted in-house; no redistribution
  -- APPROVED_REDISTRIBUTION  an explicit ruling that sharing is permitted
  licence_status           text not null default 'RESTRICTED'
    check (licence_status in ('RESTRICTED', 'INTERNAL_ONLY', 'APPROVED_REDISTRIBUTION')),
  redistribution_allowed   boolean not null default false,
  licence_note             text,

  -- ---- the two verifications publication depends on ----------------------
  provenance_verified      boolean not null default false,
  legal_version_verified   boolean not null default false,

  -- ---- actors ------------------------------------------------------------
  uploaded_by             uuid not null,
  uploaded_at             timestamptz not null default now(),
  published_by            uuid,
  published_at            timestamptz,
  withdrawn_by            uuid,
  withdrawn_at            timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- PUBLISHED is unrepresentable without the publisher, the moment, and both
  -- human verifications. This is what stops the platform claiming a document
  -- is the current law because a file landed in a bucket.
  constraint customs_reference_published_is_verified check (
    status <> 'PUBLISHED'
    or (
      published_by is not null
      and published_at is not null
      and provenance_verified
      and legal_version_verified
      and licence_status <> 'RESTRICTED'
    )
  ),

  -- The HS Explanatory Notes fence. Their licence is unknown, so the category
  -- gets its own refusal rather than relying on the general rule above.
  constraint customs_reference_explanatory_notes_licence check (
    category <> 'EXPLANATORY_NOTES'
    or status <> 'PUBLISHED'
    or licence_status = 'APPROVED_REDISTRIBUTION'
  ),

  -- Redistribution is a claim only the strongest licence can support.
  constraint customs_reference_redistribution_needs_licence check (
    not redistribution_allowed or licence_status = 'APPROVED_REDISTRIBUTION'
  ),

  -- Supersession is one fact recorded in two columns; they move together.
  constraint customs_reference_supersession_coherent check (
    (superseded_by_id is null and superseded_at is null)
    or (superseded_by_id is not null and superseded_at is not null)
  ),

  constraint customs_reference_withdrawal_coherent check (
    (withdrawn_by is null and withdrawn_at is null)
    or (withdrawn_by is not null and withdrawn_at is not null)
  ),

  -- A document cannot supersede itself.
  constraint customs_reference_no_self_supersede check (
    supersedes_id is distinct from id and superseded_by_id is distinct from id
  )
);

comment on table public.customs_reference_document is
  'CUSTOMS-REF-01A — Customs Department reference material (CET, Customs Code, regime list, circulars, HS Explanatory Notes). Deliberately NOT public.document: it carries no file_id and is therefore unreachable from the dossier evidence engine.';

-- ---------------------------------------------------------------------------
-- 2. Indexes. tenant_id first, always.
-- ---------------------------------------------------------------------------
create index if not exists idx_customs_reference_tenant_category
  on public.customs_reference_document (tenant_id, category, status);

create index if not exists idx_customs_reference_tenant_status
  on public.customs_reference_document (tenant_id, status, published_on desc);

create index if not exists idx_customs_reference_lineage
  on public.customs_reference_document (tenant_id, reference_code, version desc);

-- ONE live published version per business key. Still partial on the LIFECYCLE,
-- so superseded and withdrawn editions accumulate freely — the history is the
-- point — but no longer partial on `reference_code`, which is now NOT NULL and
-- therefore always carries the rule (F2).
create unique index if not exists uq_customs_reference_one_current
  on public.customs_reference_document (tenant_id, category, reference_code)
  where status = 'PUBLISHED' and superseded_at is null;

-- A superseding document is claimed by exactly one predecessor.
create unique index if not exists uq_customs_reference_supersedes
  on public.customs_reference_document (supersedes_id)
  where supersedes_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The bytes that are stored are the bytes that were uploaded.
--
-- Lifecycle columns move; identity columns never do. Without this, a later
-- UPDATE could repoint `storage_path` or rewrite `content_sha256` and the
-- version history would describe files it no longer refers to.
-- ---------------------------------------------------------------------------
create or replace function public.protect_customs_reference_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id      is distinct from old.tenant_id
     or new.category       is distinct from old.category
     or new.storage_path   is distinct from old.storage_path
     or new.content_sha256 is distinct from old.content_sha256
     or new.size_bytes     is distinct from old.size_bytes
     or new.mime_type      is distinct from old.mime_type
     or new.version        is distinct from old.version
     or new.uploaded_by    is distinct from old.uploaded_by
     or new.uploaded_at    is distinct from old.uploaded_at
  then
    raise exception
      'customs_reference_document: the stored object and its identity are immutable (document %)', old.id;
  end if;

  -- A publication decision is not re-writable either: once published, the
  -- publisher and the moment stand. Withdrawal is the way back, not an edit.
  if old.status = 'PUBLISHED' and new.status = 'PUBLISHED' then
    if new.published_by is distinct from old.published_by
       or new.published_at is distinct from old.published_at then
      raise exception
        'customs_reference_document: a recorded publication cannot be re-attributed (document %)', old.id;
    end if;
  end if;

  -- REF-1-HARDEN (F4) — A WITHDRAWN DOCUMENT IS FROZEN.
  --
  -- `recordVerifications` already refused a withdrawn document and
  -- `recordLicenceRuling` did not, so a licence could be re-ruled on a document
  -- nobody can consult — a governance statement about a retired text, recorded
  -- as though it still mattered. The application refuses it too; this is the
  -- layer that does not depend on remembering to.
  --
  -- The withdrawal itself is still allowed through (old.status <> 'WITHDRAWN'),
  -- and so is a future un-withdrawal, which would be its own governed act.
  if old.status = 'WITHDRAWN' and new.status = 'WITHDRAWN' then
    if new.licence_status is distinct from old.licence_status
       or new.redistribution_allowed is distinct from old.redistribution_allowed
       or new.licence_note is distinct from old.licence_note
       or new.provenance_verified is distinct from old.provenance_verified
       or new.legal_version_verified is distinct from old.legal_version_verified
    then
      raise exception
        'customs_reference_document: a withdrawn document is frozen — its licence and verifications cannot be changed (document %)', old.id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customs_reference_identity on public.customs_reference_document;
create trigger trg_customs_reference_identity
  before update on public.customs_reference_document
  for each row execute function public.protect_customs_reference_identity();

-- REF-1-HARDEN (F2) — A REPLACEMENT INHERITS ITS PREDECESSOR'S IDENTITY.
--
-- The upload route checked the tenant, the category and "not already
-- superseded", and nothing checked the BUSINESS KEY: a replacement could carry
-- a different `reference_code`, which silently split one document's history
-- across two keys and moved the new edition out from under the predecessor's
-- one-current-edition rule. The route still checks all four, so an operator
-- gets a French sentence rather than a constraint — but the rule lives here,
-- because the route is not the only possible writer of a service-role insert.
--
-- INSERT-only by design: `supersedes_id` is immutable afterwards (the identity
-- trigger does not list it, so this is the one moment it is set).
create or replace function public.enforce_customs_reference_lineage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare p record;
begin
  if new.supersedes_id is null then
    return new;
  end if;

  select tenant_id, category, reference_code, superseded_by_id
    into p
    from public.customs_reference_document
   where id = new.supersedes_id;

  if not found then
    raise exception
      'customs_reference_document: the document being replaced does not exist (%)', new.supersedes_id;
  end if;
  if p.tenant_id is distinct from new.tenant_id then
    raise exception
      'customs_reference_document: a replacement may not cross tenants (%)', new.supersedes_id;
  end if;
  if p.category is distinct from new.category then
    raise exception
      'customs_reference_document: a replacement must keep the category of the edition it replaces (%)', new.supersedes_id;
  end if;
  if p.reference_code is distinct from new.reference_code then
    raise exception
      'customs_reference_document: a replacement must keep the reference code of the edition it replaces (% vs %)',
      new.reference_code, p.reference_code;
  end if;
  if p.superseded_by_id is not null then
    raise exception
      'customs_reference_document: that edition has already been replaced (%)', new.supersedes_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_customs_reference_lineage on public.customs_reference_document;
create trigger trg_customs_reference_lineage
  before insert on public.customs_reference_document
  for each row execute function public.enforce_customs_reference_lineage();

drop trigger if exists trg_customs_reference_updated_at on public.customs_reference_document;
create trigger trg_customs_reference_updated_at
  before update on public.customs_reference_document
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — STAFF ONLY, and readers see only what was published.
--
-- No portal policy and no driver path: a customer account and a chauffeur have
-- no business in the Customs library, and the absence of a policy is what
-- denies them rather than a condition that could be edited into truth.
--
-- The two permissions differ in VISIBILITY, not only in capability: a reader
-- sees PUBLISHED documents; a publisher additionally sees QUARANTINE and
-- WITHDRAWN ones, because somebody has to be able to look at a quarantined
-- upload in order to decide about it.
--
-- There is no insert, update or delete policy anywhere here. Every write
-- arrives through the service-role actions, so THE ACTIONS ARE THE BOUNDARY.
-- ---------------------------------------------------------------------------
alter table public.customs_reference_document enable row level security;

drop policy if exists customs_reference_document_select on public.customs_reference_document;
create policy customs_reference_document_select on public.customs_reference_document
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      (status = 'PUBLISHED' and public.has_permission('customs:reference:read'))
      or public.has_permission('customs:reference:publish')
    )
  );

grant select on public.customs_reference_document to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Permissions. Two, narrowly scoped.
--
-- `read` is consultation and nothing else — it carries no upload, publish,
-- replace or withdraw authority, each of which requires `publish`.
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('customs:reference:read',    'customs', 'read',    'all', 'Consulter la bibliothèque douanière de référence'),
  ('customs:reference:publish', 'customs', 'approve', 'all', 'Téléverser, publier, remplacer et retirer les documents de référence douaniers')
on conflict (code) do nothing;

-- Consultation: the customs chain, the roles that supervise it, and the
-- documentation function. DGA is deliberately absent: it holds no customs
-- permission at all today, and a reference-library grant is not the place to
-- give the Direction its first one. DRIVER, COURIER, PICKUP_AGENT, PARTNER_AGENT and
-- CLIENT_USER are deliberately absent.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:reference:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'COORDINATOR',
                 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'CUSTOMS_FIELD_AGENT',
                 'CUSTOMS_FINANCE_OFFICER', 'DOCUMENTATION_OFFICER', 'COMPLIANCE_HSSE')
on conflict do nothing;

-- Publication: the customs authority and the platform administrator. Narrow on
-- purpose — publishing asserts that a document is the current authoritative
-- text, which is the Chef de Transit's professional judgement to make.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:reference:publish'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Private storage bucket. Deny-by-default.
--
-- No storage.objects policies are created, so a browser holding an ordinary
-- authenticated session cannot read this bucket at all. The only path to the
-- bytes is the server route, which streams them after checking authorization —
-- no signed URL is handed out, so there is no shareable link to leak. PDF only,
-- and a ceiling well above anything a single statute needs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customs-reference', 'customs-reference', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;
