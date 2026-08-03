-- ===========================================================================
-- EC-3D — Customer acceptance & dossier conversion (migration 84)
--
-- EC-3B already ships everything the DECISION needs: the acceptance columns,
-- the CHECK that makes evidence mandatory, the decline/cancel paths, and
-- `quotation_record_conversion` (which refuses a non-ACCEPTED quotation with
-- QT616, refuses a cross-tenant dossier with QT617, never inserts into
-- operational_file, and emits the keystone event). **EC-3D adds no commercial
-- schema and no RPC.**
--
-- What it does add is the minimum that lets the EXISTING Customer Notify
-- pipeline carry a commercial decision:
--
--   1. `client_notification.category` is constrained to shipment/invoice/payment.
--      A quotation acknowledgement is none of those, so the CHECK is widened
--      (drop-and-recreate, the WES-5 precedent) rather than mislabelling a
--      commercial message as a shipment one.
--   2. `client_notification` can reference a dossier or an invoice. At
--      acceptance a quotation has NEITHER — that is the whole point of the
--      phase — so without a quotation reference the row would point at nothing
--      and the portal could not link it. A nullable FK fixes that.
--
-- No second notification engine is created: this widens the one that exists.
-- Additive, idempotent, forward-only. Migrations 1–83 are untouched.
-- ===========================================================================

-- 1. Widen the category vocabulary. Drop-and-recreate is the sanctioned way to
--    change a CHECK; the new value is ADDED, none is removed, so every existing
--    row remains valid.
alter table public.client_notification
  drop constraint if exists client_notification_category_check;

alter table public.client_notification
  add constraint client_notification_category_check
  check (category in ('shipment', 'invoice', 'payment', 'commercial'));

-- 2. The commercial entity a notification may refer to. Nullable, and ON DELETE
--    SET NULL like its file/invoice siblings: losing the quotation must never
--    delete the customer's copy of what they were told.
alter table public.client_notification
  add column if not exists quotation_id uuid references public.quotation (id) on delete set null;

create index if not exists idx_client_notification_quotation
  on public.client_notification (tenant_id, quotation_id)
  where quotation_id is not null;

-- No RLS change: client_notification's existing policies are scoped by
-- tenant + client and are unaffected by a new nullable column.
