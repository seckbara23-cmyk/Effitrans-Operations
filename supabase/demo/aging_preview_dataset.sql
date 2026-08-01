-- =========================================================================
-- SYNTHETIC PREVIEW DATASET — Balance âgée (FIN-AGING-3A)
-- =========================================================================
-- PREVIEW / STAGING ONLY. NEVER RUN THIS AGAINST PRODUCTION.
--
-- Purpose: give the Finance Manager something to LOOK at. Every client, invoice
-- and payment below is invented. There is no production client, no production
-- invoice, no imported workbook and no real legacy balance anywhere in this file
-- — the reference workbook is not committed to this repository at all, and the
-- names here are deliberately obvious placeholders ("Client Démo Alpha").
--
-- =========================================================================
-- HOW IT REFUSES TO DAMAGE ANYTHING
-- =========================================================================
--   1. It creates its OWN tenant (a fixed demo UUID). It never writes into an
--      existing organization, so no real tenant can acquire demo receivables.
--   2. It ABORTS if that tenant already holds non-demo invoices — the one way
--      the demo id could ever collide with something real.
--   3. Every row it creates is prefixed DEMO- or « Démo », so the companion
--      teardown at the bottom removes exactly what this script added.
--   4. It is idempotent: re-running replaces the demo data rather than
--      duplicating it.
--
-- Usage (preview/staging database only):
--   psql "$PREVIEW_DATABASE_URL" -f supabase/demo/aging_preview_dataset.sql
--
-- To see it in the app you also need, per the FIN-AGING-3 gates:
--   * migration 72 applied on that database;
--   * EFFITRANS_FINANCE_AGING_ENABLED=true on that deployment;
--   * a login whose role holds finance:aging:read;
--   * that login's app_user.tenant_id = the demo tenant below.
--
-- =========================================================================
-- WHAT THE DATA EXERCISES
-- =========================================================================
-- Deliberately shaped to hit every visual state the review checklist names,
-- including the ones that are easy to forget until they render badly:
--   * every one of the seven buckets, including the 365/366 boundary;
--   * a not-yet-due invoice (negative days) and one due exactly today;
--   * partial payment, full settlement (excluded), overpayment (unapplied credit);
--   * a disputed invoice;
--   * OPENING_IMPORT rows with no dossier, showing a preserved legacy reference;
--   * a foreign-currency invoice, to exercise the exclusion notice;
--   * a client whose invoices are all in the future — the « Faible » floor;
--   * one client large enough to dominate the Top-10 chart, and a long tail.
-- =========================================================================

\set ON_ERROR_STOP on

do $$
declare
  demo_tenant uuid := '00000000-0000-0000-0000-00000000de00';
  real_invoices int;
begin
  -- (2) Refuse to touch a tenant that holds anything real.
  select count(*) into real_invoices
    from public.invoice
   where tenant_id = demo_tenant
     and coalesce(invoice_number, '') not like 'DEMO-%';
  if real_invoices > 0 then
    raise exception
      'REFUSING: tenant % holds % non-demo invoice(s). This script only ever populates a dedicated demo tenant.',
      demo_tenant, real_invoices;
  end if;
end $$;

begin;

-- ---------------------------------------------------------------- teardown
-- Idempotent: remove the previous run before rebuilding.
delete from public.payment
 where tenant_id = '00000000-0000-0000-0000-00000000de00'
   and invoice_id in (select id from public.invoice
                       where tenant_id = '00000000-0000-0000-0000-00000000de00'
                         and invoice_number like 'DEMO-%');
delete from public.invoice_line
 where tenant_id = '00000000-0000-0000-0000-00000000de00'
   and invoice_id in (select id from public.invoice
                       where tenant_id = '00000000-0000-0000-0000-00000000de00'
                         and invoice_number like 'DEMO-%');
delete from public.invoice
 where tenant_id = '00000000-0000-0000-0000-00000000de00' and invoice_number like 'DEMO-%';

-- ---------------------------------------------------------------- tenant
insert into public.organization (id, name, country, timezone)
values ('00000000-0000-0000-0000-00000000de00', 'Démo — Balance âgée', 'SN', 'Africa/Dakar')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- clients
insert into public.client (id, tenant_id, name) values
  ('00000000-0000-0000-0000-0000000c1e01', '00000000-0000-0000-0000-00000000de00', 'Client Démo Alpha'),
  ('00000000-0000-0000-0000-0000000c1e02', '00000000-0000-0000-0000-00000000de00', 'Client Démo Bêta'),
  ('00000000-0000-0000-0000-0000000c1e03', '00000000-0000-0000-0000-00000000de00', 'Client Démo Gamma'),
  ('00000000-0000-0000-0000-0000000c1e04', '00000000-0000-0000-0000-00000000de00', 'Client Démo Delta'),
  ('00000000-0000-0000-0000-0000000c1e05', '00000000-0000-0000-0000-00000000de00', 'Client Démo Epsilon'),
  ('00000000-0000-0000-0000-0000000c1e06', '00000000-0000-0000-0000-00000000de00', 'Client Démo Zêta'),
  ('00000000-0000-0000-0000-0000000c1e07', '00000000-0000-0000-0000-00000000de00', 'Client Démo Êta'),
  ('00000000-0000-0000-0000-0000000c1e08', '00000000-0000-0000-0000-00000000de00', 'Client Démo Thêta'),
  ('00000000-0000-0000-0000-0000000c1e09', '00000000-0000-0000-0000-00000000de00', 'Client Démo Iota'),
  ('00000000-0000-0000-0000-0000000c1e10', '00000000-0000-0000-0000-00000000de00', 'Client Démo Kappa'),
  ('00000000-0000-0000-0000-0000000c1e11', '00000000-0000-0000-0000-00000000de00', 'Client Démo Lambda'),
  ('00000000-0000-0000-0000-0000000c1e12', '00000000-0000-0000-0000-00000000de00', 'Client Démo Futur')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- dossiers
insert into public.operational_file (id, tenant_id, file_number, type, client_id, status) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-00000000de00', 'DEMO-IMP-2026-0001', 'IMP', '00000000-0000-0000-0000-0000000c1e01', 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-00000000de00', 'DEMO-IMP-2026-0002', 'IMP', '00000000-0000-0000-0000-0000000c1e02', 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-00000000de00', 'DEMO-EXP-2026-0003', 'EXP', '00000000-0000-0000-0000-0000000c1e03', 'DELIVERED'),
  ('00000000-0000-0000-0000-00000000f104', '00000000-0000-0000-0000-00000000de00', 'DEMO-TRP-2026-0004', 'TRP', '00000000-0000-0000-0000-0000000c1e04', 'DELIVERED'),
  -- FND-R11-02: dossiers for Epsilon and Zêta, so their PLATFORM_NATIVE invoices
  -- satisfy invoice_dossier_or_legacy_reference (Q-08: dossier mandatory for
  -- native provenance). Added when the constraint rejected the original rows.
  ('00000000-0000-0000-0000-00000000f105', '00000000-0000-0000-0000-00000000de00', 'DEMO-IMP-2026-0005', 'IMP', '00000000-0000-0000-0000-0000000c1e05', 'DELIVERED'),
  ('00000000-0000-0000-0000-00000000f106', '00000000-0000-0000-0000-00000000de00', 'DEMO-EXP-2026-0006', 'EXP', '00000000-0000-0000-0000-0000000c1e06', 'DELIVERED'),
  -- FND-R11-02 (second finding): the tail clients billed against dossiers owned
  -- by OTHER clients — a state production cannot reach, since an invoice is
  -- created from a dossier and inherits its client. Each client now owns the
  -- dossier it is billed against.
  ('00000000-0000-0000-0000-00000000f107', '00000000-0000-0000-0000-00000000de00', 'DEMO-IMP-2026-0007', 'IMP', '00000000-0000-0000-0000-0000000c1e09', 'IN_PROGRESS'),
  ('00000000-0000-0000-0000-00000000f108', '00000000-0000-0000-0000-00000000de00', 'DEMO-IMP-2026-0008', 'IMP', '00000000-0000-0000-0000-0000000c1e10', 'DELIVERED'),
  ('00000000-0000-0000-0000-00000000f109', '00000000-0000-0000-0000-00000000de00', 'DEMO-EXP-2026-0009', 'EXP', '00000000-0000-0000-0000-0000000c1e11', 'DELIVERED'),
  ('00000000-0000-0000-0000-00000000f110', '00000000-0000-0000-0000-00000000de00', 'DEMO-TRP-2026-0010', 'TRP', '00000000-0000-0000-0000-0000000c1e12', 'IN_PROGRESS')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- invoices
-- `today` is resolved once so the dataset stays meaningful whenever it is run:
-- every due date is expressed as an offset, which keeps the buckets populated
-- next month as well as today.
do $$
declare
  T uuid := '00000000-0000-0000-0000-00000000de00';
  today date := current_date;
  -- (client, dossier, invoice suffix, days overdue, amount, provenance, legacy ref, currency, disputed)
  spec record;
begin
  for spec in
    select * from (values
      -- --- the seven buckets, including both sides of the 365/366 boundary ---
      ('00000000-0000-0000-0000-0000000c1e01'::uuid, '00000000-0000-0000-0000-00000000f101'::uuid, '0001',  -45,  4200000::numeric, 'PLATFORM_NATIVE', null::text, 'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e01'::uuid, '00000000-0000-0000-0000-00000000f101'::uuid, '0002',    0,  1850000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e02'::uuid, '00000000-0000-0000-0000-00000000f102'::uuid, '0003',   12,  9600000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e02'::uuid, '00000000-0000-0000-0000-00000000f102'::uuid, '0004',   30,  2400000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e03'::uuid, '00000000-0000-0000-0000-00000000f103'::uuid, '0005',   31,  5100000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e03'::uuid, '00000000-0000-0000-0000-00000000f103'::uuid, '0006',   60,   780000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e04'::uuid, '00000000-0000-0000-0000-00000000f104'::uuid, '0007',   61,  3300000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e04'::uuid, '00000000-0000-0000-0000-00000000f104'::uuid, '0008',   90,  1200000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- FND-R11-02 correction: these four were PLATFORM_NATIVE with no dossier and
      -- a legacy reference — the exact combination the Q-08 constraint forbids
      -- (and did reject). Native invoices now carry their client's own dossier and
      -- no legacy reference; the buckets they exercise (91/180/181/365) are unchanged.
      ('00000000-0000-0000-0000-0000000c1e05'::uuid, '00000000-0000-0000-0000-00000000f105'::uuid, '0009',   91, 14500000::numeric, 'PLATFORM_NATIVE', null::text,  'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e05'::uuid, '00000000-0000-0000-0000-00000000f105'::uuid, '0010',  180,  6400000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e06'::uuid, '00000000-0000-0000-0000-00000000f106'::uuid, '0011',  181,  2750000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- 365 must NOT be critical; 366 must be. The pair sits here so the boundary
      -- is visible on screen, not only in a unit test.
      ('00000000-0000-0000-0000-0000000c1e06'::uuid, '00000000-0000-0000-0000-00000000f106'::uuid, '0012',  365,  1950000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e07'::uuid, null,                                          '0013',  366,  8800000::numeric, 'OPENING_IMPORT',  'DEMO-LEG-2024-118', 'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e07'::uuid, null,                                          '0014',  742, 12300000::numeric, 'OPENING_IMPORT',  'DEMO-LEG-2023-042', 'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e08'::uuid, null,                                          '0015', 1580,  4700000::numeric, 'OPENING_IMPORT',  'DEMO-LEG-2021-007', 'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e08'::uuid, null,                                          '0016', 2505,  2100000::numeric, 'OPENING_IMPORT',  'DEMO-LEG-2019-044', 'XOF', false),
      -- --- a disputed receivable: visible, aged normally, flagged ---
      ('00000000-0000-0000-0000-0000000c1e09'::uuid, '00000000-0000-0000-0000-00000000f107'::uuid, '0017',   75,  3600000::numeric, 'PLATFORM_NATIVE', null,        'XOF', true),
      -- --- long tail, so the Top-10 chart has an eleventh client to cut off ---
      ('00000000-0000-0000-0000-0000000c1e10'::uuid, '00000000-0000-0000-0000-00000000f108'::uuid, '0018',   22,   540000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e11'::uuid, '00000000-0000-0000-0000-00000000f109'::uuid, '0019',    5,   180000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- --- a client entirely in the future: proves the « Faible » client floor ---
      ('00000000-0000-0000-0000-0000000c1e12'::uuid, '00000000-0000-0000-0000-00000000f110'::uuid, '0020',  -30,  2600000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      ('00000000-0000-0000-0000-0000000c1e12'::uuid, '00000000-0000-0000-0000-00000000f110'::uuid, '0021',  -58,  1400000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- --- foreign currency: excluded from an XOF report, counted, never converted ---
      ('00000000-0000-0000-0000-0000000c1e01'::uuid, '00000000-0000-0000-0000-00000000f101'::uuid, '0022',   40,    95000::numeric, 'PLATFORM_NATIVE', null,        'EUR', false),
      -- --- partially paid (payment applied below) ---
      ('00000000-0000-0000-0000-0000000c1e02'::uuid, '00000000-0000-0000-0000-00000000f102'::uuid, '0023',  120,  8000000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- --- fully settled: must NOT appear in the aged population ---
      ('00000000-0000-0000-0000-0000000c1e03'::uuid, '00000000-0000-0000-0000-00000000f103'::uuid, '0024',   55,  1000000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false),
      -- --- overpaid: receivable clamps to zero, excess shown as unapplied credit ---
      ('00000000-0000-0000-0000-0000000c1e04'::uuid, '00000000-0000-0000-0000-00000000f104'::uuid, '0025',   18,   500000::numeric, 'PLATFORM_NATIVE', null,        'XOF', false)
    ) as s(client_id, file_id, suffix, days_overdue, amount, provenance, legacy_ref, currency, disputed)
  loop
    insert into public.invoice (
      tenant_id, file_id, client_id, invoice_number, status, currency,
      issue_date, due_date, provenance, legacy_file_reference, disputed_at, dispute_reason
    ) values (
      T, spec.file_id, spec.client_id, 'DEMO-INV-' || spec.suffix, 'ISSUED', spec.currency,
      today - spec.days_overdue - 30, today - spec.days_overdue,
      spec.provenance, spec.legacy_ref,
      case when spec.disputed then now() - interval '10 days' else null end,
      case when spec.disputed then 'Écart de tarification signalé par le client (démo)' else null end
    );

    insert into public.invoice_line (tenant_id, invoice_id, description, quantity, unit_amount, tax_rate)
    select T, i.id, 'Prestation de transit (démo)', 1, spec.amount, 0
      from public.invoice i
     where i.tenant_id = T and i.invoice_number = 'DEMO-INV-' || spec.suffix;
  end loop;
end $$;

-- ---------------------------------------------------------------- payments
-- 0023 partially paid · 0024 settled in full · 0025 overpaid.
insert into public.payment (tenant_id, invoice_id, amount, method, paid_at, reference)
select '00000000-0000-0000-0000-00000000de00', i.id, 3000000, 'BANK_TRANSFER', current_date - 20, 'DEMO-PAY-001'
  from public.invoice i
 where i.tenant_id = '00000000-0000-0000-0000-00000000de00' and i.invoice_number = 'DEMO-INV-0023';

insert into public.payment (tenant_id, invoice_id, amount, method, paid_at, reference)
select '00000000-0000-0000-0000-00000000de00', i.id, 1000000, 'CASH', current_date - 5, 'DEMO-PAY-002'
  from public.invoice i
 where i.tenant_id = '00000000-0000-0000-0000-00000000de00' and i.invoice_number = 'DEMO-INV-0024';

insert into public.payment (tenant_id, invoice_id, amount, method, paid_at, reference)
select '00000000-0000-0000-0000-00000000de00', i.id, 620000, 'WAVE', current_date - 3, 'DEMO-PAY-003'
  from public.invoice i
 where i.tenant_id = '00000000-0000-0000-0000-00000000de00' and i.invoice_number = 'DEMO-INV-0025';

-- A payment dated AFTER a back-dated arrêté, so reviewers can see that moving
-- the date backwards genuinely changes the figures.
insert into public.payment (tenant_id, invoice_id, amount, method, paid_at, reference)
select '00000000-0000-0000-0000-00000000de00', i.id, 500000, 'CHEQUE', current_date + 3, 'DEMO-PAY-FUTURE'
  from public.invoice i
 where i.tenant_id = '00000000-0000-0000-0000-00000000de00' and i.invoice_number = 'DEMO-INV-0003';

-- Mark the settled one so the invoice status matches its balance.
update public.invoice set status = 'PAID'
 where tenant_id = '00000000-0000-0000-0000-00000000de00' and invoice_number = 'DEMO-INV-0024';
update public.invoice set status = 'PARTIALLY_PAID'
 where tenant_id = '00000000-0000-0000-0000-00000000de00' and invoice_number in ('DEMO-INV-0023', 'DEMO-INV-0025');

commit;

select
  (select count(*) from public.invoice where tenant_id = '00000000-0000-0000-0000-00000000de00') as demo_invoices,
  (select count(*) from public.client  where tenant_id = '00000000-0000-0000-0000-00000000de00') as demo_clients,
  (select count(*) from public.payment where tenant_id = '00000000-0000-0000-0000-00000000de00') as demo_payments;

-- =========================================================================
-- TEARDOWN (run to remove every row this script created)
-- =========================================================================
-- delete from public.payment      where tenant_id = '00000000-0000-0000-0000-00000000de00';
-- delete from public.invoice_line where tenant_id = '00000000-0000-0000-0000-00000000de00';
-- delete from public.invoice      where tenant_id = '00000000-0000-0000-0000-00000000de00';
-- delete from public.operational_file where tenant_id = '00000000-0000-0000-0000-00000000de00';
-- delete from public.client       where tenant_id = '00000000-0000-0000-0000-00000000de00';
-- delete from public.organization where id        = '00000000-0000-0000-0000-00000000de00';
