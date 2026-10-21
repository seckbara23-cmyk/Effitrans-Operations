-- migrate:executor db-query
-- ===========================================================================
-- Migration 160 — CEO-ALIGNMENT WP1-D: the customer's instructing e-mail,
-- filed on the dossier, with its provenance.
-- ===========================================================================
-- CEO-004 — « … ou rattacher le mail du client qui confie le dossier a
-- Effitrans. »
--
-- EMP-4 (migration 20260812000001) let an inbound ATTACHMENT become a dossier
-- document. The instruction itself, though, is usually the MESSAGE — « please
-- handle this shipment » in the body, with nothing attached — and the message
-- had no way onto the dossier. This is the same mechanism, one level up.
--
-- WHAT THE DOCUMENT IS. A rendition, not the original. The original `.eml` is
-- EC-1's immutable capture evidence in the inbound bucket (append-only trigger
-- on ec_inbound_message) and it is never copied, moved or modified. The
-- dossier receives a PDF rendered from the captured envelope and text, whose
-- source snapshot carries the raw message's sha256 — so the rendition can
-- always be tied back to the exact bytes the provider delivered.
--
-- WHAT THIS MIGRATION ADDS, mirroring 20260812000001 for attachments:
--   1. `document.source_message_id` — nullable FK to the captured message.
--   2. ONE document per message — a partial unique index, because a
--      read-then-insert in the service could be raced by two operators.
--   3. A lookup index for « was this message already filed? ».
-- No policy, no permission (ingestion composes `communication:inbound:read`,
-- `document:create` and dossier visibility, exactly as EMP-4 does), no
-- trigger, no RPC, no emitter — `emit_document_events()` already fires
-- DOCUMENT_UPLOADED on the INSERT.
-- ===========================================================================

alter table public.document
  add column if not exists source_message_id uuid
    references public.ec_inbound_message (id);

comment on column public.document.source_message_id is
  'CEO-ALIGNMENT WP1-D: the captured inbound message this document was rendered from (the customer''s instructing e-mail). NULL for every other document. The inbound message itself is never modified — provenance lives on the copy.';

-- One captured message yields at most one dossier document. Soft-deleted
-- documents are deliberately NOT excluded, for the reason 20260812000001 gives:
-- « already filed » is a fact about the message, not about its copy's status.
create unique index if not exists uq_document_source_message
  on public.document (source_message_id)
  where source_message_id is not null;

create index if not exists idx_document_ingested_message
  on public.document (tenant_id, source_message_id)
  where source_message_id is not null;
