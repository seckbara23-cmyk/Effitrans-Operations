-- 20260615000004_create_finance.sql
-- Effitrans Operations Platform — PHASE 1.11: Finance / Billing.
--
-- Lightweight billing on top of dossiers: charges -> draft invoice -> issue ->
-- payments. NOT accounting: no GL, no chart of accounts, no tax engine, no
-- supplier bills, no export, no payment-provider API.
--
-- SECURITY MODEL (different from the other modules): finance visibility is
-- FINANCE-ROLE based, NOT inherited from can_read_file. RLS = tenant +
-- has_permission('finance:read') only. A general operational user never sees
-- money by default. Deny-by-default writes via service-role server actions.
--
-- Numbering (per tenant x year, sequential, never reused), assigned on ISSUE:
-- EFT-INV-YYYY-00001. XOF default currency. Invoices editable only while DRAFT.

-- ===========================================================================
-- 1. invoice_counter (INTERNAL — numbering only; locked down, no policies/grants)
-- ===========================================================================
create table public.invoice_counter (
  tenant_id uuid not null references public.organization (id),
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, year)
);
alter table public.invoice_counter enable row level security;

create or replace function public.next_invoice_number(p_tenant uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  insert into public.invoice_counter (tenant_id, year, next_seq)
  values (p_tenant, v_year, 1)
  on conflict (tenant_id, year)
    do update set next_seq = invoice_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'EFT-INV-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

revoke execute on function public.next_invoice_number(uuid) from public;
grant execute on function public.next_invoice_number(uuid) to service_role;

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
create table public.billing_charge (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  file_id     uuid not null references public.operational_file (id) on delete cascade,
  description text not null,
  quantity    numeric(12, 2) not null default 1,
  unit_amount numeric(14, 2) not null default 0,
  tax_rate    numeric(5, 2)  not null default 0,   -- optional VAT %
  currency    text not null default 'XOF',
  created_by  uuid references public.app_user (id),
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.invoice (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.organization (id),
  file_id        uuid not null references public.operational_file (id) on delete cascade,
  client_id      uuid references public.client (id),
  invoice_number text,                              -- null until issued
  status         text not null default 'DRAFT'
                   check (status in ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
  currency       text not null default 'XOF',
  issue_date     date,
  due_date       date,
  notes          text,
  created_by     uuid references public.app_user (id),
  issued_by      uuid references public.app_user (id),
  voided_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, invoice_number)               -- multiple NULLs allowed (drafts)
);

create table public.invoice_line (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  invoice_id  uuid not null references public.invoice (id) on delete cascade,
  charge_id   uuid references public.billing_charge (id) on delete set null,
  description text not null,
  quantity    numeric(12, 2) not null default 1,
  unit_amount numeric(14, 2) not null default 0,
  tax_rate    numeric(5, 2)  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.payment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  invoice_id  uuid not null references public.invoice (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  method      text not null
                check (method in ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'WAVE', 'ORANGE_MONEY', 'OTHER')),
  reference   text,
  paid_at     date not null default current_date,
  reversed_at timestamptz,
  reversed_by uuid references public.app_user (id),
  recorded_by uuid references public.app_user (id),
  created_at  timestamptz not null default now()
);

create index idx_charge_file on public.billing_charge (file_id) where deleted_at is null;
create index idx_invoice_file on public.invoice (file_id);
create index idx_invoice_tenant_status on public.invoice (tenant_id, status);
create index idx_invoice_line_invoice on public.invoice_line (invoice_id);
create index idx_payment_invoice on public.payment (invoice_id) where reversed_at is null;

create trigger trg_charge_updated_at before update on public.billing_charge
  for each row execute function public.set_updated_at();
create trigger trg_invoice_updated_at before update on public.invoice
  for each row execute function public.set_updated_at();
create trigger trg_invoice_line_updated_at before update on public.invoice_line
  for each row execute function public.set_updated_at();

-- Tenant-match integrity (charge/invoice vs file; line/payment vs invoice).
create or replace function public.enforce_finance_file_tenant()
returns trigger language plpgsql as $$
declare f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'finance tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_charge_tenant before insert or update on public.billing_charge
  for each row execute function public.enforce_finance_file_tenant();
create trigger trg_invoice_tenant before insert or update on public.invoice
  for each row execute function public.enforce_finance_file_tenant();

create or replace function public.enforce_finance_invoice_tenant()
returns trigger language plpgsql as $$
declare i_tenant uuid;
begin
  select tenant_id into i_tenant from public.invoice where id = new.invoice_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'finance tenant mismatch (invoice_tenant=%, given=%)', i_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_invoice_line_tenant before insert or update on public.invoice_line
  for each row execute function public.enforce_finance_invoice_tenant();
create trigger trg_payment_tenant before insert or update on public.payment
  for each row execute function public.enforce_finance_invoice_tenant();

-- ===========================================================================
-- 3. RLS — FINANCE-ROLE based (tenant + finance:read). NO can_read_file: money
--    is not visible just because you can see the dossier. Deny-by-default writes.
-- ===========================================================================
alter table public.billing_charge enable row level security;
alter table public.invoice        enable row level security;
alter table public.invoice_line   enable row level security;
alter table public.payment        enable row level security;

create policy billing_charge_select on public.billing_charge
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read') and deleted_at is null);

create policy invoice_select on public.invoice
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read'));

create policy invoice_line_select on public.invoice_line
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read'));

create policy payment_select on public.payment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('finance:read'));

grant select on public.billing_charge, public.invoice, public.invoice_line, public.payment to authenticated;

-- ===========================================================================
-- 4. Permissions (catalog + role grants, mirrored in seed.sql).
--    NOTE: the spec's "FINANCE_AGENT" maps to the seeded FINANCE_OFFICER role.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('finance:create',  'finance', 'create',  'all', 'Create charges / draft invoices'),
  ('finance:read',    'finance', 'read',    'all', 'View finance (charges, invoices, payments)'),
  ('finance:update',  'finance', 'update',  'all', 'Edit charges / draft invoices'),
  ('finance:issue',   'finance', 'issue',   'all', 'Issue invoices'),
  ('finance:payment', 'finance', 'payment', 'all', 'Record payments'),
  ('finance:void',    'finance', 'void',    'all', 'Void invoices / reverse payments'),
  ('finance:delete',  'finance', 'delete',  'all', 'Delete charges / draft invoices')
on conflict (code) do nothing;

-- SYSTEM_ADMIN: all.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.module = 'finance'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

-- CEO: read.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'finance:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'CEO'
on conflict do nothing;

-- OPS_SUPERVISOR: read, create, update, issue, payment, void.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:update', 'finance:issue', 'finance:payment', 'finance:void')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

-- ACCOUNT_MANAGER: read, create, issue.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:issue')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

-- FINANCE_OFFICER (spec "FINANCE_AGENT"): read, create, update, issue, payment, void.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:create', 'finance:update', 'finance:issue', 'finance:payment', 'finance:void')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'FINANCE_OFFICER'
on conflict do nothing;
