-- 20260713000002_pickup_gate_document_types.sql
-- Effitrans Operations Platform — PHASE 5.0B: the two document types the official
-- pickup convergence gate depends on.
-- ---------------------------------------------------------------------------
-- Phase 5.0A found ten document types missing from the catalog. Eight of them
-- (quotation, vendor invoice, spending authorisation, GAINDE submission evidence,
-- proof of deposit, ...) belong to Phase 5.0D and are NOT added here.
--
-- These two are different: the official pickup gate REQUIRES a Bon à Délivrer and
-- a Pre-Gate authorisation. Without a document type to hold them, the evidence
-- checker resolves both to `missing` forever, and the gate can never open — it
-- could be proven to BLOCK, but never to PASS. Adding them is what makes the gate
-- a working control rather than a permanent wall.
--
-- `document_type` is a GLOBAL table (no tenant_id, no FK to organization), so a
-- literal insert is safe on a clean replay. No RLS change: the existing
-- document_type_select policy already exposes the catalog to authenticated users,
-- and documents themselves stay behind the dossier-scoped document policy.
--
-- The Bordereau de Livraison deliberately still maps to the EXISTING DELIVERY_NOTE
-- type. Splitting the prepared BL from the signed POD is a Phase 5.0D change that
-- touches shipped behaviour (the POD gate reads DELIVERY_NOTE today); 5.0B does
-- not disturb it.

insert into public.document_type
  (code, label_fr, label_en, category, has_validity, required_for, conditional, sort_order)
values
  ('BON_A_DELIVRER',          'Bon à Délivrer (BAD)',       'Delivery Order (carrier release)', 'transport',   false, '{}', true, 61),
  ('PRE_GATE_AUTHORIZATION',  'Autorisation Pre-Gate',      'Pre-Gate terminal authorization',  'operational', false, '{}', true, 62)
on conflict (code) do nothing;
