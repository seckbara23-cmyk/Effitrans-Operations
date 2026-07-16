# Document Intelligence — Document Schemas

**Phase 7.4A.** Source of truth: [`lib/docintel/schemas.ts`](../../lib/docintel/schemas.ts).
This document is descriptive; the code is authoritative.

## Closed class vocabulary

Exactly eight document classes are supported (plus the sentinel `UNKNOWN`). The
vocabulary is closed — the extractor never invents a class, and a class outside this
list is never produced. Declared class comes from the operator; an AI prediction (when a
provider is ever approved) is only ever advisory (see [human-review-model.md](./human-review-model.md)).

| Class | French label | Operational relevance |
|-------|--------------|-----------------------|
| `BILL_OF_LADING` | Connaissement | Ocean shipment master BL / booking |
| `AIR_WAYBILL` | Lettre de transport aérien | Air shipment MAWB / HAWB |
| `COMMERCIAL_INVOICE` | Facture commerciale | Customs valuation (review-only) |
| `PACKING_LIST` | Liste de colisage | Weight/piece reconciliation (review-only) |
| `CERTIFICATE_OF_ORIGIN` | Certificat d'origine | Origin evidence (review-only) |
| `CUSTOMS_DECLARATION` | Déclaration en douane | Customs regime (review-only) |
| `ARRIVAL_NOTICE` | Avis d'arrivée | ETA / terminal cross-check (review-only) |
| `DELIVERY_ORDER` | Bon de livraison | Release cross-check (review-only) |

`classFromTypeCode()` maps the existing `document.type_code` vocabulary onto these classes
(e.g. `AIRWAY_BILL → AIR_WAYBILL`, `DELIVERY_NOTE → DELIVERY_ORDER`); an unmapped code
yields `UNKNOWN`, never a guess.

## The schema is an allowlist

For each class the schema lists **every** field a structured extractor is permitted to
return. `normalizeCandidateFields()` drops any key not in the schema (recorded as
`rejectedKeys`); a required field that is absent stays `null` rather than being fabricated.
There is no free-text field bag — nothing outside the allowlist ever reaches storage.

Each field has a `kind` that selects a **deterministic** validator (reused from the shipping
and air domains — the AI never replaces validation):

`text` · `reference` · `date` · `number` · `currency` · `container` (ISO 6346 check digit) ·
`awb` (11-digit mod-7) · `unlocode` · `iata` · `imo` · `mmsi`.

## `applyTarget` — the only writable fields

A field may carry an `applyTarget = { domain, field }`. This is the **only** way an approved
value can flow into an operational record, and it always routes through that domain's own
service (which re-checks `transport:update`). Fields without an `applyTarget` are
extract → validate → review-only: there is **no** authoritative operational field for them,
and the platform never invents one.

| Class | Field key | Kind | Required | Apply target |
|-------|-----------|------|:--------:|--------------|
| `BILL_OF_LADING` | `bl_number` | reference | ✓ | `shipping.masterBl` |
| | `booking_reference` | reference | | `shipping.bookingReference` |
| | `carrier`, `vessel`, `voyage`, `port_of_loading`, `port_of_discharge`, `container_numbers`, `package_count`, `gross_weight`, `goods_description`, `issue_date` | (mixed) | | — (review-only) |
| `AIR_WAYBILL` | `mawb` | reference | ✓ | `air.mawb` |
| | `hawb` | reference | | `air.hawb` |
| | `airline`, `flight_number`, `origin_airport`, `destination_airport`, `piece_count`, `gross_weight`, `chargeable_weight`, `flight_date` | (mixed) | | — (review-only) |
| `COMMERCIAL_INVOICE` | `invoice_number` (req.), `invoice_date`, `currency`, `subtotal`, `tax`, `total`, `incoterm`, `country_of_origin` | (mixed) | | — (review-only) |
| `PACKING_LIST` | `packing_list_number`, `date`, `package_count`, `net_weight`, `gross_weight`, `volume`, `container` | (mixed) | | — (review-only) |
| `CERTIFICATE_OF_ORIGIN` | `certificate_number`, `exporter`, `origin_country`, `issue_date`, `issuing_authority` | (mixed) | | — (review-only) |
| `CUSTOMS_DECLARATION` | `declaration_number`, `regime`, `office`, `customs_value`, `declaration_date` | (mixed) | | — (review-only) |
| `ARRIVAL_NOTICE` | `carrier`, `bl_number`, `vessel`, `voyage`, `arrival_port`, `eta`, `terminal` | (mixed) | | — (review-only) |
| `DELIVERY_ORDER` | `order_number`, `bl_number`, `container`, `release_party`, `validity`, `issue_date` | (mixed) | | — (review-only) |

> Only **four** fields across the whole platform are ever writable from a document
> (`bl_number`, `booking_reference`, `mawb`, `hawb`), and only through
> `updateBookingBl` / `updateAwb`. Everything else is decision support for a human.

## Reconciliation, not authority

Extracted values are compared against operational facts and across documents
([`lib/docintel/reconcile.ts`](../../lib/docintel/reconcile.ts)): `AGREEMENT`, `CONFLICT`,
`MISSING`, `NONE`. Cross-document checks (BL container vs shipment, AWB vs air shipment,
invoice total vs subtotal+tax, invoice vs packing-list gross weight, etc.) surface conflicts
for a human; they never auto-resolve and never elect a winner where no rule defines authority.
