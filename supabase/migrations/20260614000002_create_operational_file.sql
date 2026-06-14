-- 20260614000002_create_operational_file.sql
-- Effitrans Operations Platform — PHASE 1.2: Operational File + Shipment (spine)
-- Follows docs/s2-security-patterns.md (tenant_id + RLS + helper reuse + audited
-- service-role writes) and reuses the Client Management patterns.
-- File numbering per DEC-B06: EFT-{TYPE}-{YEAR}-{SEQUENCE}, 5-digit, per
-- tenant x type x year, never reused, assigned on creation, concurrency-safe.
--
-- SCOPE GUARD: operational file + shipment only. NO customs / documents /
-- transport module / finance / invoices / portal. Multi-tenant isolation preserved.

-- ===========================================================================
-- file_counter (INTERNAL — numbering only; locked down, no RLS policies/grants)
-- ===========================================================================
create table public.file_counter (
  tenant_id uuid not null references public.organization (id),
  type      text not null,
  year      int  not null,
  next_seq  int  not null default 0,
  primary key (tenant_id, type, year)
);
alter table public.file_counter enable row level security;
-- No policies, no grants: only the function (security definer) / service role writes it.

-- Concurrency-safe next number. The ON CONFLICT ... RETURNING takes a row lock
-- so concurrent callers serialize and each gets a unique, increasing sequence.
-- Gaps are allowed (a consumed number is never reused) per DEC-B06.
create or replace function public.next_file_number(p_tenant uuid, p_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_seq  int;
begin
  if p_type not in ('IMP', 'EXP', 'TRP', 'HND') then
    raise exception 'invalid file type %', p_type;
  end if;
  insert into public.file_counter (tenant_id, type, year, next_seq)
  values (p_tenant, p_type, v_year, 1)
  on conflict (tenant_id, type, year)
    do update set next_seq = file_counter.next_seq + 1
  returning next_seq into v_seq;
  return 'EFT-' || p_type || '-' || v_year::text || '-' || lpad(v_seq::text, 5, '0');
end;
$$;

revoke execute on function public.next_file_number(uuid, text) from public;
grant execute on function public.next_file_number(uuid, text) to service_role;

-- ===========================================================================
-- operational_file (the spine)
-- ===========================================================================
create table public.operational_file (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organization (id),
  file_number        text not null,
  type               text not null check (type in ('IMP', 'EXP', 'TRP', 'HND')),
  client_id          uuid not null references public.client (id),
  account_manager_id uuid references public.app_user (id),
  coordinator_id     uuid references public.app_user (id),
  status             text not null default 'DRAFT'
                       check (status in ('DRAFT', 'OPENED', 'IN_PROGRESS', 'DELIVERED', 'CLOSED')),
  priority           text not null default 'normal'
                       check (priority in ('low', 'normal', 'high', 'critical')),
  opened_at          timestamptz,
  archived_at        timestamptz,                 -- reserved (ARCHIVED deferred to POD module)
  created_by         uuid references public.app_user (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index uq_operational_file_number on public.operational_file (tenant_id, file_number);
create index idx_operational_file_tenant on public.operational_file (tenant_id);
create index idx_operational_file_tenant_status on public.operational_file (tenant_id, status);
create index idx_operational_file_client on public.operational_file (client_id);
create index idx_operational_file_am on public.operational_file (account_manager_id);

create trigger trg_operational_file_updated_at before update on public.operational_file
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- shipment (1:1 transport detail for a file)
-- ===========================================================================
create table public.shipment (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organization (id),
  file_id          uuid not null unique references public.operational_file (id) on delete cascade,
  transport_mode   text check (transport_mode in ('SEA', 'AIR', 'ROAD', 'MULTIMODAL')),
  incoterm         text,
  origin           text,
  destination      text,
  cargo_type       text,
  carrier_name     text,
  vessel_or_flight text,
  bl_awb_ref       text,
  container_ref    text,
  etd              timestamptz,
  atd              timestamptz,
  eta              timestamptz,
  ata              timestamptz,
  pickup_planned   timestamptz,
  pickup_actual    timestamptz,
  delivery_planned timestamptz,
  delivery_actual  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_shipment_tenant on public.shipment (tenant_id);
create index idx_shipment_file on public.shipment (file_id);

create trigger trg_shipment_updated_at before update on public.shipment
  for each row execute function public.set_updated_at();

create or replace function public.enforce_shipment_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'shipment tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_shipment_tenant before insert or update on public.shipment
  for each row execute function public.enforce_shipment_tenant();

-- ===========================================================================
-- file_state_transition (append-only history of status changes)
-- ===========================================================================
create table public.file_state_transition (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organization (id),
  file_id     uuid not null references public.operational_file (id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid references public.app_user (id),
  note        text,
  occurred_at timestamptz not null default now()
);

create index idx_fst_tenant on public.file_state_transition (tenant_id);
create index idx_fst_file on public.file_state_transition (file_id);

-- Immutable records (UPDATE blocked). DELETE is left to FK cascade only.
create trigger trg_fst_no_update before update on public.file_state_transition
  for each row execute function public.prevent_mutation();

-- ===========================================================================
-- RLS — reads via user-context client (tenant + file:read). Writes via the
-- service-role admin client in server actions (deny-by-default for authenticated).
-- ===========================================================================
alter table public.operational_file      enable row level security;
alter table public.shipment              enable row level security;
alter table public.file_state_transition enable row level security;

create policy operational_file_select on public.operational_file
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('file:read'));

create policy shipment_select on public.shipment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('file:read'));

create policy file_state_transition_select on public.file_state_transition
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('file:read'));

grant select on public.operational_file, public.shipment, public.file_state_transition to authenticated;

-- ===========================================================================
-- Permissions (catalog + provisional role mappings, pending BLK-RB1).
-- Mirrored into seed.sql for fresh local resets. file:delete is reserved for the
-- archive flow (deferred to the document/POD module) — seeded but not yet used.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('file:create', 'file', 'create', 'all', 'Create operational files'),
  ('file:read',   'file', 'read',   'all', 'View operational files'),
  ('file:update', 'file', 'update', 'all', 'Edit operational files & shipments'),
  ('file:delete', 'file', 'delete', 'all', 'Archive operational files (reserved)')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:create', 'file:read', 'file:update', 'file:delete')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'SYSTEM_ADMIN'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:create', 'file:read', 'file:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'ACCOUNT_MANAGER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('file:read', 'file:update')
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'COORDINATOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('CEO', 'OPS_SUPERVISOR')
on conflict do nothing;
