-- POD-UPLOAD-01 — name the signed POD as the official process names it.
-- migrate:executor db-query
-- ---------------------------------------------------------------------------
-- ⚠⚠ NOT APPLIED BY PUSHING THIS FILE. Production migrations are dispatched by
-- a human against the `production-db` environment, one version per approved
-- action (docs/migration-policy.md). The application ships and runs correctly
-- WITHOUT this migration: the delivery-proof button preselects the type by
-- CODE, and the panel resolves its French wording from the process registry, so
-- the operator already sees « Bordereau de Livraison signé (POD) » before this
-- row is touched. What this migration fixes is every OTHER reader of the
-- catalogue — the dropdown list itself, the customer portal, any surface that
-- prints `document_type.label_fr`.
--
-- ===========================================================================
-- WHAT WAS WRONG, AND WHY IT IS A LABEL AND NOT A TYPE
-- ===========================================================================
-- Phase 5.0D (20260714000001) split the delivery slip in two and said so in as
-- many words: « DELIVERY_NOTE stays the SIGNED POD. Untouched. … No data
-- migration, no alias, no rewrite of existing rows. » That was right about the
-- ROWS and silent about the NAME. The new unsigned type arrived as « Bordereau
-- de Livraison (non signé) » while the signed one kept the label it was seeded
-- with in June 2026 — « Bon de livraison / POD » — from the period when ONE
-- type served both artefacts.
--
-- So one code answered to two names. The official process, the dossier's
-- delivery-proof card and step 17 all say « Bordereau de Livraison signé
-- (POD) »; the upload dropdown said « Bon de livraison / POD », three rows
-- below an entry that DOES contain the words the operator had just read and is
-- a different artefact with a different authority.
--
-- On EFT-IMP-2026-00013 that cost a UAT run: the signed bordereau was filed as
-- « Signature de livraison » (DRIVER_SIGNATURE, the driver-app evidence kind),
-- verified, and nothing moved — transport stayed DELIVERED, step 17 stayed
-- ACTIVE, the billing gate kept reporting `no_approved_pod`. Every one of those
-- reads `DELIVERY_NOTE` and only `DELIVERY_NOTE`, correctly.
--
-- ===========================================================================
-- WHAT THIS DOES — AND EVERYTHING IT DOES NOT
-- ===========================================================================
-- It updates two text columns on ONE reference row. It does not:
--   * touch `document` rows — no type is reassigned, no status rewritten, and
--     the mis-filed DRIVER_SIGNATURE on 00013 stays exactly as it is, because
--     it is UAT evidence and correcting data is a separate, explicit act;
--   * add, retire or deactivate any `document_type`;
--   * change `required_for`, `conditional`, `category`, `sort_order` or
--     `gates_customs` — the pickup gate, the stage-aware requirement resolver
--     and the missing-documents computation all read those, and this migration
--     is not entitled to move a single gate;
--   * touch BORDEREAU_LIVRAISON, which keeps its label AND its separate
--     authority: it satisfies the pickup gate and never the POD;
--   * touch DRIVER_SIGNATURE;
--   * create a schema object, a policy, a grant or a trigger. `document_type`
--     is global reference data (P0.8-C: no tenant_id) and its RLS is untouched.
--
-- REVERSIBLE by one UPDATE back to the previous text. No row is destroyed and
-- nothing derives behaviour from this label: every POD consumer matches on the
-- CODE. That is exactly why this is safe, and also why it had to be fixed —
-- the machine was never confused, only the person reading it.
-- ===========================================================================

-- Fail loudly if the row is not there: a silent no-op UPDATE would record this
-- migration as applied while the catalogue still said something else.
do $$
begin
  if not exists (select 1 from public.document_type where code = 'DELIVERY_NOTE') then
    raise exception 'POD-UPLOAD-01: document_type.DELIVERY_NOTE is absent — the signed POD type must exist before it can be renamed';
  end if;
end $$;

update public.document_type
   set label_fr = 'Bordereau de Livraison signé (POD)',
       label_en = 'Signed delivery note (POD)'
 where code = 'DELIVERY_NOTE';

-- The unsigned twin is named here only to assert that it was NOT touched: the
-- two artefacts must remain distinguishable by name, which is the whole point.
do $$
declare
  v_signed   text;
  v_unsigned text;
begin
  select label_fr into v_signed   from public.document_type where code = 'DELIVERY_NOTE';
  select label_fr into v_unsigned from public.document_type where code = 'BORDEREAU_LIVRAISON';

  if v_signed is distinct from 'Bordereau de Livraison signé (POD)' then
    raise exception 'POD-UPLOAD-01: DELIVERY_NOTE label not applied (got %)', v_signed;
  end if;
  if v_unsigned is distinct from 'Bordereau de Livraison (non signé)' then
    raise exception 'POD-UPLOAD-01: BORDEREAU_LIVRAISON must keep its own label (got %)', v_unsigned;
  end if;
  if v_signed = v_unsigned then
    raise exception 'POD-UPLOAD-01: the signed and unsigned delivery notes must not share a label';
  end if;
end $$;

comment on table public.document_type is
  'Global document catalogue (no tenant_id). DELIVERY_NOTE is the SIGNED delivery note (POD) and is the sole evidence for transport receipt, step 17 and the billing/closure gates; BORDEREAU_LIVRAISON is the UNSIGNED slip read by the pickup gate. Two artefacts, two authorities — POD-UPLOAD-01.';
