-- migrate:executor db-query
-- ===========================================================================
-- Migration 158 — CEO-ALIGNMENT WP1-B1 / WP1-C: the customer PO and the
-- intended customs regime, captured at dossier opening.
-- ===========================================================================
-- CEO-003 — Abdoul's annotation on the SOP Interactif, step 3:
--
--     « L'account manager doit spécifier et inscrire le PO client, le régime
--       douanier a l'ouverture du dossier. »
--
-- TWO NULLABLE COLUMNS, NOTHING ELSE.
--
-- client_po_reference (DEC-CEO-02, approved 2026-10-21)
--   The customer's purchase-order reference. A DEDICATED field, deliberately
--   not `client_reference`: that one already holds whatever reference a client
--   quotes (6 of 15 live dossiers), and re-reading those values as POs would
--   assert something nobody recorded. Optional at creation. It becomes
--   mandatory before step 3 closes on an import dossier only in WP1 PR-2, with
--   the exception policy DEC-CEO-19 — this migration enforces nothing.
--
-- customs_regime_declared (DEC-CEO-03, approved 2026-10-21)
--   The regime the Account Manager EXPECTS at opening — commercial intent,
--   preliminary information from the customer or Operations. It is NOT the
--   declared customs regime: that remains `customs_record.regime`, governed
--   data entered by the Déclarant and certified by the Chef de Transit (D4,
--   ratified 2026-08-28). The two are never copied into each other, in either
--   direction, by anything. Free text, because the platform has no canonical
--   regime vocabulary (migration 155 records the same finding).
--
-- BACKWARD COMPATIBILITY. No default, no backfill, no index, no trigger, no
-- policy, no grant. Every existing dossier reads NULL for both, which is the
-- truth: nobody recorded them. Writes stay where they are — the service-role
-- file actions under `file:create` / `file:update`; `operational_file` has no
-- client write path and this migration adds none.
--
-- BOUNDS. Both CHECKs refuse a blank string (an empty value is NULL, never '')
-- and cap the length, so a pasted e-mail body cannot land in a reference.
-- ===========================================================================

alter table public.operational_file
  add column if not exists client_po_reference text
    constraint operational_file_client_po_reference_shape check (
      client_po_reference is null
      or (btrim(client_po_reference) <> '' and length(client_po_reference) <= 64)
    ),
  add column if not exists customs_regime_declared text
    constraint operational_file_customs_regime_declared_shape check (
      customs_regime_declared is null
      or (btrim(customs_regime_declared) <> '' and length(customs_regime_declared) <= 80)
    );

comment on column public.operational_file.client_po_reference is
  'CEO-003 / DEC-CEO-02 — the customer purchase-order reference, captured by the Account Manager at opening. Distinct from client_reference. Optional; not enforced by this migration.';

comment on column public.operational_file.customs_regime_declared is
  'CEO-003 / DEC-CEO-03 — the customs regime EXPECTED at opening (commercial intent, preliminary). NOT the declared regime: customs_record.regime stays the governed value (D4). Never copied in either direction.';
