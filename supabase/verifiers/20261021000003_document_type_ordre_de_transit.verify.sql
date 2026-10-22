-- VERIFIER for 20261021000003_document_type_ordre_de_transit
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Returns EXACTLY ONE row:
-- (ok boolean, detail text).
--
-- WHAT IT DEFENDS. The row existing is the easy part. The quiet failures are a
-- type that became MANDATORY (required_for non-empty — it would appear as
-- missing on every import dossier and delay a customer notice) or one that
-- became VALIDITY-BEARING (every upload would demand an expiry date nobody
-- ratified). Both are asserted absent.
-- ===========================================================================
with t as (
  select code, label_fr, category, has_validity, required_for, active
    from public.document_type
   where code = 'ORDRE_DE_TRANSIT'
),
checks(label, ok) as (
  values
    ('exactly one ORDRE_DE_TRANSIT type exists and is active', (
      select count(*) = 1 from t where active
    )),
    ('it is labelled « Ordre de transit / instruction client »', (
      select count(*) = 1 from t where label_fr = 'Ordre de transit / instruction client'
    )),
    ('it is NOT mandatory for any dossier type (required_for is empty)', (
      select count(*) = 1 from t where cardinality(required_for) = 0
    )),
    ('it carries NO validity (no expiry date is demanded at upload)', (
      select count(*) = 1 from t where not has_validity
    ))
)
select
  bool_and(coalesce(c.ok, false)) as ok,
  case
    when bool_and(coalesce(c.ok, false))
      then 'CEO-ALIGNMENT WP1-D #159 verified: ' || count(*) || '/' || count(*)
           || ' postconditions hold — ORDRE_DE_TRANSIT is an active, optional, non-expiring document type'
    else 'CEO-ALIGNMENT WP1-D #159 FAILED: '
         || string_agg(c.label, '; ') filter (where not coalesce(c.ok, false))
  end as detail
from checks c;
