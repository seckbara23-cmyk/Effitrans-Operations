-- 20260713000001_process_engine.sql
-- Effitrans Operations Platform — PHASE 5.0B: official process engine (schema).
-- ---------------------------------------------------------------------------
-- Persists the OPERATIONAL TRUTH of the official 26-step Effitrans process
-- ("PROCESSUS OPÉRATIONNEL – EFFITRANS"). The canonical business DEFINITION —
-- step labels, prerequisites, required documents, permissions, parallel groups,
-- join gates — lives ONLY in the Phase 5.0A registry (lib/process/
-- effitrans-process.ts). It is deliberately NOT duplicated into rows: a row here
-- carries a `step_key` and nothing else about what that step means.
--
-- What must be persisted is what cannot be derived from existing records:
--   * who received a handoff, and when (there is no "reception" concept today)
--   * who prepared vs who validated (maker-checker; NOTHING in the platform
--     records this today)
--   * what was rejected, why, and which attempt corrects which (lineage)
--   * whether a legacy dossier's step is real or UNVERIFIED_HISTORICAL
-- Evidence itself is NOT copied: documents, customs refs, transport assignment,
-- POD, invoices and payments stay in their existing tables and are REFERENCED.
--
-- RELATIONSHIP TO operational_file.status (DEC — no duplicate status truth):
-- the engine NEVER writes operational_file. That column stays authoritative for
-- the legacy lifecycle and every existing feature, which is what makes the
-- EFFITRANS_PROCESS_ENGINE_ENABLED flag a true no-op when off. Closure readiness
-- is COMPUTED here, never applied to the dossier, in 5.0B.
--
-- CLEAN-REPLAY (822c0d7): migrations run against an EMPTY database and seed.sql
-- runs AFTER them. Every literal tenant-scoped insert below is therefore a
-- GUARDED BACKFILL (`where exists (select 1 from public.organization ...)`) so it
-- no-ops on a clean DB (seed.sql owns that data) and backfills the live tenant.
-- Enforced by tests/migration-clean-replay.test.ts.
--
-- Decisions: DEC-A02 (dossier authoritative), DEC-A12 (additive/forward-only),
-- DEC-B13 (union perms), DEC-C01 (tenant_id + RLS everywhere).

-- ===========================================================================
-- 1. process_instance — one per dossier.
-- ===========================================================================
create table public.process_instance (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organization (id),
  file_id              uuid not null references public.operational_file (id) on delete cascade,
  -- Registry version this instance was initialized against. Lets a future
  -- registry change be introduced without silently re-interpreting old rows.
  process_version      text not null default 'effitrans-v1',
  status               text not null default 'ACTIVE'
                         check (status in ('ACTIVE', 'COMPLETED_OPERATIONALLY', 'UNDER_BILLING',
                                           'UNDER_COLLECTION', 'CLOSED', 'CANCELLED')),
  -- How this instance came to exist: a dossier opened under the engine, or a
  -- legacy dossier mapped by the Phase 5.0A compatibility mapper.
  compatibility_source text not null default 'NATIVE'
                         check (compatibility_source in ('NATIVE', 'COMPATIBILITY_MAPPED')),
  -- Mapper version, set only for COMPATIBILITY_MAPPED instances.
  compatibility_version text,
  started_at           timestamptz not null default now(),
  completed_at         timestamptz,
  closed_at            timestamptz,
  created_by           uuid references public.app_user (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ONE ACTIVE INSTANCE PER DOSSIER. A cancelled instance may be superseded, so the
-- uniqueness is partial rather than a plain unique(file_id).
create unique index uq_process_instance_file_active
  on public.process_instance (file_id) where status <> 'CANCELLED';
create index idx_process_instance_tenant_status on public.process_instance (tenant_id, status);
create index idx_process_instance_file on public.process_instance (file_id);

create trigger trg_process_instance_updated_at before update on public.process_instance
  for each row execute function public.set_updated_at();

-- Integrity: an instance's tenant must equal its dossier's tenant. Blocks a
-- cross-tenant file_id even from the service role.
create or replace function public.enforce_process_instance_tenant()
returns trigger language plpgsql as $$
declare
  f_tenant uuid;
begin
  select tenant_id into f_tenant from public.operational_file where id = new.file_id;
  if f_tenant is null then
    raise exception 'process_instance references a missing dossier (file_id=%)', new.file_id;
  end if;
  if new.tenant_id is distinct from f_tenant then
    raise exception 'process tenant mismatch (file_tenant=%, given=%)', f_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_process_instance_tenant before insert or update on public.process_instance
  for each row execute function public.enforce_process_instance_tenant();

-- ===========================================================================
-- 2. process_step_execution — one row per ATTEMPT at an official step.
--    A rejected attempt is kept forever (history) and a new row corrects it via
--    correction_of_id. Prior reviews are never overwritten.
-- ===========================================================================
create table public.process_step_execution (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  process_instance_id   uuid not null references public.process_instance (id) on delete cascade,
  -- Registry key (lib/process/effitrans-process.ts). Validated in the app layer
  -- against the registry — deliberately NOT a DB enum, so the registry stays the
  -- single definition and a step rename is not a migration.
  step_key              text not null,
  -- 1..26 for official steps; NULL for the parallel Account-Manager activities
  -- (Bon à Délivrer, Pre-Gate, document transmission) which the official document
  -- lists WITHOUT numbers.
  step_number           int check (step_number is null or (step_number between 1 and 26)),
  state                 text not null default 'PENDING'
                          check (state in ('PENDING', 'AVAILABLE', 'ACTIVE', 'BLOCKED', 'SUBMITTED',
                                           'APPROVED', 'REJECTED', 'COMPLETED', 'SKIPPED',
                                           'CANCELLED', 'UNVERIFIED_HISTORICAL')),
  assigned_user_id      uuid references public.app_user (id),
  assigned_role_code    text,
  -- Maker-checker: who prepared, who reviewed. NOTHING in the platform records
  -- this today — this pair is the whole point of the table.
  submitted_by          uuid references public.app_user (id),
  submitted_at          timestamptz,
  reviewed_by           uuid references public.app_user (id),
  reviewed_at           timestamptz,
  received_from_user_id uuid references public.app_user (id),
  received_at           timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  rejected_at           timestamptz,
  rejected_by           uuid references public.app_user (id),
  rejection_reason      text,
  -- Lineage: this attempt corrects that rejected attempt.
  correction_of_id      uuid references public.process_step_execution (id),
  -- Whether a maker-checker override was used (self-validation). Off by default;
  -- requires the process:override permission AND a justification.
  override_used         boolean not null default false,
  override_reason       text,
  -- Derived evidence snapshot for display/debug. NEVER document contents, never
  -- secrets — only satisfied/missing evidence KEYS.
  evidence_summary      jsonb,
  metadata              jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- AT MOST ONE LIVE ATTEMPT PER STEP. Rejected/cancelled attempts drop out of the
-- index so a correction row can be created without colliding with its own history.
-- This is what makes initialization and submission idempotent under concurrency.
create unique index uq_pse_live_step
  on public.process_step_execution (process_instance_id, step_key)
  where state not in ('REJECTED', 'CANCELLED');

create index idx_pse_instance on public.process_step_execution (process_instance_id);
create index idx_pse_tenant_state on public.process_step_execution (tenant_id, state);
create index idx_pse_assigned on public.process_step_execution (assigned_user_id) where assigned_user_id is not null;

create trigger trg_pse_updated_at before update on public.process_step_execution
  for each row execute function public.set_updated_at();

-- Integrity: the execution's tenant must equal its instance's tenant.
create or replace function public.enforce_pse_tenant()
returns trigger language plpgsql as $$
declare
  i_tenant uuid;
begin
  select tenant_id into i_tenant from public.process_instance where id = new.process_instance_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'step execution tenant mismatch (instance_tenant=%, given=%)', i_tenant, new.tenant_id;
  end if;
  return new;
end;
$$;
create trigger trg_pse_tenant before insert or update on public.process_step_execution
  for each row execute function public.enforce_pse_tenant();

-- Integrity: maker and checker must be the SAME TENANT as the execution. Blocks a
-- cross-tenant reviewer even if a service-role caller passed a foreign user id.
create or replace function public.enforce_pse_actor_tenant()
returns trigger language plpgsql as $$
declare
  u_tenant uuid;
begin
  if new.submitted_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.submitted_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'submitted_by belongs to another tenant';
    end if;
  end if;
  if new.reviewed_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.reviewed_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'reviewed_by belongs to another tenant';
    end if;
  end if;
  if new.assigned_user_id is not null then
    select tenant_id into u_tenant from public.app_user where id = new.assigned_user_id;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'assigned_user_id belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_pse_actor_tenant before insert or update on public.process_step_execution
  for each row execute function public.enforce_pse_actor_tenant();

-- ===========================================================================
-- 3. process_handoff — the controlled handoff the old task.handoff_type could
--    not express: explicit reception, rejection with reason, and a correction
--    target. Old handoff tasks are left untouched as historical evidence.
-- ===========================================================================
create table public.process_handoff (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),
  process_instance_id   uuid not null references public.process_instance (id) on delete cascade,
  from_step_key         text not null,
  to_step_key           text not null,
  sent_by               uuid not null references public.app_user (id),
  sent_at               timestamptz not null default now(),
  received_by           uuid references public.app_user (id),
  received_at           timestamptz,
  status                text not null default 'SENT'
                          check (status in ('SENT', 'RECEIVED', 'REJECTED', 'CANCELLED')),
  rejection_reason      text,
  -- Where a rejection sends the work back to (a registry step key).
  returned_to_step_key  text,
  -- Idempotency key. A repeated send with the same key is a no-op, not a second
  -- handoff — the unique index below is the race-proof backstop.
  dedup_key             text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Idempotent send.
create unique index uq_process_handoff_dedup on public.process_handoff (tenant_id, dedup_key);
-- At most ONE open (SENT) handoff into a given step at a time — no silent
-- double-progression.
create unique index uq_process_handoff_open
  on public.process_handoff (process_instance_id, to_step_key) where status = 'SENT';

create index idx_handoff_instance on public.process_handoff (process_instance_id);
create index idx_handoff_tenant_status on public.process_handoff (tenant_id, status);

create trigger trg_handoff_updated_at before update on public.process_handoff
  for each row execute function public.set_updated_at();

-- Integrity: handoff tenant == instance tenant, AND both participants are members
-- of that same tenant. A cross-tenant handoff is impossible at the DB level.
create or replace function public.enforce_handoff_tenant()
returns trigger language plpgsql as $$
declare
  i_tenant uuid;
  u_tenant uuid;
begin
  select tenant_id into i_tenant from public.process_instance where id = new.process_instance_id;
  if new.tenant_id is distinct from i_tenant then
    raise exception 'handoff tenant mismatch (instance_tenant=%, given=%)', i_tenant, new.tenant_id;
  end if;

  select tenant_id into u_tenant from public.app_user where id = new.sent_by;
  if u_tenant is distinct from new.tenant_id then
    raise exception 'handoff sender belongs to another tenant';
  end if;

  if new.received_by is not null then
    select tenant_id into u_tenant from public.app_user where id = new.received_by;
    if u_tenant is distinct from new.tenant_id then
      raise exception 'handoff receiver belongs to another tenant';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_handoff_tenant before insert or update on public.process_handoff
  for each row execute function public.enforce_handoff_tenant();

-- ===========================================================================
-- 4. RLS — READ-ONLY for `authenticated`, exactly like every other business
--    table here. Reads inherit dossier visibility (can_read_file) and require
--    process:read. ALL writes go through the service-role server actions in
--    lib/process/engine/, which gate on assertPermission() first.
--
--    Consequences, by design:
--      * portal users        -> no process:read, no policy  -> see nothing
--      * drivers             -> no process:read             -> see nothing
--      * platform admins     -> auth_tenant_id() is null    -> see nothing
--                               (a platform admin is a separate identity class
--                                with no tenant; they get no implicit access)
--      * a tenant SYSTEM_ADMIN is still confined by tenant_id = auth_tenant_id()
-- ===========================================================================
alter table public.process_instance      enable row level security;
alter table public.process_step_execution enable row level security;
alter table public.process_handoff       enable row level security;

create policy process_instance_select on public.process_instance
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('process:read')
    and public.can_read_file(file_id)
  );

create policy process_step_execution_select on public.process_step_execution
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('process:read')
    and exists (
      select 1 from public.process_instance pi
      where pi.id = process_step_execution.process_instance_id
        and pi.tenant_id = public.auth_tenant_id()
        and public.can_read_file(pi.file_id)
    )
  );

create policy process_handoff_select on public.process_handoff
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and public.has_permission('process:read')
    and exists (
      select 1 from public.process_instance pi
      where pi.id = process_handoff.process_instance_id
        and pi.tenant_id = public.auth_tenant_id()
        and public.can_read_file(pi.file_id)
    )
  );

grant select on public.process_instance       to authenticated;
grant select on public.process_step_execution to authenticated;
grant select on public.process_handoff        to authenticated;

-- ===========================================================================
-- 5. Permission catalog. Backs every permission the 5.0A registry declares
--    (lib/process/roles.ts MISSING_PERMISSIONS) plus the engine's own codes.
--    `permission` is a GLOBAL table (no tenant_id) — a literal insert is safe on
--    a clean DB.
-- ===========================================================================
insert into public.permission (code, module, action, data_scope, description) values
  -- engine
  ('process:read',                'process',     'read',     'assigned', 'View the official process state of a dossier'),
  ('process:manage',              'process',     'manage',   'assigned', 'Initialize / activate / complete official process steps'),
  ('process:handoff:send',        'process',     'send',     'assigned', 'Send a controlled process handoff'),
  ('process:handoff:receive',     'process',     'receive',  'assigned', 'Confirm reception of a process handoff'),
  ('process:completeness:review', 'process',     'review',   'assigned', 'Perform an official completeness checkpoint (steps 18/19)'),
  -- Maker-checker override. Granted to NO ROLE — self-validation is disabled by
  -- default and must be an explicit, audited governance decision.
  ('process:override',            'process',     'override', 'all',      'Override maker-checker separation (self-validation). Requires a justification; audited.'),
  -- customs chain (steps 5, 7, 9)
  ('customs:assign',              'customs',     'assign',   'assigned', 'Assign a Declarant / Field Agent to a customs dossier'),
  ('customs:validate',            'customs',     'validate', 'assigned', 'Validate a prepared customs dossier (Chief Transit, step 7)'),
  ('customs:register',            'customs',     'register', 'assigned', 'Register the declaration in GAINDE (Finance, step 9)'),
  -- billing / finance split (steps 20, 21)
  ('finance:validate',            'finance',     'validate', 'all',      'Validate a drafted invoice (Finance, step 21) — the checker half of the pair'),
  -- transport request (step 3)
  ('transport:request',           'transport',   'request',  'assigned', 'Raise a transport request for a dossier'),
  -- administration / courier / collections (steps 23-26)
  ('admin_service:manage',        'admin_service','manage',  'all',      'Administrative service — deposit preparation and archiving'),
  ('courier:assign',              'courier',     'assign',   'all',      'Assign an invoice deposit to a courier'),
  ('courier:deposit',             'courier',     'deposit',  'assigned', 'Confirm a physical invoice deposit and upload proof'),
  ('collections:manage',          'collections', 'manage',   'all',      'Monitor receivables and close a fully paid dossier'),
  -- quotation (step 1) — catalog only; the quotation MODULE itself is Phase 5.0D.
  ('quotation:create',            'quotation',   'create',   'all',      'Prepare a quotation'),
  ('quotation:send',              'quotation',   'send',     'all',      'Send a quotation to the client'),
  ('quotation:approve',           'quotation',   'approve',  'all',      'Record the client''s quotation approval')
on conflict (code) do nothing;

-- ===========================================================================
-- 6. The seven roles Phase 5.0A found missing. GUARDED BACKFILL (clean-replay):
--    no-ops on an empty DB (seed.sql creates them), backfills the live tenant.
--    Mirrored exactly in supabase/seed.sql and lib/platform/role-templates.ts;
--    tests/role-templates.test.ts re-parses seed.sql and enforces parity.
-- ===========================================================================
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001', r.code, r.label_fr, r.label_en, true
from (values
  ('BILLING_OFFICER',        'Agent de facturation',        'Billing Officer'),
  ('CUSTOMS_FINANCE_OFFICER','Finance douane',              'Customs Finance Officer'),
  ('CUSTOMS_FIELD_AGENT',    'Agent de terrain douane',     'Customs Field Agent'),
  ('PICKUP_AGENT',           'Agent d''enlèvement',         'Pickup Agent'),
  ('ADMINISTRATIVE_OFFICER', 'Agent administratif',         'Administrative Officer'),
  ('COURIER',                'Coursier',                    'Courier'),
  ('COLLECTIONS_OFFICER',    'Agent de recouvrement',       'Collections Officer')
) as r(code, label_fr, label_en)
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

-- ===========================================================================
-- 7. Role grants. All select-driven (zero rows on a clean DB — harmless), so the
--    clean-replay guard is satisfied without an exists() wrapper.
-- ===========================================================================

-- process:read — everyone who works a dossier, plus the seven new roles.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'CEO', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR',
                 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'FINANCE_OFFICER',
                 'COMPLIANCE_HSSE', 'BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER',
                 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER',
                 'COLLECTIONS_OFFICER')
on conflict do nothing;

-- process:manage — who may initialize / drive the process.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR')
on conflict do nothing;

-- handoff send/receive.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('process:handoff:send', 'process:handoff:receive')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'COORDINATOR',
                 'CHIEF_OF_TRANSIT', 'CUSTOMS_DECLARANT', 'TRANSPORT_OFFICER', 'BILLING_OFFICER',
                 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT', 'PICKUP_AGENT',
                 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

-- completeness checkpoints (steps 18/19) — the Coordinator prepares, the AM checks.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'process:completeness:review'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'COORDINATOR', 'ACCOUNT_MANAGER')
on conflict do nothing;

-- customs:assign (steps 5, 12).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:assign'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT', 'COORDINATOR')
on conflict do nothing;

-- customs:validate (step 7) — the CHECKER half. Deliberately NOT granted to
-- CUSTOMS_DECLARANT: the preparer must never hold the validation permission.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CHIEF_OF_TRANSIT')
on conflict do nothing;

-- customs:register (step 9) — the Finance customs function. This is the grant
-- that makes step 9 possible at all: FINANCE_OFFICER previously held NO customs
-- permission, so RBAC actively forbade the official step.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'customs:register'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'CUSTOMS_FINANCE_OFFICER')
on conflict do nothing;

-- finance:validate (step 21) — the CHECKER half. NOT granted to BILLING_OFFICER,
-- which holds finance:create (the MAKER half). That is the billing/finance split.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'finance:validate'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER')
on conflict do nothing;

-- transport:request (step 3).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'transport:request'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ACCOUNT_MANAGER', 'TRANSPORT_OFFICER')
on conflict do nothing;

-- administration / courier / collections (steps 23-26).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('admin_service:manage', 'courier:assign')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'ADMINISTRATIVE_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'courier:deposit'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'COURIER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'collections:manage'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'FINANCE_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

-- quotation (step 1) — catalog + grant only; the module is Phase 5.0D.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('quotation:create', 'quotation:send', 'quotation:approve')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('SYSTEM_ADMIN', 'OPS_SUPERVISOR', 'QUOTATION_MANAGER')
on conflict do nothing;

-- Base + operational grants for the seven new roles.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('profile:read:self', 'profile:update:self')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT',
                 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'CUSTOMS_FINANCE_OFFICER', 'CUSTOMS_FIELD_AGENT',
                 'PICKUP_AGENT', 'ADMINISTRATIVE_OFFICER', 'COURIER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

-- Tenant-wide dossier read for the roles that must reach ANY dossier to do their job.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'file:read:all'
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code in ('BILLING_OFFICER', 'ADMINISTRATIVE_OFFICER', 'COLLECTIONS_OFFICER')
on conflict do nothing;

-- BILLING_OFFICER — the MAKER half of the invoice pair (create/update/issue, and
-- explicitly NOT finance:validate / finance:void / finance:payment).
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:create', 'finance:read', 'finance:update',
                                       'finance:issue', 'client:read', 'communication:send',
                                       'communication:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'BILLING_OFFICER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:read', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'CUSTOMS_FINANCE_OFFICER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('customs:read', 'customs:update', 'customs:release',
                                       'document:create', 'document:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'CUSTOMS_FIELD_AGENT'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('transport:read', 'transport:update', 'document:create',
                                       'document:read', 'tracking:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PICKUP_AGENT'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:read', 'finance:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'ADMINISTRATIVE_OFFICER'
on conflict do nothing;

-- COURIER — deliberately narrow, like DRIVER. Deposit + proof upload only; NO
-- finance permission at all, so a courier can never move a financial status.
insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('document:create', 'document:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'COURIER'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code in ('finance:read', 'finance:payment', 'communication:read',
                                       'communication:send', 'report:read')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'COLLECTIONS_OFFICER'
on conflict do nothing;
