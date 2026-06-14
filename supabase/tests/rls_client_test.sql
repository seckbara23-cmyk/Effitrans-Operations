-- RLS regression test — Client Management (Phase 1.1). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves for client + client_contact:
--   * a tenant-A user WITH client:read reads tenant A's own clients      -> 1
--   * the same user CANNOT read tenant B's clients (tenant isolation)    -> 0
--   * a tenant-A user WITHOUT client:read reads nothing                  -> 0
--   * client_contact follows the SAME tenant + permission boundary
--
-- Requires all migrations + seed applied (roles, client perms, grants, helpers).
-- Run: psql "$DATABASE_URL" -f supabase/tests/rls_client_test.sql
-- (or paste into the Supabase SQL Editor — the final SELECT shows the counts).

begin;

-- Tenant B (tenant A = seeded Effitrans 000…001).
insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- Two tenant-A users: reader (SYSTEM_ADMIN -> has client:read) and
-- plain (CUSTOMS_DECLARANT -> no client:read).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ce01', 'reader@test.local'),
  ('00000000-0000-0000-0000-00000000ce02', 'plain@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-00000000ce01', '00000000-0000-0000-0000-000000000001', 'reader@test.local'),
  ('00000000-0000-0000-0000-00000000ce02', '00000000-0000-0000-0000-000000000001', 'plain@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ce01', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-00000000ce02', r.id, r.tenant_id
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CUSTOMS_DECLARANT'
on conflict do nothing;

-- One client in each tenant, each with a contact.
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000c1a00', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-0000000c1b00', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

insert into public.client_contact (tenant_id, client_id, name) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000c1a00', 'Contact A'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000c1b00', 'Contact B')
on conflict do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  reader_a int; reader_b int; plain_a int;
  reader_ca int; reader_cb int; plain_ca int;
begin
  -- USER WITH client:read (tenant A)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce01','role','authenticated')::text, true);
  select count(*) into reader_a  from public.client         where id='00000000-0000-0000-0000-0000000c1a00';
  select count(*) into reader_b  from public.client         where id='00000000-0000-0000-0000-0000000c1b00';
  select count(*) into reader_ca from public.client_contact where client_id='00000000-0000-0000-0000-0000000c1a00';
  select count(*) into reader_cb from public.client_contact where client_id='00000000-0000-0000-0000-0000000c1b00';

  -- USER WITHOUT client:read (tenant A)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-00000000ce02','role','authenticated')::text, true);
  select count(*) into plain_a  from public.client         where id='00000000-0000-0000-0000-0000000c1a00';
  select count(*) into plain_ca from public.client_contact where client_id='00000000-0000-0000-0000-0000000c1a00';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('reader_sees_own_client',      reader_a),
    ('reader_sees_tenantB_client',  reader_b),
    ('plain_sees_own_client',       plain_a),
    ('reader_sees_own_contact',     reader_ca),
    ('reader_sees_tenantB_contact', reader_cb),
    ('plain_sees_own_contact',      plain_ca);

  -- CI assertion: fail (non-zero exit under ON_ERROR_STOP) on any regression.
  if reader_a <> 1 or reader_b <> 0 or plain_a <> 0
     or reader_ca <> 1 or reader_cb <> 0 or plain_ca <> 0 then
    raise exception
      'RLS CLIENT FAIL: own_client=%, tenantB_client=%, plain_client=%, own_contact=%, tenantB_contact=%, plain_contact=% (expected 1/0/0/1/0/0)',
      reader_a, reader_b, plain_a, reader_ca, reader_cb, plain_ca;
  end if;
end $$;

select * from _r order by check_name;
rollback;
