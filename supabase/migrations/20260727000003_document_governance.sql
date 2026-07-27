-- 20260727000003_document_governance.sql
-- Effitrans Operations Platform — PHASE WES-4: document governance & BAE.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Implements WES-4A/4B/4D/4E/4F/4H/4I.
--
-- ===========================================================================
-- WHAT THE AUDIT FOUND
-- ===========================================================================
--   * `document` had NO content hash, NO review record, NO reviewer/uploader
--     separation and NO supersession pointer (only `supersedes_id`, which
--     points backwards and leaves the superseded row unaware it was replaced).
--   * THE BAE DID NOT EXIST AS A DOCUMENT. It was a text string on
--     `customs_record.bae_reference`, and `canRelease()` checked only that the
--     string was non-empty. There was no evidence to verify.
--   * `releaseCustoms(id, reference)` was ONE action that recorded the
--     reference, set status RELEASED, stamped reviewed_by, fired the Transport
--     handoff and sent the customer notice — one click, one person, no
--     maker-checker, no evidence.
--   * `TRANSPORT_ORDER` is an UPLOADABLE document type: an internal artifact
--     offered as an upload (category B leak). Classified correctly in
--     lib/documents/doctrine.ts; the upload path is NOT removed here, because
--     no generated replacement exists yet (WES-4G).
--
-- ===========================================================================
-- SCOPE — the governance core (ratified for this phase)
-- ===========================================================================
-- IN:  immutable versions + supersession, append-only review records,
--      structured reason codes, the BAE evidence type, the record/verify/
--      release split, maker-checker, atomic RPCs and events.
-- OUT: internal document GENERATION (WES-4G) and the full document-panel
--      redesign — deferred and documented, not silently dropped.
--
-- NOT DONE ON PURPOSE: the stage-aware requirement resolver
-- (lib/documents/requirements.ts) is NOT wired into getDossierLifecycle.
-- Rewiring changes `missingRequired`, which changes the WES-2 projection's
-- responsibleDepartment, which changes WES-3 visibility for every existing
-- dossier. That reconciliation is WES-5's, and doing it here would move
-- people's access as a side effect of a document phase.

-- ===========================================================================
-- 1. The BAE document type.
--
--    `document_type` is a GLOBAL catalogue (no tenant_id) — see
--    lib/db/tenant-tables.ts GLOBAL_TABLES. required_for is '{}' because
--    applicability is decided by the stage-aware resolver and the pinned
--    policy, NOT by this column; adding it to required_for would recreate the
--    type-only requirement model WES-4C exists to replace.
-- ===========================================================================
insert into public.document_type
  (code, label_fr, label_en, category, required_for, conditional, active, sort_order)
values
  ('BAE', 'Bon À Enlever (BAE)', 'Customs Release Note', 'customs', '{}', true, true, 65)
on conflict (code) do nothing;

-- ===========================================================================
-- 2. Version, integrity and supersession metadata (WES-4B).
--
--    `supersedes_id` already existed and points BACKWARDS. A forward pointer is
--    added so a version knows it has been replaced — without it, "is this the
--    current version?" requires scanning every other row.
-- ===========================================================================
alter table public.document
  add column if not exists superseded_by_id   uuid references public.document (id),
  -- sha256 of the stored bytes. NULL for rows uploaded before WES-4: the bytes
  -- are unchanged but were never hashed, and computing one now would claim an
  -- integrity check that was never performed.
  add column if not exists content_sha256     text,
  -- For generated artifacts (WES-4G): the hash of the structured source data
  -- the artifact was rendered from, so a stale artifact is detectable.
  add column if not exists source_sha256      text,
  add column if not exists renderer_version   text,
  add column if not exists generated_by       uuid references public.app_user (id),
  add column if not exists generated_at       timestamptz,
  -- Which pinned policy governed the review.
  add column if not exists policy_version_id  uuid references public.workflow_policy_version (id),
  -- HONEST classification of pre-WES-4 rows (WES-4L). Nothing is retroactively
  -- claimed to have been maker-checker compliant.
  add column if not exists provenance         text not null default 'GOVERNED'
    check (provenance in (
      'GOVERNED',                 -- uploaded/reviewed under WES-4 rules
      'LEGACY_VERIFIED',          -- APPROVED before WES-4, reviewer known
      'LEGACY_UNVERIFIED',        -- pre-WES-4, never reviewed
      'LEGACY_REVIEWER_UNKNOWN',  -- APPROVED before WES-4, no reviewer recorded
      'LEGACY_GENERATION_UNKNOWN',-- internal artifact uploaded by hand
      'LEGACY_EXTERNALIZED_INTERNAL_DOCUMENT'));

create index if not exists idx_document_superseded_by
  on public.document (superseded_by_id) where superseded_by_id is not null;
create index if not exists idx_document_current
  on public.document (file_id, type_code) where superseded_by_id is null and deleted_at is null;

-- Classify what already exists. Read as: "we do not know", not "it was fine".
update public.document
   set provenance = case
     when status = 'APPROVED' and reviewed_by is not null then 'LEGACY_VERIFIED'
     when status = 'APPROVED' and reviewed_by is null     then 'LEGACY_REVIEWER_UNKNOWN'
     when type_code = 'TRANSPORT_ORDER'                   then 'LEGACY_GENERATION_UNKNOWN'
     else 'LEGACY_UNVERIFIED'
   end
 where provenance = 'GOVERNED';

-- ===========================================================================
-- 3. The canonical lifecycle (WES-4A).
--
--    The CHECK is WIDENED, never replaced: PENDING_REVIEW and APPROVED remain
--    legal because rows carry them, and rewriting them would make the new
--    vocabulary look original. lib/documents/doctrine.ts treats them as
--    read-only aliases of UNDER_REVIEW and VERIFIED.
-- ===========================================================================
alter table public.document drop constraint if exists document_status_check;
alter table public.document
  add constraint document_status_check check (status in (
    'UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'CONSUMED_AS_EVIDENCE',
    'REJECTED', 'SUPERSEDED', 'EXPIRED',
    'PENDING_REVIEW', 'APPROVED'));   -- legacy aliases, read-only

-- ===========================================================================
-- 4. document_review — the PROTECTED record, append-only (WES-4F).
--
--    This is where free-text explanations live, and the ONLY place. The
--    immutable business event carries the structured code, a has_reason
--    boolean and this row's id — never the sentence. That resolves the
--    contradiction WES-9 flagged: governance can always reach the explanation,
--    and the ledger never holds unredactable prose about a colleague's work.
-- ===========================================================================
create table public.document_review (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  -- Plain uuid, deliberately: document_intelligence_job already cascades from
  -- `document`, and a review is the record of a decision. It must survive the
  -- thing it decided about.
  document_id       uuid not null,
  file_id           uuid,
  document_version  int not null,

  action            text not null check (action in (
                      'SUBMITTED', 'VERIFIED', 'REJECTED', 'SUPERSEDED', 'OVERRIDE')),
  reason_code       text,
  -- RESTRICTED free text. Never copied into business_event.
  explanation       text,

  actor_user_id     uuid references public.app_user (id),
  -- Maker-checker: who uploaded the version being decided on. Stored so the
  -- separation is provable after the fact, not merely enforced at write time.
  uploader_user_id  uuid references public.app_user (id),
  maker_checker_required boolean not null default false,

  is_override       boolean not null default false,
  policy_version_id uuid references public.workflow_policy_version (id),

  created_at        timestamptz not null default now()
);

create index idx_document_review_document on public.document_review (document_id, created_at desc);
create index idx_document_review_file on public.document_review (file_id, created_at desc) where file_id is not null;
create index idx_document_review_tenant on public.document_review (tenant_id, created_at desc);

comment on table public.document_review is
  'WES-4F protected review record. Append-only. Holds the structured reason code AND '
  'the restricted free-text explanation; business_event carries only the code, a '
  'has_reason flag and this row id.';

create trigger trg_document_review_no_update
  before update on public.document_review
  for each row execute function public.prevent_mutation();
create trigger trg_document_review_no_delete
  before delete on public.document_review
  for each row execute function public.prevent_mutation();

-- Integrity the application cannot bypass.
create or replace function public.check_document_review()
returns trigger
language plpgsql
as $$
declare v_tenant uuid;
begin
  if new.action in ('REJECTED', 'OVERRIDE') and coalesce(btrim(new.reason_code), '') = '' then
    raise exception 'document_review: a structured reason code is required for %', new.action;
  end if;

  -- MAKER-CHECKER, enforced in the database. The application checks it too;
  -- neither layer trusts the other to have done it.
  if new.action = 'VERIFIED'
     and new.maker_checker_required
     and new.actor_user_id is not null
     and new.actor_user_id = new.uploader_user_id then
    raise exception 'document_review: the uploader cannot verify their own document';
  end if;

  if new.actor_user_id is not null then
    select tenant_id into v_tenant from public.app_user where id = new.actor_user_id;
    if v_tenant is distinct from new.tenant_id then
      raise exception 'document_review: actor belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_document_review_check
  before insert on public.document_review
  for each row execute function public.check_document_review();

-- RLS: SELECT only, following the dossier's own visibility. The explanation is
-- withheld from the client portal by having NO portal policy at all.
alter table public.document_review enable row level security;

create policy document_review_select on public.document_review
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and file_id is not null
    and public.can_read_file(file_id)
  );

grant select on public.document_review to authenticated;

-- ===========================================================================
-- 5. Immutability of decided versions (WES-4A invariants).
--
--    Bytes never change after upload, and a VERIFIED or SUPERSEDED version is
--    frozen. Status may still move forward through the legal graph, and the
--    forward supersession pointer may be set once — everything else is locked.
-- ===========================================================================
create or replace function public.protect_decided_document()
returns trigger
language plpgsql
as $$
begin
  -- The bytes and the identity of a version are immutable from upload, in
  -- every state. "One document version must never change bytes after upload."
  if new.storage_path is distinct from old.storage_path
     or new.content_sha256 is distinct from old.content_sha256 and old.content_sha256 is not null
     or new.version is distinct from old.version
     or new.file_id is distinct from old.file_id
     or new.type_code is distinct from old.type_code then
    raise exception 'document: a version is immutable once uploaded';
  end if;

  -- A superseded version is closed. Only the soft-delete marker may still move
  -- (retire-not-delete stays available to governance).
  if old.status = 'SUPERSEDED'
     and (new.status is distinct from old.status
          or new.reviewed_by is distinct from old.reviewed_by) then
    raise exception 'document: a superseded version cannot be reopened';
  end if;

  -- Supersession is set once and never cleared: history does not un-happen.
  if old.superseded_by_id is not null
     and new.superseded_by_id is distinct from old.superseded_by_id then
    raise exception 'document: supersession cannot be changed once recorded';
  end if;

  return new;
end;
$$;

create trigger trg_document_protect_decided
  before update on public.document
  for each row execute function public.protect_decided_document();

-- ===========================================================================
-- 6. business_event — a fourth source, and the WES-4 types.
-- ===========================================================================
alter table public.business_event drop constraint if exists business_event_source_check;
alter table public.business_event
  add constraint business_event_source_check
  check (source in ('db_trigger', 'policy_rpc', 'app_action', 'assignment_rpc', 'document_rpc'));

-- ===========================================================================
-- 7. review_document — atomic status + review record + event (WES-4I).
--
--    ONE transaction. WES-9A Model A: if the mandatory event fails, the
--    document decision fails with it. The application never does
--    "update the document, then append history, then write an event".
--
--    RPC rather than trigger, for the same reason as WES-3's assignment RPCs:
--    the reason code, the explanation, the maker-checker context and the policy
--    version are NOT derivable from the row. A trigger would have to invent them.
-- ===========================================================================
create or replace function public.review_document(
  p_document_id     uuid,
  p_action          text,
  p_actor           uuid,
  p_reason_code     text default null,
  p_explanation     text default null,
  p_maker_checker   boolean default false,
  p_is_override     boolean default false,
  p_policy_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_file     uuid;
  v_version  int;
  v_status   text;
  v_uploader uuid;
  v_type     text;
  v_new      text;
  v_review   uuid;
  v_event    text;
begin
  select tenant_id, file_id, version, status, uploaded_by, type_code
    into v_tenant, v_file, v_version, v_status, v_uploader, v_type
    from public.document where id = p_document_id for update;
  if not found then raise exception 'document not found'; end if;

  v_new := case p_action
    when 'SUBMITTED' then 'UNDER_REVIEW'
    when 'VERIFIED'  then 'VERIFIED'
    when 'REJECTED'  then 'REJECTED'
    else null
  end;
  if v_new is null then raise exception 'unsupported review action %', p_action; end if;

  -- Legal transition only. The graph lives in lib/documents/doctrine.ts and is
  -- re-asserted here, because SQL is the layer that cannot be bypassed.
  if v_status = v_new then raise exception 'document is already %', v_new; end if;
  if v_status in ('SUPERSEDED', 'CONSUMED_AS_EVIDENCE') then
    raise exception 'a % document cannot be reviewed', v_status;
  end if;
  if p_action = 'VERIFIED' and v_status = 'REJECTED' then
    raise exception 'a rejected version is replaced, not verified in place';
  end if;

  -- The protected record FIRST: its trigger enforces maker-checker and the
  -- reason requirement, so an illegal decision never reaches the document row.
  insert into public.document_review (
    tenant_id, document_id, file_id, document_version, action,
    reason_code, explanation, actor_user_id, uploader_user_id,
    maker_checker_required, is_override, policy_version_id)
  values (
    v_tenant, p_document_id, v_file, v_version, p_action,
    nullif(btrim(coalesce(p_reason_code, '')), ''),
    nullif(btrim(coalesce(p_explanation, '')), ''),
    p_actor, v_uploader, coalesce(p_maker_checker, false),
    coalesce(p_is_override, false), p_policy_id)
  returning id into v_review;

  update public.document
     set status = v_new,
         reviewed_by = case when p_action = 'SUBMITTED' then reviewed_by else p_actor end,
         review_note = null,          -- free text lives in document_review now
         policy_version_id = coalesce(p_policy_id, policy_version_id),
         provenance = 'GOVERNED'
   where id = p_document_id;

  v_event := case p_action
    when 'SUBMITTED' then 'DOCUMENT_VERIFICATION_REQUESTED'
    when 'VERIFIED'  then 'DOCUMENT_VERIFIED'
    when 'REJECTED'  then 'DOCUMENT_REJECTED'
  end;

  -- WES-4F: the CODE and a REFERENCE travel; the explanation never does.
  perform public.emit_business_event(
    v_tenant, v_event, 'document', 'document_rpc',
    'document', p_document_id, v_file, p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'type_code', v_type,
      'previous_status', v_status,
      'new_status', v_new,
      'reason_code', nullif(btrim(coalesce(p_reason_code, '')), ''),
      'has_reason', (nullif(btrim(coalesce(p_explanation, '')), '') is not null),
      'reason_reference_id', v_review::text,
      'is_override', nullif(coalesce(p_is_override, false), false))));

  return jsonb_build_object(
    'document_id', p_document_id, 'file_id', v_file,
    'status', v_new, 'review_id', v_review);
end; $$;

revoke execute on function public.review_document(uuid, text, uuid, text, text, boolean, boolean, uuid) from public;
grant execute on function public.review_document(uuid, text, uuid, text, text, boolean, boolean, uuid) to service_role;

-- ===========================================================================
-- 8. supersede_document — replacement, atomically (WES-4B).
--
--    Creates nothing: the new version is inserted by the ordinary upload path
--    (which the WES-9 trigger already turns into DOCUMENT_UPLOADED). This links
--    them and closes the old one, in one transaction.
-- ===========================================================================
create or replace function public.supersede_document(
  p_old_id   uuid,
  p_new_id   uuid,
  p_actor    uuid,
  p_policy_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid; v_file uuid; v_version int; v_status text; v_type text;
  v_new_tenant uuid; v_new_file uuid;
  v_review uuid;
begin
  if p_old_id = p_new_id then raise exception 'a version cannot supersede itself'; end if;

  select tenant_id, file_id, version, status, type_code
    into v_tenant, v_file, v_version, v_status, v_type
    from public.document where id = p_old_id for update;
  if not found then raise exception 'document not found'; end if;
  if v_status = 'SUPERSEDED' then raise exception 'document is already superseded'; end if;

  select tenant_id, file_id into v_new_tenant, v_new_file
    from public.document where id = p_new_id;
  if not found then raise exception 'replacement document not found'; end if;
  if v_new_tenant is distinct from v_tenant or v_new_file is distinct from v_file then
    raise exception 'a replacement must belong to the same dossier';
  end if;

  insert into public.document_review (
    tenant_id, document_id, file_id, document_version, action,
    actor_user_id, policy_version_id)
  values (v_tenant, p_old_id, v_file, v_version, 'SUPERSEDED', p_actor, p_policy_id)
  returning id into v_review;

  -- Forward pointer and closure on the OLD row; backward pointer on the NEW.
  update public.document
     set superseded_by_id = p_new_id, status = 'SUPERSEDED'
   where id = p_old_id;
  update public.document set supersedes_id = p_old_id where id = p_new_id;

  perform public.emit_business_event(
    v_tenant, 'DOCUMENT_SUPERSEDED', 'document', 'document_rpc',
    'document', p_old_id, v_file, p_actor,
    jsonb_build_object('type_code', v_type, 'reason_reference_id', v_review::text));

  return jsonb_build_object('superseded_id', p_old_id, 'replacement_id', p_new_id, 'review_id', v_review);
end; $$;

revoke execute on function public.supersede_document(uuid, uuid, uuid, uuid) from public;
grant execute on function public.supersede_document(uuid, uuid, uuid, uuid) to service_role;

-- ===========================================================================
-- 9. record_customs_release — the RELEASE FACT ONLY (WES-4E).
--
--    THE SPLIT. `releaseCustoms` used to record the reference, set RELEASED,
--    stamp the reviewer, fire the Transport handoff and notify the customer in
--    one call. Those are five different things and only two of them belong to
--    "the release happened".
--
--    This function records that Customs released the goods, and NOTHING else.
--    It does not verify evidence — that is review_document on the BAE. It does
--    not advance the process engine — WES-5 owns reconciliation, and a document
--    phase must not complete official steps.
--
--    LANGUAGE MATTERS: this is « mainlevée constatée », a fact Effitrans
--    OBSERVES. Effitrans does not approve Customs.
-- ===========================================================================
create or replace function public.record_customs_release(
  p_customs_id    uuid,
  p_bae_reference text,
  p_actor         uuid,
  p_release_date  date default null,
  p_policy_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid; v_file uuid; v_status text; v_existing text;
begin
  if coalesce(btrim(p_bae_reference), '') = '' then
    raise exception 'a BAE reference is required to record a customs release';
  end if;

  select tenant_id, file_id, status, bae_reference
    into v_tenant, v_file, v_status, v_existing
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;
  if v_status = 'RELEASED' then raise exception 'customs release is already recorded'; end if;
  if v_status in ('CANCELLED') then raise exception 'a % customs record cannot be released', v_status; end if;

  update public.customs_record
     set status = 'RELEASED',
         bae_reference = btrim(p_bae_reference),
         release_date = coalesce(p_release_date, current_date),
         reviewed_by = p_actor
   where id = p_customs_id;

  -- The status trigger from WES-9 emits CUSTOMS_RELEASE_COMPLETED and
  -- BAE_RECORDED in this same transaction. They are NOT re-emitted here:
  -- one fact, one event.

  return jsonb_build_object(
    'customs_id', p_customs_id, 'file_id', v_file,
    'bae_reference', btrim(p_bae_reference));
end; $$;

revoke execute on function public.record_customs_release(uuid, text, uuid, date, uuid) from public;
grant execute on function public.record_customs_release(uuid, text, uuid, date, uuid) to service_role;

-- ===========================================================================
-- 10. record_bae_reference — record WITHOUT releasing (WES-4E step 1).
--
--     The Declarant records the official reference and attaches the evidence.
--     This is NOT a release and NOT a verification. Before WES-4 there was no
--     way to say "the BAE arrived" without simultaneously declaring the goods
--     released, which is why one click did everything.
-- ===========================================================================
create or replace function public.record_bae_reference(
  p_customs_id    uuid,
  p_bae_reference text,
  p_actor         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid; v_file uuid; v_status text;
begin
  if coalesce(btrim(p_bae_reference), '') = '' then
    raise exception 'a BAE reference is required';
  end if;

  select tenant_id, file_id, status into v_tenant, v_file, v_status
    from public.customs_record where id = p_customs_id for update;
  if not found then raise exception 'customs record not found'; end if;

  -- Recording the reference NEVER changes the customs status. That separation
  -- is the whole point of the split.
  update public.customs_record
     set bae_reference = btrim(p_bae_reference)
   where id = p_customs_id;

  -- The WES-9 customs trigger emits BAE_RECORDED on the null -> set edge.
  return jsonb_build_object('customs_id', p_customs_id, 'file_id', v_file);
end; $$;

revoke execute on function public.record_bae_reference(uuid, text, uuid) from public;
grant execute on function public.record_bae_reference(uuid, text, uuid) to service_role;

-- ===========================================================================
-- 11. Single ownership of document review events.
--
--     BUG THIS FIXES: the WES-9 trigger emits DOCUMENT_VERIFIED on
--     status -> 'APPROVED' and DOCUMENT_REJECTED on status -> 'REJECTED'.
--     `review_document` above emits the same facts, with the reason code and
--     the protected-record reference the trigger cannot know. Left alone, a
--     rejection through the RPC would append TWO events for one decision.
--
--     The RPC wins, because it carries the fuller envelope. The trigger keeps
--     DOCUMENT_UPLOADED — an insert it alone observes — and stops emitting
--     review transitions.
--
--     Legacy note: a direct write of 'APPROVED'/'REJECTED' outside the RPC now
--     emits nothing. That is intentional and safe, because after WES-4 the RPC
--     is the only writer of those statuses; the application actions are
--     migrated in this same phase, and a test asserts no direct status write
--     remains.
-- ===========================================================================
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
  end if;
  -- Review transitions are emitted by review_document(), which knows the
  -- reason code, whether an explanation exists, and where to find it.
  return null;
exception
  when sqlstate 'EF001' then
    raise;
  when others then
    raise warning 'business_event emission failed on document (%): %', new.id, sqlerrm;
    raise exception
      'Enregistrement impossible : le journal opérationnel n''a pas pu être mis à jour. Aucune modification n''a été enregistrée.'
      using errcode = 'EF001';
end;
$$;
