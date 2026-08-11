-- MAYA-P0.5-B — dossier fact convergence: database-level proofs.
-- Non-destructive (BEGIN/ROLLBACK). Requires all migrations + seed applied.
--
-- What only the database can prove:
--   * a parent dossier in ANOTHER TENANT is refused, and so is a self-parent
--     and a cycle — the link cannot become a cross-tenant channel;
--   * the cargo declaration accepts what MAYA records for every dossier
--     shape, including a bulk/road dossier that has no container and no air
--     piece — the case that previously had nowhere to live;
--   * lineage is honest: a MAYA_IMPORT dossier without its original reference
--     is rejected, and the same legacy reference cannot be imported twice;
--   * BACKWARD COMPATIBILITY: an INSERT written the way every existing caller
--     writes it — no new column mentioned — still succeeds unchanged;
--   * the invariants this phase must NOT touch are intact: the four-value type
--     vocabulary the customs gates depend on, and both numbering overloads.

begin;

create temp table _r (check_name text, ok boolean, detail text) on commit drop;

do $suite$
declare
  v_tenant uuid := '00000000-0000-0000-0000-000000000001';
  v_t2     uuid;
  v_client uuid;
  v_client2 uuid;
  v_parent uuid;
  v_child  uuid;
  v_plain  uuid;
  v_other  uuid;
  v_num    text;
  v_ok     boolean;
begin
  select id into v_client from public.client where tenant_id = v_tenant limit 1;
  if v_client is null then
    insert into public.client (tenant_id, name) values (v_tenant, 'MAYA-P0.5-B probe client')
    returning id into v_client;
  end if;

  insert into public.organization (name) values ('MAYA-P0.5-B probe tenant B') returning id into v_t2;
  insert into public.client (tenant_id, name) values (v_t2, 'probe client B') returning id into v_client2;

  -- -------------------------------------------------------------------------
  -- A. BACKWARD COMPATIBILITY — the pre-existing insert shape still works and
  --    defaults are what every existing row will have.
  -- -------------------------------------------------------------------------
  v_num := public.next_file_number(v_tenant, 'IMP');
  insert into public.operational_file (tenant_id, file_number, type, client_id)
  values (v_tenant, v_num, 'IMP', v_client)
  returning id into v_plain;

  insert into _r values
    ('legacy-shaped insert still succeeds', v_plain is not null, v_num),
    ('provenance defaults to PLATFORM_NATIVE',
     (select provenance from public.operational_file where id = v_plain) = 'PLATFORM_NATIVE', '-'),
    ('new dossier facts default to NULL',
     (select parent_file_id is null and client_reference is null and on_behalf_of is null
             and processing_due_date is null and legacy_reference is null
        from public.operational_file where id = v_plain), '-'),
    ('numbering format unchanged', v_num like 'EFT-IMP-%', v_num);

  -- A shipment written the old way still works too.
  insert into public.shipment (tenant_id, file_id, transport_mode)
  values (v_tenant, v_plain, 'SEA');
  insert into _r values
    ('legacy-shaped shipment insert still succeeds',
     (select count(*) from public.shipment where file_id = v_plain) = 1, '-');

  -- -------------------------------------------------------------------------
  -- B. CARGO DECLARATION — the previously impossible case: a road/bulk dossier
  --    with no container and no air piece, describing its cargo.
  -- -------------------------------------------------------------------------
  insert into public.operational_file (tenant_id, file_number, type, client_id)
  values (v_tenant, public.next_file_number(v_tenant, 'TRP'), 'TRP', v_client)
  returning id into v_other;

  insert into public.shipment
    (tenant_id, file_id, transport_mode, cargo_form, quantity, quantity_unit,
     net_weight_kg, gross_weight_kg, volume_m3, package_count,
     goods_description, supplier_name, warehouse_entry_date)
  values
    (v_tenant, v_other, 'ROAD', 'BULK', 250.500, 'TONNE',
     250500.000, 251000.000, 320.750, 0,
     'Clinker en vrac', 'Fournisseur X', current_date);

  insert into _r values
    ('bulk/road cargo declaration accepted',
     (select quantity = 250.500 and cargo_form = 'BULK' and net_weight_kg = 250500.000
        from public.shipment where file_id = v_other), '-');

  -- Negative amounts are refused; the vocabulary is closed.
  v_ok := false;
  begin
    update public.shipment set net_weight_kg = -1 where file_id = v_other;
  exception when others then v_ok := true;
  end;
  insert into _r values ('negative weight refused', v_ok, '-');

  v_ok := false;
  begin
    update public.shipment set cargo_form = 'PALETTE' where file_id = v_other;
  exception when others then v_ok := true;
  end;
  insert into _r values ('unknown cargo form refused', v_ok, '-');

  -- -------------------------------------------------------------------------
  -- C. PARENT LINK — same tenant only, no self, no cycle.
  -- -------------------------------------------------------------------------
  insert into public.operational_file (tenant_id, file_number, type, client_id)
  values (v_tenant, public.next_file_number(v_tenant, 'IMP'), 'IMP', v_client)
  returning id into v_parent;

  insert into public.operational_file (tenant_id, file_number, type, client_id, parent_file_id)
  values (v_tenant, public.next_file_number(v_tenant, 'IMP'), 'IMP', v_client, v_parent)
  returning id into v_child;
  insert into _r values ('same-tenant parent accepted', v_child is not null, '-');

  v_ok := false;
  begin
    update public.operational_file set parent_file_id = v_child where id = v_child;
  exception when others then v_ok := true;
  end;
  insert into _r values ('self-parent refused', v_ok, '-');

  v_ok := false;
  begin
    -- parent -> child -> parent would close a loop.
    update public.operational_file set parent_file_id = v_child where id = v_parent;
  exception when others then v_ok := true;
  end;
  insert into _r values ('parent cycle refused', v_ok, '-');

  v_ok := false;
  begin
    insert into public.operational_file (tenant_id, file_number, type, client_id, parent_file_id)
    values (v_t2, 'EFT-IMP-2099-99999', 'IMP', v_client2, v_parent);
  exception when others then v_ok := true;
  end;
  insert into _r values ('cross-tenant parent refused', v_ok, '-');

  -- -------------------------------------------------------------------------
  -- D. LINEAGE — an import must carry its origin, and only once.
  -- -------------------------------------------------------------------------
  v_ok := false;
  begin
    insert into public.operational_file (tenant_id, file_number, type, client_id, provenance)
    values (v_tenant, public.next_file_number(v_tenant, 'IMP'), 'IMP', v_client, 'MAYA_IMPORT');
  exception when others then v_ok := true;
  end;
  insert into _r values ('MAYA_IMPORT without a legacy reference refused', v_ok, '-');

  insert into public.operational_file
    (tenant_id, file_number, type, client_id, provenance, legacy_reference)
  values
    (v_tenant, public.next_file_number(v_tenant, 'IMP'), 'IMP', v_client, 'MAYA_IMPORT', 'IMT2026/0250');

  v_ok := false;
  begin
    insert into public.operational_file
      (tenant_id, file_number, type, client_id, provenance, legacy_reference)
    values
      (v_tenant, public.next_file_number(v_tenant, 'IMP'), 'IMP', v_client, 'MAYA_IMPORT', 'IMT2026/0250');
  exception when others then v_ok := true;
  end;
  insert into _r values ('the same legacy dossier cannot be imported twice', v_ok, '-');

  v_ok := false;
  begin
    update public.operational_file set provenance = 'SAGE' where id = v_plain;
  exception when others then v_ok := true;
  end;
  insert into _r values ('unknown provenance refused', v_ok, '-');
end
$suite$;

-- ---------------------------------------------------------------------------
-- E. UNTOUCHED — what this phase promised not to change.
-- ---------------------------------------------------------------------------
do $untouched$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'operational_file_type_check';
  insert into _r values
    ('dossier type vocabulary is still exactly IMP/EXP/TRP/HND',
     v_def is not null and v_def like '%IMP%' and v_def like '%EXP%'
       and v_def like '%TRP%' and v_def like '%HND%' and v_def not like '%MARITIME%',
     coalesce(v_def, 'MISSING')),
    ('both numbering overloads still exist',
     to_regprocedure('public.next_file_number(uuid,text)') is not null
       and to_regprocedure('public.next_file_number(uuid,text,uuid)') is not null, '-'),
    ('file_state_transition is still append-only',
     exists (select 1 from pg_trigger
              where tgrelid = 'public.file_state_transition'::regclass
                and tgname = 'trg_fst_no_update' and not tgisinternal), '-'),
    ('shipment tenant guard still present',
     exists (select 1 from pg_trigger
              where tgrelid = 'public.shipment'::regclass
                and tgname = 'trg_shipment_tenant' and not tgisinternal), '-'),
    ('operational_file RLS still enabled',
     (select relrowsecurity from pg_class where oid = 'public.operational_file'::regclass), '-');
end
$untouched$;

select check_name, ok, detail from _r order by check_name;

do $verdict$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || detail || ')', ', ') into v_bad
    from _r where not ok;
  if v_bad is not null then
    raise exception 'MAYA-P0.5-B dossier convergence suite FAILED: %', v_bad;
  end if;
  raise notice 'MAYA-P0.5-B dossier convergence suite PASSED (% checks)', (select count(*) from _r);
end
$verdict$;

rollback;
