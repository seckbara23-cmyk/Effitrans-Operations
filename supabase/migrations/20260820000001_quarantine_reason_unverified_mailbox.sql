-- ============================================================================
-- EMP-5G — quarantine vocabulary: an in-service mailbox that is not verified
-- ============================================================================
-- EMP-5G connects EMP-5F's readiness decision to the capture boundary, so mail
-- addressed to a mailbox that is in service but NOT runtime-verified — no
-- evidence, stale evidence, unestablished provenance, or a legacy activation
-- nobody performed — is quarantined instead of routed into a tenant.
--
-- Quarantine already existed and already preserved everything: the message is
-- captured, stored and evidenced with `tenant_id NULL`. What was missing was a
-- WORD for this reason. `quarantine_reason` carries a CHECK, so writing an
-- unlisted value would abort the capture INSERT — which would turn a fail-safe
-- refusal into a lost message. Hence this migration, and hence it must be
-- applied BEFORE the application that writes the new value.
--
-- `mailbox_inactive` was NOT reused. "Switched off" and "never proven to work"
-- need different fixes, and an administrator reading the quarantine list is
-- exactly the person who needs to be told which one they are looking at.
--
-- ZERO-DISRUPTION. A pure WIDENING: every value any row can already hold stays
-- legal, so the constraint validates for free and no row changes. It touches no
-- routing, no provider, no DNS, no rollout flag and no message.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--   * does not enable inbound or outbound, or touch any rollout row;
--   * does not modify, reclassify or deactivate any mailbox;
--   * does not relax `ec_inbound_quarantine_shape` — a quarantined message
--     stays tenant-less, which is what makes it unreachable by any tenant read;
--   * does not add a policy, permission or role.
-- ============================================================================

alter table public.ec_inbound_message
  drop constraint if exists ec_inbound_message_quarantine_reason_check;

alter table public.ec_inbound_message
  add constraint ec_inbound_message_quarantine_reason_check
  check (quarantine_reason is null or quarantine_reason in (
    'no_matching_mailbox',
    'ambiguous_routing',
    'tenant_not_enabled',
    'mailbox_inactive',
    'mailbox_not_verified',   -- EMP-5G
    'payload_too_large',
    'malformed_envelope'
  ));

comment on column public.ec_inbound_message.quarantine_reason is
  'Why a captured message could not be routed to a tenant. EMP-5G adds '
  '`mailbox_not_verified`: the recipient matched an IN-SERVICE mailbox that is '
  'not runtime-verified for inbound. Distinct from `mailbox_inactive` (switched '
  'off) because the two need different fixes.';

-- ---------------------------------------------------------------------------
-- ASSERTIONS — shape only, so they cannot pass vacuously on CI's empty
-- database. Nothing here counts rows.
-- ---------------------------------------------------------------------------
do $assert_shape$
declare
  v_def     text;
  v_missing text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.ec_inbound_message'::regclass
     and conname = 'ec_inbound_message_quarantine_reason_check';
  if v_def is null then
    raise exception 'EMP-5G: quarantine_reason CHECK missing';
  end if;

  -- (a) the new reason is writable...
  if position('mailbox_not_verified' in v_def) = 0 then
    raise exception 'EMP-5G: quarantine_reason must admit mailbox_not_verified';
  end if;

  -- (b) ...and every reason EC-1 defined is STILL writable. A widening that
  --     dropped one would make historical rows unwritable and, worse, would
  --     abort a capture at the moment it most needs to succeed.
  select string_agg(s, ', ') into v_missing from unnest(array[
    'no_matching_mailbox','ambiguous_routing','tenant_not_enabled',
    'mailbox_inactive','payload_too_large','malformed_envelope']) as s
   where position(s in v_def) = 0;
  if v_missing is not null then
    raise exception 'EMP-5G: quarantine_reason CHECK dropped reasons: %', v_missing;
  end if;

  -- (c) quarantine is STILL tenant-less by construction. This is what makes a
  --     quarantined message unreachable by every tenant read, and EMP-5G relies
  --     on it: refusing to route is only safe if the refusal lands somewhere no
  --     tenant can mistake for their own mail.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.ec_inbound_message'::regclass
     and conname = 'ec_inbound_quarantine_shape';
  if v_def is null or position('tenant_id IS NULL' in v_def) = 0 then
    raise exception 'EMP-5G: quarantine must remain tenant-less';
  end if;

  raise notice 'EMP-5G: quarantine vocabulary widened (additive, enforces nothing)';
end
$assert_shape$;
