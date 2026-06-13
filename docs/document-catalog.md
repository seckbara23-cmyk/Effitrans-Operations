# Effitrans Operations Platform — Document Catalog & Expiry Rules (Phase 1)

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md).
>
> The Decision Register is the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> Contributors must **not** change assumptions or requirements directly in this document without first updating the corresponding decision entry in the Decision Register.
>
> If a decision changes: (1) update or supersede the decision in the Decision Register, (2) record the date and owner, (3) update all affected downstream documents.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

This catalog drives two Phase-1 features: (1) **classification** of every uploaded document, and (2) the **expiry alert engine** — the flagship differentiator answering the most-repeated pain in the questionnaire (Q11.3, Q14.10: expirations discovered too late).

> ⚠️ **The validity periods and alert lead times below are PLACEHOLDERS pending confirmation by the Chief of Transit ([BLK-3](#5-blocking-questions)).** Do not hardcode them — they live in the `document_type` table and are editable. This document defines the *structure*; Effitrans defines the *values*.

Related: [requirements.md](requirements.md) · [state-machine.md](state-machine.md) · [database-design.md](database-design.md)

---

## 1. Catalog structure

Each document type has:

| Field | Meaning |
|---|---|
| `code` | Stable machine key (e.g. `EXONERATION_TITLE`) |
| `label_fr` / `label_en` | Display names (FR primary) |
| `category` | Grouping (commercial / transport / customs / operational / financial / compliance) |
| `has_validity` | Whether instances expire |
| `default_validity_days` | Default lifespan if not on the document itself (placeholder) |
| `alert_lead_days` | When to start alerting before expiry (placeholder) |
| `blocks_transition` | Whether expiry blocks a workflow transition vs warn-only |
| `required_for` | File types / stages where this document is mandatory |

---

## 2. Document categories & types

### 2.1 Commercial & agreement documents
| Code | Label (FR) | has_validity | Required for |
|---|---|---|---|
| `PURCHASE_ORDER` | Bon de commande / instruction client | No | opening (import) |
| `COMMERCIAL_CONTRACT` | Contrat commercial | Yes* | — (long-term clients) |
| `QUOTATION` | Cotation approuvée | No | opening (if quote-based) |
| `PROFORMA_INVOICE` | Facture proforma | No | optional (customs/regulatory) |

### 2.2 Transport documents
| Code | Label (FR) | has_validity | Required for |
|---|---|---|---|
| `BILL_OF_LADING` | Connaissement (BL) | No | sea import/export |
| `AIRWAY_BILL` | Lettre de transport aérien (LTA/AWB) | No | air import/export |
| `BOOKING_CONFIRMATION` | Confirmation de booking | No | export booking |
| `PACKING_LIST` | Liste de colisage | No | declaration (all) |
| `DELIVERY_NOTE` | Bon de livraison / instruction | No | transport |
| `CMR_WAYBILL` | Lettre de voiture (CMR) | No | road transport |
| `TRANSPORT_ORDER` | Ordre de transport (sous-traitant) | No | external transport leg |

### 2.3 Customs & regulatory documents (expiry-critical)
| Code | Label (FR) | has_validity | blocks_transition | Required for |
|---|---|---|---|---|
| `COMMERCIAL_INVOICE` | Facture commerciale (valeur en douane) | No | — | declaration |
| `CUSTOMS_DECLARATION` | Déclaration en douane (note de détail / GAINDE) | No | — | clearance |
| `DPI` | Demande de Pré-Importation | **Yes** | **Yes** | declaration (when applicable) |
| `APE_AUTHORIZATION` | APE / APF — autorisation | **Yes** | **Yes** | declaration (when applicable) |
| `EXONERATION_TITLE` | Titre d'exonération | **Yes** | **Yes** | declaration (exempt regimes) |
| `TAX_EXEMPTION_CERT` | Certificat d'exonération fiscale | **Yes** | **Yes** | declaration (exempt) |
| `DUTY_EXEMPTION_AUTH` | Autorisation d'exonération de droits | **Yes** | **Yes** | declaration (exempt) |
| `SECTOR_AUTHORIZATION` | Autorisation sectorielle (oil & gas, mines, ONG) | **Yes** | **Yes** | declaration (sector) |
| `IMPORT_EXPORT_PERMIT` | Autorisation import/export | **Yes** | **Yes** | declaration (regulated goods) |
| `CERTIFICATE_OF_ORIGIN` | Certificat d'origine | Yes* | warn | declaration (when required) |
| `SOMMIER` | Sommier de déclaration | **Yes** | warn | customs follow-up |
| `BAE` | Bon à Enlever | No | — | clearance completion |

> **These customs documents are the heart of the expiry engine.** The questionnaire repeatedly cites APE, DPI, exoneration titles, and sommiers as documents "created at the beginning but used much later," leading to late-discovered expirations. Their validity periods are precisely what [BLK-3](#5-blocking-questions) must confirm.

### 2.4 Operational & logistics documents
| Code | Label (FR) | has_validity | Required for |
|---|---|---|---|
| `PICKUP_ORDER` | Bon d'enlèvement / ordre de release | No | clearance → transport |
| `WAREHOUSE_RECEIPT` | Bon de magasinage / reçu d'entrepôt | No | warehousing (when applicable) |
| `PORT_HANDLING_DOC` | Document de manutention portuaire | No | handling |
| `POD` | Bon de livraison déchargé (preuve de livraison) | No | **POD gate (all types)** |

### 2.5 Financial & disbursement documents
| Code | Label (FR) | has_validity | Required for |
|---|---|---|---|
| `DUTY_PAYMENT_RECEIPT` | Quittance de droits et taxes | No | clearance |
| `DISBURSEMENT_RECEIPT` | Reçu de débours (Orbus Infinity) | No | clearance |
| `FINAL_INVOICE` | Facture finale Effitrans | No | billing (Phase 2) |
| `PAYMENT_RECEIPT` | Reçu de paiement | No | collections (Phase 2) |

### 2.6 Compliance & internal control documents
| Code | Label (FR) | has_validity | Required for |
|---|---|---|---|
| `CHIEF_VALIDATION_RECORD` | Validation Chef de Transit | No | declaration gate (system-generated) |
| `FINANCE_VALIDATION_RECORD` | Validation financière | No | finance registration (system-generated) |
| `FILE_CLOSURE_DOC` | Document de clôture de dossier | No | archive |

`*` = validity exists but is per-instance (read from the document), not a fixed default.

---

## 3. Expiry engine behaviour

```
Daily scan (background job):
  for each document where has_validity = true and status != RENEWED:
    days_left = expires_at - today
    if days_left <= 0:
        status = EXPIRED
        if blocks_transition and document required by an open file:
            flag file as BLOCKED_BY_EXPIRY → escalate to AM + Chief of Transit
    elif days_left <= alert_lead_days:
        status = EXPIRING
        NOTIFY(account_manager + declarant [+ client in Phase 2], email/SMS)
```

| Status | Trigger | Effect |
|---|---|---|
| `VALID` | days_left > alert_lead_days | none |
| `EXPIRING` | 0 < days_left ≤ alert_lead_days | alert AM + declarant; appears on expiry watchlist dashboard |
| `EXPIRED` | days_left ≤ 0 | block dependent transition (if `blocks_transition`); escalate |
| `RENEWED` | superseding document uploaded | old version retained in audit trail; new instance tracked |

### Alert lead-time tiers (placeholder — confirm per type)
| Tier | Suggested lead | Applies to (proposed) |
|---|---|---|
| Critical | 30 / 14 / 7 days | EXONERATION_TITLE, DPI, APE, SECTOR_AUTHORIZATION |
| Standard | 14 / 7 days | TAX_EXEMPTION_CERT, DUTY_EXEMPTION_AUTH, IMPORT_EXPORT_PERMIT |
| Informational | 7 days | CERTIFICATE_OF_ORIGIN, SOMMIER, COMMERCIAL_CONTRACT |

---

## 4. Required-documents-by-stage matrix (missing-doc detection — REQ-D07)

| Stage | Import required docs | Export required docs |
|---|---|---|
| Opening | PURCHASE_ORDER (or QUOTATION) | QUOTATION (if applicable) |
| Booking | — | BOOKING_CONFIRMATION |
| Declaration | COMMERCIAL_INVOICE, PACKING_LIST, (BL or AWB), DPI*, EXONERATION_TITLE* | COMMERCIAL_INVOICE, PACKING_LIST |
| Clearance | CUSTOMS_DECLARATION, BAE | CUSTOMS_DECLARATION, BAE |
| Transport | PICKUP_ORDER, (CMR or DELIVERY_NOTE) | DELIVERY_NOTE / handling docs |
| POD gate | **POD** | **POD** |

`*` = conditional (regime/sector dependent). The engine flags a file before a stage if a required doc for that stage is missing.

---

## 5. Blocking questions
| ID | Question | Blocks |
|---|---|---|
| **BLK-3** (master) | Confirm the **complete document-type list** and the **validity period** of each expiry-bearing type (APE, DPI, exoneration titles, sector authorizations, sommiers, permits) | Expiry engine values |
| BLK-DC1 | For each expiring type: which truly **block** a transition vs only **warn**? | `blocks_transition` flags |
| BLK-DC2 | What alert lead times does the transit team actually want (per type)? | `alert_lead_days` |
| BLK-DC3 | Are validity periods fixed per type, or read from each document instance (so users must enter expiry on upload)? | Upload UX + engine |
| BLK-DC4 | Any document types missing from this catalog (Effitrans-specific forms)? | Catalog completeness |
| BLK-DC5 | Which docs may clients upload via the portal vs internal-only? | Portal scope (REQ-P03) |
