-- RLS regression test — Communications (Phase 1.14). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- The outbox is STAFF-ROLE gated (communication:read) and tenant-isolated:
--   * a user WITH communication:read sees tenant-A messages              -> 1
--   * the same user does NOT see tenant-B messages (isolation)           -> 0
--   * a staff user WITHOUT communication:read sees nothing               -> 0
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'commsmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'commsno@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'commsmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001', 'commsno@test.local')
on conflict (id) do nothing;

-- OPS_SUPERVISOR holds communication:read; COORDINATOR does not.
insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000c1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000c2'::uuid, 'COORDINATOR')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.communication_message (id, tenant_id, recipient_email, template_key, subject, body_html, body_text, status) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000001', 'a@test.local', 'invoice_issued', 'A', '<p>A</p>', 'A', 'SENT'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000000b2', 'b@test.local', 'invoice_issued', 'B', '<p>B</p>', 'B', 'SENT')
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  mgr_a int; mgr_b int; noperm_a int;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c1','role','authenticated')::text, true);
  select count(*) into mgr_a from public.communication_message where id='00000000-0000-0000-0000-00000000cc01';
  select count(*) into mgr_b from public.communication_message where id='00000000-0000-0000-0000-00000000cc02';

  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000c2','role','authenticated')::text, true);
  select count(*) into noperm_a from public.communication_message where id='00000000-0000-0000-0000-00000000cc01';

  perform set_config('role', 'postgres', true);
  insert into _r values ('mgr_sees_A', mgr_a), ('mgr_sees_B', mgr_b), ('noperm_sees_A', noperm_a);

  if mgr_a<>1 or mgr_b<>0 or noperm_a<>0 then
    raise exception 'RLS COMMS FAIL: mgr(A=% B=%) noperm(A=%)', mgr_a, mgr_b, noperm_a;
  end if;
end $$;

select * from _r order by check_name;
rollback;
