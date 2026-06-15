-- 20260615000003_create_transport.sql
-- Effitrans Operations Platform — PHASE 1.10: Transport execution (final-mile).
--
-- The delivery-execution leg (driver, vehicle, road pickup/delivery, POD, status),
-- distinct from `shipment` (international carriage). One transport_record per
-- operational_file (1:1). Visibility INHERITS the dossier (Phase 1.7
-- can_read_file) — no transport:read:all. Soft-delete via deleted_at; CANCELLED
-- is the normal workflow abort.
--
-- Customs gate (IMP/EXP): PICKED_UP is blocked until customs RELEASED unless
-- customs is not required or customs_override is set (enforced in the action;
-- pure canPickup). POD_RECEIVED requires an APPROVED DELIVERY_NOTE (Phase 1.8).
--
-- SCOPE GUARD: transport execution only. No GPS, driver app, vehicle catalog,
-- route optimization, fuel/cost, carrier billing, finance, external integrations.
-- RLS + append-only audit preserved.

create table public.transport_record (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  file_id              uuid not null unique references public.operational_file (id) on delete cascade,
  status               text not null default 'NOT_STARTED'
                         check (status in ('NOT_STARTED', 'PLANNED', 'DRIVER_ASSIGNED', 'PICKED_UP',
                                           'IN_TRANSIT', 'DELIVERED', 'POD_RECEIVED', 'BLOCKED', 'CANCELLED')),
  pickup_location      text,
  delivery_location    text,
  pickup_planned       timestamptz,
  pickup_actual        timestamptz,
  delivery_planned     timestamptz,
  delivery_actual      timestamptz,
  driver_name          text,
  driver_phone         text,
  vehicle_plate        text,
  trailer_or_container text,
  transport_company    text,
  delivery_reference   text,
  pod_document_id      uuid references public.document (id) on delete set null,
  customs_override     boolean not null default false,   -- manager escape hatch for the customs gate
  notes                text,
  created_by           uuid references public.app_user (id),
  assigned_by          uuid references public.app_user (id),
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_transport_tenant_status on public.transport_record (tenant_id, status) where deleted_at is null;
create index idx_transport_file on public.transport_record (file_id);

create trigger trg_transport_updated_at before update on public.transport_record
  for each row execute function public.set_updated_at();

-- Integrity: a transport record's tenant must match its dossier's tenant.
create or replace function public.enforce_transport_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'transport tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_transport_tenant before insert or update on public.transport_record
  for each row execute function public.enforce_transport_tenant();

-- ===========================================================================
-- RLS — read inherits dossier visibility (Phase 1.7). Writes via the
-- service-role admin client in server actions (deny-by-default). Soft-deleted
-- rows are never returned.
-- ===========================================================================
alter table public.transport_record enable row level security;

create policy transport_record_select on public.transport_record
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('transport:read')
    and public.can_read_file(file_id)
    and deleted_at is null
  );

grant select on public.transport_record to authenticated;

-- ===========================================================================
-- Permissions (catalog + role grants, mirrored in seed.sql).
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('transport:create',   'transport', 'create',   'assigned', 'Create transport records'),
  ('transport:read',     'transport', 'read',     'assigned', 'View transport records'),
  ('transport:update',   'transport', 'update',   'assigned', 'Edit / progress transport records'),
  ('transport:assign',   'transport', 'assign',   'assigned', 'Assign driver / vehicle'),
  ('transport:complete', 'transport', 'complete', 'assigned', 'Confirm delivery / POD received'),
  ('transport:delete',   'transport', 'delete',   'assigned', 'Delete transport records (soft)')
on conflict (code) do nothing;

-- read: everyone who works dossiers.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COMPLIANCE_HSSE',
                 'COORDINATOR', 'TRANSPORT_OFFICER', 'WAREHOUSE_COORDINATOR', 'DOCUMENTATION_OFFICER')
on conflict do nothing;

-- create / update / assign: the transport operators.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('transport:create', 'transport:update', 'transport:assign')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

-- complete (DELIVERED / POD_RECEIVED): delivery confirmation authority.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:complete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'TRANSPORT_OFFICER')
on conflict do nothing;

-- delete (soft): admin + ops supervisor.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:delete'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;
