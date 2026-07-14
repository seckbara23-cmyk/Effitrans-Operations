-- ===========================================================================
-- ENABLE THE OFFICIAL PROCESS FOR ONE TENANT — break-glass path.
-- ===========================================================================
--
-- The NORMAL path is /platform/rollout, because it AUDITS the change
-- (platform.rollout.updated, with before/after and the acting admin). Rollout is a
-- governance act — "who turned the workflow on for a live freight forwarder, and when"
-- is exactly the question asked at 2am, and raw SQL answers it with silence.
--
-- Use this only when the UI is not an option. It writes its own audit row so the trail
-- survives either way.
--
-- IDEMPOTENT. Safe to re-run. Enables ONLY the engine and the workspaces; it deliberately
-- leaves physical_invoice_deposit and collections at whatever they already are, because
-- those are separate decisions with separate readiness (Finance must be ready to work an
-- aging balance before Collections is worth switching on).
--
-- ---------------------------------------------------------------------------
-- PREREQUISITE: migration 20260714000004_tenant_process_rollout must be applied.
-- If /settings/pilot says "the table does not exist", run `supabase db push` first —
-- nothing here will work otherwise.
-- ---------------------------------------------------------------------------

-- NOTE: no psql \set — the Supabase SQL editor is not psql. Edit the slug in the DO
-- block below.

begin;

-- Resolve the tenant by SLUG, not by a hardcoded uuid. The dev fixture happens to be
-- 00000000-…-0001, but a real deployment's id is whatever it is, and a script that
-- silently no-ops against the wrong uuid is a bad afternoon.
do $$
declare
  -- ▼▼▼ EDIT THIS ONE LINE ▼▼▼
  target_slug constant text := 'effitrans';
  -- ▲▲▲ EDIT THIS ONE LINE ▲▲▲
  org_id   uuid;
  org_name text;
  was_on   boolean;
begin
  select id, name into org_id, org_name
  from public.organization
  where lower(slug) = lower(target_slug);

  if org_id is null then
    raise exception 'No organization with slug %. Check public.organization.slug.', target_slug;
  end if;

  select coalesce(process_engine, false) into was_on
  from public.tenant_process_rollout where tenant_id = org_id;

  insert into public.tenant_process_rollout (
    tenant_id, process_engine, process_workspaces, note, first_enabled_at, updated_at
  )
  values (org_id, true, true, 'Bootstrap: enabled via enable_tenant_rollout.sql', now(), now())
  on conflict (tenant_id) do update
    set process_engine     = true,
        process_workspaces = true,
        -- physical_invoice_deposit and collections are NOT touched. Separate decisions.
        note               = 'Bootstrap: enabled via enable_tenant_rollout.sql',
        first_enabled_at   = coalesce(public.tenant_process_rollout.first_enabled_at, now()),
        updated_at         = now();

  -- The trail. actor_id is null and the action is prefixed `system.` because no human
  -- identity performed this — a script did, and the audit should say so rather than
  -- attribute it to whoever happened to be logged into the SQL editor.
  insert into public.audit_log (action, tenant_id, entity, entity_id, before, after)
  values (
    'system.rollout.bootstrapped',
    org_id,
    'tenant_process_rollout',
    org_id,
    jsonb_build_object('process_engine', coalesce(was_on, false)),
    jsonb_build_object('process_engine', true, 'process_workspaces', true,
                       'via', 'enable_tenant_rollout.sql')
  );

  raise notice 'Rollout ENABLED for % (%) — engine + workspaces.', org_name, org_id;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- VERIFY — this is the same AND that the application resolver computes.
-- ---------------------------------------------------------------------------
select o.slug                                  as organization_slug,
       o.id                                    as organization_id,
       coalesce(r.process_engine, false)       as tenant_engine,
       coalesce(r.process_workspaces, false)   as tenant_workspaces,
       r.first_enabled_at,
       r.updated_at
from public.organization o
left join public.tenant_process_rollout r on r.tenant_id = o.id
order by o.name;

-- Effective Engine / Effective Workspaces = these AND the deployment env flags
-- (EFFITRANS_PROCESS_ENGINE_ENABLED, EFFITRANS_PROCESS_WORKSPACES_ENABLED).
-- /settings/pilot prints all six, resolved by the application itself.
