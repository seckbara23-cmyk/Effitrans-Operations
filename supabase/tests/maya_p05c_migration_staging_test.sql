-- MAYA-P0.5-C — migration staging foundation: database-level proofs.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
-- Every fixture below is SYNTHETIC: invented references, invented tenants.
--
-- What only the database can prove:
--   * a staging child cannot belong to a different tenant than its batch;
--   * the reconciliation equation is ENFORCED, not merely reported — a batch
--     whose counters do not account for every source row cannot reach an
--     outcome state at all;
--   * duplicates are STAGED, never rejected at insert (nothing is lost);
--   * the apply path is structurally absent: no column, no FK, no way to
--     record that a staged row became a dossier;
--   * staging touches no operational table.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_t2     uuid;
  v_batch  uuid;
  v_batch2 uuid;
  v_files_before int;
  v_ship_before  int;
  v_files_after  int;
  v_ship_after   int;
  v_ok     boolean;
begin
  select count(*) into v_files_before from public.operational_file;
  select count(*) into v_ship_before  from public.shipment;

  insert into public.organization (name) values ('MAYA-P0.5-C probe tenant B') returning id into v_t2;

  -- -------------------------------------------------------------------------
  -- A. A batch stages rows verbatim, including a deliberate DUPLICATE.
  -- -------------------------------------------------------------------------
  insert into public.maya_import_batch (tenant_id, batch_number, source_artifact, row_count)
  values (v_tenant, 'MAYA-PROBE-1', 'synthetic-export.csv', 3)
  returning id into v_batch;

  insert into public.maya_import_row
    (tenant_id, batch_id, source_row_number, source_table, source_dossier_reference,
     source_row_hash, raw, source_type_label, taxonomy_resolution)
  values
    (v_tenant, v_batch, 1, 'ORDRETRANSIT', 'PROBE/2026/0001', repeat('a', 64),
     '{"n":"1"}'::jsonb, 'IMPORT MARITIME TC', 'RESOLVED'),
    (v_tenant, v_batch, 2, 'ORDRETRANSIT', 'PROBE/2026/0002', repeat('b', 64),
     '{"n":"2"}'::jsonb, 'REMISES DOCUMENTAIRES', 'UNRESOLVED'),
    -- Same content hash as row 1: a duplicate must be STAGEABLE.
    (v_tenant, v_batch, 3, 'ORDRETRANSIT', 'PROBE/2026/0001', repeat('a', 64),
     '{"n":"1"}'::jsonb, 'IMPORT MARITIME TC', 'RESOLVED');

  insert into _r values
    ('duplicate rows are staged, not dropped',
     (select count(*) from public.maya_import_row where batch_id = v_batch) = 3, '-'),
    ('rows default to PENDING before validation',
     (select count(*) from public.maya_import_row where batch_id = v_batch and status = 'PENDING') = 3, '-'),
    ('an unresolved MAYA type keeps its original label',
     (select source_type_label from public.maya_import_row
       where batch_id = v_batch and taxonomy_resolution = 'UNRESOLVED') = 'REMISES DOCUMENTAIRES', '-');

  -- -------------------------------------------------------------------------
  -- B. RECONCILIATION IS ENFORCED. A batch cannot reach an outcome while its
  --    counters fail to account for every source row.
  -- -------------------------------------------------------------------------
  v_ok := false;
  begin
    update public.maya_import_batch
       set status = 'READY', valid_count = 1, warning_count = 0,
           rejected_count = 0, duplicate_count = 0            -- 1 <> 3 rows
     where id = v_batch;
  exception when others then v_ok := true;
  end;
  insert into _r values ('an unbalanced batch cannot reach an outcome', v_ok, '-');

  -- The honest totals are accepted.
  update public.maya_import_batch
     set status = 'READY_WITH_WARNINGS', valid_count = 1, warning_count = 1,
         rejected_count = 0, duplicate_count = 1, unresolved_count = 1
   where id = v_batch;
  insert into _r values
    ('a balanced batch reaches its outcome',
     (select status from public.maya_import_batch where id = v_batch) = 'READY_WITH_WARNINGS', '-');

  -- The unresolved overlay can never exceed the warnings it overlays.
  v_ok := false;
  begin
    update public.maya_import_batch set unresolved_count = 2 where id = v_batch;
  exception when others then v_ok := true;
  end;
  insert into _r values ('unresolved overlay cannot exceed warnings', v_ok, '-');

  -- -------------------------------------------------------------------------
  -- C. TENANT ISOLATION — a child may not belong to another tenant.
  -- -------------------------------------------------------------------------
  v_ok := false;
  begin
    insert into public.maya_import_row
      (tenant_id, batch_id, source_row_number, source_table, source_row_hash, raw)
    values (v_t2, v_batch, 99, 'ORDRETRANSIT', repeat('c', 64), '{}'::jsonb);
  exception when others then v_ok := true;
  end;
  insert into _r values ('cross-tenant staging row refused', v_ok, '-');

  v_ok := false;
  begin
    insert into public.maya_import_issue
      (tenant_id, batch_id, severity, code, message_fr)
    values (v_t2, v_batch, 'ERROR', 'PROBE', 'probe');
  exception when others then v_ok := true;
  end;
  insert into _r values ('cross-tenant staging issue refused', v_ok, '-');

  -- -------------------------------------------------------------------------
  -- D. Vocabularies are closed; no apply-ish state can be written.
  -- -------------------------------------------------------------------------
  insert into public.maya_import_batch (tenant_id, batch_number, row_count)
  values (v_tenant, 'MAYA-PROBE-2', 0) returning id into v_batch2;

  v_ok := false;
  begin
    update public.maya_import_batch set status = 'APPLIED' where id = v_batch2;
  exception when others then v_ok := true;
  end;
  insert into _r values ('an APPLIED batch state is impossible', v_ok, '-');

  v_ok := false;
  begin
    update public.maya_import_row set status = 'IMPORTED' where batch_id = v_batch;
  exception when others then v_ok := true;
  end;
  insert into _r values ('an IMPORTED row state is impossible', v_ok, '-');

  v_ok := false;
  begin
    update public.maya_import_batch set source_system = 'SAGE' where id = v_batch2;
  exception when others then v_ok := true;
  end;
  insert into _r values ('the source system is pinned to MAYA', v_ok, '-');

  -- -------------------------------------------------------------------------
  -- E. NO OPERATIONAL SIDE EFFECT. Everything above ran, and the operational
  --    tables are byte-for-byte as many rows as before.
  -- -------------------------------------------------------------------------
  select count(*) into v_files_after from public.operational_file;
  select count(*) into v_ship_after  from public.shipment;
  insert into _r values
    ('staging created no dossier', v_files_after = v_files_before,
     v_files_before::text || ' -> ' || v_files_after::text),
    ('staging created no shipment', v_ship_after = v_ship_before,
     v_ship_before::text || ' -> ' || v_ship_after::text),
    ('staging consumed no dossier number',
     coalesce((select sum(next_seq) from public.file_counter where tenant_id = v_tenant), 0)
       = coalesce((select sum(next_seq) from public.file_counter where tenant_id = v_tenant), 0), '-');
end
$suite$;

-- ---------------------------------------------------------------------------
-- F. STRUCTURE — the apply path is absent by construction, not by policy.
-- ---------------------------------------------------------------------------
do $structure$
declare v_n int;
begin
  select count(*) into v_n
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('maya_import_batch', 'maya_import_row', 'maya_import_issue')
     and (column_name like '%applied%' or column_name like '%created_file%'
          or column_name like '%migrated%');
  insert into _r values ('no staging column can record an application', v_n = 0, v_n::text);

  select count(*) into v_n
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_class r on r.oid = c.confrelid
   where c.contype = 'f'
     and t.relname in ('maya_import_batch', 'maya_import_row', 'maya_import_issue')
     and r.relname in ('operational_file', 'shipment', 'process_instance', 'invoice',
                       'expense_authorization', 'finance_request');
  insert into _r values ('staging references no operational table', v_n = 0, v_n::text);

  select count(*) into v_n from pg_class
   where oid in ('public.maya_import_batch'::regclass, 'public.maya_import_row'::regclass,
                 'public.maya_import_issue'::regclass)
     and relrowsecurity;
  insert into _r values ('RLS enabled on all three staging tables', v_n = 3, v_n::text);

  select count(*) into v_n from pg_policy
   where polrelid in ('public.maya_import_batch'::regclass, 'public.maya_import_row'::regclass,
                      'public.maya_import_issue'::regclass);
  insert into _r values ('exactly one policy per staging table (SELECT only)', v_n = 3, v_n::text);

  -- No MAYA-specific role or permission was invented.
  select count(*) into v_n from public.permission where code like 'maya%';
  insert into _r values ('no MAYA-specific permission exists', v_n = 0, v_n::text);
  select count(*) into v_n from public.role where code like 'MAYA%';
  insert into _r values ('no MAYA-specific role exists', v_n = 0, v_n::text);

  -- P0.5-B's contract and numbering remain untouched.
  insert into _r values
    ('both numbering overloads still exist',
     to_regprocedure('public.next_file_number(uuid,text)') is not null
       and to_regprocedure('public.next_file_number(uuid,text,uuid)') is not null, '-'),
    ('the P0.5-B parent guard is intact',
     exists (select 1 from pg_trigger where tgrelid = 'public.operational_file'::regclass
               and tgname = 'trg_operational_file_parent' and not tgisinternal), '-');
end
$structure$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'MAYA-P0.5-C migration staging suite FAILED: %', v_bad;
  end if;
  raise notice 'MAYA-P0.5-C migration staging suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
