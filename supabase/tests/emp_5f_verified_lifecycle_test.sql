-- EMP-5F — behavioural tests for the verified mailbox lifecycle.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- These INSERT and UPDATE real rows so the schema is proved to BEHAVE, not
-- merely to contain a constraint. Everything is rolled back; no mailbox
-- survives this suite.
--
-- The application's activation guard is tested separately and behaviourally in
-- tests/emp-5f-verified-lifecycle.test.ts — a CHECK constraint cannot express
-- "a different person activated it than recorded the evidence", so the database
-- is not asked to.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_id     uuid;
  v_status text;
  v_active boolean;
  r_default_reserved      boolean;
  r_default_not_active    boolean;
  r_canonical_ok          boolean;
  r_legacy_ok             boolean;
  r_invented_rejected     boolean;
  r_verified_not_routing  boolean;
  r_active_routes         boolean;
  r_is_active_derived     boolean;
  r_direct_is_active_noop boolean;
  r_accountability_null   boolean;
  r_activator_fk          boolean;
begin
  ---------------------------------------------------------------------------
  -- A. THE CENTRAL FIX. An insert that omits the status must NOT produce an
  --    operational mailbox. Before EMP-5F the column defaulted to 'ACTIVE',
  --    so a forgetful insert created a live, evidence-free mailbox.
  ---------------------------------------------------------------------------
  insert into public.ec_mailbox (tenant_id, address, label_fr, purpose, mailbox_type)
  values (v_tenant, 'emp5f-default@test.local', 'default', 'OPERATIONS', 'SHARED')
  returning id into v_id;

  select provisioning_status, is_active into v_status, v_active
    from public.ec_mailbox where id = v_id;
  r_default_reserved   := (v_status = 'RESERVED');
  r_default_not_active := (v_active = false);

  ---------------------------------------------------------------------------
  -- B. The canonical vocabulary is representable.
  ---------------------------------------------------------------------------
  begin
    update public.ec_mailbox set provisioning_status = 'CONFIGURATION_REQUIRED' where id = v_id;
    update public.ec_mailbox set provisioning_status = 'CONFIGURED' where id = v_id;
    update public.ec_mailbox set provisioning_status = 'PENDING_VERIFICATION' where id = v_id;
    update public.ec_mailbox set provisioning_status = 'VERIFIED' where id = v_id;
    r_canonical_ok := true;
  exception when others then r_canonical_ok := false;
  end;

  -- VERIFIED means the evidence exists — it does NOT mean the mailbox routes.
  -- Conflating the two is exactly the collapse this phase undoes.
  select is_active into v_active from public.ec_mailbox where id = v_id;
  r_verified_not_routing := (v_active = false);

  ---------------------------------------------------------------------------
  -- C. Legacy spellings remain legal. Rows hold them; outlawing them would
  --    invalidate history rather than improve it.
  ---------------------------------------------------------------------------
  begin
    update public.ec_mailbox set provisioning_status = 'PENDING_EXTERNAL_SETUP' where id = v_id;
    update public.ec_mailbox set provisioning_status = 'SETUP_FAILED' where id = v_id;
    update public.ec_mailbox set provisioning_status = 'DRAFT' where id = v_id;
    r_legacy_ok := true;
  exception when others then r_legacy_ok := false;
  end;

  begin
    update public.ec_mailbox set provisioning_status = 'PROBABLY_FINE' where id = v_id;
    r_invented_rejected := false;
  exception when check_violation then r_invented_rejected := true;
       when others then r_invented_rejected := false;
  end;

  ---------------------------------------------------------------------------
  -- D. Routing follows the lifecycle, and ONLY the lifecycle.
  ---------------------------------------------------------------------------
  update public.ec_mailbox set provisioning_status = 'ACTIVE' where id = v_id;
  select is_active into v_active from public.ec_mailbox where id = v_id;
  r_active_routes := (v_active = true);

  update public.ec_mailbox set provisioning_status = 'DISABLED' where id = v_id;
  select is_active into v_active from public.ec_mailbox where id = v_id;
  r_is_active_derived := (v_active = false);

  -- THE DEFECT EMP-5F REMOVED, PROVED AT THE DATABASE. `setMailboxActive` wrote
  -- this column directly; EMP-4A's trigger reverts it, so the write changed
  -- nothing while the action reported success and audited a state change. The
  -- action is gone — this asserts WHY it had to be.
  update public.ec_mailbox set is_active = true where id = v_id;
  select is_active into v_active from public.ec_mailbox where id = v_id;
  r_direct_is_active_noop := (v_active = false);

  ---------------------------------------------------------------------------
  -- E. Accountability columns exist, start empty, and reference a real person.
  ---------------------------------------------------------------------------
  select (activated_at is null and activated_by is null
          and verification_submitted_at is null and verification_submitted_by is null
          and outbound_verified_by is null and inbound_verified_by is null)
    into r_accountability_null
    from public.ec_mailbox where id = v_id;

  begin
    update public.ec_mailbox
       set activated_by = '00000000-0000-0000-0000-0000000000ff'
     where id = v_id;
    r_activator_fk := false;   -- a non-existent person must not be recordable
  exception when foreign_key_violation then r_activator_fk := true;
       when others then r_activator_fk := false;
  end;

  insert into _r values
    ('status defaults to RESERVED',                    r_default_reserved, coalesce(v_status,'-')),
    ('a forgetful insert is NOT operational',          r_default_not_active, '-'),
    ('canonical lifecycle states representable',       r_canonical_ok, 'CONFIGURATION_REQUIRED..VERIFIED'),
    ('VERIFIED does not route mail',                   r_verified_not_routing, 'evidence <> service'),
    ('legacy spellings still legal',                   r_legacy_ok, 'DRAFT/PENDING_EXTERNAL_SETUP/SETUP_FAILED'),
    ('invented state rejected',                        r_invented_rejected, '-'),
    ('ACTIVE routes mail',                             r_active_routes, '-'),
    ('DISABLED stops routing',                         r_is_active_derived, '-'),
    ('direct is_active write is a no-op',              r_direct_is_active_noop, 'trigger derives it from the status'),
    ('accountability starts empty',                    r_accountability_null, '-'),
    ('activator must be a real person',                r_activator_fk, 'FK to app_user');
end
$suite$;

-- ---------------------------------------------------------------------------
-- ZERO-DISRUPTION: facts about the database as the migration left it, before
-- this suite's fixtures touched anything.
-- ---------------------------------------------------------------------------
do $zero_disruption$
begin
  insert into _r values
    ('migration activated no mailbox',
     (select count(*) from public.ec_mailbox
       where provisioning_status = 'ACTIVE' and address like '%test.local') = 0,
     '-'),
    ('migration created no membership',
     (select count(*) from public.ec_mailbox_member) = 0,
     (select count(*)::text from public.ec_mailbox_member)),
    ('migration enabled no inbound rollout',
     (select count(*) from public.tenant_ec_inbound_rollout) = 0,
     (select count(*)::text from public.tenant_ec_inbound_rollout)),
    ('migration fabricated no provider acceptance',
     (select count(*) from public.communication_message where provider is not null) = 0,
     (select count(*)::text from public.communication_message where provider is not null)),
    -- The derived-routing trigger must survive. Without it a direct is_active
    -- write becomes a second, ungoverned lifecycle again.
    ('routing trigger still present',
     exists (select 1 from pg_trigger
              where tgrelid = 'public.ec_mailbox'::regclass
                and tgname = 'trg_ec_mailbox_sync_active' and not tgisinternal),
     '-'),
    -- EMP-5E must remain intact: purpose is still free vocabulary.
    ('purpose remains unconstrained',
     not exists (select 1 from pg_constraint
                  where conrelid = 'public.ec_mailbox'::regclass
                    and conname = 'ec_mailbox_purpose_check'),
     '-');
end
$zero_disruption$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'EMP-5F verified lifecycle suite FAILED: %', v_bad;
  end if;
  raise notice 'EMP-5F verified lifecycle suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
