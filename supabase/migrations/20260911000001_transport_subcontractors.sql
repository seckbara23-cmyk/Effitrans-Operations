-- 20260911000001_transport_subcontractors.sql
-- Effitrans Operations Platform — TMS-6: Subcontractors / External transport.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 119. Governing specification:
-- docs/tms/tms-6-subcontractors.md (frozen TMS-0 roadmap).
--
-- RENUMBERED: this was drafted as 118 before TMS-5C took that slot
-- (20260910000001, applied in production). A migration must sort AFTER every
-- applied one, so it moved to 20260911000001 rather than reusing the number.
--
-- REBASED onto post-TMS-5B/5C HEAD. What changed under it, and what did not:
--   * TRANSPORT is now a canonical Effitrans DEPARTMENT and the three transport
--     roles derive to it. A subcontractor is the opposite of that — an EXTERNAL
--     company, never a department and never an Effitrans identity — so the
--     registry stays a plain tenant-scoped reference table and touches neither
--     lib/organization/departments.ts nor any role mapping.
--   * Parc & Flotte is live, which makes the exclusion invariant below MORE
--     load-bearing, not less: internal execution now has real vehicles to
--     confuse with an external provider.
--   * The transport authorities (manage/assign/read) were untouched by 5B/5C,
--     so the authority finding from the original audit still holds exactly.
--
-- THE GAP THIS CLOSES: external execution was representable only as the free
-- text transport_record.transport_company. Nothing distinguished one spelling
-- from another, nothing recorded that a provider is approved or suspended, and
-- — the real defect — NOTHING PREVENTED a transport from being recorded as an
-- Effitrans-fleet execution and an external one at the same time.
--
-- WHY A NEW TABLE (verified at HEAD — no subcontractor registry exists):
--   * ocean_carrier is the MARITIME shipping-line plane, keyed to vessels and
--     voyages on `shipment`. A road subcontractor executes the final-mile
--     transport_record. Sharing the table to share the French word
--     « Transporteur » would put maritime master data under road operations.
--   * provider_webhook_event is payments infrastructure — unrelated.
--   * client is the CUSTOMER side of the relationship.
--   * transport_company (free text) cannot carry approval state, contact
--     details or identity — and it STAYS, as the historical name snapshot and
--     the ad-hoc carrier lane.
--
-- WHAT THIS ADDS — and deliberately nothing else: one registry table, one
-- nullable FK, one mutual-exclusion CHECK, one availability trigger, RLS reads
-- on the EXISTING transport:read. NO new permission, NO new event type, NO
-- execution_mode column (internal vs external is DERIVED from which FK is set),
-- NO second execution machine.
--
-- NOT here: procurement, supplier accounting, carrier billing, tendering, rate
-- cards, contracts, vendor documents, scoring, telematics, driver payroll.

-- ===========================================================================
-- 1. THE REGISTRY — mirrors the `client` idiom (name/ninea/contact/status).
-- ===========================================================================
create table if not exists public.transport_provider (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  name          text not null,
  ninea         text,                                  -- Senegalese business id
  contact_name  text,
  email         text,
  phone         text,
  address       text,
  -- Approval state, not a workflow: an operator either may dispatch this
  -- provider today, or may not. SUSPENDED keeps the history readable.
  status        text not null default 'APPROVED'
                  check (status in ('APPROVED', 'SUSPENDED')),
  is_active     boolean not null default true,
  notes         text,
  created_by    uuid references public.app_user (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_transport_provider_name
  on public.transport_provider (tenant_id, upper(btrim(name)));
create index if not exists idx_transport_provider_tenant_status
  on public.transport_provider (tenant_id, status) where is_active;

drop trigger if exists trg_transport_provider_updated_at on public.transport_provider;
create trigger trg_transport_provider_updated_at before update on public.transport_provider
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 2. THE LINK TO EXECUTION + THE EXECUTION-SOURCE INVARIANT.
--    transport_company is NOT touched: it remains the printed « Transporteur »
--    on the ORDRE DE TRANSPORT, the historical name snapshot, and the ad-hoc
--    carrier lane for a one-off haulier that is not worth registering.
-- ===========================================================================
alter table public.transport_record
  add column if not exists provider_id uuid references public.transport_provider (id);

comment on column public.transport_record.provider_id is
  'TMS-6 — the EXTERNAL subcontractor executing this transport. Mutually exclusive with vehicle_id: fleet execution or external execution, never both. Internal vs external is DERIVED from which of the two is set — there is no execution_mode column.';

create index if not exists idx_transport_record_provider
  on public.transport_record (tenant_id, provider_id) where provider_id is not null;

-- A transport is executed by the Effitrans fleet OR by a subcontractor.
-- Recording both is a contradiction, refused by the database itself.
alter table public.transport_record
  drop constraint if exists transport_execution_source_exclusive;
alter table public.transport_record
  add constraint transport_execution_source_exclusive
  check (vehicle_id is null or provider_id is null);

-- ===========================================================================
-- 3. THE AVAILABILITY INTERLOCK — symmetric to TMS-5's vehicle interlock.
-- ===========================================================================
create or replace function public.enforce_transport_provider()
returns trigger language plpgsql as $$
declare
  v_tenant uuid;
  v_status text;
  v_active boolean;
begin
  if new.provider_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.provider_id is not distinct from old.provider_id then
    return new;                      -- unchanged binding: never re-litigated
  end if;
  select tenant_id, status, is_active into v_tenant, v_status, v_active
    from public.transport_provider where id = new.provider_id;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'transport provider tenant mismatch';
  end if;
  if v_active is not true then
    raise exception 'ce sous-traitant est retiré du répertoire';
  end if;
  if v_status <> 'APPROVED' then
    raise exception 'ce sous-traitant n''est pas agréé (%)', v_status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_transport_provider on public.transport_record;
create trigger trg_transport_provider before insert or update on public.transport_record
  for each row execute function public.enforce_transport_provider();

-- ===========================================================================
-- 4. RLS — reads on the EXISTING transport:read (the ocean_port / vehicle
--    idiom). Writes have NO policy: permission-gated server actions only.
-- ===========================================================================
alter table public.transport_provider enable row level security;

drop policy if exists transport_provider_select on public.transport_provider;
create policy transport_provider_select on public.transport_provider for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('transport:read'));

grant select on public.transport_provider to authenticated;

-- ===========================================================================
-- 5. SELF-ASSERTIONS — refuse to report success on a wrong state.
-- ===========================================================================

-- 5a. No new permission was invented: TMS-6 rides transport:manage/assign/read.
do $$
begin
  if exists (select 1 from public.permission
              where code in ('subcontractor:manage', 'subcontractor:read',
                             'provider:manage', 'provider:read', 'carrier:manage')) then
    raise exception 'TMS-6 assertion 5a failed: an invented subcontractor permission exists — the ratified transport authorities govern external transport';
  end if;
  if (select count(*) from public.permission where code in ('transport:manage', 'transport:assign', 'transport:read')) <> 3 then
    raise exception 'TMS-6 assertion 5a failed: the governing transport permissions are not all present';
  end if;
end $$;

-- 5b. The execution source is EXCLUSIVE, and no row already violates it.
do $$
declare v_bad int;
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'transport_execution_source_exclusive'
       and conrelid = 'public.transport_record'::regclass) then
    raise exception 'TMS-6 assertion 5b failed: the execution-source exclusion CHECK is missing';
  end if;
  select count(*) into v_bad from public.transport_record
   where vehicle_id is not null and provider_id is not null;
  if v_bad > 0 then
    raise exception 'TMS-6 assertion 5b failed: % transport(s) claim both fleet and external execution', v_bad;
  end if;
end $$;

-- 5c. Internal vs external stays DERIVED — no execution_mode column was added.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name in ('execution_mode', 'is_external', 'execution_type')) then
    raise exception 'TMS-6 assertion 5c failed: a stored execution-mode column duplicates what the two FKs already say';
  end if;
end $$;

-- 5d. transport_company SURVIVES (historical snapshot + ad-hoc lane), the FK
--     is nullable, and the interlock trigger is armed.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name = 'transport_company') then
    raise exception 'TMS-6 assertion 5d failed: transport_company was removed — historical carrier identity and the ad-hoc lane would be lost';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name = 'provider_id' and is_nullable = 'YES') then
    raise exception 'TMS-6 assertion 5d failed: provider_id must exist and stay nullable';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_transport_provider'
       and tgrelid = 'public.transport_record'::regclass) then
    raise exception 'TMS-6 assertion 5d failed: the provider availability interlock is missing';
  end if;
end $$;

-- 5e. The maritime plane was not touched: ocean_carrier keeps its own shape
--     and no road column points at it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'transport_record'
       and column_name in ('ocean_carrier_id', 'carrier_id')) then
    raise exception 'TMS-6 assertion 5e failed: the maritime carrier plane was reused for road subcontracting';
  end if;
end $$;
