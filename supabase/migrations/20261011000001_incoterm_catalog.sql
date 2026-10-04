-- ===========================================================================
-- Migration 149 — INCOTERM-CATALOG-01: the Incoterm becomes a governed value,
-- and gets its own contractual place.
-- ===========================================================================
-- WHAT THIS CLOSES. `shipment.incoterm` has been free text since migration 2.
-- Operations could type anything into it — a lowercase code, a sentence, a
-- typo — and the dossier would carry it downstream to Transit as though it were
-- a commercial fact. Its two neighbours on the same table are already governed:
-- `transport_mode` by shipment_transport_mode_check and `cargo_form` by
-- shipment_cargo_form_check. This brings the third into line with them.
--
-- AND IT ADDS THE PLACE THE TERM IS MEANINGLESS WITHOUT. « CIF » alone does not
-- state a contract; « CIF Dakar » does. There was nowhere to record that, and
-- the available columns are all the wrong fact:
--
--   origin / destination          the shipment ROUTE (and the intake requirement)
--   origin_port_id / airport_id   TMS-2 geographic anchors for the tracking planes
--   carrier_name, vessel_or_flight, bl_awb_ref   carriage identity
--
-- The Incoterm place is a CONTRACTUAL location agreed between buyer and seller.
-- It can equal the destination and frequently does; it is still a different
-- fact, and overloading either column would make two meanings share one value
-- and then disagree. So it gets its own nullable column.
--
-- SAFE ON EXISTING ROWS, AUDITED BEFORE IT WAS WRITTEN. Adding a CHECK to an
-- EXISTING column validates every row and fails if any violates — unlike
-- migration 118's numeric checks, which could not fail because their columns
-- were brand new. So production was audited read-only first:
--
--   14 shipment rows · 9 incoterm NULL · 5 set: CIF x4, CIP x1
--   rows a canonical CHECK would reject ......... 0
--   values needing case/whitespace normalisation  0
--   empty strings ............................... 0
--
-- and supabase/seed.sql, every supabase/tests suite and every journey fixture
-- carry no incoterm value at all, so the clean stack has nothing to violate it
-- either. No data is rewritten by this migration: it writes no row.
--
-- NOT A CATALOGUE TABLE, deliberately. Eleven values fixed by Incoterms® 2020,
-- with no tenant extensibility, no metadata and no lifecycle. A table would
-- bring RLS, grants, seed rows and a foreign key to express a list the ICC owns;
-- the repository's own pattern for this shape is a CHECK mirrored by an
-- application constant (lib/files/incoterms.ts), exactly as cargo_form does.
--
-- RECORDS A FACT, CHANGES NO BEHAVIOUR. No policy, no permission, no function,
-- no trigger, no workflow step, no service scope, no assignment, no handoff, no
-- status. « Services demandés » remains the only authority on what Effitrans was
-- contracted to perform, and nothing may derive a step, a service or a
-- responsibility from an Incoterm.
--
-- NOTHING BECOMES MANDATORY. Both columns are nullable, and the CHECK is written
-- `incoterm is null or incoterm in (...)` so an absent Incoterm stays valid —
-- which is what 9 of the 14 existing shipments rely on.
-- ===========================================================================

alter table public.shipment
  -- The contractual place the term attaches to — « CIF Dakar », « FOB
  -- Shanghai ». Free text, like origin/destination: it is a named place as
  -- written in the contract, not a referential entity, and TMS-2's port and
  -- airport anchors already exist for the geography that needs identity.
  add column if not exists incoterm_place text;

do $incoterm_checks$
begin
  if not exists (select 1 from pg_constraint where conname = 'shipment_incoterm_check') then
    alter table public.shipment add constraint shipment_incoterm_check
      check (incoterm is null or incoterm in
             ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF',
              'CPT', 'CIP', 'DPU', 'DAP', 'DDP'));
  end if;
end
$incoterm_checks$;

comment on column public.shipment.incoterm is
  'Incoterms(R) 2020 code, governed by shipment_incoterm_check and mirrored by '
  'INCOTERMS in lib/files/incoterms.ts. The commercial condition between buyer '
  'and seller. NEVER a workflow, service-scope or responsibility input: '
  '"Services demandes" is the only authority on what Effitrans performs.';

comment on column public.shipment.incoterm_place is
  'The named place or port the Incoterm attaches to — "CIF Dakar", "FOB '
  'Shanghai". Contractual location, deliberately distinct from the route '
  '(origin/destination), from the TMS-2 port/airport anchors and from carriage '
  'identity. Free text, optional, and meaningless without a code.';

-- ------------------------------------------------------- self-assertions ----
-- Apply-time only, and written so they hold on an EMPTY database: this migration
-- runs before supabase/seed.sql, so it must assert nothing about seeded roles,
-- tenants, clients or dossiers. Everything below is a statement about the SCHEMA
-- plus one statement about whatever rows happen to exist.
do $$
declare
  v_def text;
  v_violations int;
  v_place_nullable text;
  v_incoterm_nullable text;
  v_code text;
begin
  -- 1. the column exists, as nullable text
  select is_nullable into v_place_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'shipment' and column_name = 'incoterm_place';
  if v_place_nullable is null then
    raise exception 'M149: shipment.incoterm_place was not created';
  end if;
  if v_place_nullable <> 'YES' then
    raise exception 'M149: shipment.incoterm_place must stay nullable — the place is optional';
  end if;

  -- 2. the Incoterm itself stays OPTIONAL. Nine of the fourteen existing
  --    shipments have none, and no business rule makes it mandatory.
  select is_nullable into v_incoterm_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'shipment' and column_name = 'incoterm';
  if v_incoterm_nullable <> 'YES' then
    raise exception 'M149: shipment.incoterm must stay nullable — this slice makes it governed, not mandatory';
  end if;

  -- 3. the constraint exists and names EVERY one of the eleven codes. Checked
  --    one by one: a constraint that silently lost a code would leave that
  --    Incoterm unusable while every other assertion passed.
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'shipment' and c.conname = 'shipment_incoterm_check';
  if v_def is null then
    raise exception 'M149: shipment_incoterm_check does not exist';
  end if;

  foreach v_code in array array['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP']
  loop
    if v_def not like '%''' || v_code || '''%' then
      raise exception 'M149: shipment_incoterm_check does not admit %', v_code;
    end if;
  end loop;

  -- …and it admits NULL, or an Incoterm-less dossier could no longer be saved.
  if v_def not like '%IS NULL%' then
    raise exception 'M149: shipment_incoterm_check must allow a null incoterm';
  end if;

  -- …and it governs the CODE only. Constraining the free-text place would be a
  -- business rule this slice deliberately does not invent.
  if v_def like '%incoterm_place%' then
    raise exception 'M149: the named place must not be constrained in this slice';
  end if;

  -- 4. nothing in the table violates it. The ALTER above would already have
  --    failed, so this is belt and braces — and it is the number the audit
  --    predicted, stated out loud in the log.
  select count(*) into v_violations
  from public.shipment
  where incoterm is not null
    and incoterm not in ('EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DPU','DAP','DDP');
  if v_violations <> 0 then
    raise exception 'M149: % shipment row(s) hold a non-canonical incoterm', v_violations;
  end if;

  raise notice 'M149 OK: shipment_incoterm_check admits all 11 codes and null; incoterm_place added (nullable); % row(s) violate nothing', v_violations;
end $$;
