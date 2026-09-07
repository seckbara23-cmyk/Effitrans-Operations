-- OPS-SERVICE-SCOPE-01 (ratified 2026-09-07) — what Effitrans actually sells.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- ⚠⚠ NOT APPLIED. Written, verified and shipped alongside application code that
-- runs correctly WITHOUT it. Production remains at migration 138 plus this and
-- 20261001000001, both pending an explicit Effitrans decision. Nothing in the
-- deployed application requires this column to exist: `scopeFromRow` degrades
-- to the type-derived answer when `services` is absent or null, and the
-- creation form's service checkboxes are rendered only when the column is
-- actually there.
--
-- THE RATIFIED REQUIREMENT. A dossier does not automatically require every
-- Effitrans service. Three shapes must work: dédouanement only, transport only,
-- and both. A requirement belonging to a service Effitrans is not providing is
-- NOT_APPLICABLE — not missing, not pending, not blocked and not failed.
--
-- WHY A TEXT[] AND NOT TWO BOOLEANS OR AN ENUM. Effitrans sells two services
-- today and will sell more (entreposage, manutention, transit aérien…). Two
-- booleans would need a schema change and a code change per service; a Postgres
-- ENUM would need `ALTER TYPE … ADD VALUE`, which cannot run inside a
-- transaction block and would force this migration onto the psql executor. An
-- array of stable text codes extends by adding one code to the CHECK — additive,
-- transactional, and mirrored by `SERVICE_KEYS` in lib/process/service-scope.ts.
--
-- WHY NULL IS THE DEFAULT, AND WHY IT MUST STAY NULL FOR EXISTING ROWS. Twelve
-- production dossiers predate this column, and nothing in them records which
-- services were contracted. Backfilling would INVENT a commercial fact:
-- « this dossier has a customs_record » establishes that customs work exists,
-- never that transport was excluded. NULL means « never recorded », the
-- application derives what the dossier TYPE genuinely establishes and leaves
-- the rest UNKNOWN, and UNKNOWN removes no step from any dossier. The ratified
-- rule, exactly: do not invent it.
--
-- WHAT THIS DOES NOT DO. It grants nothing, revokes nothing, and adds no policy:
-- `operational_file` already carries its RLS, and a new column on an existing
-- table inherits it. It creates no trigger and no function. It is reversible by
-- dropping one column.

alter table public.operational_file
  add column if not exists services text[];

comment on column public.operational_file.services is
  'OPS-SERVICE-SCOPE-01 — the operational services Effitrans provides on this '
  'dossier, chosen at creation. NULL = never recorded (legacy); the application '
  'then derives what the dossier type establishes and leaves the rest UNKNOWN. '
  'An empty array is refused: a dossier with no service is not a dossier.';

-- Every element is a known service, and the array is never empty when present.
-- Named so a refusal says which rule it broke rather than « check constraint ».
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'operational_file_services_known'
      and conrelid = 'public.operational_file'::regclass
  ) then
    alter table public.operational_file
      add constraint operational_file_services_known check (
        services is null
        or (
          array_length(services, 1) >= 1
          and services <@ array['customs', 'transport']::text[]
        )
      );
  end if;
end $$;

-- APPLICATION-TIME ASSERTIONS. Assert the outcome rather than trusting the DDL.
do $$
declare
  n integer;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operational_file'
      and column_name = 'services'
      and data_type = 'ARRAY'
  ) then
    raise exception 'OPS-SERVICE-SCOPE-01: operational_file.services is missing or not an array';
  end if;

  -- NOTHING WAS BACKFILLED. If this ever fails, a scope was invented for a
  -- dossier nobody recorded one for, and the applicability evaluator would then
  -- remove steps on the strength of a guess.
  select count(*) into n from public.operational_file where services is not null;
  if n > 0 then
    raise exception 'OPS-SERVICE-SCOPE-01: % dossier(s) already carry a service scope — this migration must not backfill', n;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'operational_file_services_known'
      and conrelid = 'public.operational_file'::regclass
  ) then
    raise exception 'OPS-SERVICE-SCOPE-01: the services CHECK constraint was not created';
  end if;
end $$;
