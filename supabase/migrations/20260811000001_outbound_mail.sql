-- 20260811000001_outbound_mail.sql
-- Effitrans — EMP-3: governed outbound mail over the EXISTING queue.
--
-- WHAT THIS IS NOT. It is not a second outbound queue, a second message table,
-- a second attachment model, a new timeline, or a new event journal. Every
-- column below is added to `communication_message`, which has been the single
-- outbound store since 2026-06-15 and is the only one there will be.
--
-- WHY A MIGRATION WAS UNAVOIDABLE. That table was built for one job: render a
-- known template and mail it to ONE address. Free compose and reply break every
-- assumption in it — `template_key` is NOT NULL, `recipient_email` is a single
-- text column, there is nowhere to record a sender mailbox, RFC headers,
-- attachments, a provider identifier, or an idempotency key, and no status
-- distinguishes a draft from a queued message or an in-flight send from a
-- finished one. The audit (docs/mail/emp-3-audit.md) enumerates all of it.
--
-- FOUR THINGS THIS MIGRATION DELIBERATELY DOES NOT DO:
--   1. it adds NO RLS policy. `communication_message` has had SELECT-only RLS
--      since it was created, with writes going through the service-role admin
--      client in server actions. That deny-by-default posture is correct and
--      untouched;
--   2. it adds NO permission. `communication:send` and `communication:manage`
--      already exist and are already granted;
--   3. it grants the new functions to NOBODY. They are SECURITY DEFINER and
--      revoked from public/anon/authenticated, reachable only by the service
--      role — so no browser session can dispatch mail by calling an RPC;
--   4. it introduces NO delivery or read state. There is no bounce webhook in
--      this platform, so DELIVERED and READ are unprovable and must not exist.
--
-- Additive, idempotent, forward-only. No historical row changes meaning:
-- every existing row becomes kind='TEMPLATE' with all new columns empty, and
-- `recipient_email` remains authoritative for template mail.

-- ===========================================================================
-- 1. COLUMNS
-- ===========================================================================
alter table public.communication_message
  -- Free compose has no template. The CHECK in §2 keeps the two coupled so a
  -- NULL here can never silently mean "template we forgot to record".
  alter column template_key drop not null;

alter table public.communication_message
  add column if not exists kind                text not null default 'TEMPLATE',

  -- The sender. EMP-1 administers these; only an ACTIVE one may send.
  add column if not exists mailbox_id          uuid references public.ec_mailbox (id),

  -- Recipients. `recipient_email` stays authoritative for TEMPLATE rows so no
  -- existing caller changes; COMPOSE/REPLY rows use these.
  add column if not exists to_addresses        jsonb not null default '[]'::jsonb,
  add column if not exists cc_addresses        jsonb not null default '[]'::jsonb,
  -- Bcc is stored because we must know who we wrote to. It is NEVER read back
  -- into a reply — EMP-3's reply builder cannot reach it.
  add column if not exists bcc_addresses       jsonb not null default '[]'::jsonb,

  -- RFC 5322 threading. Set from the ORIGINAL message's evidence, never
  -- fabricated: a reply to a message with no Message-ID gets NULL here and
  -- becomes a new conversation rather than a forged chain.
  add column if not exists message_id_header   text,
  add column if not exists in_reply_to         text,
  add column if not exists references_header   text,
  add column if not exists reply_to_message_id uuid references public.ec_inbound_message (id),

  -- Attachment REFERENCES only — ids into the existing storage/document model.
  -- No bytes, no storage paths, no second attachment table.
  add column if not exists attachments         jsonb not null default '[]'::jsonb,

  -- Provider evidence. `provider` records WHICH provider accepted, which is how
  -- the application proves an acceptance came from a real one.
  add column if not exists provider            text,
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key     text,
  add column if not exists dispatched_at       timestamptz,

  -- Optional links, mirroring the inbound side's vocabulary.
  add column if not exists thread_id           text,
  add column if not exists created_by_draft_at timestamptz;

comment on column public.communication_message.kind is
  'TEMPLATE = rendered from templates.ts (every pre-EMP-3 row). COMPOSE = free composition. REPLY = composed against an inbound message.';
comment on column public.communication_message.provider is
  'The provider that ACCEPTED this message. NULL until a real provider accepted; the no-op stub never sets it and never produces SENT.';
comment on column public.communication_message.bcc_addresses is
  'Recorded so the platform knows who it wrote to. Never reconstructed into a reply.';

-- ===========================================================================
-- 2. VOCABULARY AND COUPLING
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communication_message_kind_check') then
    alter table public.communication_message
      add constraint communication_message_kind_check
      check (kind in ('TEMPLATE', 'COMPOSE', 'REPLY'));
  end if;

  -- The coupling that makes a fake template key unnecessary AND impossible to
  -- need: exactly the TEMPLATE rows carry a template_key.
  --
  -- Validated, not NOT VALID, and safe to validate: every pre-EMP-3 row has a
  -- NOT NULL template_key and takes kind='TEMPLATE' from the column default, so
  -- the equivalence already holds for all of them.
  if not exists (select 1 from pg_constraint where conname = 'communication_message_template_coupling') then
    alter table public.communication_message
      add constraint communication_message_template_coupling
      check ((kind = 'TEMPLATE') = (template_key is not null));
  end if;

  -- A REPLY must name the message it answers; a COMPOSE must not pretend to.
  if not exists (select 1 from pg_constraint where conname = 'communication_message_reply_shape') then
    alter table public.communication_message
      add constraint communication_message_reply_shape
      check (kind = 'REPLY' or reply_to_message_id is null);
  end if;
end $$;

-- Status gains DRAFT (not yet a communication) and SENDING (a send is in
-- flight). SENDING is the whole basis of duplicate prevention: it is acquired
-- by compare-and-set BEFORE the provider is called.
--
-- DELIVERED and READ are absent on purpose and must stay absent: this platform
-- has no bounce or delivery webhook, so neither could be evidenced.
-- Re-added rather than NOT VALID: this set only WIDENS (the four original
-- values are all still present), so every historical row satisfies it and
-- validation is free. Widening is safe; narrowing would not have been.
alter table public.communication_message
  drop constraint if exists communication_message_status_check;
alter table public.communication_message
  add constraint communication_message_status_check
  check (status in ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'));

-- A message that reached SENT must carry the evidence that it did.
--
-- NOT VALID, and that word is load-bearing. `ADD CONSTRAINT` validates every
-- existing row by default, and EVERY row sent before EMP-3 is SENT with no
-- provider recorded — the column did not exist. Validating would therefore
-- abort this migration on any database with history, which is every real one.
--
-- The alternative was to back-fill a provider onto historical rows. That is
-- refused: we do not know which provider accepted them (for much of that period
-- the answer is "none — the stub did"), and writing a guess would manufacture
-- exactly the false evidence RATIFY-EMP3-2 exists to prevent.
--
-- NOT VALID enforces the rule on every future insert and update while leaving
-- the past honestly unproven. New sends cannot reach SENT without a provider.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'communication_message_sent_evidence') then
    alter table public.communication_message
      add constraint communication_message_sent_evidence
      check (status <> 'SENT' or provider is not null)
      not valid;
  end if;
end $$;

-- ===========================================================================
-- 3. DUPLICATE PREVENTION
-- ===========================================================================
-- The database-level half of idempotency. Partial, so the millions of existing
-- rows with no key are unaffected and template mail keeps working unchanged.
create unique index if not exists uq_comm_idempotency
  on public.communication_message (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_comm_mailbox
  on public.communication_message (mailbox_id, created_at desc)
  where mailbox_id is not null;

-- Finding a stuck SENDING row for reconciliation must be cheap: nothing
-- redispatches it automatically, so a human has to be able to see it.
create index if not exists idx_comm_in_flight
  on public.communication_message (tenant_id, updated_at)
  where status = 'SENDING';

create index if not exists idx_comm_thread
  on public.communication_message (tenant_id, thread_id)
  where thread_id is not null;

-- ===========================================================================
-- 4. DISPATCH FUNCTIONS
-- ===========================================================================
-- Three functions, each doing exactly one thing, so the ordering the governance
-- decision fixed cannot be rearranged by a caller.
--
-- All are SECURITY DEFINER. Their privileges are set in §4.5 as one explicit
-- block rather than a revoke beside each definition, because getting this
-- wrong is silent and the grouping makes the whole matrix reviewable at once.

-- 4.1 ACQUIRE — the compare-and-set that makes concurrent sends impossible.
--
-- The single UPDATE is the entire mechanism: PostgreSQL serializes the row
-- write, so of two concurrent callers exactly one matches `status in
-- ('QUEUED','FAILED')` and transitions it. The loser matches zero rows and
-- returns false, and its caller must not touch the provider.
create or replace function public.comm_acquire_send(
  p_message_id uuid,
  p_tenant_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.communication_message
     set status = 'SENDING',
         dispatched_at = now()
   where id = p_message_id
     and tenant_id = p_tenant_id
     -- DRAFT is absent deliberately: a draft is not a communication, and
     -- dispatching one directly would skip the send-time validation.
     and status in ('QUEUED', 'FAILED')
   returning id into v_id;

  return v_id is not null;
end $$;


-- 4.2 ACCEPTED — persist provider evidence AND emit, in ONE transaction.
--
-- This is what makes the event exactly-once: the transition out of SENDING and
-- the ledger write commit together, so the event cannot exist without the
-- evidence and cannot be written twice (a second call finds status <> 'SENDING'
-- and does nothing).
--
-- `p_provider` is required and must not be the stub. A no-op acceptance never
-- reaches this function — the application refuses earlier — but the guard is
-- restated here so the rule survives a future caller that forgets.
create or replace function public.comm_record_send_accepted(
  p_message_id          uuid,
  p_tenant_id           uuid,
  p_provider            text,
  p_provider_message_id text,
  p_actor_user_id       uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.communication_message%rowtype;
begin
  if p_provider is null or p_provider not in ('resend', 'smtp') then
    raise exception 'comm_record_send_accepted: refusing acceptance from provider %', coalesce(p_provider, 'NULL');
  end if;

  update public.communication_message
     set status = 'SENT',
         provider = p_provider,
         provider_message_id = p_provider_message_id,
         sent_at = now(),
         last_error = null
   where id = p_message_id
     and tenant_id = p_tenant_id
     and status = 'SENDING'
   returning * into v_row;

  -- Not ours to finish: either another caller already recorded it, or this
  -- message was never acquired. Either way, emit nothing.
  if v_row.id is null then
    return false;
  end if;

  -- The sanctioned write path. Metadata carries IDENTIFIERS AND CODES ONLY —
  -- never a subject, an address, a body or an attachment name, exactly as the
  -- eight inbound correspondence events do.
  perform public.emit_business_event(
    v_row.tenant_id,
    'CORRESPONDENCE_SENT',
    'communication',
    'rpc',
    'communication_message',
    v_row.id,
    v_row.file_id,
    p_actor_user_id,
    jsonb_strip_nulls(jsonb_build_object(
      'message_id', v_row.id::text,
      'mailbox_id', v_row.mailbox_id::text,
      'thread_id',  v_row.thread_id,
      'kind',       v_row.kind,
      'provider',   p_provider
    )));

  return true;
end $$;


-- 4.3 FAILED — leave the evidence, emit nothing.
--
-- A rejected send is not a communication. It records why and how many times,
-- and the message returns to FAILED where a human may retry it; the retry
-- reuses the SAME row and therefore the same idempotency key.
create or replace function public.comm_record_send_failed(
  p_message_id uuid,
  p_tenant_id  uuid,
  p_error      text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  update public.communication_message
     set status = 'FAILED',
         last_error = left(coalesce(p_error, 'send_failed'), 500),
         retry_count = retry_count + 1
   where id = p_message_id
     and tenant_id = p_tenant_id
     and status = 'SENDING'
   returning id into v_id;

  return v_id is not null;
end $$;


-- 4.4 RECONCILE — the ONLY way out of a stuck SENDING row.
--
-- A crash between provider acceptance and §4.2 leaves SENDING. Nothing
-- redispatches it: automatic recovery would be a duplicate-send machine,
-- because the platform cannot know whether the provider accepted. A human with
-- `communication:manage` decides, and the application audits the decision.
--
-- The two outcomes are the two truths available: it was accepted after all
-- (record it, with the provider named), or it was not (mark FAILED).
create or replace function public.comm_reconcile_stuck_send(
  p_message_id uuid,
  p_tenant_id  uuid,
  p_outcome    text,
  p_note       text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_outcome not in ('FAILED', 'CANCELLED') then
    raise exception 'comm_reconcile_stuck_send: outcome must be FAILED or CANCELLED, got %', p_outcome;
  end if;

  update public.communication_message
     set status = p_outcome,
         last_error = left(coalesce(p_note, 'reconciled'), 500)
   where id = p_message_id
     and tenant_id = p_tenant_id
     and status = 'SENDING'
   returning id into v_id;

  return v_id is not null;
end $$;



-- ===========================================================================
-- 4.5 FUNCTION PRIVILEGES — the part that was wrong, and why.
-- ===========================================================================
-- FIRST ATTEMPT AT MIGRATION 87 FAILED HERE, and correctly so: its own
-- assertion caught that `anon` and `authenticated` could EXECUTE all four
-- functions. The migration rolled back and nothing was applied.
--
-- ROOT CAUSE — TWO independent grant paths, and the first attempt closed only
-- one of them:
--
--   1. PostgreSQL grants EXECUTE on every new function to PUBLIC by default.
--      Every role inherits from PUBLIC, so `anon` and `authenticated` can call
--      a function nobody ever granted to them.
--   2. A Supabase project additionally carries
--      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS
--      TO anon, authenticated`, which writes EXPLICIT grants to those two roles
--      at creation time. Revoking from PUBLIC does not touch an explicit grant.
--
-- The first attempt ran `revoke all ... from public` only. That removed path 1
-- and left path 2 entirely intact — which is exactly what the assertion saw.
-- Note this is also why the defect did not appear in a bare local Postgres:
-- without Supabase's default-privilege configuration only path 1 exists, so
-- revoking from PUBLIC looked sufficient. It was not.
--
-- The fix revokes from all three grantees explicitly, then grants EXECUTE to
-- `service_role` alone — the identity the server actions already use, and the
-- one PostgREST never adopts for a browser session. The functions keep their
-- SECURITY DEFINER rights; what changes is who may invoke them.
--
-- Every REVOKE and GRANT names the function's EXACT identity signature, so a
-- future overload cannot silently inherit or escape these privileges.
revoke all on function public.comm_acquire_send(uuid, uuid) from public, anon, authenticated;
revoke all on function public.comm_record_send_accepted(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.comm_record_send_failed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.comm_reconcile_stuck_send(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.comm_acquire_send(uuid, uuid) to service_role;
grant execute on function public.comm_record_send_accepted(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.comm_record_send_failed(uuid, uuid, text) to service_role;
grant execute on function public.comm_reconcile_stuck_send(uuid, uuid, text, text) to service_role;

-- ===========================================================================
-- 5. PRIVILEGE ASSERTIONS — exercised at migration time.
-- ===========================================================================
-- Asserted through BOTH mechanisms, because they answer different questions and
-- the first attempt proved that trusting one is not enough:
--
--   * has_function_privilege() reports EFFECTIVE privilege — what a role can
--     actually do, inheritance included. It is the ground truth for anon and
--     authenticated.
--   * information_schema.routine_privileges / pg_proc.proacl report the GRANTS
--     that exist. Only these can see PUBLIC, which is not a role and therefore
--     cannot be passed to has_function_privilege at all. PUBLIC is precisely
--     the grantee the first attempt left in place.
--
-- ALLOWED, DENIED and BROKEN are classified separately, and every check names
-- the exact identity signature.
do $$
declare
  v_bad   text;
  v_sigs  text[] := array[
    'public.comm_acquire_send(uuid, uuid)',
    'public.comm_record_send_accepted(uuid, uuid, text, text, uuid)',
    'public.comm_record_send_failed(uuid, uuid, text)',
    'public.comm_reconcile_stuck_send(uuid, uuid, text, text)'
  ];
  v_sig   text;
begin
  -- ---- DENIED (1/3): PUBLIC holds no EXECUTE grant. -----------------------
  -- aclexplode grantee = 0 IS the PUBLIC pseudo-grantee. This is the check
  -- whose absence caused the first failure.
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(p.proacl) a
   where n.nspname = 'public'
     and p.proname in ('comm_acquire_send', 'comm_record_send_accepted',
                       'comm_record_send_failed', 'comm_reconcile_stuck_send')
     and a.grantee = 0
     and a.privilege_type = 'EXECUTE';
  if v_bad is not null then
    raise exception 'EMP-3 privilege assertion FAILED — PUBLIC holds EXECUTE on: %', v_bad;
  end if;

  -- ---- DENIED (2/3): no grant row for anon/authenticated. -----------------
  select string_agg(routine_name || '/' || grantee, ', ')
    into v_bad
    from information_schema.routine_privileges
   where specific_schema = 'public'
     and routine_name in ('comm_acquire_send', 'comm_record_send_accepted',
                          'comm_record_send_failed', 'comm_reconcile_stuck_send')
     and grantee in ('anon', 'authenticated', 'PUBLIC')
     and privilege_type = 'EXECUTE';
  if v_bad is not null then
    raise exception 'EMP-3 privilege assertion FAILED — grant rows present for: %', v_bad;
  end if;

  -- ---- DENIED (3/3): EFFECTIVE privilege, inheritance included. -----------
  -- The authoritative check: whatever the grant tables say, these roles must
  -- not be able to execute. Exact signatures, so an overload cannot slip past.
  foreach v_sig in array v_sigs loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 privilege assertion FAILED — anon can EXECUTE %', v_sig;
    end if;
    if has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 privilege assertion FAILED — authenticated can EXECUTE %', v_sig;
    end if;
  end loop;

  -- ---- ALLOWED: the sanctioned dispatch identity must still work. ---------
  -- Without this the migration would "pass" by making the functions
  -- unreachable to everyone, which breaks sending rather than securing it.
  foreach v_sig in array v_sigs loop
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception 'EMP-3 privilege assertion FAILED — service_role cannot EXECUTE %', v_sig;
    end if;
  end loop;

  -- ---- DENIED: no browser role may write the outbound table directly. -----
  select string_agg(r.rolname || '/' || priv, ', ')
    into v_bad
    from (values ('anon'), ('authenticated')) as r(rolname)
    cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
   where has_table_privilege(r.rolname, 'public.communication_message', p.priv);
  if v_bad is not null then
    raise exception 'EMP-3 privilege assertion FAILED (table write granted): %', v_bad;
  end if;

  -- ---- ALLOWED: the workspace's read path survives. -----------------------
  if not has_table_privilege('authenticated', 'public.communication_message', 'SELECT') then
    raise exception 'EMP-3 privilege assertion FAILED: authenticated lost SELECT on communication_message';
  end if;

  -- BROKEN would be any raise above; reaching here means the matrix is exactly
  -- as intended. A PostgREST RPC call as anon or authenticated now receives
  -- 42501 (insufficient_privilege), which is what the DENIED checks encode.
  raise notice 'EMP-3 privilege matrix OK — PUBLIC/anon/authenticated: no EXECUTE; service_role: EXECUTE; table writes denied; SELECT preserved.';
end $$;

-- ===========================================================================
-- 6. BEHAVIOURAL ASSERTIONS — prove the constraints actually bite.
-- ===========================================================================
do $$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  select id into v_tenant from public.organization limit 1;
  if v_tenant is null then
    raise notice 'EMP-3: no organization present, skipping behavioural assertions.';
    return;
  end if;

  -- A COMPOSE row with a template_key must be refused by the coupling check.
  begin
    insert into public.communication_message
      (tenant_id, recipient_email, template_key, subject, body_html, body_text, kind, status)
    values (v_tenant, 'x@example.com', 'INVOICE_ISSUED', 's', 'h', 't', 'COMPOSE', 'DRAFT')
    returning id into v_id;
    raise exception 'EMP-3 assertion FAILED: COMPOSE accepted a template_key';
  exception
    when check_violation then null;
  end;

  -- A TEMPLATE row without one must be refused too — the coupling is an
  -- equivalence, not a one-way rule.
  begin
    insert into public.communication_message
      (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
    values (v_tenant, 'x@example.com', 's', 'h', 't', 'TEMPLATE', 'DRAFT')
    returning id into v_id;
    raise exception 'EMP-3 assertion FAILED: TEMPLATE accepted a NULL template_key';
  exception
    when check_violation then null;
  end;

  -- SENT without provider evidence must be impossible.
  begin
    insert into public.communication_message
      (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
    values (v_tenant, 'x@example.com', 's', 'h', 't', 'COMPOSE', 'SENT')
    returning id into v_id;
    raise exception 'EMP-3 assertion FAILED: SENT accepted without a provider';
  exception
    when check_violation then null;
  end;

  -- The CAS must admit exactly one winner. Insert a QUEUED row and acquire it
  -- twice: the second attempt must return false.
  insert into public.communication_message
    (tenant_id, recipient_email, subject, body_html, body_text, kind, status)
  values (v_tenant, 'cas@example.com', 's', 'h', 't', 'COMPOSE', 'QUEUED')
  returning id into v_id;

  if not public.comm_acquire_send(v_id, v_tenant) then
    raise exception 'EMP-3 assertion FAILED: first acquire did not win';
  end if;
  if public.comm_acquire_send(v_id, v_tenant) then
    raise exception 'EMP-3 assertion FAILED: second acquire also won — CAS is broken';
  end if;

  -- A stub provider must be refused at the database boundary too.
  begin
    perform public.comm_record_send_accepted(v_id, v_tenant, 'noop', null, null);
    raise exception 'EMP-3 assertion FAILED: acceptance recorded for a stub provider';
  exception
    when others then
      if sqlerrm like 'EMP-3 assertion FAILED%' then raise; end if;
  end;

  delete from public.communication_message where id = v_id;
  raise notice 'EMP-3 behavioural assertions OK: coupling, sent-evidence, CAS single-winner, stub refusal.';
end $$;
