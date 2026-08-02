-- 20260802000002_hr_onboarding_equipment.sql
-- Effitrans HR Platform — HR-4: Onboarding & Equipment.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, dark-first. No new permission, no grant (B1 pause
-- intact): onboarding and asset operations ride hr:manage, reads ride hr:read,
-- C3 evidence rides hr:sensitive:read through hr_document's own policy.
--
-- ADR-HR2-01 ASSESSED AND HARDENED HERE. HR-4's writes are multi-row and
-- event-mandatory, which is exactly the case the ADR reserved for RPC
-- hardening. The four state-changing operations are therefore TRANSACTIONAL
-- FUNCTIONS: the domain write and its ledger event commit together or not at
-- all. No new compensation logic is introduced by HR-4.
--
-- REPOSITORY AUDIT (recorded): no equipment, asset, inventory or vehicle
-- catalog exists anywhere in migrations 1-75 (the only `asset` match is
-- brand_asset — logos/fonts). `vehicle_plate` is free text on transport_record
-- and the transport migration declares its own scope guard "no vehicle
-- catalog". deposit_custody is a DIFFERENT domain (cash/documents to the bank);
-- its append-only chain is reused as a PATTERN, never as a table. No competing
-- model is created here. If a Fleet module is ever built, vehicle custody must
-- be reconciled with it — recorded as an open design note, not resolved now.

-- ===========================================================================
-- 1. CHECKLIST TEMPLATES — configuration-driven; no universal checklist is
--    hard-coded in application logic (ratified addendum §3/§4 discipline).
-- ===========================================================================
create table if not exists public.hr_checklist_template (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  code       text not null,
  label_fr   text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
drop trigger if exists trg_hr_checklist_template_updated_at on public.hr_checklist_template;
create trigger trg_hr_checklist_template_updated_at before update on public.hr_checklist_template
  for each row execute function public.set_updated_at();

create table if not exists public.hr_checklist_item_template (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  template_id           uuid not null references public.hr_checklist_template (id) on delete cascade,
  position              int not null,
  label_fr              text not null,
  responsible_function  text,
  is_required           boolean not null default true,
  is_blocking           boolean not null default true,
  evidence_required     boolean not null default false,
  due_offset_days       int not null default 0,
  unique (template_id, position)
);

-- ===========================================================================
-- 2. ONBOARDING CASE — controlled lifecycle, no free-form states.
--    DRAFT → READY → IN_PROGRESS → COMPLETED, with governed CANCELLED.
-- ===========================================================================
create table if not exists public.hr_onboarding_case (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  employee_id          uuid not null references public.employee (id),
  template_id          uuid references public.hr_checklist_template (id),
  status               text not null default 'DRAFT'
                         check (status in ('DRAFT','READY','IN_PROGRESS','COMPLETED','CANCELLED')),
  planned_start_date   date,
  actual_start_date    date,
  hr_officer_id        uuid references public.app_user (id),
  manager_employee_id  uuid references public.employee (id),
  work_location_id     uuid references public.hr_work_location (id),
  position_id          uuid references public.hr_position (id),
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  cancellation_reason  text,
  summary              text,
  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint onboarding_completed_has_date check (status <> 'COMPLETED' or completed_at is not null),
  constraint onboarding_cancelled_has_reason
    check (status <> 'CANCELLED' or (cancellation_reason is not null and btrim(cancellation_reason) <> ''))
);
-- One live case per employee: a second onboarding is a rehire, i.e. a new
-- employee record (ratified: rehire = new record).
create unique index if not exists uq_onboarding_live_case
  on public.hr_onboarding_case (employee_id)
  where status in ('DRAFT','READY','IN_PROGRESS');
drop trigger if exists trg_hr_onboarding_case_updated_at on public.hr_onboarding_case;
create trigger trg_hr_onboarding_case_updated_at before update on public.hr_onboarding_case
  for each row execute function public.set_updated_at();

-- Instantiated items. Labels are SNAPSHOT at instantiation: editing a template
-- later must never rewrite what a person was actually asked to do.
create table if not exists public.hr_onboarding_item (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  case_id              uuid not null references public.hr_onboarding_case (id) on delete cascade,
  item_template_id     uuid references public.hr_checklist_item_template (id),
  position             int not null,
  label_fr             text not null,
  responsible_function text,
  is_required          boolean not null default true,
  is_blocking          boolean not null default true,
  evidence_required    boolean not null default false,
  due_date             date,
  status               text not null default 'PENDING'
                         check (status in ('PENDING','DONE','NOT_APPLICABLE')),
  evidence_document_id uuid references public.hr_document (id),
  comment              text,
  completed_by         uuid references public.app_user (id),
  completed_at         timestamptz,
  constraint onboarding_item_done_has_actor
    check (status <> 'DONE' or (completed_by is not null and completed_at is not null))
);
create index if not exists idx_onboarding_item_case on public.hr_onboarding_item (tenant_id, case_id);

-- ===========================================================================
-- 3. PROVISIONING TRACKING — orchestration only. Identity stays owned by the
--    platform administration subsystem; this table REFERENCES an app_user, it
--    never creates one and grants nothing.
-- ===========================================================================
create table if not exists public.hr_provisioning_request (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  case_id       uuid not null references public.hr_onboarding_case (id) on delete cascade,
  kind          text not null
                  check (kind in ('EMAIL','PLATFORM_ACCOUNT','ROLE_ASSIGNMENT','BADGE',
                                  'SHARED_DRIVE','PHONE_SIM','OTHER')),
  status        text not null default 'REQUESTED'
                  check (status in ('REQUESTED','COMPLETED','REJECTED')),
  linked_app_user_id uuid references public.app_user (id),
  note          text,
  requested_by  uuid references public.app_user (id),
  requested_at  timestamptz not null default now(),
  completed_by  uuid references public.app_user (id),
  completed_at  timestamptz
);
create index if not exists idx_provisioning_case on public.hr_provisioning_request (tenant_id, case_id);

-- ===========================================================================
-- 4. EQUIPMENT REGISTRY — HR-managed assets only. No procurement, no
--    depreciation, no maintenance (Finance / Procurement / Fleet own those).
-- ===========================================================================
create table if not exists public.hr_equipment_type (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organization (id),
  code       text not null,
  label_fr   text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);

-- Ratified starter vocabulary (configuration rows, guarded backfill).
insert into public.hr_equipment_type (tenant_id, code, label_fr)
select o.id, v.code, v.label_fr
from public.organization o
cross join (values
  ('LAPTOP','Ordinateur portable'), ('DESKTOP','Ordinateur fixe'),
  ('MOBILE_PHONE','Téléphone mobile'), ('SIM_CARD','Carte SIM'),
  ('BADGE','Badge'), ('ACCESS_CARD','Carte d''accès'),
  ('UNIFORM_PPE','Tenue / EPI'), ('KEYS','Clés'),
  ('OFFICE_EQUIPMENT','Équipement de bureau'), ('VEHICLE','Véhicule'),
  ('OTHER','Autre')
) as v(code, label_fr)
on conflict (tenant_id, code) do nothing;

create table if not exists public.hr_equipment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organization (id),
  equipment_type_id uuid not null references public.hr_equipment_type (id),
  asset_tag         text not null,
  serial_number     text,
  description       text,
  condition         text not null default 'GOOD'
                      check (condition in ('NEW','GOOD','FAIR','POOR','DAMAGED')),
  lifecycle_status  text not null default 'IN_STOCK'
                      check (lifecycle_status in ('IN_STOCK','ASSIGNED','IN_REPAIR','RETIRED','LOST')),
  ownership_source  text not null default 'COMPANY_OWNED'
                      check (ownership_source in ('COMPANY_OWNED','LEASED','PERSONAL')),
  acquisition_date  date,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, asset_tag)
);
drop trigger if exists trg_hr_equipment_updated_at on public.hr_equipment;
create trigger trg_hr_equipment_updated_at before update on public.hr_equipment
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 5. CUSTODY — append-only history. One asset cannot have two simultaneous
--    custodians: a PARTIAL UNIQUE INDEX makes that a database invariant, the
--    same idiom as employee_assignment's one-open-PRIMARY rule.
-- ===========================================================================
create table if not exists public.hr_equipment_assignment (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.organization (id),
  equipment_id            uuid not null references public.hr_equipment (id),
  employee_id             uuid not null references public.employee (id),
  assigned_by             uuid references public.app_user (id),
  assigned_on             date not null default current_date,
  expected_return_date    date,
  returned_on             date,
  condition_at_issue      text,
  condition_at_return     text,
  return_outcome          text
                            check (return_outcome is null or return_outcome in
                                   ('RETURNED','DAMAGED','LOST','NOT_RETURNED')),
  acknowledgement_document_id uuid references public.hr_document (id),
  note                    text,
  returned_by             uuid references public.app_user (id),
  created_at              timestamptz not null default now(),
  constraint custody_return_is_complete
    check ((returned_on is null and return_outcome is null)
        or (returned_on is not null and return_outcome is not null)),
  constraint custody_dates_ordered
    check (returned_on is null or returned_on >= assigned_on)
);
create unique index if not exists uq_equipment_single_custodian
  on public.hr_equipment_assignment (equipment_id)
  where returned_on is null;
create index if not exists idx_custody_employee
  on public.hr_equipment_assignment (tenant_id, employee_id);

-- ===========================================================================
-- 6. TRANSACTIONAL RPCs — ADR-HR2-01 hardening. Domain write + ledger event in
--    ONE transaction. Called by the service role from lib/hr; the application
--    layer still gates on hr:manage before calling.
-- ===========================================================================
create or replace function public.hr_assign_equipment(
  p_tenant uuid, p_equipment uuid, p_employee uuid, p_actor uuid,
  p_expected_return date default null, p_condition text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid; v_type text;
begin
  perform 1 from public.hr_equipment
   where id = p_equipment and tenant_id = p_tenant and is_active for update;
  if not found then raise exception 'équipement introuvable' using errcode = 'HR401'; end if;
  perform 1 from public.employee where id = p_employee and tenant_id = p_tenant;
  if not found then raise exception 'employé introuvable' using errcode = 'HR402'; end if;
  if exists (select 1 from public.hr_equipment_assignment
              where equipment_id = p_equipment and returned_on is null) then
    raise exception 'cet équipement est déjà attribué' using errcode = 'HR403';
  end if;

  insert into public.hr_equipment_assignment
    (tenant_id, equipment_id, employee_id, assigned_by, expected_return_date, condition_at_issue, note)
  values (p_tenant, p_equipment, p_employee, p_actor, p_expected_return, p_condition, p_note)
  returning id into v_id;

  update public.hr_equipment set lifecycle_status = 'ASSIGNED'
   where id = p_equipment and tenant_id = p_tenant;

  select t.code into v_type from public.hr_equipment e
    join public.hr_equipment_type t on t.id = e.equipment_type_id where e.id = p_equipment;

  -- Same transaction: the event cannot be lost, and cannot outlive a rollback.
  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, p_employee, 'asset_assigned', p_actor,
          jsonb_build_object('equipment_id', p_equipment, 'equipment_type', v_type,
                             'expected_return_date', p_expected_return));
  return v_id;
end $$;

create or replace function public.hr_return_equipment(
  p_tenant uuid, p_assignment uuid, p_actor uuid,
  p_outcome text, p_condition text default null, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_equipment uuid; v_employee uuid;
begin
  if p_outcome not in ('RETURNED','DAMAGED','LOST','NOT_RETURNED') then
    raise exception 'issue de restitution invalide' using errcode = 'HR404';
  end if;
  select equipment_id, employee_id into v_equipment, v_employee
    from public.hr_equipment_assignment
   where id = p_assignment and tenant_id = p_tenant and returned_on is null for update;
  if not found then raise exception 'attribution active introuvable' using errcode = 'HR405'; end if;

  update public.hr_equipment_assignment
     set returned_on = current_date, return_outcome = p_outcome,
         condition_at_return = p_condition, returned_by = p_actor,
         note = coalesce(note, '') || case when p_note is null then '' else ' | ' || p_note end
   where id = p_assignment;

  update public.hr_equipment
     set lifecycle_status = case when p_outcome = 'LOST' then 'LOST'
                                 when p_outcome = 'DAMAGED' then 'IN_REPAIR'
                                 else 'IN_STOCK' end,
         condition = coalesce(p_condition, condition)
   where id = v_equipment and tenant_id = p_tenant;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'asset_returned', p_actor,
          jsonb_build_object('equipment_id', v_equipment, 'outcome', p_outcome));
  return p_assignment;
end $$;

create or replace function public.hr_complete_onboarding_item(
  p_tenant uuid, p_item uuid, p_actor uuid,
  p_status text, p_evidence uuid default null, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_case uuid; v_employee uuid; v_label text; v_evidence_required boolean;
begin
  if p_status not in ('DONE','NOT_APPLICABLE','PENDING') then
    raise exception 'statut d''élément invalide' using errcode = 'HR406';
  end if;
  select i.case_id, c.employee_id, i.label_fr, i.evidence_required
    into v_case, v_employee, v_label, v_evidence_required
    from public.hr_onboarding_item i
    join public.hr_onboarding_case c on c.id = i.case_id
   where i.id = p_item and i.tenant_id = p_tenant for update;
  if not found then raise exception 'élément introuvable' using errcode = 'HR407'; end if;
  if p_status = 'DONE' and v_evidence_required and p_evidence is null then
    raise exception 'preuve requise pour cet élément' using errcode = 'HR408';
  end if;

  update public.hr_onboarding_item
     set status = p_status,
         evidence_document_id = coalesce(p_evidence, evidence_document_id),
         comment = coalesce(p_comment, comment),
         completed_by = case when p_status = 'PENDING' then null else p_actor end,
         completed_at = case when p_status = 'PENDING' then null else now() end
   where id = p_item;

  if p_status <> 'PENDING' then
    insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
    values (p_tenant, v_employee, 'onboarding_item_completed', p_actor,
            jsonb_build_object('case_id', v_case, 'item', v_label, 'status', p_status));
  end if;
  return p_item;
end $$;

-- The COMPLETION GATE, enforced at the database boundary (not only the UI):
-- every REQUIRED + BLOCKING item must be resolved, or the call raises with the
-- French list of what is missing.
create or replace function public.hr_complete_onboarding(
  p_tenant uuid, p_case uuid, p_actor uuid)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_employee uuid; v_status text; v_missing text;
begin
  select employee_id, status into v_employee, v_status
    from public.hr_onboarding_case where id = p_case and tenant_id = p_tenant for update;
  if not found then raise exception 'dossier d''intégration introuvable' using errcode = 'HR409'; end if;
  if v_status not in ('READY','IN_PROGRESS') then
    raise exception 'ce dossier ne peut pas être clôturé dans son état actuel' using errcode = 'HR410';
  end if;

  select string_agg(label_fr, ', ' order by position) into v_missing
    from public.hr_onboarding_item
   where case_id = p_case and is_required and is_blocking and status = 'PENDING';
  if v_missing is not null then
    raise exception 'éléments bloquants non complétés : %', v_missing using errcode = 'HR411';
  end if;

  update public.hr_onboarding_case
     set status = 'COMPLETED', completed_at = now() where id = p_case;

  insert into public.hr_employee_event (tenant_id, employee_id, event_kind, actor_id, payload)
  values (p_tenant, v_employee, 'onboarding_completed', p_actor, jsonb_build_object('case_id', p_case));
  return p_case;
end $$;

revoke execute on function public.hr_assign_equipment(uuid,uuid,uuid,uuid,date,text,text) from public;
revoke execute on function public.hr_return_equipment(uuid,uuid,uuid,text,text,text) from public;
revoke execute on function public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text) from public;
revoke execute on function public.hr_complete_onboarding(uuid,uuid,uuid) from public;
grant execute on function public.hr_assign_equipment(uuid,uuid,uuid,uuid,date,text,text) to service_role;
grant execute on function public.hr_return_equipment(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.hr_complete_onboarding_item(uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.hr_complete_onboarding(uuid,uuid,uuid) to service_role;

-- ===========================================================================
-- 7. RLS — same uniform idiom. Reads: hr:read. Writes: service role only.
--    No portal policy anywhere; SYSTEM_ADMIN holds no hr:* (DEC-B25).
-- ===========================================================================
alter table public.hr_checklist_template      enable row level security;
alter table public.hr_checklist_item_template enable row level security;
alter table public.hr_onboarding_case         enable row level security;
alter table public.hr_onboarding_item         enable row level security;
alter table public.hr_provisioning_request    enable row level security;
alter table public.hr_equipment_type          enable row level security;
alter table public.hr_equipment               enable row level security;
alter table public.hr_equipment_assignment    enable row level security;

drop policy if exists hr_checklist_template_select on public.hr_checklist_template;
create policy hr_checklist_template_select on public.hr_checklist_template
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_checklist_item_template_select on public.hr_checklist_item_template;
create policy hr_checklist_item_template_select on public.hr_checklist_item_template
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_onboarding_case_select on public.hr_onboarding_case;
create policy hr_onboarding_case_select on public.hr_onboarding_case
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_onboarding_item_select on public.hr_onboarding_item;
create policy hr_onboarding_item_select on public.hr_onboarding_item
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_provisioning_request_select on public.hr_provisioning_request;
create policy hr_provisioning_request_select on public.hr_provisioning_request
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_equipment_type_select on public.hr_equipment_type;
create policy hr_equipment_type_select on public.hr_equipment_type
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_equipment_select on public.hr_equipment;
create policy hr_equipment_select on public.hr_equipment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

drop policy if exists hr_equipment_assignment_select on public.hr_equipment_assignment;
create policy hr_equipment_assignment_select on public.hr_equipment_assignment
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('hr:read'));

grant select on public.hr_checklist_template, public.hr_checklist_item_template,
                public.hr_onboarding_case, public.hr_onboarding_item,
                public.hr_provisioning_request, public.hr_equipment_type,
                public.hr_equipment, public.hr_equipment_assignment
  to authenticated;
