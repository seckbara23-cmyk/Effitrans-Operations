-- RLS regression test — GAINDE tax payment (DEC-C39). Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- THE HARD GATE THIS EXISTS FOR (MIGRATION-139-APPROVAL-01 §9).
--
-- Effitrans ratified the customs duties breakdown as INTERNAL data. That ruling
-- is the entire reason migration #139 put the figures in their own tables
-- instead of on `customs_record`: `customs_record_portal_select` is
--
--     for select to authenticated using (portal_can_read_file(file_id) and ...)
--
-- with NO column list, so EVERY column of that table is readable by a customer
-- whatever the application selects. A duties breakdown added there would have
-- been exposed by construction, not by mistake.
--
-- Until this suite existed the guarantee was proven only by a STATIC scan
-- asserting no portal policy is present. A policy that does not exist cannot
-- grant anything, so the scan is sound — but it proves a property of the
-- migration FILE, not of the running database. The claim is about what a
-- customer can actually SELECT, and only a real identity against a real
-- database answers that.
--
-- EVERY NEGATIVE HAS A CONTROL. A count of zero is worthless unless the
-- identity that produced it could have read something. Each identity here is
-- therefore asked a question it MUST answer positively — `has_permission`, a
-- readable dossier, or a payment it is entitled to — and the suite reports
-- INCONCLUSIVE rather than PASS when a control fails. Three of the four zeros
-- below would otherwise be satisfied by an identity that simply has no roles.
--
-- Expected: 1 / 2 / 0 / 0 / 0 / 0 / 0 / 0, with all four controls true.

begin;

insert into public.organization (id, name, country)
values ('00000000-0000-0000-0000-0000000000b2', 'Test Tenant B', 'SN')
on conflict (id) do nothing;

-- G1 = staff, customs:read + file:read:all (tenant A)
-- G2 = staff, NO customs:read (tenant A)
-- G4 = ACTIVE portal customer of the same client (client_user, NOT app_user)
--
-- There is deliberately no tenant-B STAFF identity: the test tenant has no
-- seeded roles, so such a user would read zero because it holds nothing, not
-- because isolation held — a pass for the wrong reason. Isolation is proven
-- from the other direction instead, by asking G1 (who demonstrably reads the
-- tenant-A payment) for the tenant-B one.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'gx-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'gx-nocustoms@test.local'),
  ('00000000-0000-0000-0000-0000000000d4', 'gx-portal@test.local')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'gx-staff@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'gx-nocustoms@test.local')
on conflict (id) do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select u.uid, r.id, r.tenant_id
from (values
  ('00000000-0000-0000-0000-0000000000d1'::uuid, 'OPS_SUPERVISOR'),
  ('00000000-0000-0000-0000-0000000000d2'::uuid, 'QUOTATION_MANAGER')
) as u(uid, code)
join public.role r on r.code = u.code and r.tenant_id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-00000000c1d0', '00000000-0000-0000-0000-000000000001', 'Client GX A'),
  ('00000000-0000-0000-0000-00000000c1d1', '00000000-0000-0000-0000-0000000000b2', 'Client GX B')
on conflict (id) do nothing;

-- The portal customer belongs to the SAME client as the dossier: the most
-- favourable possible position for a leak.
insert into public.client_user (id, tenant_id, client_id, email, status, role) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000c1d0', 'gx-portal@test.local', 'ACTIVE', 'CLIENT_USER')
on conflict (id) do nothing;

insert into public.operational_file (id, tenant_id, file_number, type, client_id) values
  ('00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-000000000001', 'EFT-IMP-2099-96001', 'IMP', '00000000-0000-0000-0000-00000000c1d0'),
  ('00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-0000000000b2', 'EFT-IMP-2099-96002', 'IMP', '00000000-0000-0000-0000-00000000c1d1')
on conflict (id) do nothing;

insert into public.customs_record (id, tenant_id, file_id, status) values
  ('00000000-0000-0000-0000-00000000cd01', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000fd01', 'NOT_STARTED'),
  ('00000000-0000-0000-0000-00000000cd02', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000fd02', 'NOT_STARTED')
on conflict (id) do nothing;

-- Payments whose lines BALANCE, so the deferred constraint trigger would be
-- satisfied on a real commit. (This transaction rolls back, so the deferred
-- check never fires — but seeding unbalanced data would leave a fixture that
-- cannot exist in production, and a fixture should be a reachable state.)
insert into public.gainde_tax_payment
  (id, tenant_id, file_id, customs_record_id, paid_at, paid_by,
   currency, total_paid_minor, quittance_reference, created_by) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-00000000fd01', '00000000-0000-0000-0000-00000000cd01',
   now(), '00000000-0000-0000-0000-0000000000d1',
   'XOF', 3590000, 'Q-RLS-96001', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-0000000000b2',
   '00000000-0000-0000-0000-00000000fd02', '00000000-0000-0000-0000-00000000cd02',
   now(), '00000000-0000-0000-0000-0000000000d1',
   'XOF', 1000000, 'Q-RLS-96002', '00000000-0000-0000-0000-0000000000d1')
on conflict (id) do nothing;

insert into public.gainde_tax_payment_line
  (tenant_id, payment_id, tax_code, label_fr, amount_minor, ordinal) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ed01', 'DD',  'Droit de douane',            1250000, 1),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000ed01', 'TVA', 'Taxe sur la valeur ajoutée', 2340000, 2),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000ed02', 'DD',  'Droit de douane',            1000000, 1)
on conflict do nothing;

create temp table _r (check_name text, value int) on commit drop;

do $$
declare
  staff_pay int; staff_line int; staff_other_tenant_pay int; staff_other_tenant_line int;
  noperm_pay int; noperm_line int;
  portal_pay int; portal_line int;
  ctl_staff_perm boolean; ctl_noperm_perm boolean;
  ctl_portal_file int; ctl_portal_customs int;
begin
  perform set_config('role', 'authenticated', true);

  -- G1 — staff with customs:read who can see the dossier. Also the ISOLATION
  -- probe: the same identity, asked for another tenant's payment.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d1','role','authenticated')::text, true);
  select public.has_permission('customs:read') into ctl_staff_perm;
  select count(*) into staff_pay  from public.gainde_tax_payment      where id='00000000-0000-0000-0000-00000000ed01';
  select count(*) into staff_line from public.gainde_tax_payment_line where payment_id='00000000-0000-0000-0000-00000000ed01';
  select count(*) into staff_other_tenant_pay  from public.gainde_tax_payment      where id='00000000-0000-0000-0000-00000000ed02';
  select count(*) into staff_other_tenant_line from public.gainde_tax_payment_line where payment_id='00000000-0000-0000-0000-00000000ed02';

  -- G2 — staff WITHOUT customs:read. The capability is the boundary here, not
  -- the dossier, so the control is the capability itself.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d2','role','authenticated')::text, true);
  select public.has_permission('customs:read') into ctl_noperm_perm;
  select count(*) into noperm_pay  from public.gainde_tax_payment      where id='00000000-0000-0000-0000-00000000ed01';
  select count(*) into noperm_line from public.gainde_tax_payment_line where payment_id='00000000-0000-0000-0000-00000000ed01';

  -- G4 — THE GATE. An ACTIVE portal customer of this very client.
  perform set_config('request.jwt.claims',
    json_build_object('sub','00000000-0000-0000-0000-0000000000d4','role','authenticated')::text, true);
  select count(*) into portal_pay  from public.gainde_tax_payment      where id='00000000-0000-0000-0000-00000000ed01';
  select count(*) into portal_line from public.gainde_tax_payment_line where payment_id='00000000-0000-0000-0000-00000000ed01';
  -- …and the CONTROL for that result: this identity is not blind. It reads the
  -- dossier and its customs_record perfectly well through the portal policies.
  -- Without these two, a zero above could mean "the portal is broken" or "the
  -- fixture is wrong" rather than "the fiscal detail is out of reach", and a
  -- test that cannot tell those apart proves nothing.
  select count(*) into ctl_portal_file    from public.operational_file where id='00000000-0000-0000-0000-00000000fd01';
  select count(*) into ctl_portal_customs from public.customs_record   where id='00000000-0000-0000-0000-00000000cd01';

  perform set_config('role', 'postgres', true);
  insert into _r values
    ('staff_payment', staff_pay), ('staff_lines', staff_line),
    ('staff_other_tenant_payment', staff_other_tenant_pay),
    ('staff_other_tenant_lines', staff_other_tenant_line),
    ('no_customs_read_payment', noperm_pay), ('no_customs_read_lines', noperm_line),
    ('portal_payment', portal_pay), ('portal_lines', portal_line);

  -- ---- controls first: an inconclusive run must never read as a pass -------
  if ctl_staff_perm is not true then
    raise exception 'RLS GAINDE INCONCLUSIVE: the staff identity does not hold customs:read, so every count below is meaningless';
  end if;
  if ctl_noperm_perm is not false then
    raise exception 'RLS GAINDE INCONCLUSIVE: the no-permission identity DOES hold customs:read, so its zero would prove nothing';
  end if;
  if ctl_portal_file <> 1 or ctl_portal_customs <> 1 then
    raise exception 'RLS GAINDE INCONCLUSIVE: the portal identity cannot read the dossier (file=%) or its customs_record (customs=%), so a zero on the fiscal detail proves nothing',
      ctl_portal_file, ctl_portal_customs;
  end if;

  -- ---- then the assertions ------------------------------------------------
  if staff_pay <> 1 or staff_line <> 2 then
    raise exception 'RLS GAINDE FAIL: staff with customs:read must see the payment and its lines (payment=%, lines=%)',
      staff_pay, staff_line;
  end if;
  if staff_other_tenant_pay <> 0 or staff_other_tenant_line <> 0 then
    raise exception 'RLS GAINDE FAIL: cross-tenant read of the fiscal detail (payment=%, lines=%)',
      staff_other_tenant_pay, staff_other_tenant_line;
  end if;
  if noperm_pay <> 0 or noperm_line <> 0 then
    raise exception 'RLS GAINDE FAIL: staff without customs:read read the fiscal detail (payment=%, lines=%)',
      noperm_pay, noperm_line;
  end if;
  if portal_pay <> 0 or portal_line <> 0 then
    raise exception 'RLS GAINDE FAIL — DEC-C39 BREACHED: a customer read the customs duties breakdown (payment=%, lines=%)',
      portal_pay, portal_line;
  end if;
end $$;

select * from _r order by check_name;
rollback;
