-- 20260712000001_driver_evidence_types.sql
-- Effitrans Operations Platform — PHASE 3.4C-3: Driver evidence document types.
-- ---------------------------------------------------------------------------
-- Additive, forward-only (DEC-A12). Driver photo + signature capture REUSES the
-- existing document catalog + private-bucket storage (Phase 1.8) — no second
-- attachment system. POD stays the existing DELIVERY_NOTE type. These extra
-- operational document types let typed pickup/cargo/seal/incident/delivery
-- photos + the delivery signature be stored, audited, and (when marked) shared
-- to the client through the SAME document workflow.
--
-- SCOPE GUARD (3.4C-3): document_type rows only. No new table, no RLS change,
-- no delivery-workflow change. Applied on `db reset` with the other migrations.

insert into public.document_type (code, label_fr, label_en, category, has_validity, required_for, conditional, sort_order) values
  ('PICKUP_PHOTO',     'Photo d''enlèvement',      'Pickup photo',       'operational', false, '{}', false, 110),
  ('CARGO_PHOTO',      'Photo de marchandise',     'Cargo photo',        'operational', false, '{}', false, 111),
  ('SEAL_PHOTO',       'Photo scellé/conteneur',   'Seal/container photo','operational', false, '{}', false, 112),
  ('INCIDENT_PHOTO',   'Photo d''incident',        'Incident photo',     'operational', false, '{}', false, 113),
  ('DELIVERY_PHOTO',   'Photo de livraison',       'Delivery photo',     'operational', false, '{}', false, 114),
  ('DRIVER_SIGNATURE', 'Signature de livraison',   'Delivery signature', 'operational', false, '{}', false, 115)
on conflict (code) do nothing;
