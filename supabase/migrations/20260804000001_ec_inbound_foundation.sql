-- 20260804000001_ec_inbound_foundation.sql
-- Effitrans — EC-1: Inbound Email Foundation (capture only, dark).
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 80. Migrations 1–79 untouched.
--
-- SEVEN RULES THIS MIGRATION ENCODES, EACH ONE MANDATED BY EC-0:
--
-- 1. CAPTURE ONLY. Nothing below can create a client, quotation request,
--    dossier, document, task or invoice. There is no foreign key FROM this
--    schema INTO any business table — deliberately. An unauthenticated internet
--    input must never mint a row in an operational table (ADR-EC-1).
--
-- 2. THE MESSAGE IS IMMUTABLE, THE TRIAGE IS NOT. `ec_inbound_message` is
--    append-only (prevent_mutation) — what the provider delivered is evidence
--    and is never rewritten. Everything mutable lives in `ec_triage_item`, a
--    1:1 companion. "Corrections occur through triage metadata" is therefore a
--    structural fact, not a convention someone must remember.
--
-- 3. ROUTING IS EXPLICIT OR IT IS QUARANTINE. An address resolves to exactly
--    ONE tenant — enforced by a GLOBAL unique index on the address, not a
--    per-tenant one. Zero matches, or matches spanning more than one mailbox,
--    quarantine. Tenant ownership is NEVER inferred from sender, content or AI.
--
-- 4. QUARANTINE HAS NO TENANT. A quarantined row carries tenant_id = NULL, so
--    the tenant RLS predicate excludes it from EVERY tenant. Unrouted mail is
--    visible to nobody through the application — it cannot leak into the wrong
--    tenant because it belongs to none.
--
-- 5. TWO NEW PERMISSIONS, GRANTED TO NOBODY. `communication:read` is ALREADY
--    granted to five roles INCLUDING SYSTEM_ADMIN (migration 20260615000008),
--    so reusing it would hand every inbound customer email to a platform
--    administrator by default — which EC-1's own security requirement forbids.
--    Inbound therefore gets its own read gate. See §1.
--
-- 6. BODIES AND ATTACHMENTS ARE REFERENCES, NEVER COLUMNS. Message bodies live
--    in the private `ec-inbound` bucket and are addressed by path. No prose
--    column exists on any table here, so no query, log line, audit payload or
--    error message can accidentally carry one (C3-adjacent discipline).
--
-- 7. NO SCHEDULER, NO POLLING. Transport is a signed webhook. IMAP polling
--    would need the scheduler this platform deliberately does not have.

-- ===========================================================================
-- 1. PERMISSIONS — catalogue only, granted to NOBODY.
--
--    WHY NOT REUSE `communication:read`: it is granted to SYSTEM_ADMIN, CEO,
--    OPS_SUPERVISOR, ACCOUNT_MANAGER and FINANCE_OFFICER. Inbound correspondence
--    is customer prose — a different and more sensitive dataset than the
--    outbound send-log that permission was written for. Reusing it would grant
--    five roles read access to every incoming customer email the moment this
--    migration lands, and would put tenant correspondence in front of
--    SYSTEM_ADMIN automatically, which EC-1 explicitly refuses (the DEC-B25
--    doctrine applied to a second dataset).
--
--    `communication:triage` is catalogued here so EC-2 needs no permission
--    migration of its own; EC-1 does not use it (there is no triage action yet).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('communication:inbound:read', 'communication', 'inbound_read', 'all',
   'Consulter les courriels entrants capturés (correspondance client — distinct du journal d''envoi)'),
  ('communication:triage', 'communication', 'triage', 'all',
   'Trier un courriel entrant et décider de sa suite (autorité distincte de communication:manage)')
on conflict (code) do nothing;

-- ===========================================================================
-- 2. MAILBOX REGISTRY — tenant-owned, explicitly configured.
--    `purpose` is TENANT VOCABULARY (quotation, operations, finance, transit,
--    support, …) carried as configuration metadata. EC-1 stores it and starts
--    NOTHING: no workflow, no routing to a department, no assignment. It exists
--    so EC-2 has something ratified to dispatch on.
--    No platform or customer domain is hardcoded anywhere in this migration.
-- ===========================================================================
create table if not exists public.ec_mailbox (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  -- Stored lowercased; the CHECK makes case-collision impossible rather than
  -- relying on every caller to remember to normalize.
  address      text not null,
  label_fr     text not null,
  purpose      text not null default 'GENERAL',
  is_active    boolean not null default true,
  note         text,
  created_by   uuid references public.app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ec_mailbox_address_lowercase check (address = lower(address)),
  constraint ec_mailbox_address_shape check (address like '%@%' and length(address) between 3 and 320)
);

-- GLOBAL uniqueness, deliberately not per-tenant: rule 3. Two tenants claiming
-- the same address would make routing a guess, and this refuses to allow it.
create unique index if not exists uq_ec_mailbox_address on public.ec_mailbox (address);
create index if not exists idx_ec_mailbox_tenant on public.ec_mailbox (tenant_id, is_active);

drop trigger if exists trg_ec_mailbox_updated_at on public.ec_mailbox;
create trigger trg_ec_mailbox_updated_at before update on public.ec_mailbox
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. WEBHOOK EVENT LOG — every delivery attempt, including refused ones.
--    Mirrors public.provider_webhook_event (Phase 1.15B) exactly: the unique
--    (provider, provider_event_id) IS the idempotency anchor, and rejected
--    deliveries are logged even though they never produce a message.
--    tenant_id is NULLABLE — a rejected or unrouted delivery has no tenant.
-- ===========================================================================
create table if not exists public.ec_webhook_event (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.organization (id),
  provider          text not null,
  provider_event_id text not null,
  signature_valid   boolean not null,
  outcome           text not null
                      check (outcome in ('CAPTURED','DUPLICATE','QUARANTINED','REJECTED','ERROR')),
  -- A short, non-prose classification. NEVER a body, subject or address.
  detail            text,
  received_at       timestamptz not null default now(),
  unique (provider, provider_event_id)
);
create index if not exists idx_ec_webhook_event_tenant
  on public.ec_webhook_event (tenant_id, received_at desc);

drop trigger if exists trg_ec_webhook_event_immutable on public.ec_webhook_event;
create trigger trg_ec_webhook_event_immutable
  before update or delete on public.ec_webhook_event
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 4. INBOUND MESSAGE — the immutable envelope (rule 2).
--    Enough evidence to prove what the provider delivered, and not one column
--    of prose (rule 6): bodies are PATHS into the private bucket.
-- ===========================================================================
create table if not exists public.ec_inbound_message (
  id                  uuid primary key default gen_random_uuid(),
  -- NULL for quarantine (rule 4) — belongs to no tenant, visible to none.
  tenant_id           uuid references public.organization (id),
  mailbox_id          uuid references public.ec_mailbox (id),

  -- Provider evidence.
  provider            text not null,
  provider_event_id   text not null,
  provider_message_id text,

  -- RFC 5322 threading identifiers (EC-4 will correlate on these).
  message_id          text,
  in_reply_to         text,
  references_header   text,
  thread_key          text,

  -- Participants and subject. Addresses are identifiers, not prose.
  from_address        text not null,
  from_name           text,
  to_addresses        jsonb not null default '[]'::jsonb,
  cc_addresses        jsonb not null default '[]'::jsonb,
  -- The one short human string retained inline, for triage lists. Never logged.
  subject             text,

  -- Integrity of the original envelope.
  raw_sha256          text not null,
  raw_storage_path    text not null,
  raw_size_bytes      bigint not null check (raw_size_bytes >= 0),
  -- Normalized headers, header names + values only. Bodies never land here.
  headers             jsonb not null default '{}'::jsonb,
  -- Bodies live in the bucket; these are PATHS, nullable when absent.
  text_body_path      text,
  html_body_path      text,

  received_at         timestamptz not null,
  captured_at         timestamptz not null default now(),

  capture_status      text not null default 'RECEIVED'
                        check (capture_status in ('RECEIVED','QUARANTINED')),
  quarantine_reason   text
                        check (quarantine_reason is null or quarantine_reason in (
                          'no_matching_mailbox','ambiguous_routing','tenant_not_enabled',
                          'mailbox_inactive','payload_too_large','malformed_envelope')),

  constraint ec_inbound_quarantine_shape check (
    (capture_status = 'RECEIVED'    and tenant_id is not null and mailbox_id is not null
                                    and quarantine_reason is null)
    or
    (capture_status = 'QUARANTINED' and tenant_id is null and quarantine_reason is not null)
  ),
  unique (provider, provider_event_id)
);

create index if not exists idx_ec_inbound_tenant
  on public.ec_inbound_message (tenant_id, received_at desc);
create index if not exists idx_ec_inbound_mailbox
  on public.ec_inbound_message (mailbox_id, received_at desc);
create index if not exists idx_ec_inbound_quarantine
  on public.ec_inbound_message (capture_status, received_at desc)
  where capture_status = 'QUARANTINED';
create index if not exists idx_ec_inbound_thread
  on public.ec_inbound_message (tenant_id, thread_key) where thread_key is not null;
create index if not exists idx_ec_inbound_provider_message
  on public.ec_inbound_message (provider, provider_message_id)
  where provider_message_id is not null;

-- Rule 2 — the capture is evidence. No UPDATE, no DELETE, ever.
drop trigger if exists trg_ec_inbound_message_immutable on public.ec_inbound_message;
create trigger trg_ec_inbound_message_immutable
  before update or delete on public.ec_inbound_message
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 5. ATTACHMENTS — metadata for EVERY part, bytes only for allowed types.
--    A refused attachment is still RECORDED (filename, mime, size, hash) so the
--    register proves what arrived; only its bytes are not extracted. The raw
--    envelope in the bucket still contains it either way, so no evidence is
--    lost — this is a storage-hygiene decision, not an evidence decision.
--    These are EVIDENCE-IN-WAITING (ADR-EC-5): nothing here is a public.document
--    and no foreign key points at one.
-- ===========================================================================
create table if not exists public.ec_inbound_attachment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.organization (id),
  message_id        uuid not null references public.ec_inbound_message (id),
  -- As sanitized by the application; the original is kept for the record.
  filename          text not null,
  original_filename text,
  mime_type         text,
  size_bytes        bigint not null default 0 check (size_bytes >= 0),
  sha256            text,
  -- NULL when the bytes were not extracted (see stored/rejection_reason).
  storage_path      text,
  stored            boolean not null default false,
  rejection_reason  text
                      check (rejection_reason is null or rejection_reason in (
                        'mime_not_allowed','too_large','extraction_failed')),
  created_at        timestamptz not null default now(),
  constraint ec_attachment_stored_shape check (
    (stored = true  and storage_path is not null and rejection_reason is null)
    or
    (stored = false and storage_path is null     and rejection_reason is not null)
  )
);
create index if not exists idx_ec_attachment_message
  on public.ec_inbound_attachment (message_id);
-- Duplicate/replay detection across a tenant's corpus.
create index if not exists idx_ec_attachment_hash
  on public.ec_inbound_attachment (tenant_id, sha256) where sha256 is not null;

drop trigger if exists trg_ec_attachment_immutable on public.ec_inbound_attachment;
create trigger trg_ec_attachment_immutable
  before update or delete on public.ec_inbound_attachment
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- 6. TRIAGE ITEM — the mutable half (rule 2). 1:1 with a captured message.
--    EC-1 ships the STATUS AND ASSIGNMENT FOUNDATION ONLY. There is
--    deliberately no outcome column, no dossier reference and no quotation
--    reference: those are EC-2's decisions and EC-2 will add them additively.
-- ===========================================================================
create table if not exists public.ec_triage_item (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.organization (id),
  message_id    uuid not null references public.ec_inbound_message (id) unique,
  status        text not null default 'NEW'
                  check (status in ('NEW','ASSIGNED','IN_REVIEW','RESOLVED','QUARANTINED')),
  assigned_to   uuid references public.app_user (id),
  assigned_at   timestamptz,
  resolved_at   timestamptz,
  -- A short operator note. Not message content.
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ec_triage_assigned_shape
    check (status <> 'ASSIGNED' or assigned_to is not null),
  constraint ec_triage_resolved_shape
    check (status <> 'RESOLVED' or resolved_at is not null)
);
create index if not exists idx_ec_triage_tenant_status
  on public.ec_triage_item (tenant_id, status, created_at desc);
create index if not exists idx_ec_triage_assignee
  on public.ec_triage_item (assigned_to) where assigned_to is not null;

drop trigger if exists trg_ec_triage_updated_at on public.ec_triage_item;
create trigger trg_ec_triage_updated_at before update on public.ec_triage_item
  for each row execute function public.set_updated_at();

-- A quarantined item is terminal here: EC-1 has no release action, so nothing
-- may move it out. RESOLVED is likewise terminal. Transitions that EC-2 will
-- need (NEW→ASSIGNED→IN_REVIEW→RESOLVED) are allowed; invented ones are not.
create or replace function public.ec_triage_transition_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then return new; end if;
  if old.status in ('RESOLVED','QUARANTINED') then
    raise exception 'un élément de tri % est terminal', old.status using errcode = 'EC601';
  end if;
  if new.status = 'QUARANTINED' then
    raise exception 'la quarantaine est décidée à la capture, jamais après' using errcode = 'EC602';
  end if;
  if not (
       (old.status = 'NEW'       and new.status in ('ASSIGNED','IN_REVIEW','RESOLVED'))
    or (old.status = 'ASSIGNED'  and new.status in ('IN_REVIEW','RESOLVED','NEW'))
    or (old.status = 'IN_REVIEW' and new.status in ('RESOLVED','ASSIGNED'))
  ) then
    raise exception 'transition de tri interdite : % -> %', old.status, new.status
      using errcode = 'EC603';
  end if;
  return new;
end $$;
drop trigger if exists trg_ec_triage_guard on public.ec_triage_item;
create trigger trg_ec_triage_guard before update on public.ec_triage_item
  for each row execute function public.ec_triage_transition_guard();

-- ===========================================================================
-- 7. TENANT ROLLOUT — layer two of the two-layer flag (the standing doctrine:
--    effective = env AND tenant row; a missing row means OFF).
--    Shape/RLS copied from tenant_messaging_rollout.
-- ===========================================================================
create table if not exists public.tenant_ec_inbound_rollout (
  tenant_id        uuid primary key references public.organization (id) on delete cascade,
  enabled          boolean not null default false,
  note             text,
  first_enabled_at timestamptz,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.platform_admin (id)
);

-- ===========================================================================
-- 8. PRIVATE BUCKET — raw envelopes, bodies and extracted attachments.
--    Private, service-role only, short-TTL signed URLs minted server-side.
--    No allowed_mime_types list: this bucket holds raw RFC-822 envelopes whose
--    type we do not control. The MIME allow-list is enforced in the application
--    for EXTRACTED ATTACHMENTS, where it is a meaningful decision; refusing an
--    envelope by its content type would discard the evidence we exist to keep.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('ec-inbound', 'ec-inbound', false, 26214400)
on conflict (id) do nothing;

-- ===========================================================================
-- 9. RLS — every table, from birth.
--    Reads: tenant + `communication:inbound:read` (granted to NOBODY today).
--    Writes: service role only. NO portal policy — customers never read staff
--    correspondence. Quarantined rows carry tenant_id = NULL and are therefore
--    excluded by the tenant predicate for every tenant (rule 4).
-- ===========================================================================
alter table public.ec_mailbox               enable row level security;
alter table public.ec_webhook_event         enable row level security;
alter table public.ec_inbound_message       enable row level security;
alter table public.ec_inbound_attachment    enable row level security;
alter table public.ec_triage_item           enable row level security;
alter table public.tenant_ec_inbound_rollout enable row level security;

drop policy if exists ec_mailbox_select on public.ec_mailbox;
create policy ec_mailbox_select on public.ec_mailbox
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:inbound:read'));

drop policy if exists ec_webhook_event_select on public.ec_webhook_event;
create policy ec_webhook_event_select on public.ec_webhook_event
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:inbound:read'));

drop policy if exists ec_inbound_message_select on public.ec_inbound_message;
create policy ec_inbound_message_select on public.ec_inbound_message
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:inbound:read'));

drop policy if exists ec_inbound_attachment_select on public.ec_inbound_attachment;
create policy ec_inbound_attachment_select on public.ec_inbound_attachment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:inbound:read'));

drop policy if exists ec_triage_item_select on public.ec_triage_item;
create policy ec_triage_item_select on public.ec_triage_item
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('communication:inbound:read'));

drop policy if exists tenant_ec_inbound_rollout_select on public.tenant_ec_inbound_rollout;
create policy tenant_ec_inbound_rollout_select on public.tenant_ec_inbound_rollout
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

grant select on public.ec_mailbox, public.ec_webhook_event, public.ec_inbound_message,
                public.ec_inbound_attachment, public.ec_triage_item,
                public.tenant_ec_inbound_rollout
  to authenticated;
