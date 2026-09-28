-- VERIFIER for 20261007000001_delivery_note_signed_label
-- ===========================================================================
-- CONTRACT. Read-only. Deterministic. Idempotent. Safe to run repeatedly
-- against production. Mutates no schema, no data, no permission, no session
-- role, no configuration. Returns EXACTLY ONE row: (ok boolean, detail text).
--
-- WHAT THIS MIGRATION ESTABLISHES is a NAME, so the postcondition is a name —
-- and a verifier asserts the postconditions ITS OWN migration establishes, no
-- more. It does not test the pickup gate, the POD gate or step 17: those were
-- true before this ran, this changed none of them, and demanding them here
-- would make an unrelated regression read as "this migration is unapplied".
--
-- WHAT IT DOES ASSERT, beyond the label itself, is the INVARIANT the rename
-- exists to protect: the signed POD and the unsigned slip remain two distinct,
-- separately-named artefacts. A future edit that merged, retired or re-pointed
-- either one would leave the label technically correct and the meaning broken —
-- and this file is what runs months later to notice.
-- ===========================================================================
with checks(label, ok) as (
  values
    -- ---- 1. The rename, exactly ------------------------------------------
    ('DELIVERY_NOTE is named « Bordereau de Livraison signé (POD) »', (
      select count(*) = 1 from public.document_type
       where code = 'DELIVERY_NOTE'
         and label_fr = 'Bordereau de Livraison signé (POD)'
    )),

    ('… and its English label names the signed note', (
      select count(*) = 1 from public.document_type
       where code = 'DELIVERY_NOTE'
         and label_en = 'Signed delivery note (POD)'
    )),

    -- ---- 2. THE INVARIANT: still two artefacts, still distinguishable -----
    -- The unsigned slip is the pickup gate's evidence and satisfies no POD
    -- consumer. If these two ever share a label an operator cannot tell them
    -- apart in the dropdown, which is the defect this migration closes.
    ('BORDEREAU_LIVRAISON keeps its own name « Bordereau de Livraison (non signé) »', (
      select count(*) = 1 from public.document_type
       where code = 'BORDEREAU_LIVRAISON'
         and label_fr = 'Bordereau de Livraison (non signé)'
    )),

    -- SCOPED TO THIS MIGRATION'S OWN POSTCONDITION, and the scope is not
    -- fussiness. This check began as « no two active document types share a
    -- French label » and a read-only run against production showed it FAILING
    -- BEFORE the migration: `TRANSPORT_REQUEST` and `DEMANDE_TRANSPORT` have
    -- shared « Demande de transport » since Phase 5.0D (MAYA-P1.10 §5, audit
    -- finding F-08 — its own catalogue decision, deliberately not taken here).
    --
    -- Left as written it would have reported VERIFY_FAILED after a perfectly
    -- correct apply — « production indeterminate, diagnose by hand », caused by
    -- the safety net demanding something its migration never established. That
    -- is exactly the #139 failure the policy records.
    --
    -- What this migration DOES establish is that the name it writes is
    -- unambiguous: no other type answers to it.
    ('no other document type answers to the signed POD''s name', (
      select count(*) = 1 from public.document_type
       where label_fr = 'Bordereau de Livraison signé (POD)'
    )),

    -- ---- 3. Blast radius: a LABEL changed, and nothing else ---------------
    -- Everything below is what the POD consumers and the requirement resolver
    -- actually read. The migration touches none of it; this is what proves a
    -- later edit did not quietly ride along on the same row.
    ('DELIVERY_NOTE is still active, operational, and required for IMP/TRP/HND', (
      select count(*) = 1 from public.document_type
       where code = 'DELIVERY_NOTE'
         and active
         and category = 'operational'
         and required_for @> array['IMP','TRP','HND']::text[]
         and not conditional
    )),

    ('DELIVERY_NOTE gates no customs decision', (
      select count(*) = 1 from public.document_type
       where code = 'DELIVERY_NOTE' and not gates_customs
    )),

    ('BORDEREAU_LIVRAISON is still active, conditional, and required for nothing', (
      select count(*) = 1 from public.document_type
       where code = 'BORDEREAU_LIVRAISON'
         and active and conditional
         and coalesce(array_length(required_for, 1), 0) = 0
    )),

    -- The driver-app evidence kind, explicitly out of scope and named here so
    -- that "untouched" is asserted rather than assumed.
    ('DRIVER_SIGNATURE is untouched and remains a separate type', (
      select count(*) = 1 from public.document_type
       where code = 'DRIVER_SIGNATURE'
         and label_fr = 'Signature de livraison'
         and active
    )),

    -- ---- 4. The catalogue itself is unchanged in shape --------------------
    -- No type was added, retired or deactivated by a label migration.
    ('the three delivery-related types all still exist and are active', (
      select count(*) = 3 from public.document_type
       where code in ('DELIVERY_NOTE', 'BORDEREAU_LIVRAISON', 'DRIVER_SIGNATURE')
         and active
    )),

    -- `document_type` is GLOBAL reference data (P0.8-C). A tenant column
    -- appearing here would mean the catalogue had been forked per tenant, which
    -- would change what every dossier can store.
    ('document_type remains global reference data — no tenant column', (
      select count(*) = 0 from information_schema.columns
       where table_schema = 'public' and table_name = 'document_type'
         and column_name = 'tenant_id'
    )),

    -- ---- 5. No document row was reassigned -------------------------------
    -- The migration renames a TYPE; it must never move a document between
    -- types. Nothing may be filed under a code the catalogue does not define.
    ('every document still points at a type the catalogue defines', (
      select count(*) = 0 from public.document d
       where d.deleted_at is null
         and not exists (select 1 from public.document_type t where t.code = d.type_code)
    ))
)
select
  bool_and(ok) as ok,
  case when bool_and(ok)
       then 'POD-UPLOAD-01 #145 verified: ' || count(*) || '/' || count(*) || ' postconditions hold'
       else 'POD-UPLOAD-01 #145 FAILED: ' || string_agg(label, '; ') filter (where not ok)
  end as detail
from checks;
