-- ADMIN-USER-IDENTITY-01 (ratified 2026-09-07) — canonical staff identity.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- ⚠⚠ NOT APPLIED. Written, verified, and shipped alongside application code that
-- runs correctly WITHOUT it. Production remains at migration 138, plus
-- 20261001000001 (#139), 20261002000001 (#140) and this (#141) — all three
-- pending an explicit Effitrans decision.
--
-- THE REQUIREMENT. A System Administrator must be able to open Administration →
-- Users, select a user, and edit four facts: Prénom, Nom, Fonction, Titre
-- principal. Two of those can already be stored on schema 138 — the display name
-- on `app_user.name` and the title on `workforce_profile.job_title`, which is
-- populated for 30 of 32 profiles and already feeds the Digital Business Card,
-- the e-mail signature and generated documents. The other two cannot, and this
-- is what makes them possible.
--
-- WHY `workforce_profile` AND NOT A NEW TABLE. It is already the staff
-- professional profile: keyed by `user_id`, already carrying the title, the
-- phones, the photo, the signature variant and the card token, and already read
-- by every branding surface. A new table would be a fourth identity authority
-- beside `app_user`, `workforce_profile` and HR's `employee` — which is exactly
-- what the ratification forbids.
--
-- WHY NOT HR's `employee`, WHICH ALREADY HAS first_name/last_name. Because it is
-- a different object with a different lifecycle: an employee number, a hire
-- date, a termination date, and no requirement to have a login at all. Three
-- rows exist; two are linked to an `app_user`, and BOTH disagree with that
-- user's name today. Making HR the authority for login identity would either
-- rename two live accounts on apply or require a reconciliation nobody has
-- ruled on (RQ-ID-1). This migration touches no HR table.
--
-- ── WHY `staff_function` AND NOT `function` ────────────────────────────────
-- `FUNCTION` is a reserved word in PostgreSQL. A quoted "function" column works
-- and then has to be quoted in every query, view and generated type forever;
-- one unquoted reference is a syntax error at the worst moment.
--
-- ── AND WHY IT IS NOT `department` ─────────────────────────────────────────
-- Ratified as distinct concepts. `employee.department` (HR) and
-- ROLE_CANONICAL_DEPARTMENT (derived from roles) both already exist and neither
-- is touched here. Fonction answers « what does this person do », department
-- answers « which part of the company are they in », and the brief's own example
-- has them differ: department Transit, fonction Douane, titre Déclarant en
-- Douane.
--
-- WHAT THIS DOES NOT DO. It grants nothing, revokes nothing, adds no policy, no
-- trigger and no function. `workforce_profile` already carries its RLS and a new
-- column inherits it. Nothing is backfilled: a title is not invented from a role
-- and a name is not split on whitespace. Reversible by dropping three columns.

alter table public.workforce_profile
  add column if not exists first_name     text,
  add column if not exists last_name      text,
  add column if not exists staff_function text;

comment on column public.workforce_profile.first_name is
  'ADMIN-USER-IDENTITY-01 — canonical given name. NULL = never recorded; the '
  'application then falls back to app_user.name and finally to the e-mail. '
  'Never inferred by splitting an existing display name.';
comment on column public.workforce_profile.last_name is
  'ADMIN-USER-IDENTITY-01 — canonical family name. Same fallback rule.';
comment on column public.workforce_profile.staff_function is
  'ADMIN-USER-IDENTITY-01 — « Fonction »: the organisational function (Opérations, '
  'Transit, Douane…). NOT the department, NOT a role, and it grants no permission. '
  'Named staff_function because FUNCTION is a reserved word.';

-- Length only. A pattern that "looks like a name" is a pattern that rejects
-- somebody real: Senegalese names carry particles, apostrophes, hyphens and
-- multiple given names. Blank strings are refused so « recorded as empty » and
-- « never recorded » cannot both exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workforce_profile_identity_shape'
      and conrelid = 'public.workforce_profile'::regclass
  ) then
    alter table public.workforce_profile
      add constraint workforce_profile_identity_shape check (
        (first_name     is null or (btrim(first_name)     <> '' and length(first_name)     <= 120))
        and (last_name      is null or (btrim(last_name)      <> '' and length(last_name)      <= 120))
        and (staff_function is null or (btrim(staff_function) <> '' and length(staff_function) <= 120))
      );
  end if;
end $$;

-- APPLICATION-TIME ASSERTIONS. Assert the outcome rather than trusting the DDL.
do $$
declare
  n integer;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'workforce_profile'
     and column_name in ('first_name', 'last_name', 'staff_function')
     and is_nullable = 'YES' and column_default is null;
  if n <> 3 then
    raise exception 'ADMIN-USER-IDENTITY-01: expected 3 nullable, default-free identity columns, found %', n;
  end if;

  -- NOTHING WAS BACKFILLED. If this ever fails, a name was invented for somebody
  -- — split from a display name, or copied out of HR — and the platform would be
  -- asserting a family name nobody gave it.
  select count(*) into n from public.workforce_profile
   where first_name is not null or last_name is not null or staff_function is not null;
  if n > 0 then
    raise exception 'ADMIN-USER-IDENTITY-01: % profile(s) already carry identity values — this migration must not backfill', n;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'workforce_profile_identity_shape'
      and conrelid = 'public.workforce_profile'::regclass
  ) then
    raise exception 'ADMIN-USER-IDENTITY-01: the identity CHECK constraint was not created';
  end if;

  -- BLAST RADIUS: this migration must not have touched authority. `job_title`
  -- keeps its shape, and no permission row was added.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'workforce_profile'
       and column_name = 'job_title' and is_nullable = 'YES'
  ) then
    raise exception 'ADMIN-USER-IDENTITY-01: job_title changed shape — the title store must be untouched';
  end if;
end $$;
