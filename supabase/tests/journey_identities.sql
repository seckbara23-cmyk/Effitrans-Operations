-- Journey harness identities (C-4). Fixture CONFIGURATION, not workflow state.
-- ---------------------------------------------------------------------------
-- "Who exists and what roles they hold" is tenant configuration — the equivalent
-- of an administrator having created these accounts in /users before a
-- rehearsal. It is created here, in psql, for the same reason every rls_*.sql
-- suite does: PostgREST does not expose `auth`, and `service_role` holds no
-- INSERT grant on `app_user` (grants were deliberately scoped to `select` for
-- authenticated, and service-role writes were never widened).
--
-- THIS FILE NEVER TOUCHES WORKFLOW STATE. No process_instance, no
-- process_step_execution, no handoff, no document, no invoice. Every dossier
-- movement in the journey goes through a real server action.
--
-- Deterministic UUIDs so the harness can resolve identities by email without
-- creating them, and so a re-run is idempotent.

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000aa01', 'journey.ops@test.local'),
  ('00000000-0000-0000-0000-00000000aa02', 'journey.am@test.local'),
  ('00000000-0000-0000-0000-00000000aa03', 'journey.transit@test.local'),
  ('00000000-0000-0000-0000-00000000aa04', 'journey.declarant@test.local'),
  ('00000000-0000-0000-0000-00000000aa05', 'journey.coordinator@test.local'),
  ('00000000-0000-0000-0000-00000000aa06', 'journey.customsfinance@test.local'),
  ('00000000-0000-0000-0000-00000000aa07', 'journey.field@test.local'),
  ('00000000-0000-0000-0000-00000000aa08', 'journey.transport@test.local'),
  ('00000000-0000-0000-0000-00000000aa09', 'journey.pickup@test.local'),
  ('00000000-0000-0000-0000-00000000aa10', 'journey.documentation@test.local'),
  ('00000000-0000-0000-0000-00000000aa11', 'journey.billing@test.local'),
  ('00000000-0000-0000-0000-00000000aa12', 'journey.finance@test.local'),
  ('00000000-0000-0000-0000-00000000aa13', 'journey.admin@test.local'),
  ('00000000-0000-0000-0000-00000000aa14', 'journey.courier@test.local'),
  ('00000000-0000-0000-0000-00000000aa15', 'journey.collections@test.local'),
  ('00000000-0000-0000-0000-00000000aa16', 'journey.driver@test.local'),
  ('00000000-0000-0000-0000-00000000aa17', 'journey.quotation@test.local'),
  ('00000000-0000-0000-0000-00000000aa18', 'journey.blindquote@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, name, status) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000001', 'journey.ops@test.local',            'Journey Ops',          'active'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-000000000001', 'journey.am@test.local',             'Journey AM',           'active'),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-000000000001', 'journey.transit@test.local',        'Journey Transit',      'active'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-000000000001', 'journey.declarant@test.local',      'Journey Declarant',    'active'),
  ('00000000-0000-0000-0000-00000000aa05', '00000000-0000-0000-0000-000000000001', 'journey.coordinator@test.local',    'Journey Coordinator',  'active'),
  ('00000000-0000-0000-0000-00000000aa06', '00000000-0000-0000-0000-000000000001', 'journey.customsfinance@test.local', 'Journey CustFinance',  'active'),
  ('00000000-0000-0000-0000-00000000aa07', '00000000-0000-0000-0000-000000000001', 'journey.field@test.local',          'Journey Field',        'active'),
  ('00000000-0000-0000-0000-00000000aa08', '00000000-0000-0000-0000-000000000001', 'journey.transport@test.local',      'Journey Transport',    'active'),
  ('00000000-0000-0000-0000-00000000aa09', '00000000-0000-0000-0000-000000000001', 'journey.pickup@test.local',         'Journey Pickup',       'active'),
  ('00000000-0000-0000-0000-00000000aa10', '00000000-0000-0000-0000-000000000001', 'journey.documentation@test.local',  'Journey Documentation','active'),
  ('00000000-0000-0000-0000-00000000aa11', '00000000-0000-0000-0000-000000000001', 'journey.billing@test.local',        'Journey Billing',      'active'),
  ('00000000-0000-0000-0000-00000000aa12', '00000000-0000-0000-0000-000000000001', 'journey.finance@test.local',        'Journey Finance',      'active'),
  ('00000000-0000-0000-0000-00000000aa13', '00000000-0000-0000-0000-000000000001', 'journey.admin@test.local',          'Journey Admin',        'active'),
  ('00000000-0000-0000-0000-00000000aa14', '00000000-0000-0000-0000-000000000001', 'journey.courier@test.local',        'Journey Courier',      'active'),
  ('00000000-0000-0000-0000-00000000aa15', '00000000-0000-0000-0000-000000000001', 'journey.collections@test.local',    'Journey Collections',  'active'),
  ('00000000-0000-0000-0000-00000000aa16', '00000000-0000-0000-0000-000000000001', 'journey.driver@test.local',         'Journey Driver',       'active'),
  ('00000000-0000-0000-0000-00000000aa17', '00000000-0000-0000-0000-000000000001', 'journey.quotation@test.local',      'Journey Quotation',    'active'),
  ('00000000-0000-0000-0000-00000000aa18', '00000000-0000-0000-0000-000000000001', 'journey.blindquote@test.local',     'Journey BlindQuote',   'active')
on conflict (id) do nothing;

-- Role grants: EXACTLY one canonical role each, so a maker/checker proof can
-- never be weakened by an identity that happens to hold both sides.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-00000000aa01'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-00000000aa02'::uuid, 'ACCOUNT_MANAGER'),
  ('00000000-0000-0000-0000-00000000aa03'::uuid, 'CHIEF_OF_TRANSIT'),
  ('00000000-0000-0000-0000-00000000aa04'::uuid, 'CUSTOMS_DECLARANT'),
  ('00000000-0000-0000-0000-00000000aa05'::uuid, 'COORDINATOR'),
  ('00000000-0000-0000-0000-00000000aa06'::uuid, 'CUSTOMS_FINANCE_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa07'::uuid, 'CUSTOMS_FIELD_AGENT'),
  ('00000000-0000-0000-0000-00000000aa08'::uuid, 'TRANSPORT_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa09'::uuid, 'PICKUP_AGENT'),
  ('00000000-0000-0000-0000-00000000aa10'::uuid, 'DOCUMENTATION_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa11'::uuid, 'BILLING_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa12'::uuid, 'FINANCE_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa13'::uuid, 'ADMINISTRATIVE_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa14'::uuid, 'COURIER'),
  ('00000000-0000-0000-0000-00000000aa15'::uuid, 'COLLECTIONS_OFFICER'),
  ('00000000-0000-0000-0000-00000000aa16'::uuid, 'DRIVER'),
  ('00000000-0000-0000-0000-00000000aa17'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- NEGATIVE FIXTURE — an actor who may ACT on a step but cannot SEE its evidence.
-- ---------------------------------------------------------------------------
-- C-4 found that a step completed on evidence the actor had no access to:
-- `unauthorized` items are neither satisfied nor missing, and the completeness
-- test ignored them. The engine now refuses that case, and this role is how
-- that refusal stays proven.
--
-- It mirrors NO production role and appears in no migration, in seed.sql or in
-- role-templates.ts — it exists only here, in a test fixture. That is
-- deliberate: the real gap (QUOTATION_MANAGER without document:read) is now
-- FIXED, so a test written against real roles alone would pass for the wrong
-- reason the moment every role holds the right grants. A permanent synthetic
-- blind actor keeps the invariant honest no matter what the grant matrix does.
--
-- It holds exactly what it needs to REACH the step and nothing that would let
-- it judge the evidence:
--   quotation:create — the gating permission of step 1 (Cotation)
--   file:read:all    — so the dossier is visible without depending on the
--                      responsibility-visibility ground under test elsewhere
--   NO document:read — the whole point
insert into public.role (tenant_id, code, label_fr, label_en)
values ('00000000-0000-0000-0000-000000000001', 'JOURNEY_EVIDENCE_BLIND',
        'Fixture — acteur sans accès aux preuves', 'Fixture — evidence-blind actor')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('quotation:create', 'file:read:all')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'JOURNEY_EVIDENCE_BLIND'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000aa18'::uuid, r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'JOURNEY_EVIDENCE_BLIND'
on conflict do nothing;

-- Two clients: one REQUIRING physical deposit (primary journey), one not (the
-- control fixture that proves the deposit branch is genuinely conditional).
insert into public.client (id, tenant_id, name, email, requires_physical_invoice_deposit) values
  ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-000000000001', 'Journey Client — dépôt requis',  'journey.client.deposit@test.local', true),
  ('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-000000000001', 'Journey Client — sans dépôt',    'journey.client.nodeposit@test.local', false)
on conflict (id) do nothing;

-- CI-ONLY PRIVILEGES for the harness's service-role client.
-- `grant_table_privileges.sql` scoped grants to `authenticated` and explicitly
-- left service-role writes "out of scope … added per-table when write flows
-- land". The journey's client needs to READ state to assert it and to seed
-- nothing else. Granting here — in a test fixture, never in a migration — keeps
-- production privileges exactly as they are.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
-- FUNCTIONS TOO. get_user_permissions is granted to `authenticated` only, and
-- getEffectivePermissions calls it through the session client — so without this
-- every action returned "forbidden" and looked like an authority failure rather
-- than a missing execute grant.
grant execute on all functions in schema public to service_role;

-- The pilot tenant's rollout row: the journey exercises the engine, so the
-- TENANT half of every flag must be on, exactly as it is for the real pilot
-- tenant in production. The ENV half is supplied by the CI step.
insert into public.tenant_process_rollout
  (tenant_id, process_engine, process_workspaces, physical_invoice_deposit, collections, note)
values
  ('00000000-0000-0000-0000-000000000001', true, true, true, true, 'C-4 journey harness')
on conflict (tenant_id) do update set
  process_engine = true,
  process_workspaces = true,
  physical_invoice_deposit = true,
  collections = true;

do $$
declare
  v_users int;
  v_roles int;
  v_clients int;
  v_blind int;
  v_quote int;
begin
  select count(*) into v_users from public.app_user where email like 'journey.%@test.local';
  select count(*) into v_roles from public.user_role ur
    join public.app_user u on u.id = ur.user_id where u.email like 'journey.%@test.local';
  select count(*) into v_clients from public.client where id in
    ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-0000000cc002');

  if v_users <> 18 then raise exception 'JOURNEY FIXTURES: expected 18 identities, got %', v_users; end if;
  if v_roles <> 18 then raise exception 'JOURNEY FIXTURES: expected 18 role grants, got % (a role code is missing from this tenant)', v_roles; end if;
  if v_clients <> 2 then raise exception 'JOURNEY FIXTURES: expected 2 clients, got %', v_clients; end if;

  -- The negative fixture must actually BE blind, and the quotation lead must
  -- actually be able to see. Asserted here rather than assumed: a fixture that
  -- silently gained document:read would make the refusal test pass for the
  -- wrong reason, and a quotation lead that silently lost it would fail the
  -- happy path for a reason that looks like a product defect.
  select count(*) into v_blind
  from public.app_user u
  join public.user_role ur on ur.user_id = u.id
  join public.role_permission rp on rp.role_id = ur.role_id
  join public.permission p on p.id = rp.permission_id
  where u.email = 'journey.blindquote@test.local' and p.code = 'document:read';

  select count(*) into v_quote
  from public.app_user u
  join public.user_role ur on ur.user_id = u.id
  join public.role_permission rp on rp.role_id = ur.role_id
  join public.permission p on p.id = rp.permission_id
  where u.email = 'journey.quotation@test.local' and p.code = 'document:read';

  if v_blind <> 0 then
    raise exception 'JOURNEY FIXTURES: the evidence-blind actor HOLDS document:read (%) — the refusal test would pass for the wrong reason', v_blind;
  end if;
  if v_quote < 1 then
    raise exception 'JOURNEY FIXTURES: the quotation lead lacks document:read — migration 124 did not apply';
  end if;

  raise notice 'journey identities ready (% users, % grants, % clients, blind=% quote_reads=%)', v_users, v_roles, v_clients, v_blind, v_quote;
end $$;

commit;
