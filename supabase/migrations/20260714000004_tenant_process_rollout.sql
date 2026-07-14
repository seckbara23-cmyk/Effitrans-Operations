-- Phase 5.0E-2A — TENANT-SCOPED ROLLOUT of the official process engine.
-- ---------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES
--
-- Until now the process engine was gated by environment booleans
-- (EFFITRANS_PROCESS_ENGINE_ENABLED and friends). An environment variable is
-- ALL-OR-NOTHING: turning it on to pilot ONE tenant would have turned the engine
-- on for EVERY tenant in that deployment. There was no way to run a controlled
-- pilot, and no way to roll back for one tenant without a redeploy.
--
-- THE MODEL
--
-- Two independent gates, ANDed. A feature is live for a tenant only when BOTH say
-- yes:
--
--   env flag   (the GLOBAL KILL SWITCH)   -- ships with the deployment; one flip
--                                            kills the feature for everyone, at once,
--                                            with no database access required.
--   tenant row (the ENABLEMENT)           -- per-tenant, toggled by a platform
--                                            admin, no redeploy.
--
--   effective = env_enabled AND tenant_enabled
--
-- The default on BOTH sides is FALSE, and a MISSING ROW MEANS DISABLED. That is the
-- important safety property: a tenant that nobody has thought about cannot acquire
-- the engine by accident, and neither a forgotten migration nor a half-finished
-- provisioning run can enable one.
--
-- WHY NOT REUSE tenant modules / plan entitlements?
--
-- lib/platform/entitlements.ts is explicitly a CONTRACT ONLY (Phase 4.0B-2): it has
-- no persistence and no enforcement, and it models COMMERCIAL modules (does this
-- plan include customs?). Rollout is a different question with a different owner and
-- a different lifetime — it is an operational safety control, not a billing fact, and
-- it must be revocable in seconds without touching what a tenant has paid for.
-- Conflating them would mean a rollback also downgraded the customer's plan.
--
-- This table is deliberately NOT a generic flag store. Four boolean columns, one row
-- per tenant, typed and greppable. A generic key/value flag table invites exactly the
-- ungoverned proliferation this phase exists to prevent.

create table if not exists public.tenant_process_rollout (
  tenant_id                 uuid primary key
                              references public.organization (id) on delete cascade,

  -- The four rollout-controlled capabilities. Each mirrors an env flag; the
  -- effective value is the AND of the two.
  process_engine            boolean not null default false,
  process_workspaces        boolean not null default false,
  physical_invoice_deposit  boolean not null default false,
  collections               boolean not null default false,

  -- Provenance. Who turned this on, when, and why — a rollout decision is a
  -- governance act, not a config tweak.
  note                      text,
  first_enabled_at          timestamptz,
  updated_at                timestamptz not null default now(),
  -- The platform admin who last changed it. NOT an app_user: rollout is a platform
  -- decision, and a tenant user must never be able to enable their own pilot.
  updated_by                uuid references public.platform_admin (id)
);

comment on table public.tenant_process_rollout is
  'Phase 5.0E-2. Per-tenant enablement of the official process engine. Effective = env flag AND this row. A missing row means DISABLED.';

-- A sub-capability without the engine is incoherent: queues over a dark engine are
-- always empty, and a deposit chain with no process to hang it on has no meaning.
-- The application resolver enforces this too (lib/process/rollout.ts), but a
-- constraint means a bad UPDATE cannot even be written.
alter table public.tenant_process_rollout
  drop constraint if exists tenant_process_rollout_requires_engine;
alter table public.tenant_process_rollout
  add constraint tenant_process_rollout_requires_engine check (
    process_engine
    or not (process_workspaces or physical_invoice_deposit or collections)
  );

-- ---------------------------------------------------------------------------
-- RLS. SELECT-only for authenticated, scoped to the caller's own tenant.
--
-- Every staff user may READ their own tenant's rollout state: the navigation
-- builder and the route guards need it on every request, and it is not sensitive
-- (it says "is the new workflow on for us", nothing more). Nobody may read another
-- tenant's row, and NOBODY may write through RLS at all — writes go exclusively
-- through the platform service-role action, which is audited.
-- ---------------------------------------------------------------------------
alter table public.tenant_process_rollout enable row level security;

drop policy if exists tenant_process_rollout_select on public.tenant_process_rollout;
create policy tenant_process_rollout_select on public.tenant_process_rollout
  for select to authenticated
  using (tenant_id = public.auth_tenant_id());

-- No insert/update/delete policy exists, deliberately. `authenticated` therefore
-- cannot mutate rollout state under any role or permission — including a tenant
-- SYSTEM_ADMIN, who must not be able to enable their own pilot.

-- SELECT only. The absent insert/update/delete grants are load-bearing: without the
-- table privilege, a future stray RLS policy still could not open a write path.
grant select on public.tenant_process_rollout to authenticated;

-- ---------------------------------------------------------------------------
-- Platform permission for the toggle. SUPER_ADMIN only; the platform RBAC set
-- itself is resolved in application code (lib/platform/roles.ts), so this is a
-- documentation anchor rather than a grant.
-- ---------------------------------------------------------------------------

-- NOTE ON CLEAN REPLAY: no tenant-scoped row is inserted here. Migrations run
-- against an EMPTY database before seed.sql, so any literal
-- `insert into tenant_process_rollout values ('<tenant-uuid>', ...)` would violate
-- the organization FK and abort the entire replay (the Phase 3.4 failure). It is
-- also unnecessary: a missing row already means DISABLED, which is exactly the
-- state every tenant should start in.
