-- 20260922000001_performance_report.sql
-- ===========================================================================
-- Slice 1 « Premier rapport » — the official management performance report.
--
-- BROUILLON → PRÊT POUR REVUE → PUBLIÉ. A draft may evolve; a published report
-- may not, ever, by any ordinary application path.
--
-- WHAT A PUBLISHED REPORT STORES, and why it is not a copy of the business.
-- The snapshot holds the COMPUTED FACTS management read — the totals, the
-- per-collaborateur rows, the reliability markers, the honesty notes — plus the
-- identity of the engine and parameter set that produced them. It does not
-- copy dossiers, documents or customs records: re-reading the live data answers
-- "what would the indicator say now", and the snapshot answers "what did we
-- publish". Both questions are legitimate; conflating them is what makes a
-- spreadsheet's history untrustworthy, and the platform exists to end that.
--
-- IMMUTABILITY IS ENFORCED IN THE DATABASE, not in the action. A trigger allows
-- UPDATE only while the row is a draft or awaiting review, and refuses every
-- UPDATE and every DELETE once PUBLIÉ. An application bug, a future action, a
-- careless admin client — none of them can quietly rewrite what management was
-- briefed on. The customs_correction WORM trigger proved this idiom; this is
-- the same one, narrowed to "after publication" rather than "always", because a
-- draft that could not be edited would be useless.
--
-- The PDF is an artifact of the SNAPSHOT, never of live data: the columns below
-- carry its storage path, its sha256 and the renderer version, exactly as
-- quotations and invoices already do.
-- ===========================================================================

create table if not exists public.performance_report (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.organization (id),

  -- What the report is about.
  title                 text not null check (length(btrim(title)) > 0),
  period_kind           text not null check (period_kind in ('MONTH','QUARTER','YEAR','CUSTOM')),
  period_start          date not null,
  period_end            date not null,
  period_label          text not null,
  check (period_end >= period_start),

  status                text not null default 'BROUILLON'
                          check (status in ('BROUILLON','PRET_POUR_REVUE','PUBLIE')),

  -- Authored prose. Editable while the report is a draft.
  executive_summary     text,
  management_commentary text,

  -- The frozen computed facts + the engine/parameter identity that produced
  -- them. NULL until publication: a draft renders live, which is the point of a
  -- draft.
  snapshot              jsonb,
  parameter_set_version text,
  engine_version        text,

  -- The PDF of the snapshot.
  artifact_storage_path text,
  artifact_sha256       text,
  artifact_renderer_version text,
  artifact_generated_at timestamptz,

  -- Attribution. All timestamps are database time — never a client clock.
  created_by            uuid not null references public.app_user (id),
  created_at            timestamptz not null default now(),
  submitted_by          uuid references public.app_user (id),
  submitted_at          timestamptz,
  published_by          uuid references public.app_user (id),
  published_at          timestamptz,

  -- A published report without its evidence would be a claim, not a record.
  check (
    status <> 'PUBLIE'
    or (snapshot is not null and published_by is not null
        and published_at is not null and parameter_set_version is not null)
  )
);

create index if not exists idx_performance_report_tenant_period
  on public.performance_report (tenant_id, period_start desc);

-- ---------------------------------------------------------------------------
-- Immutability after publication.
--
-- A published row is frozen in every respect that management read — title,
-- period, prose, snapshot, attribution, timestamps. The ONE thing that may
-- still be written is the PDF artifact, and only once, while it is still null:
-- rendering is a separate step from deciding, and a record whose artifact could
-- never be attached would either force the render into the publishing
-- transaction (where a font bug could refuse a publication) or leave the
-- document unreachable. Attaching it changes nothing a reader was briefed on.
--
-- Everything else — including a second attempt to change the artifact — raises.
-- ---------------------------------------------------------------------------
create or replace function public.performance_report_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'PUBLIE' then
      raise exception 'a published performance report is permanent: it records what management was briefed on and may never be deleted';
    end if;
    return old;
  end if;

  if old.status <> 'PUBLIE' then
    return new;                                    -- drafts evolve; that is the point
  end if;

  -- The artifact, exactly once.
  if old.artifact_storage_path is null
     and new.artifact_storage_path is not null
     and new.status                = old.status
     and new.title                 is not distinct from old.title
     and new.period_kind           is not distinct from old.period_kind
     and new.period_start          is not distinct from old.period_start
     and new.period_end            is not distinct from old.period_end
     and new.period_label          is not distinct from old.period_label
     and new.executive_summary     is not distinct from old.executive_summary
     and new.management_commentary is not distinct from old.management_commentary
     and new.snapshot              is not distinct from old.snapshot
     and new.parameter_set_version is not distinct from old.parameter_set_version
     and new.engine_version        is not distinct from old.engine_version
     and new.created_by            is not distinct from old.created_by
     and new.created_at            is not distinct from old.created_at
     and new.published_by          is not distinct from old.published_by
     and new.published_at          is not distinct from old.published_at
  then
    return new;
  end if;

  raise exception 'a published performance report is frozen: reopen the period as a new report rather than rewriting a published one';
end $$;

drop trigger if exists performance_report_immutable on public.performance_report;
create trigger performance_report_immutable
  before update or delete on public.performance_report
  for each row execute function public.performance_report_immutable();

-- ---------------------------------------------------------------------------
-- Publication, as ONE atomic act with database time.
--
-- An RPC rather than an ordinary update, for three reasons that all matter:
-- `published_at` must be the DATABASE's clock and no application's; the status
-- flip and the snapshot must land in the same statement so a published report
-- can never exist without the evidence it was published on; and the caller's
-- claimed identity must be verified against its permissions rather than
-- believed (OPS-SEC-2A / INV-7).
-- ---------------------------------------------------------------------------
create or replace function public.publish_performance_report(
  p_report_id             uuid,
  p_actor                 uuid,
  p_snapshot              jsonb,
  p_parameter_set_version text,
  p_engine_version        text
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
  if p_snapshot is null then raise exception 'a published report requires its snapshot'; end if;

  select tenant_id, status into v_tenant, v_status
    from public.performance_report
   where id = p_report_id
     for update;
  if not found then raise exception 'performance report not found'; end if;

  perform public.assert_actor_authority(p_actor, v_tenant, 'performance:report:publish', 'SERVICE');

  if v_status = 'PUBLIE' then
    raise exception 'this report is already published';
  end if;
  if v_status <> 'PRET_POUR_REVUE' then
    raise exception 'only a report marked « prêt pour revue » may be published';
  end if;

  update public.performance_report
     set status                = 'PUBLIE',
         snapshot              = p_snapshot,
         parameter_set_version = p_parameter_set_version,
         engine_version        = p_engine_version,
         published_by          = p_actor,
         published_at          = now()          -- DATABASE time, always
   where id = p_report_id
  returning published_at into v_at;

  return jsonb_build_object('report_id', p_report_id, 'published_at', v_at);
end $$;

revoke execute on function public.publish_performance_report(uuid, uuid, jsonb, text, text) from public;
revoke execute on function public.publish_performance_report(uuid, uuid, jsonb, text, text) from anon;
revoke execute on function public.publish_performance_report(uuid, uuid, jsonb, text, text) from authenticated;
grant  execute on function public.publish_performance_report(uuid, uuid, jsonb, text, text) to service_role;

alter table public.performance_report enable row level security;

drop policy if exists performance_report_select on public.performance_report;
create policy performance_report_select on public.performance_report
  for select to authenticated
  using (tenant_id = public.auth_tenant_id() and public.has_permission('performance:read'));

grant select on public.performance_report to authenticated;

-- ---------------------------------------------------------------------------
-- Capabilities.
--
-- Drafting is the working half of the module and belongs with reading, so
-- `performance:report:create` joins PERFORMANCE_MANAGEMENT. PUBLISHING is an
-- official act — the moment a set of numbers becomes the company's record of a
-- period — so it is separated. Since the administration screen grants ROLES,
-- the separation is expressed as a second thin assignable role rather than as a
-- permission somebody would have to hand-attach.
-- ---------------------------------------------------------------------------
insert into public.permission (code, module, action, data_scope, description) values
  ('performance:report:create', 'performance', 'report_create', 'tenant',
   'Draft a management performance report: create it, edit it while it is a draft, and submit it for review. Confers no authority to publish.'),
  ('performance:report:publish', 'performance', 'report_publish', 'tenant',
   'Publish a management performance report, freezing its computed snapshot permanently. Confers no other performance or operational authority.')
on conflict (code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p on p.code = 'performance:report:create'
where r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

-- The publisher role. Assigned to nobody by this migration: like
-- PERFORMANCE_MANAGEMENT, it is granted deliberately, per person, through
-- « Ajouter un rôle… → Attribuer ».
insert into public.role (tenant_id, code, label_fr, label_en, is_provisional)
select '00000000-0000-0000-0000-000000000001',
       'PERFORMANCE_PUBLISHER', 'Publication des rapports de performance',
       'Performance Report Publisher', false
where exists (select 1 from public.organization where id = '00000000-0000-0000-0000-000000000001')
on conflict (tenant_id, code) do nothing;

insert into public.role_permission (role_id, permission_id)
select r.id, p.id
from public.role r
join public.permission p
  on p.code in ('profile:read:self', 'profile:update:self', 'performance:report:publish')
where r.tenant_id = '00000000-0000-0000-0000-000000000001'
  and r.code = 'PERFORMANCE_PUBLISHER'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Self-assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_role  int;
  v_extra text;
begin
  select count(*) into v_n from public.permission
   where code in ('performance:report:create', 'performance:report:publish');
  if v_n <> 2 then
    raise exception 'M130: expected 2 report capabilities in the catalog, found %', v_n;
  end if;

  select count(*) into v_n from pg_trigger
   where tgname = 'performance_report_immutable' and not tgisinternal;
  if v_n <> 1 then raise exception 'M130: the immutability trigger is missing'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'publish_performance_report';
  if v_n <> 1 then raise exception 'M130: the publication RPC is missing'; end if;

  if has_function_privilege('anon', 'public.publish_performance_report(uuid,uuid,jsonb,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.publish_performance_report(uuid,uuid,jsonb,text,text)', 'execute') then
    raise exception 'M130: the publication RPC must never be browser-executable';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'performance_report'
     and cmd in ('INSERT','UPDATE','DELETE');
  if v_n <> 0 then
    raise exception 'M130: performance_report must have NO write policy — the actions are the boundary, found %', v_n;
  end if;

  -- Role-relative (migrations run before the seed).
  select count(*) into v_role from public.role where code = 'PERFORMANCE_PUBLISHER';
  select count(*) into v_n
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'PERFORMANCE_PUBLISHER' and p.code = 'performance:report:publish';
  if v_n <> v_role then
    raise exception 'M130: expected % publisher grant(s), got %', v_role, v_n;
  end if;

  -- THE SEPARATION: publishing is held by the publisher role alone, and the
  -- publisher role holds nothing else. Reading performance must not imply
  -- publishing the company's record of a period.
  select count(*), min(r.code) into v_n, v_extra
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'performance:report:publish' and r.code <> 'PERFORMANCE_PUBLISHER';
  if v_n <> 0 then
    raise exception 'M130: % role(s) other than PERFORMANCE_PUBLISHER may publish (e.g. %)', v_n, v_extra;
  end if;

  select count(*), min(p.code) into v_n, v_extra
    from public.role_permission rp
    join public.role r on r.id = rp.role_id
    join public.permission p on p.id = rp.permission_id
   where r.code = 'PERFORMANCE_PUBLISHER'
     and p.code not in ('profile:read:self', 'profile:update:self', 'performance:report:publish');
  if v_n <> 0 then
    raise exception 'M130: PERFORMANCE_PUBLISHER holds % extra permission(s) (e.g. %) — it publishes, it does not administer', v_n, v_extra;
  end if;

  raise notice 'M130 OK: performance_report created, frozen after publication; report capabilities catalogued; PERFORMANCE_PUBLISHER holds publication and nothing else';
end $$;
