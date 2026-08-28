-- Behaviour test — Slice 1: the management report lifecycle and its freeze.
-- Non-destructive (BEGIN/ROLLBACK).
-- ---------------------------------------------------------------------------
-- Proves in the DATABASE what the application only promises:
--   * the report table, its statuses and its no-write-policy shape
--   * a report cannot be published from BROUILLON — only from PRÊT POUR REVUE
--   * an actor without performance:report:publish is refused by the RPC
--   * a cross-tenant actor is refused
--   * a legitimate publisher publishes, and published_at is DATABASE time
--   * a published report is FROZEN: every substantive UPDATE raises
--   * a published report cannot be DELETED
--   * the artifact may be attached exactly once, and never revised
--   * a published report cannot exist without its snapshot (CHECK)
--   * a second publication is refused
--   * drafting and publishing are separate capabilities held by separate roles
--   * cross-tenant reports are invisible under RLS
--
-- Requires all migrations + seed applied. Run like the other suites.

begin;

create temp table _r (check_name text, value int) on commit drop;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fb001', 'rep-drafter@test.local'),
  ('00000000-0000-0000-0000-0000000fb002', 'rep-publisher@test.local'),
  ('00000000-0000-0000-0000-0000000fb003', 'rep-xtenant@test.local')
on conflict (id) do nothing;

insert into public.organization (id, name, country) values
  ('00000000-0000-0000-0000-0000000fb0b2', 'REP Tenant B', 'SN')
on conflict (id) do nothing;

insert into public.app_user (id, tenant_id, email, status) values
  ('00000000-0000-0000-0000-0000000fb001', '00000000-0000-0000-0000-000000000001', 'rep-drafter@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000fb002', '00000000-0000-0000-0000-000000000001', 'rep-publisher@test.local', 'active'),
  ('00000000-0000-0000-0000-0000000fb003', '00000000-0000-0000-0000-0000000fb0b2', 'rep-xtenant@test.local', 'active')
on conflict (id) do nothing;

-- Tenant B gets its own publisher role, so its refusal below proves TENANT
-- isolation rather than a missing permission.
insert into public.role (id, tenant_id, code, label_fr) values
  ('00000000-0000-0000-0000-0000000fb0c3', '00000000-0000-0000-0000-0000000fb0b2', 'REP_PUBLISHER_B', 'Publication B (test)')
on conflict (tenant_id, code) do nothing;
insert into public.role_permission (role_id, permission_id)
select '00000000-0000-0000-0000-0000000fb0c3', p.id from public.permission p
 where p.code in ('performance:read', 'performance:report:publish')
on conflict do nothing;

-- The drafter and the publisher each hold the REAL seeded access roles.
insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000fb001', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'PERFORMANCE_MANAGEMENT'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id)
select '00000000-0000-0000-0000-0000000fb002', r.id, '00000000-0000-0000-0000-000000000001'
from public.role r
where r.tenant_id = '00000000-0000-0000-0000-000000000001' and r.code = 'PERFORMANCE_PUBLISHER'
on conflict do nothing;

insert into public.user_role (user_id, role_id, tenant_id) values
  ('00000000-0000-0000-0000-0000000fb003', '00000000-0000-0000-0000-0000000fb0c3', '00000000-0000-0000-0000-0000000fb0b2')
on conflict do nothing;

insert into public.performance_report
  (id, tenant_id, title, period_kind, period_start, period_end, period_label, created_by)
values
  ('00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-000000000001',
   'Rapport de Performance — test', 'MONTH', '2026-08-01', '2026-08-31', 'aout 2026',
   '00000000-0000-0000-0000-0000000fb001'),
  ('00000000-0000-0000-0000-0000000fb0e2', '00000000-0000-0000-0000-0000000fb0b2',
   'Rapport tenant B', 'MONTH', '2026-08-01', '2026-08-31', 'aout 2026',
   '00000000-0000-0000-0000-0000000fb003')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. Shape and separation of authority.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname='public' and tablename='performance_report';
  insert into _r values ('exactly_one_policy', n);
  if n <> 1 then raise exception 'REP FAIL: expected 1 policy, found %', n; end if;

  select count(*) into n from pg_policies
   where schemaname='public' and tablename='performance_report'
     and cmd in ('INSERT','UPDATE','DELETE');
  insert into _r values ('no_write_policy', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'REP FAIL: % write policy(ies) on performance_report', n; end if;

  -- Drafting and publishing are held by DIFFERENT roles.
  select count(*) into n
    from public.role r
    join public.role_permission rp on rp.role_id = r.id
    join public.permission p on p.id = rp.permission_id
   where p.code = 'performance:report:publish'
     and r.tenant_id = '00000000-0000-0000-0000-000000000001'
     and r.code <> 'PERFORMANCE_PUBLISHER';
  insert into _r values ('publish_held_by_publisher_role_only', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'REP FAIL: % other role(s) may publish', n; end if;

  -- The drafter genuinely cannot publish.
  select count(*) into n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fb001'
     and p.code = 'performance:report:publish';
  insert into _r values ('drafter_cannot_publish', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'REP FAIL: the drafter holds publication authority'; end if;

  -- …and the publisher gains no wider performance or operational access.
  select count(*) into n
    from public.user_role ur
    join public.role_permission rp on rp.role_id = ur.role_id
    join public.permission p on p.id = rp.permission_id
   where ur.user_id = '00000000-0000-0000-0000-0000000fb002'
     and p.code in ('performance:read', 'performance:manage', 'performance:report:create',
                    'hr:manage', 'customs:update', 'customs:validate', 'finance:read',
                    'process:close', 'admin:users:manage');
  insert into _r values ('publisher_gains_nothing_else', case when n=0 then 1 else 0 end);
  if n <> 0 then raise exception 'REP FAIL: the publisher role leaked % permission(s)', n; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Publication refuses the wrong state and the wrong actor.
-- ---------------------------------------------------------------------------
do $$
declare from_draft boolean := false; noperm boolean := false; xtenant boolean := false;
begin
  -- BROUILLON: a report must pass through review.
  begin
    perform public.publish_performance_report(
      '00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-0000000fb002',
      '{"parameterSetVersion":"2026.1"}'::jsonb, '2026.1', 'slice1-1');
  exception when others then from_draft := true; end;

  update public.performance_report set status = 'PRET_POUR_REVUE'
   where id = '00000000-0000-0000-0000-0000000fb0e1';

  -- The DRAFTER holds create, not publish.
  begin
    perform public.publish_performance_report(
      '00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-0000000fb001',
      '{"parameterSetVersion":"2026.1"}'::jsonb, '2026.1', 'slice1-1');
  exception when others then noperm := true; end;

  -- A publisher of ANOTHER tenant.
  begin
    perform public.publish_performance_report(
      '00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-0000000fb003',
      '{"parameterSetVersion":"2026.1"}'::jsonb, '2026.1', 'slice1-1');
  exception when others then xtenant := true; end;

  insert into _r values ('cannot_publish_from_draft', case when from_draft then 1 else 0 end),
                        ('drafter_refused_by_rpc', case when noperm then 1 else 0 end),
                        ('cross_tenant_publish_refused', case when xtenant then 1 else 0 end);
  if not (from_draft and noperm and xtenant) then
    raise exception 'REP guard FAIL: draft=% noperm=% xtenant=%', from_draft, noperm, xtenant;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. A legitimate publication, with DATABASE time.
-- ---------------------------------------------------------------------------
do $$
declare v_row record;
begin
  perform public.publish_performance_report(
    '00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-0000000fb002',
    '{"parameterSetVersion":"2026.1","activity":{"dossierCount":7}}'::jsonb, '2026.1', 'slice1-1');

  select * into v_row from public.performance_report
   where id = '00000000-0000-0000-0000-0000000fb0e1';

  insert into _r values
    ('published', case when v_row.status = 'PUBLIE' then 1 else 0 end),
    ('publisher_recorded', case when v_row.published_by = '00000000-0000-0000-0000-0000000fb002' then 1 else 0 end),
    ('snapshot_frozen', case when v_row.snapshot->'activity'->>'dossierCount' = '7' then 1 else 0 end),
    ('parameter_version_recorded', case when v_row.parameter_set_version = '2026.1' then 1 else 0 end),
    -- DATABASE time, proved by identity rather than by a window: the RPC writes
    -- now(), which is the TRANSACTION timestamp, so the stored value must equal
    -- this transaction's own. `clock_timestamp()` would have been the wrong
    -- comparison — now() is fixed at transaction start and therefore precedes
    -- any clock reading taken inside it.
    ('published_at_is_database_time',
     case when v_row.published_at = transaction_timestamp() then 1 else 0 end);

  if v_row.status <> 'PUBLIE' then raise exception 'REP FAIL: publication did not take'; end if;
  if v_row.published_at is distinct from transaction_timestamp() then
    raise exception 'REP FAIL: published_at is not the database transaction time (% vs %)',
      v_row.published_at, transaction_timestamp();
  end if;
end $$;

-- The structural half of the same guarantee: the RPC has no timestamp
-- parameter, so no caller CAN supply one — a wrong client clock has nothing to
-- reach through.
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'publish_performance_report'
     and pg_get_function_arguments(p.oid) ilike '%timestamp%';
  insert into _r values ('rpc_accepts_no_timestamp', case when n = 0 then 1 else 0 end);
  if n <> 0 then
    raise exception 'REP FAIL: the publication RPC accepts a timestamp argument';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Frozen. Every substantive write raises; delete raises.
-- ---------------------------------------------------------------------------
do $$
declare t boolean := false; sum_ boolean := false; snap boolean := false;
        stat boolean := false; pub boolean := false; del boolean := false; again boolean := false;
begin
  begin update public.performance_report set title = 'réécrit'
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then t := true; end;

  begin update public.performance_report set executive_summary = 'réécrit'
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then sum_ := true; end;

  begin update public.performance_report set snapshot = '{"activity":{"dossierCount":999}}'::jsonb
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then snap := true; end;

  begin update public.performance_report set status = 'BROUILLON'
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then stat := true; end;

  begin update public.performance_report set published_by = '00000000-0000-0000-0000-0000000fb001'
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then pub := true; end;

  begin delete from public.performance_report
         where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then del := true; end;

  -- A second publication is refused too.
  begin
    perform public.publish_performance_report(
      '00000000-0000-0000-0000-0000000fb0e1', '00000000-0000-0000-0000-0000000fb002',
      '{"x":1}'::jsonb, '2026.1', 'slice1-1');
  exception when others then again := true; end;

  insert into _r values
    ('frozen_title', case when t then 1 else 0 end),
    ('frozen_summary', case when sum_ then 1 else 0 end),
    ('frozen_snapshot', case when snap then 1 else 0 end),
    ('frozen_status', case when stat then 1 else 0 end),
    ('frozen_attribution', case when pub then 1 else 0 end),
    ('delete_refused', case when del then 1 else 0 end),
    ('second_publication_refused', case when again then 1 else 0 end);

  if not (t and sum_ and snap and stat and pub and del and again) then
    raise exception 'REP FREEZE FAIL: title=% summary=% snapshot=% status=% attribution=% delete=% again=%',
      t, sum_, snap, stat, pub, del, again;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The artifact attaches exactly once, and never changes.
-- ---------------------------------------------------------------------------
do $$
declare v_path text; second boolean := false;
begin
  update public.performance_report
     set artifact_storage_path = 'performance-reports/t/a.pdf',
         artifact_sha256 = 'abc123',
         artifact_renderer_version = 'perf-1',
         artifact_generated_at = now()
   where id = '00000000-0000-0000-0000-0000000fb0e1';

  select artifact_storage_path into v_path from public.performance_report
   where id = '00000000-0000-0000-0000-0000000fb0e1';
  insert into _r values ('artifact_attached_once', case when v_path is not null then 1 else 0 end);
  if v_path is null then raise exception 'REP FAIL: the artifact could not be attached'; end if;

  begin
    update public.performance_report set artifact_storage_path = 'performance-reports/t/b.pdf'
     where id = '00000000-0000-0000-0000-0000000fb0e1';
  exception when others then second := true; end;
  insert into _r values ('artifact_cannot_be_revised', case when second then 1 else 0 end);
  if not second then raise exception 'REP FAIL: the artifact of a frozen record was revised'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. A published report cannot exist without its snapshot.
-- ---------------------------------------------------------------------------
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.performance_report
      (tenant_id, title, period_kind, period_start, period_end, period_label, status, created_by)
    values ('00000000-0000-0000-0000-000000000001', 'sans preuve', 'MONTH',
            '2026-08-01', '2026-08-31', 'aout 2026', 'PUBLIE',
            '00000000-0000-0000-0000-0000000fb001');
  exception when check_violation then blocked := true; end;
  insert into _r values ('published_requires_evidence', case when blocked then 1 else 0 end);
  if not blocked then raise exception 'REP FAIL: a published report was created without a snapshot'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. RLS — measured under each role, recorded after reset.
-- ---------------------------------------------------------------------------
set local role authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000fb003', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.performance_report
   where tenant_id = '00000000-0000-0000-0000-000000000001';
  perform set_config('rep.xtenant', n::text, true);
  if n <> 0 then raise exception 'REP FAIL: cross-tenant report leak (% rows)', n; end if;
end $$;

-- The publisher holds no performance:read, so it cannot browse reports either.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000fb002', 'role', 'authenticated')::text, true);
do $$
declare n int;
begin
  select count(*) into n from public.performance_report;
  perform set_config('rep.publisher_reads', n::text, true);
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

insert into _r values
  ('cross_tenant_reports_invisible', case when current_setting('rep.xtenant')::int = 0 then 1 else 0 end),
  ('publisher_alone_reads_no_reports', case when current_setting('rep.publisher_reads')::int = 0 then 1 else 0 end);

select * from _r order by check_name;
rollback;
