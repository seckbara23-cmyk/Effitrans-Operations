-- migrate:executor db-query
-- ===========================================================================
-- Migration 159 — CEO-ALIGNMENT WP1-D: « Ordre de transit / instruction
-- client » as a document type.
-- ===========================================================================
-- CEO-004 — Abdoul's annotation on the SOP Interactif, step 3:
--
--     « L'account manager doit scanner le fond de dossier (…) et l'ordre de
--       transit ou rattacher le mail du client qui confie le dossier a
--       Effitrans. »
--
-- Until now the customer's instruction had no home: it was filed as `OTHER`,
-- indistinguishable from any other paper. This gives it one.
--
-- WHAT THIS IS NOT.
--   * NOT A NEW MANDATORY DOCUMENT. `required_for` is EMPTY on purpose. Listing
--     it for IMP would (a) put it in every « documents manquants » indicator,
--     and (b) delay the customer notice `documents_verified`, which fires only
--     once every REQUIRED type is verified (lib/customer-notify/triggers.ts).
--     Making it mandatory is a business rule nobody has ratified; this slice
--     does not invent one.
--   * NOT A VALIDITY-BEARING TYPE. An instruction does not expire. The customs
--     expiry-bearing catalogue (DPI, titre d'exonération, APE, sommier…) waits
--     for DEC-CEO-04/05 — the Chef de Transit's values, not ours.
--   * NOT AUTO-VERIFIED. A document of this type enters UPLOADED like any other
--     and follows the ordinary verification workflow. The platform records what
--     arrived; it never certifies the customer's intent on its own.
--
-- IDEMPOTENT: `on conflict do nothing`.
-- ===========================================================================

insert into public.document_type
  (code, label_fr, label_en, category, has_validity, required_for, conditional, active, sort_order)
values
  ('ORDRE_DE_TRANSIT', 'Ordre de transit / instruction client', 'Transit order / client instruction',
   'commercial', false, '{}', true, true, 12)
on conflict (code) do nothing;
