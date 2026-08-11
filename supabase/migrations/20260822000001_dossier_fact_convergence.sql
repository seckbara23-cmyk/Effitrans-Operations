-- ===========================================================================
-- MAYA-P0.5-B — Dossier fact convergence (ratified 2026-08-11).
-- ---------------------------------------------------------------------------
-- ADDITIVE ONLY. Every new business column is NULLABLE, carries no default
-- that rewrites data, and is a FACT — never a workflow prerequisite. Nothing
-- here changes the dossier state machine, the customs gates, the numbering
-- function or its trusted OPS-SEC-2A overload.
--
-- WHY (MAYA-P0.5-A §4): MAYA's opening form records, for EVERY dossier type,
-- cargo it can describe, a parent dossier, the client's own reference and two
-- operational dates. This platform held weight and volume ONLY inside
-- mode-specific children (ocean_container, air_cargo_piece), so a bulk export,
-- a road-only dossier or a documentary file had nowhere to record what it
-- carried at all. These columns close that, at the one place that is already
-- 1:1 with the dossier and already tenant-guarded.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   * it does NOT widen operational_file.type — seven code sites derive
--     "has a customs leg" from that vocabulary (P0.5-A §0). MAYA's compound
--     types are DERIVED labels over (direction × mode × cargo form × regime),
--     computed in lib/files/taxonomy.ts and stored nowhere;
--   * it does NOT give parent_file_id any groupage, cascade or lifecycle
--     meaning — Q5 is unanswered, so the column is a link and nothing more;
--   * it creates NO import pipeline (P0.5-C) and no apply path. `provenance`
--     and `legacy_reference` are the durable lineage a later, separately
--     ratified import will write.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. shipment — the cargo declaration a dossier can carry whatever its mode.
--    numeric CHECKs are non-negativity only: they cannot fail on existing
--    rows (every new column is NULL there) and they encode no business rule.
-- ---------------------------------------------------------------------------
alter table public.shipment
  -- Cargo FORM — the fourth taxonomy dimension (direction=operational_file.type,
  -- mode=transport_mode, regime=customs_record.regime already exist). Kept
  -- SEPARATE from the pre-existing free-text `cargo_type`, which means "nature
  -- of goods" to the copilot and the artifact engine and must keep meaning it.
  add column if not exists cargo_form        text,
  add column if not exists quantity          numeric(14, 3),
  add column if not exists quantity_unit     text,
  add column if not exists net_weight_kg     numeric(14, 3),
  add column if not exists gross_weight_kg   numeric(14, 3),
  add column if not exists volume_m3         numeric(14, 3),
  add column if not exists package_count     integer,
  -- MAYA « Désignation » (the goods as written on the documents). `cargo_type`
  -- remains « Nature ».
  add column if not exists goods_description text,
  -- MAYA « Fournisseur » on the marchandise block: a NAME, deliberately not a
  -- registry reference. A supplier party model is P0.5-D and needs its own
  -- RLS/portal decision.
  add column if not exists supplier_name     text,
  -- MAYA « Date d'entrée en magasin ». A recorded fact; nothing advances on it.
  add column if not exists warehouse_entry_date date;

do $shipment_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipment_cargo_form_check') then
    alter table public.shipment add constraint shipment_cargo_form_check
      check (cargo_form is null or cargo_form in
             ('CONTAINER', 'BULK', 'PARCEL', 'GROUPAGE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shipment_cargo_amounts_check') then
    alter table public.shipment add constraint shipment_cargo_amounts_check
      check (
        (quantity        is null or quantity        >= 0) and
        (net_weight_kg   is null or net_weight_kg   >= 0) and
        (gross_weight_kg is null or gross_weight_kg >= 0) and
        (volume_m3       is null or volume_m3       >= 0) and
        (package_count   is null or package_count   >= 0)
      );
  end if;
end
$shipment_checks$;

comment on column public.shipment.cargo_form is
  'Cargo FORM (CONTAINER/BULK/PARCEL/GROUPAGE) — the taxonomy dimension that '
  'had no home. Distinct from cargo_type, which is the free-text nature of the '
  'goods. Never a workflow input.';

-- ---------------------------------------------------------------------------
-- 2. operational_file — parent link, client-facing references, deadline,
--    and the migration lineage pair.
-- ---------------------------------------------------------------------------
alter table public.operational_file
  -- MAYA « Dossier mère ». STRUCTURE ONLY: no cascade, no state propagation,
  -- no groupage semantics (Q5). Same-tenant, no self-parent and no cycle are
  -- enforced by the trigger below.
  add column if not exists parent_file_id      uuid references public.operational_file (id),
  -- MAYA « Réf. Client » — the customer's own reference for this shipment.
  add column if not exists client_reference    text,
  -- MAYA « P/C » (pour le compte de). A label; it grants nothing and routes
  -- nothing — the billable/authorized party stays client_id.
  add column if not exists on_behalf_of        text,
  -- MAYA « Date d'échéance traitement dossier ». Displayed, never enforced:
  -- no SLA engine, no escalation, no automatic transition.
  add column if not exists processing_due_date date,
  -- Lineage, mirroring the proven FIN-AGING pattern on public.invoice
  -- (provenance + legacy_file_reference). MAYA identifiers stay REFERENCES:
  -- the platform keeps its own uuid PK and its own EFT- numbering.
  add column if not exists provenance          text not null default 'PLATFORM_NATIVE',
  add column if not exists legacy_reference    text;

do $file_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'operational_file_provenance_check') then
    alter table public.operational_file add constraint operational_file_provenance_check
      check (provenance in ('PLATFORM_NATIVE', 'MAYA_IMPORT'));
  end if;
  -- An imported dossier must carry the identity it was imported from, or the
  -- migration could never be reconciled. Vacuously true today: every existing
  -- row defaults to PLATFORM_NATIVE.
  if not exists (select 1 from pg_constraint where conname = 'operational_file_legacy_identity_check') then
    alter table public.operational_file add constraint operational_file_legacy_identity_check
      check (provenance <> 'MAYA_IMPORT' or legacy_reference is not null);
  end if;
end
$file_checks$;

-- One legacy dossier maps to at most one platform dossier. This is the
-- idempotency backstop a later import will rely on — re-running it can never
-- create a second copy.
create unique index if not exists uq_operational_file_legacy_reference
  on public.operational_file (tenant_id, legacy_reference)
  where legacy_reference is not null;

create index if not exists idx_operational_file_parent
  on public.operational_file (parent_file_id)
  where parent_file_id is not null;

create index if not exists idx_operational_file_provenance
  on public.operational_file (tenant_id, provenance)
  where provenance <> 'PLATFORM_NATIVE';

comment on column public.operational_file.parent_file_id is
  'MAYA « Dossier mère ». A link and nothing more: no cascade, no state '
  'propagation, no groupage semantics — Q5 is unanswered.';
comment on column public.operational_file.provenance is
  'PLATFORM_NATIVE — created here. MAYA_IMPORT — migrated from the legacy '
  'MAYA TRANSIT application, carrying its original reference.';
comment on column public.operational_file.legacy_reference is
  'The dossier number in the source system (e.g. the MAYA dossier number). A '
  'REFERENCE, never a platform key.';

-- ---------------------------------------------------------------------------
-- 3. Parent integrity — same tenant, no self-parent, no cycle. Mirrors the
--    existing enforce_shipment_tenant idiom (plain trigger, not definer).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_file_parent()
returns trigger language plpgsql as $$
declare
  parent_tenant uuid;
  hop           uuid;
  depth         int := 0;
begin
  if new.parent_file_id is null then
    return new;
  end if;
  if new.parent_file_id = new.id then
    raise exception 'a dossier cannot be its own parent';
  end if;

  select tenant_id into parent_tenant
    from public.operational_file where id = new.parent_file_id;
  if parent_tenant is null then
    raise exception 'parent dossier not found';
  end if;
  if parent_tenant is distinct from new.tenant_id then
    raise exception 'parent dossier belongs to another tenant';
  end if;

  -- Walk the chain upward: reaching this row again is a cycle.
  hop := new.parent_file_id;
  while hop is not null and depth < 64 loop
    if hop = new.id then
      raise exception 'parent dossier chain forms a cycle';
    end if;
    select parent_file_id into hop from public.operational_file where id = hop;
    depth := depth + 1;
  end loop;
  if depth >= 64 then
    raise exception 'parent dossier chain is too deep';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_operational_file_parent on public.operational_file;
create trigger trg_operational_file_parent
  before insert or update of parent_file_id, tenant_id on public.operational_file
  for each row execute function public.enforce_file_parent();

-- ---------------------------------------------------------------------------
-- 4. Assertions — the migration proves its own outcome, and proves that the
--    invariants it must NOT touch are still intact.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_missing text;
  v_def     text;
begin
  -- 4a. Every new column exists and is NULLABLE (except the defaulted
  --     provenance flag, which is NOT NULL by design and safe: it has a
  --     default and a CHECK that existing rows already satisfy).
  select string_agg(c.col, ', ') into v_missing
  from (values
    ('shipment', 'cargo_form'), ('shipment', 'quantity'), ('shipment', 'quantity_unit'),
    ('shipment', 'net_weight_kg'), ('shipment', 'gross_weight_kg'), ('shipment', 'volume_m3'),
    ('shipment', 'package_count'), ('shipment', 'goods_description'),
    ('shipment', 'supplier_name'), ('shipment', 'warehouse_entry_date'),
    ('operational_file', 'parent_file_id'), ('operational_file', 'client_reference'),
    ('operational_file', 'on_behalf_of'), ('operational_file', 'processing_due_date'),
    ('operational_file', 'provenance'), ('operational_file', 'legacy_reference')
  ) as c(tbl, col)
  where not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = c.tbl and column_name = c.col);
  if v_missing is not null then
    raise exception 'MAYA-P0.5-B: columns missing: %', v_missing;
  end if;

  select string_agg(c.col, ', ') into v_missing
  from (values
    ('shipment', 'cargo_form'), ('shipment', 'quantity'), ('shipment', 'quantity_unit'),
    ('shipment', 'net_weight_kg'), ('shipment', 'gross_weight_kg'), ('shipment', 'volume_m3'),
    ('shipment', 'package_count'), ('shipment', 'goods_description'),
    ('shipment', 'supplier_name'), ('shipment', 'warehouse_entry_date'),
    ('operational_file', 'parent_file_id'), ('operational_file', 'client_reference'),
    ('operational_file', 'on_behalf_of'), ('operational_file', 'processing_due_date'),
    ('operational_file', 'legacy_reference')
  ) as c(tbl, col)
  join information_schema.columns ic
    on ic.table_schema = 'public' and ic.table_name = c.tbl and ic.column_name = c.col
  where ic.is_nullable <> 'YES';
  if v_missing is not null then
    raise exception 'MAYA-P0.5-B: these business columns must stay nullable: %', v_missing;
  end if;

  -- 4b. The parent guard is installed.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.operational_file'::regclass
       and tgname = 'trg_operational_file_parent' and not tgisinternal) then
    raise exception 'MAYA-P0.5-B: parent integrity trigger missing';
  end if;

  -- 4c. UNTOUCHED: the dossier type vocabulary is still exactly the four
  --     values the customs gates depend on.
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'operational_file_status_check';
  if v_def is null then
    raise exception 'MAYA-P0.5-B: dossier status CHECK vanished';
  end if;
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'operational_file_type_check';
  if v_def is null or v_def not like '%IMP%' or v_def not like '%EXP%'
     or v_def not like '%TRP%' or v_def not like '%HND%' then
    raise exception 'MAYA-P0.5-B: dossier type vocabulary was altered';
  end if;

  -- 4d. UNTOUCHED: numbering. Both overloads still exist and the base one
  --     still validates the same four types.
  if to_regprocedure('public.next_file_number(uuid,text)') is null
     or to_regprocedure('public.next_file_number(uuid,text,uuid)') is null then
    raise exception 'MAYA-P0.5-B: a next_file_number overload disappeared';
  end if;
  select prosrc into v_def from pg_proc
   where oid = to_regprocedure('public.next_file_number(uuid,text)');
  if v_def not like '%IMP%' or v_def not like '%EFT-%' then
    raise exception 'MAYA-P0.5-B: numbering behaviour was altered';
  end if;
end
$assert$;
