-- ===========================================================================
-- UT-1 — Decision Plane ordering foundation (migration 85)
--
-- Implements DEC-B88 (UT-1A governance freeze). Two changes, both narrow:
--
--   1. A MONOTONIC ORDINAL on public.business_event, so events emitted inside
--      ONE transaction have a deterministic order. They share `occurred_at` by
--      construction — `now()` is transaction start time — and `id` is a random
--      UUID, so before this migration there was no truthful intra-transaction
--      order at all. That is the defect UT-0 recorded as D3.
--
--   2. A NARROW correction to the SELECT policy so prologue events follow the
--      SUBJECT rather than the ledger (DEC-B88 §5). No permission is minted and
--      SYSTEM_ADMIN gains nothing — it in fact stops seeing commercial prologue
--      events, which is the ratified outcome, not a regression.
--
-- What this migration deliberately does NOT do:
--   * touch a single historical row — no ordinal is synthesised, no
--     `occurred_at` is rewritten, no chronology is invented;
--   * create a second event table, or copy any Observation Plane row;
--   * change the event registry, the metadata policy, or emit_business_event's
--     signature;
--   * relax immutability — `prevent_mutation()` already blocks UPDATE and
--     DELETE for every role including service_role, so the ordinal is immutable
--     the moment it is written, with no new guard required.
--
-- Additive, idempotent, forward-only. Migrations 1–84 are untouched.
-- ===========================================================================

-- ===========================================================================
-- 1. THE MONOTONIC SOURCE.
--
--    A real sequence, not the counter-TABLE pattern used by `file_counter` and
--    `quotation_counter`. Those mint BUSINESS numbers, which must be dense,
--    gap-free and scoped per tenant/type/year — properties that justify a row
--    lock. An ordering ordinal needs none of that: it needs to never block the
--    platform's single event write path. A sequence gives monotonicity without
--    contention; rollback gaps are harmless because we require ORDER, not
--    density, and a gap asserts nothing about history.
--
--    SCOPE: GLOBAL, and deliberately so.
--      * dossier-scoped would need a counter per dossier — a hot row per
--        dossier — and prologue events have no dossier to count against;
--      * tenant-scoped would put a serialization point on every emission for
--        every tenant, to order events that are never compared across tenants
--        anyway (RLS means a reader only ever sees one tenant's rows);
--      * global costs nothing and is never compared across tenants, because
--        the frozen doctrine only ever orders WITHIN a subject's timeline.
--
--    Accepted, documented trade-off: a tenant observing gaps in its own
--    ordinals can infer platform-wide event VOLUME. That is low-sensitivity
--    aggregate information, and the alternative (a per-tenant counter) trades
--    it for write contention on the one path every module depends on. If that
--    trade is ever reversed, the read contract can expose an opaque cursor
--    instead of the raw ordinal with no schema change.
-- ===========================================================================
create sequence if not exists public.business_event_ordinal_seq as bigint;

-- Nobody calls this directly. The trigger below is the only consumer.
revoke all on sequence public.business_event_ordinal_seq from public;

-- ===========================================================================
-- 2. THE COLUMN. Nullable FOREVER: NULL means "this event predates the
--    ordinal, and its position among events sharing its timestamp was never
--    recorded". That is the truth, and it is preserved rather than papered
--    over with a synthesised value.
-- ===========================================================================
alter table public.business_event
  add column if not exists ordinal bigint;

comment on column public.business_event.ordinal is
  'UT-1 monotonic ordering token. Assigned by trigger from '
  'business_event_ordinal_seq; never supplied by a caller and never updatable. '
  'NULL = pre-UT-1 event whose intra-transaction order was never recorded: '
  'such events are GROUPED, never ordered, by consumers. Meaningful only for '
  'ordering within a tenant — never compared across tenants.';

-- ===========================================================================
-- 3. ASSIGNMENT — by trigger, not by emit_business_event().
--
--    Putting it in the trigger rather than the function makes the ordinal
--    UNSPOOFABLE BY CONSTRUCTION: every insert path, present or future,
--    including a direct service-role insert, has its supplied value discarded
--    and replaced. emit_business_event() keeps its exact signature, so no
--    caller changes and no RPC is touched.
--
--    BEFORE INSERT, so the value is set inside the SAME transaction as the
--    event, and commits or rolls back with it.
-- ===========================================================================
create or replace function public.assign_business_event_ordinal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Unconditional. Whatever the caller supplied is discarded.
  new.ordinal := nextval('public.business_event_ordinal_seq');
  return new;
end $$;

revoke all on function public.assign_business_event_ordinal() from public;

drop trigger if exists trg_business_event_ordinal on public.business_event;
create trigger trg_business_event_ordinal
  before insert on public.business_event
  for each row execute function public.assign_business_event_ordinal();

-- The read order, indexed. NULLS LAST mirrors the reader: a pre-ordinal event
-- sorts after an ordinal-bearing one at the same instant, deterministically.
create index if not exists idx_business_event_dossier_order
  on public.business_event (dossier_id, occurred_at desc, ordinal desc nulls last, id desc)
  where dossier_id is not null;

create index if not exists idx_business_event_tenant_order
  on public.business_event (tenant_id, occurred_at desc, ordinal desc nulls last, id desc);

-- ===========================================================================
-- 4. VISIBILITY — the frozen subject-based rule (DEC-B88 §5).
--
--    BEFORE: a non-dossier event required `admin:config:manage`. That single
--    branch covered THREE unrelated things — policy configuration, the
--    quotation prologue and the correspondence prologue — so the people who
--    own a quotation could not see their own commercial history, while a
--    platform administrator could see all of it.
--
--    AFTER: each scope follows the subject it is about. Dossier events are
--    UNCHANGED. No permission is created. Nothing is widened: this is strictly
--    a re-partition, and SYSTEM_ADMIN NARROWS — it holds no quotation
--    authority (DEC-C32) and therefore stops seeing commercial prologue
--    events, which is the ratified intent.
--
--    Stitched events (CORRESPONDENCE_ATTACHED, QUOTATION_CONVERTED_TO_DOSSIER)
--    carry a dossier_id and so fall in the FIRST branch: a dossier reader sees
--    THAT a quotation preceded the dossier without thereby gaining the right
--    to open its amounts, because the amounts are not in the event and the
--    quotation tables have their own policies.
-- ===========================================================================
drop policy if exists business_event_select on public.business_event;
create policy business_event_select on public.business_event
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      -- Dossier events follow the dossier's own visibility rules exactly.
      (dossier_id is not null and public.can_read_file(dossier_id))

      -- Commercial prologue — the quotation read pair, per DEC-C32.
      or (dossier_id is null and event_domain = 'commercial'
          and (public.has_permission('quotation:create')
               or public.has_permission('quotation:validate')))

      -- Correspondence prologue — the EC authorities, per EC-1/EC-2.
      or (dossier_id is null and event_domain = 'communication'
          and (public.has_permission('communication:inbound:read')
               or public.has_permission('communication:triage')))

      -- Configuration history stays exactly where it was.
      or (dossier_id is null and event_domain in ('policy', 'ledger')
          and public.has_permission('admin:config:manage'))
    )
  );
