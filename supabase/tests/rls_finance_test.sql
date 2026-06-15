-- RLS regression test — Finance (Phase 1.11). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves finance visibility is FINANCE-ROLE based, NOT inherited from
-- can_read_file:
--   * FINANCE_OFFICER (finance:read) sees tenant-A invoices/charges          -> 1
--   * the same user does NOT see tenant-B finance (tenant isolation)          -> 0
--   * COORDINATOR who COORDINATES fileX (can read the dossier) but has NO
--     finance:read sees NONE of its invoices/charges                          -> 0
-- This is the key difference from documents/customs/transport. Also verifies
-- next_invoice_number is per-tenant sequential.
--
-- Requires all migrations + seed applied. Run like the other RLS tests.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f7', 'fin@test.local'),
  ('00000000-0000-0000-0000-0000000000f8', 'coord@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000f7', '00000000-0000-0000-0000-000000000001', 'fin@test.local'),
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-000000000001', 'coord@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000f7'::uuid, 'FINANCE_OFFICER'),
  ('00000000-0000-0000-0000-0000000000f8'::uuid, 'COORDINATOR')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-000000000001', 'Client A'),
  ('00000000-0000-0000-0000-00000000c1b0', '00000000-0000-0000-0000-0000000000b2', 'Client B')
on conflict (id) do nothing;

-- fileX coordinated by the COORDINATOR (so the dossier IS visible to them).
insert into public.operational_file (id, tenant_id, file_number, type, client_id, coordinator_id) values
  ('00000000-0000-0000-0000-00000000fe71', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-99001', 'IMP', '00000000-0000-0000-0000-00000000c1a0', '00000000-0000-0000-0000-0000000000f8'),
  ('00000000-0000-0000-0000-00000000fe81', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-99002', 'IMP', '00000000-0000-0000-0000-00000000c1b0', null)
on conflict (id) do nothing;

insert into public.invoice (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-0000000091e7', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fe71', 'DRAFT'),
  ('00000000-0000-0000-0000-0000000091e8', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000fe81', 'DRAFT')
on conflict (id) do nothing;

insert into public.billing_charge (id, tenant_id, file_id, description, unit_amount) values
  ('00000000-0000-0000-0000-0000000091c7', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fe71', 'Handling', 1000)
on conflict (id) do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  fin_invA int; fin_invB int; fin_charge int;
  coord_inv int; coord_charge int;
  num1 text; num2 text;
begin
  perform set_config('role', 'authenticated', true);

  -- FINANCE_OFFICER (finance:read)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f7','role','authenticated')::text, true);
  select count(*) into fin_invA   from public.invoice where id='00000000-0000-0000-0000-0000000091e7';
  select count(*) into fin_invB   from public.invoice where id='00000000-0000-0000-0000-0000000091e8';
  select count(*) into fin_charge from public.billing_charge where id='00000000-0000-0000-0000-0000000091c7';

  -- COORDINATOR (coordinates fileX, but NO finance:read)
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000f8','role','authenticated')::text, true);
  select count(*) into coord_inv    from public.invoice where id='00000000-0000-0000-0000-0000000091e7';
  select count(*) into coord_charge from public.billing_charge where id='00000000-0000-0000-0000-0000000091c7';

  perform set_config('role', 'postgres', true);

  -- Numbering: per-tenant sequential.
  select public.next_invoice_number('00000000-0000-0000-0000-000000000001') into num1;
  select public.next_invoice_number('00000000-0000-0000-0000-000000000001') into num2;

  insert into _r values
    ('fin_sees_invA', fin_invA), ('fin_sees_invB', fin_invB), ('fin_sees_charge', fin_charge),
    ('coord_sees_inv', coord_inv), ('coord_sees_charge', coord_charge);

  if fin_invA<>1 or fin_invB<>0 or fin_charge<>1 or coord_inv<>0 or coord_charge<>0 then
    raise exception 'RLS FINANCE FAIL: fin(invA=% invB=% charge=%) coord(inv=% charge=%)',
      fin_invA, fin_invB, fin_charge, coord_inv, coord_charge;
  end if;
  if num1 not like 'EFT-INV-%-%' or num2 = num1 then
    raise exception 'INVOICE NUMBERING FAIL: % then %', num1, num2;
  end if;
end $$;

select * from _r order by check_name;
rollback;
