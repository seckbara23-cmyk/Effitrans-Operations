-- ============================================================================
-- EMP-5C — Corporate mail coexistence: schema foundation (DARK, ADDITIVE)
-- ============================================================================
-- EMP-5B.1 established that ec_mailbox cannot express the one fact coexistence
-- depends on: WHO IS AUTHORITATIVE FOR THE EXISTENCE OF AN ADDRESS. Today the
-- table can say an address exists, but not that it lives in Effitrans's
-- corporate mail system and that this platform merely participates in it.
--
-- This migration adds that vocabulary and nothing else. It activates nothing.
--
-- ZERO-DISRUPTION. It cannot interrupt corporate mail, because it touches no
-- routing, no provider configuration, no DNS, no rollout flag and no message.
-- Every column is additive and nullable-or-defaulted, so every existing row
-- survives byte-identical apart from the new defaults.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * does not create, modify, retype, disable or delete any mailbox --
--     aminata@effitrans.com is left exactly as found;
--   * does not create memberships;
--   * does not enable inbound or outbound, or touch any rollout row;
--   * does not change RLS policies, permissions or role templates;
--   * does not make ACTIVE depend on the new evidence columns. Tightening the
--     lifecycle is a ratified behaviour change, and this is foundation only;
--   * stores NO credentials. Provider secrets live in the environment, never
--     in a row.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP — the central column.
--
-- Answers "who is authoritative for the existence of this mailbox?", which is
-- exactly the question `provisioning_status` cannot answer: that column
-- describes how far THIS PLATFORM got, and silently assumes the platform is
-- the one doing the provisioning.
--
--   PLATFORM_MANAGED   the platform reserved this identity and owns it
--   CORPORATE_EXISTING the address already exists in Effitrans's corporate
--                      mail system; the platform integrates with it and did
--                      NOT create it
--   UNKNOWN            provenance not established
--
-- DEFAULT IS 'UNKNOWN', AND THAT IS THE POINT. The one existing production row
-- has never had its provenance established, so classifying it as
-- CORPORATE_EXISTING would be exactly the kind of convenient assumption this
-- programme exists to stop making. UNKNOWN is the honest value and it grants
-- nothing.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox
  add column if not exists ownership text not null default 'UNKNOWN';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox'::regclass
                    and conname = 'ec_mailbox_ownership_check') then
    alter table public.ec_mailbox
      add constraint ec_mailbox_ownership_check
      check (ownership in ('PLATFORM_MANAGED', 'CORPORATE_EXISTING', 'UNKNOWN'));
  end if;
end $$;

comment on column public.ec_mailbox.ownership is
  'EMP-5C. Who is authoritative for this address existing. CORPORATE_EXISTING '
  'means it lives in the corporate mail system and the platform integrates with '
  'it -- NOT that the platform created it. Defaults to UNKNOWN: provenance is '
  'established by evidence, never inferred.';

-- ---------------------------------------------------------------------------
-- 2. EXTERNAL PROVIDER IDENTITY — all nullable, because the provider is an
-- external fact awaiting confirmation from Effitrans IT (EMP-5B.1 §11).
--
-- NO PROVIDER IS ASSUMED. Public DNS hints at LWS for effitrans.com and
-- Microsoft 365 + OVH for effitrans.sn, but a DNS hint is not a confirmed
-- operational fact, so the column is free text with no CHECK: constraining it
-- now would encode a guess as an invariant.
--
-- NO CREDENTIALS. These identify a mailbox at a provider; they never
-- authenticate to one.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox
  add column if not exists external_provider   text,
  add column if not exists external_mailbox_id text,
  add column if not exists integration_address text;

comment on column public.ec_mailbox.external_provider is
  'EMP-5C. Which system really hosts this mailbox. NULL = not yet confirmed. '
  'Deliberately unconstrained: the provider is an external fact pending IT '
  'confirmation, and a CHECK here would freeze a guess.';
comment on column public.ec_mailbox.external_mailbox_id is
  'EMP-5C. The provider''s own identifier, for reconciliation. Never a credential.';
comment on column public.ec_mailbox.integration_address is
  'EMP-5C. The address a provider-side COPY rule feeds, when capture is fed by '
  'forwarding rather than by MX. Keeping it distinct from `address` is what lets '
  'the corporate mailbox stay the delivery target while the platform sees a copy.';

-- The integration address, when set, obeys the same shape rules as `address`.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox'::regclass
                    and conname = 'ec_mailbox_integration_address_shape') then
    alter table public.ec_mailbox
      add constraint ec_mailbox_integration_address_shape
      check (integration_address is null
             or (integration_address = lower(integration_address)
                 and integration_address like '%@%'
                 and length(integration_address) between 3 and 320));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. VERIFICATION EVIDENCE — auditable, and not yet load-bearing.
--
-- EMP-5A/5B.1 found that ACTIVE currently means "an operator asserted it".
-- These columns give the lifecycle somewhere to record that the platform
-- OBSERVED something instead. They are recorded here and enforced later: making
-- ACTIVE depend on them is a behaviour change requiring its own ratification.
--
-- The *_ref columns hold a pointer to real evidence already stored elsewhere --
-- a provider_message_id, an ec_webhook_event id -- so the claim is checkable
-- rather than self-asserted. They are not free-text reassurance and never a
-- secret.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox
  add column if not exists corporate_identity_confirmed_at timestamptz,
  add column if not exists corporate_identity_confirmed_by uuid,
  add column if not exists outbound_verified_at            timestamptz,
  add column if not exists outbound_verification_ref       text,
  add column if not exists inbound_verified_at             timestamptz,
  add column if not exists inbound_verification_ref        text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox'::regclass
                    and conname = 'ec_mailbox_confirmed_by_fkey') then
    alter table public.ec_mailbox
      add constraint ec_mailbox_confirmed_by_fkey
      foreign key (corporate_identity_confirmed_by) references public.app_user (id);
  end if;
end $$;

comment on column public.ec_mailbox.corporate_identity_confirmed_at is
  'EMP-5C. When a human confirmed this address really exists in the corporate '
  'mail system. Evidence for CONFIGURER, not for ACTIVER.';
comment on column public.ec_mailbox.outbound_verification_ref is
  'EMP-5C. Pointer to the provider acceptance that proves outbound works '
  '(e.g. communication_message.provider_message_id). Checkable, not asserted.';
comment on column public.ec_mailbox.inbound_verification_ref is
  'EMP-5C. Pointer to the captured event that proves inbound works '
  '(e.g. ec_webhook_event.id). Checkable, not asserted.';

-- ---------------------------------------------------------------------------
-- 4. MAILBOX SEMANTICS — add FUNCTIONAL.
--
-- PERSONAL / SHARED could not express a role address such as `noreply@` or
-- `billing@`, which is neither one person's mailbox nor a department's.
--
-- This is a WIDENING change: every existing row is SHARED, so re-adding the
-- CHECK validates for free. The owner-shape rule is unaffected -- FUNCTIONAL,
-- like SHARED, must have no owner.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox drop constraint if exists ec_mailbox_mailbox_type_check;
alter table public.ec_mailbox
  add constraint ec_mailbox_mailbox_type_check
  check (mailbox_type in ('SHARED', 'PERSONAL', 'FUNCTIONAL'));

-- ---------------------------------------------------------------------------
-- 5. ALIAS SEMANTICS — an alias is not always an alias.
--
-- EMP-5B.1 required distinguishing a true alias from a distribution list or a
-- forward, because attaching dossier correspondence to a list that fans out to
-- many people is a materially different act. The table is empty, so the default
-- is free.
-- ---------------------------------------------------------------------------
alter table public.ec_mailbox_alias
  add column if not exists alias_type text not null default 'ALIAS';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox_alias'::regclass
                    and conname = 'ec_mailbox_alias_type_check') then
    alter table public.ec_mailbox_alias
      add constraint ec_mailbox_alias_type_check
      check (alias_type in ('ALIAS', 'DISTRIBUTION_LIST', 'FORWARD'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. PURPOSE INTEGRITY — NOT DONE IN THIS PHASE, AND THE REASON MATTERS.
--
-- EMP-5B.1 recommended constraining `purpose` to the canonical eligibility set.
-- Implementing it revealed that recommendation was wrong, because TWO
-- VOCABULARIES EXIST AND WERE NEVER RECONCILED:
--
--   * EC-1 defined `purpose` as TENANT VOCABULARY -- its own migration says
--     "(quotation, operations, finance, transit, ...)" -- with
--     `default 'GENERAL'`. The EC-1 suite legitimately uses 'QUOTATION'.
--   * EMP-4A later defined SHARED_MAILBOX_PURPOSES -- six values -- for
--     ELIGIBILITY, which is a narrower question layered on top.
--
-- Constraining to the EMP-4A set therefore does three unacceptable things: it
-- invalidates the column's OWN DEFAULT, so any insert omitting `purpose` fails;
-- it retroactively outlaws 'QUOTATION', a value EC-1 designed for; and it
-- settles by migration a vocabulary question that belongs to ratification.
--
-- A constraint whose own default violates it is incoherent, and widening the
-- list until CI passed would have been inventing a vocabulary nobody agreed.
-- So this phase adds NO purpose constraint and reports the conflict instead.
--
-- The inconsistency remains DETECTABLE without a constraint:
--   select address, purpose from public.ec_mailbox
--    where purpose not in ('OPERATIONS','TRANSIT','CUSTOMS','FINANCE',
--                          'COMMERCIAL','SUPPORT');
-- Today that returns aminata@effitrans.com ('GENERAL') -- a mailbox the
-- eligibility engine silently never offers.
--
-- RATIFY-EMP5C-1 must decide whether the two vocabularies merge, whether
-- eligibility keys on something other than `purpose`, and what the default
-- becomes. Only then can integrity be enforced safely.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. ASSERTIONS — data-independent, so they cannot pass vacuously on CI's
-- empty database. Every check below is about SHAPE, not about rows.
-- ---------------------------------------------------------------------------
do $assert_shape$
declare v_missing text;
begin
  -- (a) every new column landed
  select string_agg(c, ', ') into v_missing from (
    select c from unnest(array[
      'ownership','external_provider','external_mailbox_id','integration_address',
      'corporate_identity_confirmed_at','corporate_identity_confirmed_by',
      'outbound_verified_at','outbound_verification_ref',
      'inbound_verified_at','inbound_verification_ref']) as c
    where not exists (select 1 from pg_attribute a
                       where a.attrelid='public.ec_mailbox'::regclass
                         and a.attname=c and not a.attisdropped)
  ) z;
  if v_missing is not null then
    raise exception 'EMP-5C: ec_mailbox missing columns: %', v_missing;
  end if;

  if not exists (select 1 from pg_attribute
                  where attrelid='public.ec_mailbox_alias'::regclass
                    and attname='alias_type' and not attisdropped) then
    raise exception 'EMP-5C: ec_mailbox_alias.alias_type missing';
  end if;

  -- (b) ownership defaults to UNKNOWN. A default of CORPORATE_EXISTING would
  --     silently assert provenance nobody established.
  if coalesce((select column_default from information_schema.columns
                where table_schema='public' and table_name='ec_mailbox'
                  and column_name='ownership'), '') not like '%UNKNOWN%' then
    raise exception 'EMP-5C: ownership must default to UNKNOWN';
  end if;

  -- (c) NO purpose constraint was added (see section 6). Asserting its ABSENCE
  --     keeps the decision visible: if a later phase adds one without settling
  --     RATIFY-EMP5C-1, this fails and forces the conversation.
  if exists (select 1 from pg_constraint
              where conrelid='public.ec_mailbox'::regclass
                and conname='ec_mailbox_purpose_check') then
    raise exception 'EMP-5C: a purpose constraint was added without RATIFY-EMP5C-1';
  end if;

  -- (d) FUNCTIONAL is now representable
  if not exists (select 1 from pg_constraint
                  where conrelid='public.ec_mailbox'::regclass
                    and conname='ec_mailbox_mailbox_type_check'
                    and pg_get_constraintdef(oid) like '%FUNCTIONAL%') then
    raise exception 'EMP-5C: mailbox_type must admit FUNCTIONAL';
  end if;

  raise notice 'EMP-5C: coexistence foundation in place (additive, dark)';
end
$assert_shape$;
