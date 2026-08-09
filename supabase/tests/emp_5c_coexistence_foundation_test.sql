-- EMP-5C — behavioural tests for the coexistence foundation.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- These INSERT and UPDATE real rows to prove the constraints actually bite,
-- rather than asserting that a constraint exists and hoping. Everything is
-- rolled back; no mailbox survives this suite.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_state  text;
  v_id     uuid;
  v_val    text;
  r_default_unknown      boolean;
  r_corporate_ok         boolean;
  r_platform_ok          boolean;
  r_bad_ownership        boolean;
  r_provider_nullable    boolean;
  r_extid_absent         boolean;
  r_evidence_unverified  boolean;
  r_bad_purpose_rejected boolean;
  r_good_purpose_ok      boolean;
  r_functional_ok        boolean;
  r_alias_default        boolean;
  r_bad_alias_rejected   boolean;
  r_update_bad_purpose   boolean;
  r_integration_shape    boolean;
begin
  ---------------------------------------------------------------------------
  -- B. ownership defaults safely, and C. UNKNOWN implies no platform ownership
  ---------------------------------------------------------------------------
  insert into public.ec_mailbox (tenant_id, address, label_fr, purpose, mailbox_type)
  values (v_tenant, 'emp5c-default@test.local', 'default', 'OPERATIONS', 'SHARED')
  returning id into v_id;
  select ownership into v_val from public.ec_mailbox where id = v_id;
  r_default_unknown := (v_val = 'UNKNOWN');

  -- E/F. provider and external id may stay absent -- the provider is an
  -- external fact nobody has confirmed yet.
  select (external_provider is null), (external_mailbox_id is null)
    into r_provider_nullable, r_extid_absent
    from public.ec_mailbox where id = v_id;

  -- G. verification evidence can represent "unverified" without lying.
  select (corporate_identity_confirmed_at is null
          and outbound_verified_at is null
          and inbound_verified_at is null)
    into r_evidence_unverified
    from public.ec_mailbox where id = v_id;

  ---------------------------------------------------------------------------
  -- D. CORPORATE_EXISTING is representable, with a provider and an
  --    integration address -- the shape a real coexisting mailbox needs.
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_mailbox
      (tenant_id, address, label_fr, purpose, mailbox_type, ownership,
       external_provider, external_mailbox_id, integration_address)
    values (v_tenant, 'emp5c-corporate@test.local', 'corporate', 'SUPPORT', 'SHARED',
            'CORPORATE_EXISTING', 'unconfirmed-provider', 'ext-abc-123',
            'emp5c-integration@test.local');
    r_corporate_ok := true;
  exception when others then r_corporate_ok := false;
  end;

  begin
    insert into public.ec_mailbox
      (tenant_id, address, label_fr, purpose, mailbox_type, ownership)
    values (v_tenant, 'emp5c-platform@test.local', 'platform', 'FINANCE', 'SHARED',
            'PLATFORM_MANAGED');
    r_platform_ok := true;
  exception when others then r_platform_ok := false;
  end;

  -- An invented ownership value must be refused: the vocabulary is closed.
  begin
    insert into public.ec_mailbox
      (tenant_id, address, label_fr, purpose, mailbox_type, ownership)
    values (v_tenant, 'emp5c-bad-own@test.local', 'bad', 'SUPPORT', 'SHARED', 'MINE');
    r_bad_ownership := false;
  exception when check_violation then r_bad_ownership := true;
       when others then r_bad_ownership := false;
  end;

  ---------------------------------------------------------------------------
  -- H. purpose integrity BITES on new rows, even though the constraint is
  --    NOT VALID for the pre-existing one.
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_mailbox (tenant_id, address, label_fr, purpose, mailbox_type)
    values (v_tenant, 'emp5c-bad-purpose@test.local', 'bad', 'GENERAL', 'SHARED');
    r_bad_purpose_rejected := false;   -- accepted => the constraint is inert
  exception when check_violation then r_bad_purpose_rejected := true;
       when others then r_bad_purpose_rejected := false;
  end;

  begin
    insert into public.ec_mailbox (tenant_id, address, label_fr, purpose, mailbox_type)
    values (v_tenant, 'emp5c-good-purpose@test.local', 'good', 'COMMERCIAL', 'SHARED');
    r_good_purpose_ok := true;
  exception when others then r_good_purpose_ok := false;
  end;

  -- ...and an UPDATE cannot smuggle a bad value in either.
  begin
    update public.ec_mailbox set purpose = 'GENERAL' where id = v_id;
    r_update_bad_purpose := false;
  exception when check_violation then r_update_bad_purpose := true;
       when others then r_update_bad_purpose := false;
  end;

  ---------------------------------------------------------------------------
  -- mailbox_type now admits FUNCTIONAL (a role address is neither personal
  -- nor departmental).
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_mailbox (tenant_id, address, label_fr, purpose, mailbox_type)
    values (v_tenant, 'emp5c-noreply@test.local', 'noreply', 'SUPPORT', 'FUNCTIONAL');
    r_functional_ok := true;
  exception when others then r_functional_ok := false;
  end;

  ---------------------------------------------------------------------------
  -- alias semantics
  ---------------------------------------------------------------------------
  insert into public.ec_mailbox_alias (tenant_id, mailbox_id, address)
  values (v_tenant, v_id, 'emp5c-alias@test.local');
  select alias_type into v_val from public.ec_mailbox_alias
   where address = 'emp5c-alias@test.local';
  r_alias_default := (v_val = 'ALIAS');

  begin
    insert into public.ec_mailbox_alias (tenant_id, mailbox_id, address, alias_type)
    values (v_tenant, v_id, 'emp5c-alias2@test.local', 'MAILING_LIST');
    r_bad_alias_rejected := false;
  exception when check_violation then r_bad_alias_rejected := true;
       when others then r_bad_alias_rejected := false;
  end;

  -- integration_address obeys the same shape rule as address
  begin
    update public.ec_mailbox set integration_address = 'NOT-AN-ADDRESS' where id = v_id;
    r_integration_shape := false;
  exception when check_violation then r_integration_shape := true;
       when others then r_integration_shape := false;
  end;

  insert into _r values
    ('ownership defaults to UNKNOWN',                r_default_unknown, coalesce(v_val,'-')),
    ('UNKNOWN is the default, not PLATFORM_MANAGED', r_default_unknown, 'no ownership inferred'),
    ('CORPORATE_EXISTING representable',             r_corporate_ok, 'with provider + integration address'),
    ('PLATFORM_MANAGED representable',               r_platform_ok, '-'),
    ('invented ownership rejected',                  r_bad_ownership, '-'),
    ('provider may remain unknown',                  r_provider_nullable, '-'),
    ('external mailbox id may be absent',            r_extid_absent, '-'),
    ('evidence can represent unverified',            r_evidence_unverified, '-'),
    ('non-canonical purpose REJECTED on insert',     r_bad_purpose_rejected, '-'),
    ('canonical purpose accepted',                   r_good_purpose_ok, '-'),
    ('non-canonical purpose REJECTED on update',     r_update_bad_purpose, '-'),
    ('FUNCTIONAL mailbox type accepted',             r_functional_ok, '-'),
    ('alias_type defaults to ALIAS',                 r_alias_default, '-'),
    ('invented alias_type rejected',                 r_bad_alias_rejected, '-'),
    ('integration_address shape enforced',           r_integration_shape, '-');
end
$suite$;

-- ---------------------------------------------------------------------------
-- ZERO-DISRUPTION: the migration must have activated nothing. These are facts
-- about the database as the migration left it, before this suite's fixtures.
-- ---------------------------------------------------------------------------
do $zero_disruption$
begin
  insert into _r values
    ('no inbound rollout row was created',
     (select count(*) from public.tenant_ec_inbound_rollout) = 0,
     (select count(*)::text from public.tenant_ec_inbound_rollout)),
    ('no membership was created by the migration',
     (select count(*) from public.ec_mailbox_member) = 0,
     (select count(*)::text from public.ec_mailbox_member)),
    ('no webhook event was created',
     (select count(*) from public.ec_webhook_event) = 0,
     (select count(*)::text from public.ec_webhook_event)),
    ('no provider acceptance was fabricated',
     (select count(*) from public.communication_message where provider is not null) = 0,
     (select count(*)::text from public.communication_message where provider is not null));
end
$zero_disruption$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'EMP-5C coexistence suite FAILED: %', v_bad;
  end if;
  raise notice 'EMP-5C coexistence suite: all checks passed';
end
$verdict$;

rollback;
