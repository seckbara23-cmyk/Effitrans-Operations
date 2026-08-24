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
  ('00000000-0000-0000-0000-00000000aa16', 'journey.driver@test.local')
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
  ('00000000-0000-0000-0000-00000000aa16', '00000000-0000-0000-0000-000000000001', 'journey.driver@test.local',         'Journey Driver',       'active')
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
  ('00000000-0000-0000-0000-00000000aa16'::uuid, 'DRIVER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- Two clients: one REQUIRING physical deposit (primary journey), one not (the
-- control fixture that proves the deposit branch is genuinely conditional).
insert into public.client (id, tenant_id, name, email, requires_physical_invoice_deposit) values
  ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-000000000001', 'Journey Client — dépôt requis',  'journey.client.deposit@test.local', true),
  ('00000000-0000-0000-0000-0000000cc002', '00000000-0000-0000-0000-000000000001', 'Journey Client — sans dépôt',    'journey.client.nodeposit@test.local', false)
on conflict (id) do nothing;

do $$
declare
  v_users int;
  v_roles int;
  v_clients int;
begin
  select count(*) into v_users from public.app_user where email like 'journey.%@test.local';
  select count(*) into v_roles from public.user_role ur
    join public.app_user u on u.id = ur.user_id where u.email like 'journey.%@test.local';
  select count(*) into v_clients from public.client where id in
    ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-0000000cc002');

  if v_users <> 16 then raise exception 'JOURNEY FIXTURES: expected 16 identities, got %', v_users; end if;
  if v_roles <> 16 then raise exception 'JOURNEY FIXTURES: expected 16 role grants, got % (a role code is missing from this tenant)', v_roles; end if;
  if v_clients <> 2 then raise exception 'JOURNEY FIXTURES: expected 2 clients, got %', v_clients; end if;

  raise notice 'journey identities ready (% users, % grants, % clients)', v_users, v_roles, v_clients;
end $$;

commit;
