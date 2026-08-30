-- 20260923000001_operational_incident.sql
-- ===========================================================================
-- ICAM-2 — the operational register of « retours / non-conformités », and the
-- source of NINC.
--
-- AN OPERATIONS REGISTER, NOT PERFORMANCE DATA ENTRY. A return happens on a
-- dossier whether or not anybody ever opens Gestion de la Performance. This
-- table records the operational event; ICAM later derives a count from it. It
-- is deliberately NOT a "enter your NINC figure" surface, and the frozen source
-- map's VALIDATED MANUAL expectation is superseded by ruling R3 for exactly
-- that reason — a per-incident record can be decomposed later for IPAM, a
-- validated count cannot.
--
-- TWO INDEPENDENT DETERMINATIONS, and the frozen wording demands both:
--
--     « retours / non-conformités NON imputables traités »
--                                 ^^^^^^^^^^^^^ ^^^^^^^^
--                                 adjudication  treatment
--
-- R1 ratified that « traité » is a DISTINCT treatment-completion act — not the
-- adjudication, not the dossier's closure. So the register carries two
-- lifecycles that do not imply one another: an incident may be treated and
-- still under analysis, or adjudicated non-imputable and not yet treated.
-- Neither alone counts.
--
-- WHY NINC IS NOT A PENALTY. An incident imputable to Effitrans/the Account
-- Manager contributes ZERO — F-ICAM-06: "an AM-caused rework must NOT increment
-- counters". It is still recorded, still auditable, and still available to
-- IPAM's quality dimensions in Slice 3. ICAM neither rewards nor punishes
-- fault; it counts handled non-fault work.
--
-- FOUR EYES, because imputability assigns blame. The governance matrix is
-- explicit: "anything that can blame is NOT entered by the person being
-- measured". The recorder may never adjudicate their own incident, and the
-- corrector may never revalidate their own correction — both enforced in the
-- database, not in a screen.
--
-- VOCABULARY IS RATIFIED, NOT INVENTED. `Imputabilité (Oui/Non/En analyse/Non
-- évalué)` is the workbook's own four-state list (formula-source-census §LISTES).
-- An earlier audit proposed EFFITRANS/CLIENT/TIERS categories; those were
-- invented and are not used here.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The register.
-- ---------------------------------------------------------------------------
create table if not exists public.operational_incident (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organization (id),
  file_id       uuid not null references public.operational_file (id),

  -- The frozen wording names two kinds; both are the same operational fact for
  -- NINC, and keeping them apart preserves the distinction for later analysis.
  kind          text not null check (kind in ('RETOUR', 'NON_CONFORMITE')),
  description   text not null check (length(btrim(description)) > 0),

  -- TREATMENT lifecycle (R1). OUVERT → TRAITE, or OUVERT → ANNULE.
  status        text not null default 'OUVERT'
                  check (status in ('OUVERT', 'TRAITE', 'ANNULE')),

  -- IMPUTABILITY lifecycle — the ratified four states. EN_ANALYSE is the
  -- honest default: an incident that has not been adjudicated is not a fault,
  -- and GOV-04 says so.
  imputability  text not null default 'EN_ANALYSE'
                  check (imputability in ('EN_ANALYSE', 'OUI', 'NON', 'NON_EVALUE')),

  recorded_by             uuid not null references public.app_user (id),
  recorded_at             timestamptz not null default now(),

  -- The adjudication. `decided_at` NULL means "not final" — which is also the
  -- state a governed correction returns the incident to.
  imputability_decided_by uuid references public.app_user (id),
  imputability_decided_at timestamptz,

  -- The treatment. `treated_at` is THE ICAM WORKLOAD INSTANT (R2): Q9 resolves
  -- the Account Manager who owned the dossier at this moment.
  treated_by              uuid references public.app_user (id),
  treated_at              timestamptz,

  cancelled_by            uuid references public.app_user (id),
  cancelled_at            timestamptz,
  cancellation_reason     text,

  -- A treated incident must say who treated it and when: `treated_at` drives
  -- attribution, so it may never be implied.
  check (
    (status = 'TRAITE') = (treated_at is not null and treated_by is not null)
  ),
  -- A final imputability must carry its author and instant.
  check (
    (imputability_decided_at is not null) = (imputability_decided_by is not null)
  ),
  -- EN_ANALYSE is never final.
  check (
    imputability <> 'EN_ANALYSE' or imputability_decided_at is null
  ),
  check (
    (status = 'ANNULE') = (cancelled_at is not null)
  )
);

create index if not exists idx_operational_incident_file
  on public.operational_incident (tenant_id, file_id);
create index if not exists idx_operational_incident_treated
  on public.operational_incident (tenant_id, treated_at)
  where status = 'TRAITE' and imputability = 'NON';

-- Tenant integrity: an incident may never point at another tenant's dossier.
-- A FK alone cannot express this, and the app is not the place to enforce it.
create or replace function public.operational_incident_tenant_guard()
returns trigger
language plpgsql
as $$
declare v_file_tenant uuid;
begin
  select tenant_id into v_file_tenant
    from public.operational_file where id = new.file_id;
  if v_file_tenant is null then
    raise exception 'incident references an unknown dossier';
  end if;
  if v_file_tenant <> new.tenant_id then
    raise exception 'incident tenant mismatch (file_tenant=%, given=%)', v_file_tenant, new.tenant_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_operational_incident_tenant on public.operational_incident;
create trigger trg_operational_incident_tenant
  before insert or update on public.operational_incident
  for each row execute function public.operational_incident_tenant_guard();

-- ---------------------------------------------------------------------------
-- 2. The append-only correction history.
--
-- A final determination cannot be silently overwritten, because changing it
-- changes a named person's measured workload. Corrections append; they never
-- rewrite. The customs_correction WORM idiom, applied to the same problem.
-- ---------------------------------------------------------------------------
create table if not exists public.operational_incident_correction (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.organization (id),
  incident_id         uuid not null references public.operational_incident (id),
  file_id             uuid not null references public.operational_file (id),
  corrected_by        uuid not null references public.app_user (id),
  corrected_at        timestamptz not null default now(),
  reason              text not null check (length(btrim(reason)) > 0),
  -- { "imputability": { "old": …, "new": … }, … } — computed server-side.
  changes             jsonb not null,
  -- The determination this correction displaced, preserved verbatim.
  imputability_before text not null,
  decided_by_before   uuid,
  decided_at_before   timestamptz
);

create index if not exists idx_operational_incident_correction_incident
  on public.operational_incident_correction (tenant_id, incident_id, corrected_at desc);

create or replace function public.operational_incident_correction_worm()
returns trigger
language plpgsql
as $$
begin
  raise exception 'operational_incident_correction is append-only: a determination that changed a person''s measured workload is never rewritten or erased';
end $$;

drop trigger if exists operational_incident_correction_worm on public.operational_incident_correction;
create trigger operational_incident_correction_worm
  before update or delete on public.operational_incident_correction
  for each row execute function public.operational_incident_correction_worm();

-- ---------------------------------------------------------------------------
-- 3. RLS — reads for operational readers; NO write policy, so the RPCs below
--    are the only door.
-- ---------------------------------------------------------------------------
alter table public.operational_incident enable row level security;
alter table public.operational_incident_correction enable row level security;

drop policy if exists operational_incident_select on public.operational_incident;
create policy operational_incident_select on public.operational_incident
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('file:read'));

drop policy if exists operational_incident_correction_select on public.operational_incident_correction;
create policy operational_incident_correction_select on public.operational_incident_correction
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('file:read'));

grant select on public.operational_incident, public.operational_incident_correction
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The two capabilities, on EXISTING operational roles.
--
-- No new role: the governance matrix already names the actors. « Superviseur »
-- is OPS_SUPERVISOR (Superviseur opérations) and records; « Responsable
-- Qualité » is COMPLIANCE_HSSE (Responsable conformité/HSSE) and adjudicates —
-- non-conformity is precisely its domain.
--
-- SYSTEM_ADMIN receives NEITHER. It may assign these roles; that is not a
-- reason to decide whether a colleague caused an incident. Same doctrine as
-- DEC-B61 for hr:* and as the performance capabilities.
--
-- PERFORMANCE_MANAGEMENT receives NEITHER. Performance consumes derived
-- results; it does not become an incident operator.
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('incident:record', 'incident', 'record', 'assigned',
   'Record an operational return / non-conformity on a dossier, and record its treatment completion. Confers no authority to decide imputability.'),
  ('incident:adjudicate', 'incident', 'adjudicate', 'assigned',
   'Decide the imputability of an operational incident, and correct or revalidate a final determination. Person-level four-eyes: never one''s own recording, never one''s own correction.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'incident:record'
where r.code = 'OPS_SUPERVISOR'
on conflict do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'incident:adjudicate'
where r.code = 'COMPLIANCE_HSSE'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Recording. Database time, verified actor, tenant-checked dossier.
-- ---------------------------------------------------------------------------
create or replace function public.record_operational_incident(
  p_file_id     uuid,
  p_actor       uuid,
  p_kind        text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_id     uuid;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;

  select tenant_id into v_tenant from public.operational_file where id = p_file_id;
  if v_tenant is null then raise exception 'dossier not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'incident:record', 'SERVICE');

  insert into public.operational_incident
    (tenant_id, file_id, kind, description, recorded_by)
  values (v_tenant, p_file_id, p_kind, btrim(p_description), p_actor)
  returning id into v_id;

  return jsonb_build_object('incident_id', v_id, 'file_id', p_file_id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Adjudication — four eyes. The recorder may never decide their own.
-- ---------------------------------------------------------------------------
create or replace function public.adjudicate_operational_incident(
  p_incident_id  uuid,
  p_actor        uuid,
  p_imputability text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant     uuid;
  v_recorded   uuid;
  v_status     text;
  v_decided_at timestamptz;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;
  if p_imputability not in ('OUI', 'NON', 'NON_EVALUE') then
    raise exception 'imputability must be one of OUI, NON, NON_EVALUE — EN_ANALYSE is the absence of a decision, not a decision';
  end if;

  select tenant_id, recorded_by, status, imputability_decided_at
    into v_tenant, v_recorded, v_status, v_decided_at
    from public.operational_incident
   where id = p_incident_id
     for update;
  if not found then raise exception 'incident not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'incident:adjudicate', 'SERVICE');

  if v_status = 'ANNULE' then
    raise exception 'a cancelled incident is not adjudicated';
  end if;

  -- THE SEPARATION. Imputability assigns responsibility for someone's work, so
  -- whoever reported the incident may not be the one who rules on it.
  if v_recorded = p_actor then
    raise exception 'the actor who recorded an incident may not adjudicate it';
  end if;

  if v_decided_at is not null then
    raise exception 'this incident is already adjudicated: use the governed correction';
  end if;

  update public.operational_incident
     set imputability            = p_imputability,
         imputability_decided_by = p_actor,
         imputability_decided_at = now()          -- DATABASE time, always
   where id = p_incident_id;

  return jsonb_build_object('incident_id', p_incident_id, 'imputability', p_imputability);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Treatment completion — the ICAM WORKLOAD INSTANT (R2).
--
-- `treated_at = now()` is the timestamp Q9 resolves ownership against, so it
-- must be the database's and never an application's.
-- ---------------------------------------------------------------------------
create or replace function public.complete_operational_incident_treatment(
  p_incident_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_status text;
  v_at     timestamptz;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;

  select tenant_id, status into v_tenant, v_status
    from public.operational_incident
   where id = p_incident_id
     for update;
  if not found then raise exception 'incident not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'incident:record', 'SERVICE');

  if v_status = 'ANNULE' then raise exception 'a cancelled incident is not treated'; end if;
  if v_status = 'TRAITE' then raise exception 'this incident is already treated'; end if;

  update public.operational_incident
     set status     = 'TRAITE',
         treated_by = p_actor,
         treated_at = now()
   where id = p_incident_id
  returning treated_at into v_at;

  return jsonb_build_object('incident_id', p_incident_id, 'treated_at', v_at);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Cancellation — never counts, and says why.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_operational_incident(
  p_incident_id uuid,
  p_actor       uuid,
  p_reason      text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_status text;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'cancelling an incident requires a reason';
  end if;

  select tenant_id, status into v_tenant, v_status
    from public.operational_incident where id = p_incident_id for update;
  if not found then raise exception 'incident not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'incident:adjudicate', 'SERVICE');
  if v_status = 'ANNULE' then raise exception 'this incident is already cancelled'; end if;

  update public.operational_incident
     set status              = 'ANNULE',
         treated_by          = null,
         treated_at          = null,
         cancelled_by        = p_actor,
         cancelled_at        = now(),
         cancellation_reason = btrim(p_reason)
   where id = p_incident_id;

  return jsonb_build_object('incident_id', p_incident_id);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Correction of a FINAL determination, and its revalidation.
--
-- Correction records the new value, preserves the displaced one, and CLEARS
-- finality — so a corrected incident stops counting until somebody other than
-- the corrector confirms it. The D4 customs door, applied to imputability.
-- ---------------------------------------------------------------------------
create or replace function public.correct_operational_incident(
  p_incident_id  uuid,
  p_actor        uuid,
  p_reason       text,
  p_imputability text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old  record;
  v_corr uuid;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a correction requires a reason';
  end if;
  if p_imputability not in ('OUI', 'NON', 'NON_EVALUE') then
    raise exception 'imputability must be one of OUI, NON, NON_EVALUE';
  end if;

  select * into v_old from public.operational_incident
   where id = p_incident_id for update;
  if not found then raise exception 'incident not found'; end if;

  perform public.assert_actor_authority(p_actor, v_old.tenant_id, 'incident:adjudicate', 'SERVICE');

  if v_old.imputability_decided_at is null then
    raise exception 'only a final determination passes through the correction door';
  end if;
  if v_old.imputability = p_imputability then
    raise exception 'a correction must change the determination';
  end if;

  insert into public.operational_incident_correction
    (tenant_id, incident_id, file_id, corrected_by, reason, changes,
     imputability_before, decided_by_before, decided_at_before)
  values
    (v_old.tenant_id, p_incident_id, v_old.file_id, p_actor, btrim(p_reason),
     jsonb_build_object('imputability',
       jsonb_build_object('old', v_old.imputability, 'new', p_imputability)),
     v_old.imputability, v_old.imputability_decided_by, v_old.imputability_decided_at)
  returning id into v_corr;

  -- The new value is recorded but NOT final: it awaits a different pair of eyes.
  update public.operational_incident
     set imputability            = p_imputability,
         imputability_decided_by = null,
         imputability_decided_at = null
   where id = p_incident_id;

  return jsonb_build_object('correction_id', v_corr, 'incident_id', p_incident_id);
end $$;

create or replace function public.revalidate_operational_incident(
  p_incident_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant    uuid;
  v_decided   timestamptz;
  v_corr      uuid;
  v_corrector uuid;
begin
  if p_actor is null then raise exception 'an actor is required'; end if;

  select tenant_id, imputability_decided_at into v_tenant, v_decided
    from public.operational_incident where id = p_incident_id for update;
  if not found then raise exception 'incident not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'incident:adjudicate', 'SERVICE');

  select id, corrected_by into v_corr, v_corrector
    from public.operational_incident_correction
   where incident_id = p_incident_id and tenant_id = v_tenant
   order by corrected_at desc limit 1;
  if v_corr is null then
    raise exception 'this incident was never corrected — use the ordinary adjudication';
  end if;
  if v_decided is not null then
    raise exception 'this incident is already adjudicated';
  end if;
  if v_corrector = p_actor then
    raise exception 'the corrector may not revalidate their own correction';
  end if;

  update public.operational_incident
     set imputability_decided_by = p_actor,
         imputability_decided_at = now()
   where id = p_incident_id;

  return jsonb_build_object('incident_id', p_incident_id, 'correction_id', v_corr);
end $$;

-- OPS-SEC-1: a definer function is never browser-executable.
revoke execute on function public.record_operational_incident(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.adjudicate_operational_incident(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.complete_operational_incident_treatment(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.cancel_operational_incident(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.correct_operational_incident(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.revalidate_operational_incident(uuid, uuid) from public, anon, authenticated;

grant execute on function public.record_operational_incident(uuid, uuid, text, text) to service_role;
grant execute on function public.adjudicate_operational_incident(uuid, uuid, text) to service_role;
grant execute on function public.complete_operational_incident_treatment(uuid, uuid) to service_role;
grant execute on function public.cancel_operational_incident(uuid, uuid, text) to service_role;
grant execute on function public.correct_operational_incident(uuid, uuid, text, text) to service_role;
grant execute on function public.revalidate_operational_incident(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_roles int;
  v_extra text;
begin
  select count(*) into v_n from public.permission
   where code in ('incident:record', 'incident:adjudicate');
  if v_n <> 2 then raise exception 'M131: expected 2 incident capabilities, found %', v_n; end if;

  -- Grants are role-relative: migrations run before the seed.
  select count(*) into v_roles from public.role where code = 'OPS_SUPERVISOR';
  select count(*) into v_n
    from public.role r join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'OPS_SUPERVISOR' and p.code = 'incident:record';
  if v_n <> v_roles then raise exception 'M131: expected % incident:record grant(s), got %', v_roles, v_n; end if;

  select count(*) into v_roles from public.role where code = 'COMPLIANCE_HSSE';
  select count(*) into v_n
    from public.role r join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'COMPLIANCE_HSSE' and p.code = 'incident:adjudicate';
  if v_n <> v_roles then raise exception 'M131: expected % incident:adjudicate grant(s), got %', v_roles, v_n; end if;

  -- Neither capability may reach Performance or platform administration.
  select count(*), min(r.code) into v_n, v_extra
    from public.role r join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code in ('incident:record', 'incident:adjudicate')
     and r.code in ('PERFORMANCE_MANAGEMENT', 'PERFORMANCE_PUBLISHER', 'SYSTEM_ADMIN');
  if v_n <> 0 then
    raise exception 'M131: % forbidden holder(s) of an incident capability (e.g. %) — Performance consumes results and SYSTEM_ADMIN administers roles; neither decides who caused an incident', v_n, v_extra;
  end if;

  select count(*) into v_n from pg_trigger
   where tgname in ('operational_incident_correction_worm', 'trg_operational_incident_tenant')
     and not tgisinternal;
  if v_n <> 2 then raise exception 'M131: expected the WORM and tenant-guard triggers, found %', v_n; end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public'
     and tablename in ('operational_incident', 'operational_incident_correction')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');
  if v_n <> 0 then
    raise exception 'M131: the incident tables must have NO write policy — the RPCs are the boundary, found %', v_n;
  end if;

  for v_extra in select unnest(array[
      'record_operational_incident', 'adjudicate_operational_incident',
      'complete_operational_incident_treatment', 'cancel_operational_incident',
      'correct_operational_incident', 'revalidate_operational_incident']) loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_extra;
    if v_n <> 1 then raise exception 'M131: RPC % is missing', v_extra; end if;
  end loop;

  raise notice 'M131 OK: operational_incident register created; four-eyes adjudication and correction enforced in the database; incident:record on OPS_SUPERVISOR and incident:adjudicate on COMPLIANCE_HSSE; no Performance or SYSTEM_ADMIN holder';
end $$;
