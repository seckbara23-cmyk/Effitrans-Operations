-- 20260723000001_workflow_structures.sql
-- Effitrans Operations Platform — PHASE 9.0B: dossier workflow structural extensions.
--
-- ADDITIVE ONLY, and DARK. Extends the Phase 5.0B process engine with the structural
-- contracts the confirmed Effitrans workflow needs (docs/workflow/
-- phase-9-dossier-workflow-architecture.md, audit in phase-9.0a-organization-audit.md):
--
--   1. CANONICAL INSTANCE OWNER   — Operations owns every dossier; ownership is
--      distinct from task assignment. New nullable columns on process_instance.
--   2. process_decision           — a recorded workflow decision. First use case:
--      « continuer avant confirmation du paiement » (business decision 8/11 — a
--      RECORDED decision, never an implicit default). Immutable once finalized;
--      superseding creates a NEW row (supersedes_decision_id), never a rewrite.
--   3. process_blocker            — a formal blocker (document manquant, observation
--      douanière, paiement, incident terrain…). Blockers do NOT replace step state;
--      internal description NEVER reaches a customer (no portal RLS policy at all —
--      a future customer surface goes through a customer-safe reader).
--   4. organization_team_member   — AIBD / Maritime membership. TEAMS under Transit,
--      never departments (Phase 9.0A registry); membership is organizational
--      metadata, NEVER authorization.
--   5. Step team + skip metadata  — assigned_team_code on step executions (a step may
--      target a Transit team) and explicit skip provenance (who, when, why, and
--      whether the skip was DEFINITION-driven or MANUAL). SKIPPED already exists as
--      a state and already counts as done for closure — what was missing is anything
--      that ever assigns it, and the audit trail of why.
--
-- NOTHING ACTIVATES. All writes go through lib/process/engine/structures-actions.ts,
-- which is double-gated: EFFITRANS_PROCESS_ENGINE_ENABLED (master) AND
-- EFFITRANS_PROCESS_STRUCTURES_ENABLED (this phase's sub-flag), both default false,
-- plus the per-tenant rollout — identical to every other engine capability.
--
-- The engine STILL never writes operational_file. Legacy ownership columns
-- (account_manager_id / coordinator_id / assigned_to_user_id) are untouched; the
-- effective-owner precedence is a READ-side resolver (lib/process/ownership.ts).
--
-- CLEAN-REPLAY safe: permission inserts are global with on-conflict; every role
-- grant is select-driven (zero rows on an empty DB; seed.sql owns that data).

-- ===========================================================================
-- 1. Canonical instance owner (additive columns).
-- ===========================================================================
alter table public.process_instance
  add column if not exists owner_user_id           uuid references public.app_user (id),
  add column if not exists owner_assigned_at       timestamptz,
  add column if not exists owner_assigned_by       uuid references public.app_user (id),
  add column if not exists owner_assignment_reason text;

create index if not exists idx_process_instance_owner
  on public.process_instance (owner_user_id) where owner_user_id is not null;

-- Integrity: the owner (and assigner) must belong to the instance's tenant — the
-- same defense-in-depth the step-execution actor trigger applies.
create or replace function public.enforce_process_owner_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
begin
  if new.owner_user_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.owner_user_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'process owner belongs to another tenant';
    end if;
  end if;
  if new.owner_assigned_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.owner_assigned_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'owner assigner belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_process_owner_tenant before insert or update on public.process_instance
  for each row execute function public.enforce_process_owner_tenant();

-- ===========================================================================
-- 2. Step-execution extensions: Transit team target + explicit skip provenance.
-- ===========================================================================
alter table public.process_step_execution
  add column if not exists assigned_team_code text
    check (assigned_team_code is null or assigned_team_code in ('AIBD', 'MARITIME')),
  add column if not exists skipped_by  uuid references public.app_user (id),
  add column if not exists skipped_at  timestamptz,
  add column if not exists skip_reason text,
  -- DEFINITION = deterministic, from the applicability registry (e.g. customs steps
  -- on a TRP/HND dossier). MANUAL = an authorized human call (process:step:skip).
  add column if not exists skip_source text
    check (skip_source is null or skip_source in ('DEFINITION', 'MANUAL'));

-- ===========================================================================
-- 3. process_decision — recorded workflow decisions.
-- ===========================================================================
create table public.process_decision (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id),
  process_instance_id       uuid not null references public.process_instance (id) on delete cascade,
  process_step_execution_id uuid references public.process_step_execution (id),
  decision_type             text not null check (decision_type in ('CONTINUE_BEFORE_PAYMENT')),
  -- Set at FINALIZATION, by the decider — never proposed into existence.
  outcome                   text check (outcome is null or outcome in
                              ('BLOCK_UNTIL_PAYMENT', 'CONTINUE_PROVISIONALLY', 'CONTINUE_WITH_APPROVAL')),
  requested_by              uuid not null references public.app_user (id),
  requested_at              timestamptz not null default now(),
  decided_by                uuid references public.app_user (id),
  decided_at                timestamptz,
  -- The requester's justification. MANDATORY (application-enforced non-empty).
  reason                    text not null,
  -- The decider's conditions (échéance, limites) — the « conditions et échéance »
  -- the business requires on a continue-before-payment record.
  conditions                text,
  expires_at                timestamptz,
  status                    text not null default 'PENDING'
                              check (status in ('PENDING', 'FINALIZED')),
  -- Superseding NEVER rewrites: a new decision row points at the one it replaces.
  supersedes_decision_id    uuid references public.process_decision (id),
  metadata                  jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_process_decision_instance on public.process_decision (process_instance_id);
create index idx_process_decision_tenant_status on public.process_decision (tenant_id, status);

create trigger trg_process_decision_updated_at before update on public.process_decision
  for each row execute function public.set_updated_at();

-- Tenant integrity (instance + actors), mirroring the engine's existing triggers.
create or replace function public.enforce_process_decision_tenant()
returns trigger language plpgsql as $$
declare
  i_tenant uuid;
  u_tenant uuid;
begin
  select tenant_id into i_tenant from public.process_instance where id = new.process_instance_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'decision tenant mismatch (instance_tenant=%, given=%)', i_tenant, new.tenant_id;
  end if;
  select tenant_id into u_tenant from public.app_user where id = new.requested_by;
  if u_tenant is distinct from new.tenant_id then
    raise exception 'decision requester belongs to another tenant';
  end if;
  if new.decided_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.decided_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'decision decider belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_process_decision_tenant before insert or update on public.process_decision
  for each row execute function public.enforce_process_decision_tenant();

-- IMMUTABLE AFTER FINALIZATION — structural, not conventional. A finalized decision
-- row can never be updated again (supersede = new row); deletion is blocked always.
create or replace function public.enforce_process_decision_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'process decisions are append-only and cannot be deleted';
  end if;
  if old.status = 'FINALIZED' then
    raise exception 'a finalized process decision is immutable (supersede with a new decision instead)';
  end if;
  return new;
end;
$$;
create trigger trg_process_decision_immutable before update or delete on public.process_decision
  for each row execute function public.enforce_process_decision_immutable();

-- ===========================================================================
-- 4. process_blocker — formal blockers.
-- ===========================================================================
create table public.process_blocker (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.organization (id),
  process_instance_id       uuid not null references public.process_instance (id) on delete cascade,
  process_step_execution_id uuid references public.process_step_execution (id),
  category                  text not null check (category in
                              ('MISSING_DOCUMENT', 'CUSTOMER_RESPONSE_REQUIRED', 'CUSTOMS_OBSERVATION',
                               'PAYMENT_PENDING', 'PAYMENT_REJECTED', 'SUPPLIER_DELAY',
                               'TRANSPORT_UNAVAILABLE', 'FIELD_INCIDENT', 'SYSTEM_DEPENDENCY', 'OTHER')),
  title                     text not null,
  -- INTERNAL text. Never selected by any customer-safe reader; the portal has NO
  -- RLS policy on this table at all.
  description               text,
  severity                  text not null default 'MEDIUM'
                              check (severity in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  -- Canonical ORG department (Phase 9.0A), for dashboard rollup — organizational
  -- metadata, never authorization.
  source_department_code    text check (source_department_code is null or source_department_code in
                              ('OPERATIONS', 'TRANSIT', 'FINANCE', 'HUMAN_RESOURCES')),
  owner_user_id             uuid references public.app_user (id),
  status                    text not null default 'OPEN'
                              check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED')),
  opened_by                 uuid not null references public.app_user (id),
  opened_at                 timestamptz not null default now(),
  resolved_by               uuid references public.app_user (id),
  resolved_at               timestamptz,
  resolution_note           text,
  -- A customer NEVER sees `description`. When (and only when) customer_visible is
  -- true, a future customer-safe reader may expose customer_message — an APPROVED,
  -- separately-written text.
  customer_visible          boolean not null default false,
  customer_message          text,
  due_at                    timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_process_blocker_instance on public.process_blocker (process_instance_id);
create index idx_process_blocker_tenant_status on public.process_blocker (tenant_id, status);

create trigger trg_process_blocker_updated_at before update on public.process_blocker
  for each row execute function public.set_updated_at();

create or replace function public.enforce_process_blocker_tenant()
returns trigger language plpgsql as $$
declare
  i_tenant uuid;
  u_tenant uuid;
begin
  select tenant_id into i_tenant from public.process_instance where id = new.process_instance_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'blocker tenant mismatch (instance_tenant=%, given=%)', i_tenant, new.tenant_id;
  end if;
  select tenant_id into u_tenant from public.app_user where id = new.opened_by;
  if u_tenant is distinct from new.tenant_id then
    raise exception 'blocker opener belongs to another tenant';
  end if;
  if new.owner_user_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.owner_user_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'blocker owner belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_process_blocker_tenant before insert or update on public.process_blocker
  for each row execute function public.enforce_process_blocker_tenant();

-- ===========================================================================
-- 5. organization_team_member — AIBD / Maritime membership (Transit teams).
--    The team REGISTRY itself is code-side (lib/organization/departments.ts
--    TRANSIT_TEAMS, Phase 9.0A) — only per-tenant MEMBERSHIP is data.
-- ===========================================================================
create table public.organization_team_member (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organization (id),
  team_code    text not null check (team_code in ('AIBD', 'MARITIME')),
  app_user_id  uuid not null references public.app_user (id),
  active       boolean not null default true,
  assigned_at  timestamptz not null default now(),
  assigned_by  uuid references public.app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One membership row per (tenant, team, user). Deactivation flips `active`;
-- re-adding reactivates the same row (no duplicate history rows to reconcile).
create unique index uq_org_team_member on public.organization_team_member (tenant_id, team_code, app_user_id);
create index idx_org_team_member_user on public.organization_team_member (app_user_id) where active;

create trigger trg_org_team_member_updated_at before update on public.organization_team_member
  for each row execute function public.set_updated_at();

create or replace function public.enforce_team_member_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
begin
  select tenant_id into u_tenant from public.app_user where id = new.app_user_id;
  if u_tenant is distinct from new.tenant_id then
    raise exception 'team member belongs to another tenant';
  end if;
  if new.assigned_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.assigned_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'team assigner belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_team_member_tenant before insert or update on public.organization_team_member
  for each row execute function public.enforce_team_member_tenant();

-- ===========================================================================
-- 6. RLS — SELECT-only for `authenticated`, exactly like the engine tables.
--    Decisions and blockers inherit dossier visibility + process:read. Portal
--    users have NO policy on any of these tables — they see nothing, including
--    customer_visible blockers (a customer surface arrives later via a
--    customer-safe reader that exposes ONLY the approved customer_message).
--    All writes go through the service-role structures actions.
-- ===========================================================================
alter table public.process_decision        enable row level security;
alter table public.process_blocker         enable row level security;
alter table public.organization_team_member enable row level security;

create policy process_decision_select on public.process_decision
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('process:read')
    and exists (
      select 1 from public.process_instance pi
      where pi.id = process_decision.process_instance_id
        and pi.tenant_id = public.auth_tenant_id()
        and public.can_read_file(pi.file_id)
    )
  );

create policy process_blocker_select on public.process_blocker
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('process:read')
    and exists (
      select 1 from public.process_instance pi
      where pi.id = process_blocker.process_instance_id
        and pi.tenant_id = public.auth_tenant_id()
        and public.can_read_file(pi.file_id)
    )
  );

-- Team rosters are organizational metadata any tenant staff member may see
-- (like the staff directory) — tenant-confined, nothing more.
create policy org_team_member_select on public.organization_team_member
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

grant select on public.process_decision         to authenticated;
grant select on public.process_blocker          to authenticated;
grant select on public.organization_team_member to authenticated;

-- ===========================================================================
-- 7. Permissions (global catalog) + role grants (seed tenant; select-driven).
--    Mirrored in supabase/seed.sql + lib/platform/role-templates.ts — parity
--    machine-enforced by tests/role-templates.test.ts. Grants are deliberately
--    NARROW; the decision-approval grant in particular stays minimal because
--    manager-approval policy is an unresolved business decision.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  ('process:owner:assign',    'process', 'owner_assign',    'assigned', 'Assign or change the canonical operational owner of a dossier process'),
  ('process:decision:create', 'process', 'decision_create', 'assigned', 'Request a recorded workflow decision (e.g. continue before payment)'),
  ('process:decision:approve','process', 'decision_approve','assigned', 'Finalize a recorded workflow decision'),
  ('process:blocker:manage',  'process', 'blocker_manage',  'assigned', 'Open, acknowledge, resolve or cancel a formal dossier blocker'),
  ('process:team:manage',     'process', 'team_manage',     'all',      'Manage Transit team membership (AIBD / Maritime) and step team targeting'),
  ('process:step:skip',       'process', 'step_skip',       'assigned', 'Explicitly skip a non-applicable process step, or reopen a skipped one')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:owner:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:decision:create'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

-- PROVISIONAL narrow grant: manager-approval policy is unresolved (business
-- decision 16), so only supervision finalizes decisions until the business decides.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:decision:approve'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:blocker:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:team:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:step:skip'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR')
on conflict do nothing;
