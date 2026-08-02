# LOG-0 — Document Intelligence Catalog (additions & confirmations)

Per-type analysis for docintel (7.4A suggestions-only doctrine). Only fields the
templates themselves carry are listed — nothing invented. The platform's WES-4 catalog
(`docs/document-catalog.md`, 83 rows) already covers the core; this table records what
the KIT **confirms**, what it **adds as candidates** (RMD before catalog entry), and
extraction traits.

| Canonical name | Aliases seen [O] | Issuer → Recipient | Stage | Catalog status | Key fields evidenced [O] | OCR suitability | Extraction difficulty | Human verification |
|---|---|---|---|---|---|---|---|---|
| BILL_OF_LADING | Connaissement Maritime, Lettre de Voiture (sic) | carrier → shipper/consignee | transport | **confirmed** | BL nº, date, parties (+ tax IDs), goods, packages, gross/net kg, m³, declared value+currency, vessel | good (structured) | medium | required (governance) |
| PACKING_LIST | Liste de Colisage | shipper → all | transport | confirmed | packages, contents, weights, dims | good | low-medium | required |
| COMMERCIAL_INVOICE | Facture Commerciale | seller → buyer/customs | commercial/customs | confirmed | invoice nº, date, parties+VAT, lines (desc/qty/PU/total), **Incoterm, payment mode, currency** | good | medium | required — valeur en douane |
| PROFORMA_INVOICE | Facture Pro Forma | seller → buyer | pre-shipment | confirmed | as invoice, non-fiscal | good | medium | required |
| PURCHASE_ORDER | Bon de Commande | buyer → seller | commercial | confirmed | PO nº, parties, lines, delivery terms | good | medium | required |
| CUSTOMS_DECLARATION | Formulaire de Déclaration en Douane | declarant → customs | customs | confirmed (platform's GAINDE model is MORE specific) | declarant, regime, goods, HS-adjacent fields | medium (forms vary) | high | **required — regulatory** |
| CERTIFICATE_OF_ORIGIN | Certificat d'Origine | chamber/authority | customs | confirmed | origin country, goods, authority stamp | medium (stamps) | medium | required — stamped |
| DELIVERY_NOTE / POD | Bon de Livraison | carrier → consignee | delivery | confirmed | delivery ref, goods, **signature block** | medium (signatures) | medium | required — POD doctrine (WES-5) |
| CMR_WAYBILL | Lettre de Voiture Routier National | carrier | road | confirmed | parties, vehicle, goods, signatures | medium | medium | required |
| ARRIVAL_NOTICE *(candidate — RMD)* | Avis d'Arrivée | shipping line → consignee | arrival | **not in catalog** | vessel, ETA, BL ref, storage/franchise dates | good | low-medium | required |
| CARGO_MANIFEST *(candidate — RMD)* | Manifeste de Cargaison | carrier → customs | arrival | not in catalog | voyage, BL list, totals | good | medium | required |
| INSURANCE_CERTIFICATE / CARGO_POLICY *(candidates — RMD+RLC)* | Certificat d'Assurance Transporteur, Police d'Assurance Cargo, Déclaration d'Assurance | insurer → assured | transport | not in catalog | policy nº, assured, coverage, **validity dates** (expiry idiom exists [R]) | good | low-medium | required |
| WAREHOUSE bons *(partial)* | Bons de Réception/Retour/Sortie/Dépôt/Chargement | warehouse/ops | warehouse | `WAREHOUSE_RECEIPT`/`PICKUP_ORDER` exist; Retour/Sortie/Dépôt are candidates gated on the warehouse domain decision (G-2) | ref, goods, quantities, signatures | good | low-medium | required |
| CLAIM_NOTICE *(candidate — gated on G-7)* | Avis de Réclamation | any → Effitrans | post-delivery | not in catalog | claimant, dossier ref, grounds | medium (free prose) | high | **mandatory** |
| Rail/TIR/river waybills *(candidates — Q-OPS-2)* | CIM, TIR, Fluviale, Intermodale | carrier | transport | not in catalog — is the mode even used? | as CMR | medium | medium | required |
| Customs AGREEMENTS (22 kinds) | Contrats/Accords douaniers | Effitrans ↔ client/authority | contractual | `COMMERCIAL_CONTRACT` only — kind vocabulary is Q-LEG-1 | parties, object, duration, obligations | poor-medium (long prose) | high — **not an extraction target** | mandatory — legal |

## Cross-cutting

* **Signature/stamp requirements** [O]: BL, CMR, delivery notes, certificate of origin
  and every contract carry signature blocks; several imply stamps. Docintel can flag
  presence; **validity of a signature is never an AI judgment** [R doctrine].
* **Expiry/validity**: insurance validity dates map onto the existing `expiry_date`
  idiom [R]. Quotation validity is unevidenced (Q-COM-3).
* **Relationships**: every operational type keys to dossier + client [R];
  insurance/contract types would key to client (and vendor — absent, G-3).
* **Storage**: all above → `documents` bucket under WES-4 governance after human
  promotion; HR-adjacent mail → HR-3 private context; inbound raw stays in `ec-inbound`.
* **Confidentiality classes**: operational docs C2; contracts C2-C3; anything with
  personal identifiers C3 [R classification].
* **AI-assist ranking** (safe-first): file-number detection in correspondence → type
  classification of clean PDFs (invoice/BL/packing list) → header-field extraction
  (BL nº, invoice nº, totals) → *never* auto-promotion, *never* customs-value assertion.
