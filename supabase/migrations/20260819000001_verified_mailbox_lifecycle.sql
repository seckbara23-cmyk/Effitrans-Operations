-- ============================================================================
-- EMP-5F — Verified mailbox lifecycle: schema for evidence-backed ACTIVE
-- ============================================================================
-- THE WEAKNESS THIS ADDRESSES. `provisioning_status = 'ACTIVE'` currently means
-- "an operator clicked a button". The production mailbox was reserved and
-- marked ACTIVE NINETEEN SECONDS LATER with an empty note: no external mailbox
-- can be created and verified in nineteen seconds, so ACTIVE there records a
-- human assertion, not an observation.
--
-- Worse, EMP-4A gave the column `default 'ACTIVE'`. Any insert that omits it —
-- a future code path, a seed, an operator's SQL — creates an OPERATIONAL,
-- evidence-free mailbox. That is a route to ACTIVE that passes through no gate
-- at all.
--
-- This migration adds the vocabulary and the accountability columns that make
-- an evidence-backed lifecycle expressible. IT ENFORCES NOTHING BY ITSELF:
-- enforcement is the application's activation guard, and a CHECK cannot express
-- "a different person activated it than recorded the evidence".
--
-- ZERO-DISRUPTION. It touches no routing, no provider, no DNS, no rollout flag,
-- no message, and NO EXISTING ROW. Every column is additive and nullable; the
-- CHECK change is a pure WIDENING, so it validates for free.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * does not modify, reclassify, retype, deactivate or delete any mailbox --
--     the one production row is left exactly as found, ACTIVE, and is surfaced
--     as LEGACY-UNVERIFIED at READ time rather than rewritten here;
--   * does not add a legacy marker column. Legacy-active is derivable with zero
--     inference (`provisioning_status = 'ACTIVE' and activated_by is null`), and
--     a derived fact must not become a stored one;
--   * does not rename or retire the legacy state values. Renaming them would
--     rewrite what a row remembers;
--   * does not create memberships, enable inbound or outbound, or change RLS,
--     permissions or role templates;
--   * stores NO credentials.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. LIFECYCLE VOCABULARY — widened, never rewritten.
--
-- The canonical model is RÉSERVER -> CONFIGURER -> VÉRIFIER -> ACTIVER:
--
--   RESERVED               internal identity recorded; NO claim that the
--                          external mailbox exists
--   CONFIGURATION_REQUIRED external / corporate-provider work is needed
--   CONFIGURED             provider relationship or external identity recorded;
--                          NOT yet proven operational
--   PENDING_VERIFICATION   readiness checks awaiting completion
--   VERIFIED               required evidence exists and is current
--   ACTIVE                 verified AND explicitly enabled for operational use
--   FAILED                 configuration or verification failed, with a reason
--   DISABLED               administratively unavailable
--
-- The five EMP-4A values stay legal because rows hold them today. They are
-- LEGACY ALIASES, mapped to the canonical model in exactly one place in the
-- application (lib/ec/mailboxes/lifecycle.ts) and never written again:
--
--   DRAFT                  -> RESERVED
--   PENDING_EXTERNAL_SETUP -> CONFIGURATION_REQUIRED
--   SETUP_FAILED           -> FAILED
--
-- Keeping both spellings in the CHECK is not a second vocabulary: it is one
-- vocabulary plus the historical spellings of three of its members. EMP-5D's
-- lesson was that a column must not be BOTH a free label and a controlled key;
-- this column stays a controlled key, and the aliases resolve to it.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox drop constraint if exists ec_mailbox_provisioning_status_check;
alter table public.ec_mailbox
  add constraint ec_mailbox_provisioning_status_check
  check (provisioning_status in (
    -- canonical
    'RESERVED', 'CONFIGURATION_REQUIRED', 'CONFIGURED', 'PENDING_VERIFICATION',
    'VERIFIED', 'ACTIVE', 'FAILED', 'DISABLED',
    -- legacy spellings, readable forever, never written again
    'DRAFT', 'PENDING_EXTERNAL_SETUP', 'SETUP_FAILED'
  ));

-- ---------------------------------------------------------------------------
-- 2. THE DEFAULT — the unguarded route to ACTIVE, closed.
--
-- `default 'ACTIVE'` meant an insert that simply forgot the column produced an
-- operational mailbox. RESERVED is the honest default: an identity exists here,
-- and nothing is claimed about the world outside.
--
-- Affects FUTURE inserts only. No existing row changes, and the application's
-- provisioning path already sets the column explicitly, so its behaviour is
-- unchanged either way.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox alter column provisioning_status set default 'RESERVED';

comment on column public.ec_mailbox.provisioning_status is
  'EMP-5F. Governed lifecycle: RESERVED -> CONFIGURATION_REQUIRED -> CONFIGURED '
  '-> PENDING_VERIFICATION -> VERIFIED -> ACTIVE, plus FAILED and DISABLED. '
  'ACTIVE means verified AND explicitly enabled -- it is NOT shorthand for "an '
  'operator clicked success". DRAFT/PENDING_EXTERNAL_SETUP/SETUP_FAILED are '
  'legacy spellings still held by rows; they are read, never written. Defaults '
  'to RESERVED so a forgetful insert cannot create an operational mailbox.';

-- ---------------------------------------------------------------------------
-- 3. ACCOUNTABILITY — who did which half, and when.
--
-- Maker-checker needs two identifiable people, so it needs two recorded people.
-- EMP-5C gave evidence a WHEN and a REFERENCE but no WHO for the capability
-- checks, and there was nowhere at all to record who activated a mailbox — the
-- single most consequential act in the lifecycle.
--
-- All nullable: every existing row genuinely has no answer, and inventing one
-- would fabricate the accountability this phase exists to establish. That NULL
-- is exactly what makes legacy-active detectable without a marker column.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox
  add column if not exists activated_at              timestamptz,
  add column if not exists activated_by              uuid,
  add column if not exists verification_submitted_at timestamptz,
  add column if not exists verification_submitted_by uuid,
  add column if not exists outbound_verified_by      uuid,
  add column if not exists inbound_verified_by       uuid;

do $$
declare
  c record;
begin
  for c in select * from (values
      ('ec_mailbox_activated_by_fkey',              'activated_by'),
      ('ec_mailbox_verification_submitted_by_fkey', 'verification_submitted_by'),
      ('ec_mailbox_outbound_verified_by_fkey',      'outbound_verified_by'),
      ('ec_mailbox_inbound_verified_by_fkey',       'inbound_verified_by')
    ) as t(cname, col)
  loop
    if not exists (select 1 from pg_constraint
                    where conrelid = 'public.ec_mailbox'::regclass and conname = c.cname) then
      execute format(
        'alter table public.ec_mailbox add constraint %I foreign key (%I) references public.app_user (id)',
        c.cname, c.col);
    end if;
  end loop;
end $$;

comment on column public.ec_mailbox.activated_by is
  'EMP-5F. Who put this mailbox into operational use. NULL on a row that '
  'reached ACTIVE before the governed lifecycle existed -- which is how '
  'legacy-unverified ACTIVE is detected at read time, with no inference and no '
  'marker column.';
comment on column public.ec_mailbox.outbound_verified_by is
  'EMP-5F. Who recorded the outbound evidence. Maker-checker needs the maker to '
  'be identifiable, and the checker must not be the same person.';

-- ---------------------------------------------------------------------------
-- 4. ASSERTIONS — shape only, so they cannot pass vacuously on CI's empty
-- database. Nothing here counts rows.
-- ---------------------------------------------------------------------------
do $assert_shape$
declare
  v_missing text;
  v_def     text;
begin
  -- (a) every accountability column landed
  select string_agg(c, ', ') into v_missing from (
    select c from unnest(array[
      'activated_at','activated_by','verification_submitted_at',
      'verification_submitted_by','outbound_verified_by','inbound_verified_by']) as c
    where not exists (select 1 from pg_attribute a
                       where a.attrelid = 'public.ec_mailbox'::regclass
                         and a.attname = c and not a.attisdropped)
  ) z;
  if v_missing is not null then
    raise exception 'EMP-5F: ec_mailbox missing columns: %', v_missing;
  end if;

  -- (b) all nullable. A NOT NULL here would demand an answer for rows that
  --     have none, and the honest answer is the one that makes legacy
  --     detectable.
  if exists (select 1 from pg_attribute
              where attrelid = 'public.ec_mailbox'::regclass
                and attname in ('activated_at','activated_by','verification_submitted_at',
                                'verification_submitted_by','outbound_verified_by',
                                'inbound_verified_by')
                and attnotnull) then
    raise exception 'EMP-5F: accountability columns must all be nullable';
  end if;

  -- (c) the default no longer creates an operational mailbox. THE central
  --     structural fix: this is the route to ACTIVE that passed no gate.
  select column_default into v_def from information_schema.columns
   where table_schema = 'public' and table_name = 'ec_mailbox'
     and column_name = 'provisioning_status';
  if coalesce(v_def, '') like '%ACTIVE%' then
    raise exception 'EMP-5F: provisioning_status must not default to ACTIVE (got %)', v_def;
  end if;
  if coalesce(v_def, '') not like '%RESERVED%' then
    raise exception 'EMP-5F: provisioning_status must default to RESERVED (got %)', v_def;
  end if;

  -- (d) the canonical vocabulary is representable AND the legacy spellings
  --     still are. A widening that dropped a legacy value would invalidate
  --     rows that hold it -- the EMP-5C mistake, in the opposite direction.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.ec_mailbox'::regclass
     and conname = 'ec_mailbox_provisioning_status_check';
  if v_def is null then
    raise exception 'EMP-5F: provisioning_status CHECK missing';
  end if;
  select string_agg(s, ', ') into v_missing from unnest(array[
    'RESERVED','CONFIGURATION_REQUIRED','CONFIGURED','PENDING_VERIFICATION',
    'VERIFIED','ACTIVE','FAILED','DISABLED',
    'DRAFT','PENDING_EXTERNAL_SETUP','SETUP_FAILED']) as s
   where position(s in v_def) = 0;
  if v_missing is not null then
    raise exception 'EMP-5F: provisioning_status CHECK is missing states: %', v_missing;
  end if;

  -- (e) `is_active` is still DERIVED. EMP-4A's trigger is what makes the status
  --     the single writer of routing; if it were ever dropped, a direct write
  --     to is_active would become a second, ungoverned lifecycle.
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.ec_mailbox'::regclass
                    and tgname = 'trg_ec_mailbox_sync_active'
                    and not tgisinternal) then
    raise exception 'EMP-5F: trg_ec_mailbox_sync_active missing -- is_active would stop being derived';
  end if;

  -- (f) no legacy marker column was added. Legacy-active is DERIVED at read
  --     time; storing it would create a second source of truth that drifts.
  if exists (select 1 from pg_attribute
              where attrelid = 'public.ec_mailbox'::regclass
                and attname in ('is_legacy_active','legacy_active','legacy')
                and not attisdropped) then
    raise exception 'EMP-5F: legacy-active must be derived, not stored';
  end if;

  raise notice 'EMP-5F: verified lifecycle vocabulary in place (additive, enforces nothing)';
end
$assert_shape$;
