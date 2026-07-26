-- 20260726000003_workflow_policy_registry.sql
-- Effitrans Operations Platform — PHASE WES-7: versioned workflow policy registry.
-- ---------------------------------------------------------------------------
-- ADDITIVE. Implements ADR-WES-012: the engine is reusable software, business
-- policy is VERSIONED CONFIGURATION. No existing table, policy, permission,
-- role or grant is modified; two additive columns are added to process_instance
-- so a dossier can pin the policy version that governs it.
--
-- WHY A NEW TABLE. The audit looked for a reusable structure first:
--   * expense_template is the closest precedent (version + DRAFT/ACTIVE/RETIRED
--     + checksum + active_from/retired_at) and its SHAPE is reused here — but it
--     is a GLOBAL, non-tenant catalogue of PDF metadata with a two-value code
--     CHECK. It carries no document, no tenant scope, no validation state and no
--     activation actor, so it cannot express a tenant-overridable policy.
--   * tenant_process_rollout is boolean feature flags, not versioned content.
--   * document_type / role / permission are the CATALOGS policy references, not
--     a place to store policy.
-- Nothing existing satisfies the contract, so one table is added — and it
-- deliberately mirrors the expense_template lifecycle vocabulary rather than
-- inventing a second one.
--
-- IMMUTABILITY. A published version (ACTIVE or RETIRED) can never be edited:
-- a trigger hard-blocks any UPDATE to its content, and editing an active policy
-- means creating a NEW draft. The content hash makes tampering detectable.
--
-- SCOPE: storage, resolution support and atomic activation only. NO SLA engine
-- (WES-8), NO business event ledger (WES-9), NO assignment or BAE change.

-- ===========================================================================
-- 1. Permission catalog — REUSE, no new privileged permission.
--
--    The audit found admin:config:manage already exists and is held by
--    SYSTEM_ADMIN. WES-7F states plainly: do not invent a new privileged
--    permission unless repository evidence proves it necessary. It does not:
--    workflow policy IS system configuration. Platform-default policy is
--    additionally bounded by the existing platform_admin identity, which is a
--    separate table and a separate auth path — not a tenant permission.
-- ===========================================================================

-- ===========================================================================
-- 2. workflow_policy_version — one row per version of the whole policy document.
--
--    tenant_id NULL  ⇒ PLATFORM DEFAULT (managed by platform admins)
--    tenant_id set   ⇒ that tenant's override
--
--    ONE document per version covering every domain: a dossier pins ONE
--    identifier and its rules are internally consistent. Independently-versioned
--    domains could pin to a combination nobody ever validated.
-- ===========================================================================
create table public.workflow_policy_version (
  id                    uuid primary key default gen_random_uuid(),
  -- NULL = platform default. Not a FK-to-nothing hack: the nullability IS the
  -- scope discriminator, and every index/policy below treats it as such.
  tenant_id             uuid references public.organization (id),

  -- Monotonic per scope (see the unique indexes below).
  version               int not null check (version > 0),

  -- Shape version of the document. A row declaring an unknown value is rejected
  -- at validation and can never be activated.
  policy_schema_version int not null,

  status                text not null default 'DRAFT'
                          check (status in ('DRAFT', 'VALIDATED', 'ACTIVE', 'RETIRED')),

  -- The policy itself. Strictly validated in TypeScript before it may reach
  -- VALIDATED, and re-checked by the activation RPC below.
  document              jsonb not null,
  -- sha256 over the NORMALIZED document (order-independent). Integrity,
  -- comparison, duplicate detection, audit.
  content_sha256        text not null,

  -- Validation outcome. Errors are retained so an operator can see WHY.
  validation_status     text not null default 'PENDING'
                          check (validation_status in ('PENDING', 'PASSED', 'FAILED')),
  validation_errors     jsonb,
  validated_at          timestamptz,
  validated_by          uuid references public.app_user (id),

  -- Activation provenance.
  effective_from        timestamptz,
  activated_at          timestamptz,
  activated_by          uuid references public.app_user (id),
  activation_reason     text,
  retired_at            timestamptz,

  -- Draft lineage: which version this draft was created from.
  parent_version_id     uuid references public.workflow_policy_version (id) on delete set null,

  created_by            uuid references public.app_user (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- A version number is unique within its scope. Two partial uniques because
  -- NULL tenant_id does not participate in a plain unique constraint.
  constraint workflow_policy_activation_reason_required
    check (status <> 'ACTIVE' or activation_reason is not null)
);

-- Version numbering, per scope.
create unique index uq_workflow_policy_tenant_version
  on public.workflow_policy_version (tenant_id, version) where tenant_id is not null;
create unique index uq_workflow_policy_platform_version
  on public.workflow_policy_version (version) where tenant_id is null;

-- EXACTLY ONE ACTIVE VERSION PER SCOPE — the invariant the resolver depends on.
create unique index uq_workflow_policy_tenant_active
  on public.workflow_policy_version (tenant_id) where tenant_id is not null and status = 'ACTIVE';
create unique index uq_workflow_policy_platform_active
  on public.workflow_policy_version ((true)) where tenant_id is null and status = 'ACTIVE';

-- Resolution path: "the active version for this scope" must be an index hit.
create index idx_workflow_policy_scope_status
  on public.workflow_policy_version (tenant_id, status);
create index idx_workflow_policy_hash on public.workflow_policy_version (content_sha256);

create trigger trg_workflow_policy_updated_at before update on public.workflow_policy_version
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- 3. IMMUTABILITY of published versions.
--
--    prevent_mutation is all-or-nothing, so this table needs a targeted guard:
--    a published row's CONTENT is frozen, while the retirement bookkeeping the
--    activation RPC performs (status -> RETIRED, retired_at) stays possible.
-- ===========================================================================
create or replace function public.enforce_workflow_policy_immutability()
returns trigger language plpgsql as $$
begin
  if old.status in ('ACTIVE', 'RETIRED') then
    if new.document        is distinct from old.document
       or new.content_sha256 is distinct from old.content_sha256
       or new.policy_schema_version is distinct from old.policy_schema_version
       or new.tenant_id    is distinct from old.tenant_id
       or new.version      is distinct from old.version then
      raise exception 'workflow policy version % is published and immutable', old.id;
    end if;
    -- A published version may only ever move ACTIVE -> RETIRED.
    if old.status = 'RETIRED' and new.status <> 'RETIRED' then
      raise exception 'a retired workflow policy version cannot be reactivated';
    end if;
    if old.status = 'ACTIVE' and new.status not in ('ACTIVE', 'RETIRED') then
      raise exception 'an active workflow policy version may only be retired';
    end if;
  end if;
  return new;
end; $$;

create trigger trg_workflow_policy_immutable before update on public.workflow_policy_version
  for each row execute function public.enforce_workflow_policy_immutability();

-- A published version is never deleted — history stays queryable forever.
create or replace function public.prevent_published_policy_delete()
returns trigger language plpgsql as $$
begin
  if old.status in ('ACTIVE', 'RETIRED') then
    raise exception 'a published workflow policy version cannot be deleted';
  end if;
  return old;
end; $$;

create trigger trg_workflow_policy_no_delete before delete on public.workflow_policy_version
  for each row execute function public.prevent_published_policy_delete();

-- Tenant integrity: the actors on a tenant-scoped version belong to that tenant.
create or replace function public.enforce_workflow_policy_actor_tenant()
returns trigger language plpgsql as $$
declare t uuid;
begin
  if new.tenant_id is null then return new; end if;   -- platform default: platform actors
  foreach t in array array[new.created_by, new.validated_by, new.activated_by] loop
    if t is not null then
      if (select tenant_id from public.app_user where id = t) is distinct from new.tenant_id then
        raise exception 'workflow policy actor belongs to another tenant';
      end if;
    end if;
  end loop;
  return new;
end; $$;

create trigger trg_workflow_policy_actor_tenant before insert or update on public.workflow_policy_version
  for each row execute function public.enforce_workflow_policy_actor_tenant();

-- ===========================================================================
-- 4. DOSSIER PINNING (WES-7C).
--
--    Additive columns on the EXISTING process_instance, which already carries
--    `process_version` for exactly this purpose — the registry-version pin is
--    the same idea, so it lives beside it rather than in a parallel table.
--
--    provenance:
--      PINNED         resolved and pinned when the instance was created
--      LEGACY_DEFAULT predates the registry — honestly marked, never fabricated
--      MIGRATED       moved by an explicit, reasoned, audited action
-- ===========================================================================
alter table public.process_instance
  add column if not exists policy_version_id uuid references public.workflow_policy_version (id),
  add column if not exists policy_provenance text not null default 'LEGACY_DEFAULT'
    check (policy_provenance in ('PINNED', 'LEGACY_DEFAULT', 'MIGRATED'));

create index if not exists idx_process_instance_policy on public.process_instance (policy_version_id)
  where policy_version_id is not null;

comment on column public.process_instance.policy_provenance is
  'WES-7C — how this dossier came to be governed by its policy version. LEGACY_DEFAULT means it predates the registry: its historical policy was never recorded and is not fabricated.';

-- ===========================================================================
-- 5. ATOMIC ACTIVATION (WES-7E).
--
--    Retiring the previous active version and activating the new one must be ONE
--    transaction: a partial activation would leave a scope with zero or two
--    active versions, and the resolver's fail-closed contract would start
--    refusing work. The supabase-js service-role client cannot hold a
--    multi-statement transaction, so this is a security-definer RPC — the
--    provision_tenant / next_*_number precedent.
--
--    The RPC re-checks the safety-critical facts the application already
--    checked. It does NOT re-run the full document validation (that is
--    deterministic TypeScript); it enforces that only a PASSED, VALIDATED
--    version of a known schema can ever become ACTIVE.
-- ===========================================================================
create or replace function public.activate_workflow_policy(
  p_version_id uuid,
  p_actor      uuid,
  p_reason     text,
  p_schema_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
  v_retired uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'activation reason is required';
  end if;

  select * into v from public.workflow_policy_version where id = p_version_id for update;
  if not found then raise exception 'workflow policy version not found'; end if;

  -- Fail closed: only a validated, passing version of a KNOWN schema activates.
  if v.status <> 'VALIDATED' then
    raise exception 'only a VALIDATED version may be activated (found %)', v.status;
  end if;
  if v.validation_status <> 'PASSED' then
    raise exception 'version % has not passed validation', p_version_id;
  end if;
  if v.policy_schema_version <> p_schema_version then
    raise exception 'policy schema version mismatch: version declares %, platform expects %',
      v.policy_schema_version, p_schema_version;
  end if;

  -- Retire the current active version OF THE SAME SCOPE (NULL-safe comparison).
  update public.workflow_policy_version
     set status = 'RETIRED', retired_at = now()
   where status = 'ACTIVE'
     and tenant_id is not distinct from v.tenant_id
  returning id into v_retired;

  update public.workflow_policy_version
     set status            = 'ACTIVE',
         activated_at      = now(),
         activated_by      = p_actor,
         activation_reason = p_reason,
         effective_from    = coalesce(effective_from, now())
   where id = p_version_id;

  return jsonb_build_object(
    'activated_id', p_version_id,
    'retired_id',   v_retired,
    'tenant_id',    v.tenant_id,
    'version',      v.version
  );
end; $$;

revoke execute on function public.activate_workflow_policy(uuid, uuid, text, int) from public;
grant execute on function public.activate_workflow_policy(uuid, uuid, text, int) to service_role;

-- ===========================================================================
-- 6. RLS — read-only for tenant staff holding admin:config:manage, and STRICTLY
--    tenant-scoped. A tenant can never see another tenant's drafts or versions.
--    The platform default (tenant_id IS NULL) is readable by any config manager
--    (they must be able to see the policy their dossiers actually run on) but is
--    writable only through the service-role actions, which enforce the
--    platform-admin boundary in application code.
--
--    ALL WRITES go through the server actions on the service-role client. There
--    is no authenticated INSERT/UPDATE/DELETE policy at all.
-- ===========================================================================
alter table public.workflow_policy_version enable row level security;

create policy workflow_policy_select on public.workflow_policy_version
  for select to authenticated
  using (
    public.has_permission('admin:config:manage')
    and (tenant_id is null or tenant_id = public.auth_tenant_id())
  );

grant select on public.workflow_policy_version to authenticated;

-- ===========================================================================
-- 7. Seed the PLATFORM DEFAULT placeholder row.
--
--    Deliberately NOT seeded with a document here: the default is DERIVED from
--    the code registries (lib/workflow/policy/default.ts) so it cannot drift
--    from them, and the resolver falls back to that built-in default when no
--    platform row is active. Seeding a frozen copy in SQL would create exactly
--    the second source of truth this phase exists to remove.
--
--    An operator publishes a platform default through the admin surface when
--    they want one pinned; until then every dossier resolves the built-in
--    default and is marked LEGACY_DEFAULT, which is honest.
-- ===========================================================================
