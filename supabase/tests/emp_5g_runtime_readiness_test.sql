-- EMP-5G — behavioural tests for the quarantine vocabulary widening.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- The runtime eligibility DECISION is pure TypeScript and is tested
-- behaviourally in tests/emp-5g-runtime-readiness.test.ts. What only the
-- database can prove is that the refusal has somewhere legal to land: if
-- `mailbox_not_verified` were not writable, a fail-safe refusal would abort the
-- capture INSERT and the message would be LOST rather than quarantined.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_id     uuid;
  v_tid    uuid;
  r_new_reason_writable   boolean;
  r_old_reasons_writable  boolean;
  r_invented_rejected     boolean;
  r_quarantine_tenantless boolean;
  r_routed_needs_mailbox  boolean;
begin
  ---------------------------------------------------------------------------
  -- A. THE POINT OF THE MIGRATION. The new reason must be writable, or the
  --    refusal EMP-5G introduces would abort the capture that carries it.
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_inbound_message
      (tenant_id, mailbox_id, provider, provider_event_id, from_address,
       raw_sha256, raw_storage_path, raw_size_bytes, received_at,
       capture_status, quarantine_reason)
    values (null, null, 'GENERIC', 'evt_emp5g_001', 'stranger@example.test',
            repeat('a', 64), 'quarantine/5g1/raw.eml', 100, now(),
            'QUARANTINED', 'mailbox_not_verified')
    returning id into v_id;
    r_new_reason_writable := true;
  exception when others then r_new_reason_writable := false;
  end;

  ---------------------------------------------------------------------------
  -- B. Every reason EC-1 defined is STILL writable. A widening that dropped
  --    one would abort a capture at the moment it most needs to succeed.
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_inbound_message
      (tenant_id, mailbox_id, provider, provider_event_id, from_address,
       raw_sha256, raw_storage_path, raw_size_bytes, received_at,
       capture_status, quarantine_reason)
    select null, null, 'GENERIC', 'evt_emp5g_' || s, 'stranger@example.test',
           repeat('b', 64), 'quarantine/5g/' || s || '.eml', 100, now(),
           'QUARANTINED', s
      from unnest(array['no_matching_mailbox','ambiguous_routing','tenant_not_enabled',
                        'mailbox_inactive','payload_too_large','malformed_envelope']) as s;
    r_old_reasons_writable := true;
  exception when others then r_old_reasons_writable := false;
  end;

  ---------------------------------------------------------------------------
  -- C. An invented reason is still refused. The vocabulary widened; it did not
  --    become free text.
  ---------------------------------------------------------------------------
  begin
    insert into public.ec_inbound_message
      (tenant_id, mailbox_id, provider, provider_event_id, from_address,
       raw_sha256, raw_storage_path, raw_size_bytes, received_at,
       capture_status, quarantine_reason)
    values (null, null, 'GENERIC', 'evt_emp5g_bad', 'stranger@example.test',
            repeat('c', 64), 'quarantine/5gbad/raw.eml', 100, now(),
            'QUARANTINED', 'looked_a_bit_odd');
    r_invented_rejected := false;
  exception when check_violation then r_invented_rejected := true;
       when others then r_invented_rejected := false;
  end;

  ---------------------------------------------------------------------------
  -- D. The refusal lands somewhere NO TENANT CAN READ. Refusing to route is
  --    only safe if the refusal is tenant-less — otherwise a message would be
  --    withheld from the mailbox and yet visible to the tenant anyway.
  ---------------------------------------------------------------------------
  select tenant_id into v_tid from public.ec_inbound_message where id = v_id;
  r_quarantine_tenantless := (v_tid is null);

  -- And a QUARANTINED row cannot claim a tenant even if someone tried.
  begin
    update public.ec_inbound_message set tenant_id = v_tenant where id = v_id;
    r_routed_needs_mailbox := false;
  exception when others then r_routed_needs_mailbox := true;  -- shape CHECK or immutability
  end;

  insert into _r values
    ('mailbox_not_verified is writable',        r_new_reason_writable, 'else the capture would abort'),
    ('every EC-1 reason still writable',        r_old_reasons_writable, '6 reasons'),
    ('invented reason still rejected',          r_invented_rejected, 'vocabulary, not free text'),
    ('quarantine is tenant-less',               r_quarantine_tenantless, 'unreachable by any tenant read'),
    ('a quarantined row cannot claim a tenant', r_routed_needs_mailbox, 'shape constraint holds');
end
$suite$;

-- ---------------------------------------------------------------------------
-- ZERO-DISRUPTION: facts about the database as the migration left it.
-- ---------------------------------------------------------------------------
do $zero_disruption$
begin
  insert into _r values
    ('migration enabled no inbound rollout',
     (select count(*) from public.tenant_ec_inbound_rollout) = 0,
     (select count(*)::text from public.tenant_ec_inbound_rollout)),
    ('migration activated no mailbox',
     (select count(*) from public.ec_mailbox where provisioning_status = 'ACTIVE') = 0,
     (select count(*)::text from public.ec_mailbox where provisioning_status = 'ACTIVE')),
    ('migration created no membership',
     (select count(*) from public.ec_mailbox_member) = 0,
     (select count(*)::text from public.ec_mailbox_member)),
    ('migration fabricated no provider acceptance',
     (select count(*) from public.communication_message where provider is not null) = 0,
     (select count(*)::text from public.communication_message where provider is not null)),
    -- EMP-5F must remain intact.
    ('status still defaults to RESERVED',
     coalesce((select column_default from information_schema.columns
                where table_schema = 'public' and table_name = 'ec_mailbox'
                  and column_name = 'provisioning_status'), '') like '%RESERVED%',
     '-'),
    ('routing trigger still present',
     exists (select 1 from pg_trigger
              where tgrelid = 'public.ec_mailbox'::regclass
                and tgname = 'trg_ec_mailbox_sync_active' and not tgisinternal),
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
    raise exception 'EMP-5G runtime readiness suite FAILED: %', v_bad;
  end if;
  raise notice 'EMP-5G runtime readiness suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
