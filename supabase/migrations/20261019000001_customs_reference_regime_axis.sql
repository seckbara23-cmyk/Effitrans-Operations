-- ===========================================================================
-- Migration 155 — CUSTOMS-REF-01A / REF-2: the regime axis, and nothing else.
-- ===========================================================================
-- WHAT THIS ADDS. One nullable-by-default array column, one normalising
-- trigger, one GIN index. It adds NO policy, NO permission, NO function that
-- writes a document, and it touches no column that governs publication. The
-- publication gate built by migrations 152–154 is untouched, and the verifier
-- for this migration asserts that it is.
--
-- WHY AN ARRAY AND NOT A COLUMN. A reference document is not scoped to one
-- customs regime. The Tarif Extérieur Commun applies across every regime; a
-- circular may address two or three; the Customs Code addresses all of them.
-- A single `customs_regime text` would force the uploader to pick one and
-- would make « which texts govern the mise en consommation? » unanswerable for
-- every document that governs more than one. So the axis is many-valued.
--
-- WHY FREE TEXT, NORMALISED, RATHER THAN A CHECKED VOCABULARY. There is no
-- canonical regime vocabulary anywhere in this platform to key on:
-- `customs_record.regime` — the operational declaration field — is itself
-- `text` with no constraint, and has been since 20260615000002. Inventing an
-- official code list here would mean this migration asserting a customs
-- vocabulary that the Direction Générale des Douanes, not Effitrans, defines,
-- and it would immediately disagree with the free text already recorded on
-- declarations. So entries are normalised to a stable shape and matched
-- exactly, and the controlled vocabulary is left as a decision for the customs
-- department — at which point a CHECK can be added over data that already
-- conforms.
--
-- WHY A TRIGGER AND NOT A CHECK. The shape this column needs — no NULL
-- elements, no blank entries, no duplicates, no case variants, a bounded
-- element length — is per-element, and a CHECK constraint cannot contain a
-- subquery, so `unnest` is unavailable to it. What a CHECK *can* express is
-- asserted as a CHECK; the rest is normalised in a BEFORE trigger. That
-- placement matters here beyond tidiness: every write to this table arrives
-- through the service role or a definer RPC, both of which bypass RLS, so the
-- database must normalise for itself rather than trust a caller to have done
-- it. 'mise en consommation', ' Mise En Consommation ' and
-- 'MISE EN CONSOMMATION' are one regime, and the column stores one form.
-- ===========================================================================

alter table public.customs_reference_document
  add column if not exists customs_regimes text[] not null default '{}'::text[];

comment on column public.customs_reference_document.customs_regimes is
  'CUSTOMS-REF-01A / REF-2. The customs regimes this document governs, normalised to upper case and de-duplicated by trg_customs_reference_regimes. Empty means "not regime-specific" (the Customs Code, the tariff), never "unknown". Free text by design: the platform has no canonical regime vocabulary — customs_record.regime is unconstrained text — so a CHECK here would assert a code list Effitrans does not own.';

-- What a CHECK can actually say: the column is present, and the array is
-- bounded, because an unbounded one is a denial-of-service surface on the GIN
-- index below.
--
-- NULL ELEMENTS ARE NOT CHECKED HERE, DELIBERATELY. The obvious spelling,
-- `array_position(customs_regimes, null) is null`, cannot be used: a CHECK
-- constraint accepts only IMMUTABLE expressions, and `array_position` compares
-- elements with the type's default equality operator, which makes it STABLE
-- rather than immutable for a collatable element type like text. Postgres would
-- refuse to create the constraint. `cardinality` has no such problem.
--
-- Nothing is lost: `normalize_customs_reference_regimes` below coalesces every
-- element and drops the blanks, so a NULL element cannot survive a write to
-- this column at all. The trigger is the enforcement, not a convenience.
alter table public.customs_reference_document
  drop constraint if exists customs_reference_regimes_shape;
alter table public.customs_reference_document
  add constraint customs_reference_regimes_shape check (
    customs_regimes is not null
    and cardinality(customs_regimes) <= 24
  );

-- ---------------------------------------------------------------------------
-- Normalisation. Runs on INSERT and on any UPDATE that touches the column.
--
-- It REJECTS rather than truncates an over-long entry: silently storing a
-- shortened regime name would make the row searchable under a name nobody
-- typed, and a search axis that quietly rewrites its own values is worse than
-- one that refuses bad input.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_customs_reference_regimes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_too_long text;
begin
  if new.customs_regimes is null then
    new.customs_regimes := '{}'::text[];
    return new;
  end if;

  select r into v_too_long
    from unnest(new.customs_regimes) as t(raw)
   cross join lateral (select upper(btrim(coalesce(t.raw, ''))) as r) z
   where length(z.r) > 48
   limit 1;

  if v_too_long is not null then
    raise exception
      'customs_reference_document.customs_regimes: "%" exceeds 48 characters; a regime is a name, not a description',
      left(v_too_long, 60)
      using errcode = 'EFR02';
  end if;

  -- Trim, upper-case, drop blanks, de-duplicate, order. The ordering is what
  -- makes two rows carrying the same regimes compare equal as arrays.
  select coalesce(array_agg(distinct z.r order by z.r), '{}'::text[])
    into new.customs_regimes
    from unnest(new.customs_regimes) as t(raw)
   cross join lateral (select upper(btrim(coalesce(t.raw, ''))) as r) z
   where z.r <> '';

  return new;
end
$$;

comment on function public.normalize_customs_reference_regimes() is
  'CUSTOMS-REF-01A / REF-2. Normalises customs_regimes to trimmed, upper-cased, de-duplicated, ordered entries and rejects an entry over 48 characters. Enforced in the database because every writer to this table bypasses RLS.';

drop trigger if exists trg_customs_reference_regimes on public.customs_reference_document;
create trigger trg_customs_reference_regimes
  before insert or update of customs_regimes on public.customs_reference_document
  for each row execute function public.normalize_customs_reference_regimes();

-- Containment search: `customs_regimes @> array['MISE EN CONSOMMATION']`.
create index if not exists idx_customs_reference_regimes
  on public.customs_reference_document using gin (customs_regimes);
