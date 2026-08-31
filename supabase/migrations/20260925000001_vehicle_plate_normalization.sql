-- 20260925000001_vehicle_plate_normalization.sql
-- Effitrans Operations Platform — TMS-1B: normalized registration uniqueness.
-- ---------------------------------------------------------------------------
-- ADDITIVE, idempotent, forward-only. Migration 133. Governing audit:
-- docs/transport/tms-1b-preimplementation-audit.md (ada13e4) §3, APPROVED.
--
-- HOW THE DUPLICATE WAS BORN. Migration 117's uniqueness is
-- upper(btrim(registration)) — case- and outer-space-insensitive, but a hyphen
-- is a different vehicle. So « aa-605-mw » and « AA605MW » coexisted in
-- production as two rows for ONE physical truck, and the pair was only
-- untangled by hand (retire + governed delete, 2026-08-30, audited).
--
-- THE RULE, ratified: a registration's IDENTITY is its alphanumeric content,
-- case-insensitively. Separators — hyphens, spaces, dots, anything that is not
-- a letter or digit — are formatting. AA605MW ≡ aa605mw ≡ AA-605-MW ≡
-- AA 605 MW: one vehicle, whatever the keyboard did.
--
-- WHAT IS **NOT** DONE:
--   * stored registrations are NOT rewritten — the typed form stays the
--     display form; only the COMPARISON normalizes. AA605MW and every
--     historical row are untouched, byte for byte.
--   * no row is deleted or merged. If two rows already collide under the new
--     rule, this migration REFUSES AND NAMES THEM — deciding which duplicate
--     is the real vehicle is an operator's judgment, never a script's.
--   * the 117 index survives: strictly weaker, harmless, and dropping it buys
--     nothing.
--
-- SCOPE — ALL ROWS, RETIRED INCLUDED, deliberately. A retired duplicate is
-- precisely the accident that started this: the fix for « my plate already
-- exists on a retired row » is to REACTIVATE that row, not to re-create the
-- vehicle. Accepted limitation (stated in the audit): a state-reassigned plate
-- whose old holder is retired needs the operator to distinguish the two in the
-- registration text.

-- ===========================================================================
-- 1. CENSUS FIRST — a code census is not a data census. If any two rows
--    collide under the new identity, fail DESCRIPTIVELY, listing every group,
--    and touch nothing. (Production 2026-08-31: 3 vehicles, 0 collisions,
--    verified read-only before this migration was written.)
-- ===========================================================================
do $$
declare
  v_groups text;
begin
  select string_agg(grp, ' | ') into v_groups
    from (
      select tenant_id::text || ' → [' || string_agg(registration, ', ' order by created_at) || ']' as grp
        from public.vehicle
       group by tenant_id, upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g'))
      having count(*) > 1
    ) c;
  if v_groups is not null then
    raise exception using message =
      'M133 REFUSED: these registrations are the SAME vehicle under normalized identity and an operator must resolve them first (reactivate/delete the duplicate — never this script): ' || v_groups;
  end if;
end $$;

-- ===========================================================================
-- 2. The normalized identity, unique per tenant, every row.
-- ===========================================================================
create unique index if not exists uq_vehicle_registration_normalized
  on public.vehicle (tenant_id, upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g')));

comment on index public.uq_vehicle_registration_normalized is
  'TMS-1B — a registration''s identity is its alphanumeric content, case-insensitive; separators are formatting. Covers retired rows: reactivate, never duplicate.';

-- ===========================================================================
-- 3. Self-assertions.
-- ===========================================================================
do $$
declare
  v_def text;
  v_n   int;
begin
  -- 3a. The normalized index exists and carries the exact identity expression.
  select indexdef into v_def from pg_indexes
   where schemaname = 'public' and indexname = 'uq_vehicle_registration_normalized';
  if v_def is null then
    raise exception 'M133: the normalized uniqueness index is missing';
  end if;
  if position('regexp_replace' in v_def) = 0 or position('upper' in lower(v_def)) = 0 then
    raise exception 'M133: the index does not normalize (got %)', v_def;
  end if;
  if position('UNIQUE' in upper(v_def)) = 0 then
    raise exception 'M133: the normalized index is not UNIQUE';
  end if;

  -- 3b. The 117 index survives — this migration only ADDS strictness.
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'uq_vehicle_registration') then
    raise exception 'M133: uq_vehicle_registration (117) disappeared — this migration must not weaken anything';
  end if;

  -- 3c. Zero collisions stand (the census above already guaranteed it; this
  --     re-checks AFTER index creation so a partial apply cannot lie).
  select count(*) into v_n from (
    select 1 from public.vehicle
     group by tenant_id, upper(regexp_replace(registration, '[^A-Za-z0-9]', '', 'g'))
    having count(*) > 1) c;
  if v_n <> 0 then
    raise exception 'M133: % normalized collision group(s) exist despite the unique index', v_n;
  end if;

  -- 3d. This migration wrote no vehicle data.
  --     (Structural: it contains no UPDATE/DELETE/INSERT on public.vehicle —
  --     asserted by vitest against the file; here we assert the row count is
  --     whatever it was, which a same-transaction xact check cannot see, so
  --     the data-untouched proof lives in the test suite.)

  raise notice 'M133 OK: normalized registration identity unique per tenant (all rows, retired included); census-first; stored text untouched';
end $$;
