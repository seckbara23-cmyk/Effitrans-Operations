-- RLS regression test — Payment intents + webhook events (Phase 1.15B).
-- Non-destructive (BEGIN/ROLLBACK). Proves:
--   * payment_intent visibility is FINANCE-ROLE based (finance:read), NOT
--     inherited from can_read_file:
--       - FINANCE_OFFICER sees tenant-A intent                      -> 1
--       - the same user does NOT see tenant-B intent (isolation)     -> 0
--       - COORDINATOR who coordinates fileA (reads the dossier) but
--         has NO finance:read sees NONE of its intents               -> 0
--   * provider_webhook_event is finance-role gated the same way.
--   * provider_webhook_event is APPEND-ONLY (UPDATE/DELETE blocked, all roles).
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000fa', 'fin2@test.local'),
  ('00000000-0000-0000-0000-0000000000fb', 'coord2@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-000000000001', 'fin2@test.local'),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-000000000001', 'coord2@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000fa'::uuid, 'FINANCE_OFFICER'),
  ('00000000-0000-0000-0000-0000000000fb'::uuid, 'COORDINATOR')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a1', '00000000-0000-0000-0000-000000000001', 'Client A2'),
  ('00000000-0000-0000-0000-00000000c1b1', '00000000-0000-0000-0000-0000000000b2', 'Client B2')
on conflict (id) do nothing;

-- fileA coordinated by the COORDINATOR (so the dossier IS visible to them).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fea1', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-99011', 'IMP', '00000000-0000-0000-0000-00000000c1a1', '00000000-0000-0000-0000-0000000000fb'),
  ('00000000-0000-0000-0000-00000000feb1', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-99012', 'IMP', '00000000-0000-0000-0000-00000000c1b1', null)
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000092a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fea1', 'ISSUED'),
  ('00000000-0000-0000-0000-0000000092b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000feb1', 'ISSUED')
on conflict (id) do nothing;

insert into public.payment_intent (id, tenant_id, invoice_id, provider, amount, status) values
  ('00000000-0000-0000-0000-00000000a1a1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000092a1', 'MOCK', 1000, 'PENDING'),
  ('00000000-0000-0000-0000-00000000a1b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000092b1', 'MOCK', 2000, 'PENDING')
on conflict (id) do nothing;

insert into public.provider_webhook_event (id, tenant_id, provider, provider_event_id, event_type, payment_intent_id, signature_valid, outcome) values
  ('00000000-0000-0000-0000-00000000eba1', '00000000-0000-0000-0000-000000000001', 'MOCK', 'evt-a1', 'payment.success', '00000000-0000-0000-0000-00000000a1a1', true, 'APPLIED')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  fin_intA int; fin_intB int; fin_evt int;
  coord_int int; coord_evt int;
  blocked_update boolean := false;
  blocked_delete boolean := false;
begin
  perform set_config('role', 'authenticated', true);

  -- FINANCE_OFFICER (finance:read)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000fa','role','authenticated')::text, true);
  select count(*) into fin_intA from public.payment_intent where id='00000000-0000-0000-0000-00000000a1a1';
  select count(*) into fin_intB from public.payment_intent where id='00000000-0000-0000-0000-00000000a1b1';
  select count(*) into fin_evt  from public.provider_webhook_event where id='00000000-0000-0000-0000-00000000eba1';

  -- COORDINATOR (coordinates fileA, but NO finance:read)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000fb','role','authenticated')::text, true);
  select count(*) into coord_int from public.payment_intent where id='00000000-0000-0000-0000-00000000a1a1';
  select count(*) into coord_evt from public.provider_webhook_event where id='00000000-0000-0000-0000-00000000eba1';

  perform set_config('role', 'postgres', true);

  -- Append-only: UPDATE/DELETE on provider_webhook_event must be blocked (all roles).
  begin
    update public.provider_webhook_event set outcome='REJECTED' where id='00000000-0000-0000-0000-00000000eba1';
  exception when others then blocked_update := true;
  end;
  begin
    delete from public.provider_webhook_event where id='00000000-0000-0000-0000-00000000eba1';
  exception when others then blocked_delete := true;
  end;

  insert into _r values
    ('fin_sees_intA', fin_intA), ('fin_sees_intB', fin_intB), ('fin_sees_evt', fin_evt),
    ('coord_sees_int', coord_int), ('coord_sees_evt', coord_evt),
    ('webhook_update_blocked', blocked_update::int), ('webhook_delete_blocked', blocked_delete::int);

  if fin_intA<>1 or fin_intB<>0 or fin_evt<>1 or coord_int<>0 or coord_evt<>0 then
    raise exception 'RLS PAYMENT_INTENT FAIL: fin(intA=% intB=% evt=%) coord(int=% evt=%)',
      fin_intA, fin_intB, fin_evt, coord_int, coord_evt;
  end if;
  if not blocked_update or not blocked_delete then
    raise exception 'APPEND-ONLY FAIL: webhook update_blocked=% delete_blocked=%', blocked_update, blocked_delete;
  end if;
end $$;

select * from _r order by check_name;
rollback;
