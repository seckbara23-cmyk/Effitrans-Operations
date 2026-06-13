# Workshop — Chief of Transit Validation Sheet
## Atelier de validation — Chef de Transit

> **Governance Notice**
>
> This workshop **produces** decisions that must be recorded in [`docs/decision-register.md`](../decision-register.md) — the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> After the workshop, transfer every confirmed answer into the Decision Register before it is treated as binding: (1) add or supersede the decision, (2) record the date and owner, (3) update all affected downstream documents, then close the matching `BLK-*` items.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

**Purpose / Objet :** Validate every customs, compliance, document, expiry, and workflow business rule **before development starts**. Nothing in this sheet is a settled fact — items marked **PROPOSED** are the development team's draft assumptions and **must be confirmed or corrected**. Items left blank (`______`) **must be supplied** by the Chief of Transit.

**How to use:** Conduct in French if preferred. For each row, either tick **✅ Confirm** (the proposal is correct) or write the correction in the **Correction / Réponse** field. Record every decision in the [Decision Log](#decision-log--journal-des-décisions). Anything unresolved goes to [Open Questions](#open-questions--questions-ouvertes).

**Validates:** [state-machine.md](../state-machine.md) · [document-catalog.md](../document-catalog.md) · [requirements.md](../requirements.md) · [architecture.md](../architecture.md)

| Field | Value |
|---|---|
| Date of workshop | ______ |
| Chief of Transit (name) | ______ |
| Facilitator | ______ |
| Other attendees | ______ |
| Version | 1.0 (draft for completion) |

> **Rule for this workshop: do not assume. Every business rule below must be explicitly validated.**

---

# 1. Operational File Lifecycle / Cycle de vie du dossier

## 1.1 Workflow states — confirm the real sequence

For each file type, confirm whether the PROPOSED states match real Effitrans operations. Add/remove/rename/merge as needed.

### IMPORT — proposed states
| # | Proposed state | Real-life name (FR) | ✅ Confirm | Correction / merge / remove |
|---|---|---|---|---|
| 1 | DRAFT | Brouillon | ☐ | ______ |
| 2 | OPENED | Dossier ouvert | ☐ | ______ |
| 3 | COORDINATION | Coordination | ☐ | ______ |
| 4 | TRANSIT_PREP | Préparation transit | ☐ | ______ |
| 5 | DECLARATION_DRAFT | Déclaration en préparation | ☐ | ______ |
| 6 | DECLARATION_VALIDATED | Déclaration validée (gate) | ☐ | ______ |
| 7 | FINANCE_REGISTERED | Enregistrement financier | ☐ | ______ |
| 8 | CLEARANCE_IN_PROGRESS | Dédouanement en cours | ☐ | ______ |
| 9 | CLEARED | Dédouané / BAE obtenu | ☐ | ______ |
| 10 | IN_TRANSPORT | En transport / livraison | ☐ | ______ |
| 11 | DELIVERED | Livré | ☐ | ______ |
| 12 | POD_VALIDATED | POD validé (gate) | ☐ | ______ |
| 13 | BILLED | Facturé (Phase 2) | ☐ | ______ |
| 14 | ARCHIVED | Archivé (verrouillé) | ☐ | ______ |
| + | Missing state? | ______ | ☐ | ______ |

### EXPORT — proposed states
| # | Proposed state | Real-life name (FR) | ✅ Confirm | Correction |
|---|---|---|---|---|
| 1 | DRAFT | Brouillon | ☐ | ______ |
| 2 | FILE_CREATED | Dossier créé (incoterm/mode) | ☐ | ______ |
| 3 | BOOKING | Réservation (booking/SI/AWB) | ☐ | ______ |
| 4 | COORDINATION_READY | Prêt coordination | ☐ | ______ |
| 5 | TRANSIT_PREP | Préparation transit | ☐ | ______ |
| 6 | DECLARATION_DRAFT | Déclaration export en préparation | ☐ | ______ |
| 7 | DECLARATION_VALIDATED | Déclaration validée (gate) | ☐ | ______ |
| 8 | FINANCE_REGISTERED | Enregistrement financier | ☐ | ______ |
| 9 | CLEARANCE_IN_PROGRESS | Dédouanement en cours | ☐ | ______ |
| 10 | CLEARED | BAE / équivalent obtenu | ☐ | ______ |
| 11 | MULTIMODAL_EXECUTION | Exécution multimodale | ☐ | ______ |
| 12 | DEPARTED | Départ navire / vol | ☐ | ______ |
| 13 | DESTINATION_DELIVERY | Livraison à destination | ☐ | ______ |
| 14 | POD_VALIDATED | POD validé (gate) | ☐ | ______ |
| 15 | ARCHIVED | Archivé | ☐ | ______ |
| + | Missing state? | ______ | ☐ | ______ |

### TRANSPORT (standalone) — proposed states
`DRAFT → PLANNED → ASSIGNED → IN_TRANSIT → DELIVERED → POD_VALIDATED → BILLED → ARCHIVED`
✅ Confirm ☐ Correction: ______

### HANDLING — proposed states
`DRAFT → ORDERED → IN_PROGRESS → COMPLETED → POD_VALIDATED → ARCHIVED`
✅ Confirm ☐ Correction: ______
**Q:** Is HANDLING always a child of a shipment file, or can it be a standalone billed job? → ______

## 1.2 Transition rules — who may move the file
| Transition | Proposed allowed role(s) | ✅ Confirm | Correct role(s) |
|---|---|---|---|
| Open file | Account Manager | ☐ | ______ |
| Dispatch to coordination | Account Manager / Coordinator | ☐ | ______ |
| Assign declarant | Coordinator / Chief of Transit | ☐ | ______ |
| Submit declaration | Customs Declarant | ☐ | ______ |
| **Validate declaration** | **Chief of Transit only** | ☐ | ______ |
| Register declaration | Finance Officer | ☐ | ______ |
| Release to agents | Coordinator | ☐ | ______ |
| Record BAE | Transit Agent | ☐ | ______ |
| Start transport | Transport Officer / Coordinator | ☐ | ______ |
| Mark delivered | Transport Officer | ☐ | ______ |
| **Validate POD** | **Account Manager only** | ☐ | ______ |
| Archive | Account Manager / System | ☐ | ______ |

## 1.3 Approval gates — confirm the hard stops
| Gate | Proposed rule | ✅ Confirm | Correction |
|---|---|---|---|
| Chief-of-Transit validation | Declaration cannot reach Finance without Chief validation | ☐ | ______ |
| POD hard gate | No BILLED / ARCHIVED without AM-validated POD | ☐ | ______ |
| Checklist gate | Cannot advance a stage with incomplete mandatory checklist | ☐ | ______ |
| Expiry gate | Cannot proceed to clearance with an expired required document | ☐ | ______ |
| Archive lock | Archived file is read-only | ☐ | ______ |
| Other mandatory gate? | ______ | ☐ | ______ |

## 1.4 Escalation paths
| Situation | Who is notified / escalated to? | Trigger condition | After how long? |
|---|---|---|---|
| Declaration rejected by Chief | ______ | ______ | ______ |
| Document expired, file blocked | ______ | ______ | ______ |
| File stuck in a stage too long | ______ | ______ | ______ |
| Customs inspection / hold | ______ | ______ | ______ |
| Missing document before arrival | ______ | ______ | ______ |
| Backward transitions (rework) — which are allowed? | ______ | ______ | ______ |

---

# 2. Document Catalog Validation / Validation du catalogue documentaire

> For **every** document type: confirm the identity (Table A) and the lifecycle (Table B). Codes are technical — pre-filled. Everything else needs confirmation or input. **Do not skip rows.**

## 2.1 Customs & regulatory documents (expiry-critical)

### Table A — Identity
| Code | Document name (FR) | Import / Export / Both | Mandatory / Optional | Issuing authority |
|---|---|---|---|---|
| DPI | Demande de Pré-Importation | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| APE_AUTHORIZATION | APE / APF — autorisation | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| EXONERATION_TITLE | Titre d'exonération | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| TAX_EXEMPTION_CERT | Certificat d'exonération fiscale | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| DUTY_EXEMPTION_AUTH | Autorisation d'exonération de droits | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| SECTOR_AUTHORIZATION | Autorisation sectorielle (O&G/mines/ONG) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| IMPORT_EXPORT_PERMIT | Autorisation import/export | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| CERTIFICATE_OF_ORIGIN | Certificat d'origine | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| CUSTOMS_DECLARATION | Déclaration en douane (note de détail) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| SOMMIER | Sommier de déclaration | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| BAE | Bon à Enlever | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| COMMERCIAL_INVOICE | Facture commerciale (valeur douane) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |

### Table B — Lifecycle
| Code | Required BEFORE which stage | Expiration period | Renewal process | Responsible role |
|---|---|---|---|---|
| DPI | ______ | ______ | ______ | ______ |
| APE_AUTHORIZATION | ______ | ______ | ______ | ______ |
| EXONERATION_TITLE | ______ | ______ | ______ | ______ |
| TAX_EXEMPTION_CERT | ______ | ______ | ______ | ______ |
| DUTY_EXEMPTION_AUTH | ______ | ______ | ______ | ______ |
| SECTOR_AUTHORIZATION | ______ | ______ | ______ | ______ |
| IMPORT_EXPORT_PERMIT | ______ | ______ | ______ | ______ |
| CERTIFICATE_OF_ORIGIN | ______ | ______ | ______ | ______ |
| CUSTOMS_DECLARATION | ______ | n/a? confirm | ______ | ______ |
| SOMMIER | ______ | ______ | ______ | ______ |
| BAE | ______ | n/a? confirm | ______ | ______ |
| COMMERCIAL_INVOICE | ______ | n/a? confirm | ______ | ______ |

## 2.2 Commercial & transport documents

### Table A — Identity
| Code | Document name (FR) | Imp/Exp/Both | M/O | Issuing authority |
|---|---|---|---|---|
| PURCHASE_ORDER | Bon de commande / instruction client | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| QUOTATION | Cotation approuvée | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| COMMERCIAL_CONTRACT | Contrat commercial | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| PROFORMA_INVOICE | Facture proforma | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| BILL_OF_LADING | Connaissement (BL) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| AIRWAY_BILL | LTA / AWB | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| BOOKING_CONFIRMATION | Confirmation de booking | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| PACKING_LIST | Liste de colisage | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| DELIVERY_NOTE | Bon de livraison / instruction | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| CMR_WAYBILL | Lettre de voiture (CMR) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| TRANSPORT_ORDER | Ordre de transport (sous-traitant) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |

### Table B — Lifecycle
| Code | Required BEFORE which stage | Expiration period | Renewal process | Responsible role |
|---|---|---|---|---|
| PURCHASE_ORDER | ______ | n/a? | ______ | ______ |
| QUOTATION | ______ | ______ | ______ | ______ |
| COMMERCIAL_CONTRACT | ______ | ______ | ______ | ______ |
| BILL_OF_LADING | ______ | n/a? | ______ | ______ |
| AIRWAY_BILL | ______ | n/a? | ______ | ______ |
| BOOKING_CONFIRMATION | ______ | ______ | ______ | ______ |
| PACKING_LIST | ______ | n/a? | ______ | ______ |
| CMR_WAYBILL | ______ | n/a? | ______ | ______ |
| TRANSPORT_ORDER | ______ | n/a? | ______ | ______ |

## 2.3 Operational & financial documents

### Table A — Identity
| Code | Document name (FR) | Imp/Exp/Both | M/O | Issuing authority |
|---|---|---|---|---|
| PICKUP_ORDER | Bon d'enlèvement / release | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| WAREHOUSE_RECEIPT | Bon de magasinage | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| PORT_HANDLING_DOC | Document de manutention portuaire | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| POD | Bon de livraison déchargé (POD) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| DUTY_PAYMENT_RECEIPT | Quittance de droits et taxes | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |
| DISBURSEMENT_RECEIPT | Reçu de débours (Orbus) | ☐ Imp ☐ Exp ☐ Both | ☐ M ☐ O | ______ |

### Table B — Lifecycle
| Code | Required BEFORE which stage | Expiration period | Renewal process | Responsible role |
|---|---|---|---|---|
| PICKUP_ORDER | ______ | n/a? | ______ | ______ |
| WAREHOUSE_RECEIPT | ______ | ______ | ______ | ______ |
| PORT_HANDLING_DOC | ______ | n/a? | ______ | ______ |
| POD | ______ | n/a | ______ | ______ |
| DUTY_PAYMENT_RECEIPT | ______ | n/a? | ______ | ______ |
| DISBURSEMENT_RECEIPT | ______ | n/a? | ______ | ______ |

## 2.4 Missing document types
List any Effitrans document not above (especially sector-specific oil & gas / mining forms):
| Document name (FR) | Imp/Exp/Both | M/O | Issuing authority | Expires? | Responsible role |
|---|---|---|---|---|---|
| ______ | ______ | ______ | ______ | ______ | ______ |
| ______ | ______ | ______ | ______ | ______ | ______ |
| ______ | ______ | ______ | ______ | ______ | ______ |

---

# 3. Expiry Engine Rules / Règles du moteur d'expiration

> Only documents marked as expiring in Section 2 appear here. For each, define alerting and whether expiry **blocks** the workflow or only **warns**.

| Document (code) | Alert windows (tick) | Block or warn? | Escalation recipients | Required action on alert |
|---|---|---|---|---|
| DPI | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| APE_AUTHORIZATION | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| EXONERATION_TITLE | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| TAX_EXEMPTION_CERT | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| DUTY_EXEMPTION_AUTH | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| SECTOR_AUTHORIZATION | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| IMPORT_EXPORT_PERMIT | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| CERTIFICATE_OF_ORIGIN | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| SOMMIER | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |
| (other) ______ | ☐30 ☐15 ☐7 ☐3 ☐1 — other: ___ | ☐ Block ☐ Warn | ______ | ______ |

**Cross-cutting expiry questions**
- Is the validity period **fixed per document type**, or **read from each document instance** (user enters expiry on upload)? → ______
- Who is **accountable** for renewing an expiring document by default? → ______
- Should the **client** be alerted via the portal when their document is expiring (Phase 2)? → ☐ Yes ☐ No
- When a document expires mid-operation, what is the exact **blocking behaviour** (hard stop vs supervisor override)? → ______

---

# 4. Customs Workflow Validation / Validation du circuit douanier

For each customs sub-process, confirm the trigger, responsible role, required documents, and what conditions **block** progression.

## 4.1 DPI (Demande de Pré-Importation)
| Field | Answer |
|---|---|
| When is it triggered (which files / goods)? | ______ |
| Responsible role | ______ |
| Required documents to produce it | ______ |
| Blocking conditions (no DPI ⇒ cannot…?) | ______ |
| Validity / expiry once issued | ______ |

## 4.2 GAINDE declaration
| Field | Answer |
|---|---|
| Trigger (when is the declaration prepared?) | ______ |
| Responsible role | ______ |
| Required documents | ______ |
| Why are declarations often made late (at arrival)? Can the system push earlier? | ______ |
| Blocking conditions | ______ |
| What reference(s) does GAINDE return that we must capture? | ______ |

## 4.3 Exoneration titles (titres d'exonération)
| Field | Answer |
|---|---|
| Trigger (which regimes / clients / sectors?) | ______ |
| Responsible role (prepare / validate) | ______ |
| Required supporting documents | ______ |
| Typical validity period | ______ |
| Blocking conditions if missing/expired | ______ |
| Renewal process & lead time | ______ |

## 4.4 BAE (Bon à Enlever)
| Field | Answer |
|---|---|
| Trigger / pre-conditions to obtain it | ______ |
| Responsible role | ______ |
| Required documents | ______ |
| Does anything block after BAE (e.g. payment, scanner)? | ______ |

## 4.5 Customs inspections (visites / scanner)
| Field | Answer |
|---|---|
| When do inspections occur (circuit colors?)? | ______ |
| Responsible role to manage | ______ |
| How should the system represent an inspection state/hold? | ______ |
| Blocking conditions / typical delays | ______ |
| Documents produced by an inspection | ______ |

## 4.6 Customs disputes (litiges) — *(tracking is Phase 3; capture rules now)*
| Field | Answer |
|---|---|
| What triggers a dispute (penalty, reassessment, seizure)? | ______ |
| Responsible role | ______ |
| Required documents | ______ |
| Should an open dispute block archiving of the file? | ☐ Yes ☐ No → ______ |
| Where are disputes tracked today? | ______ |

---

# 5. POD Validation Rules / Règles de validation du POD

| Question | Answer |
|---|---|
| What documents constitute a **valid** POD? (signed bordereau déchargé? stamp? consignee signature?) | ______ |
| Who is authorized to **validate** the POD? (proposed: Account Manager only) | ☐ Confirm AM-only / Other: ______ |
| What **evidence** must be attached (scan, photo, e-signature)? | ______ |
| Is a digital/photographed POD acceptable, or must the original be filed? | ______ |
| **Exceptions:** can a file close **without** a standard POD (e.g. some export/destination cases)? Under what rule? | ______ |
| **Overrides:** who can override the POD gate, and what must be logged? | ______ |
| For destination delivery (export), who collects/validates POD (destination agent vs AM)? | ______ |

---

# 6. Notification Matrix / Matrice de notifications

> For each event, confirm the recipient(s), channel, and whether it is sent **immediately** or batched into a **digest**. Channels: E=Email, S=SMS, W=WhatsApp (Phase 2), P=Portal. Add events at the bottom.

| Event | Recipient(s) | Channel (E/S/W/P) | Immediate / Digest |
|---|---|---|---|
| File opened | ______ | ______ | ☐ Imm ☐ Digest |
| Declarant assigned | ______ | ______ | ☐ Imm ☐ Digest |
| Declaration validated by Chief | ______ | ______ | ☐ Imm ☐ Digest |
| Declaration **rejected** by Chief | ______ | ______ | ☐ Imm ☐ Digest |
| Finance registered | ______ | ______ | ☐ Imm ☐ Digest |
| BAE obtained | ______ | ______ | ☐ Imm ☐ Digest |
| Transport assigned / dispatched | ______ | ______ | ☐ Imm ☐ Digest |
| Delivered | ______ | ______ | ☐ Imm ☐ Digest |
| **POD validated** | ______ | ______ | ☐ Imm ☐ Digest |
| Document **expiring** (per window) | ______ | ______ | ☐ Imm ☐ Digest |
| Document **expired / file blocked** | ______ | ______ | ☐ Imm ☐ Digest |
| Missing document detected before arrival | ______ | ______ | ☐ Imm ☐ Digest |
| Customs inspection / hold | ______ | ______ | ☐ Imm ☐ Digest |
| File stuck in stage > threshold | ______ | ______ | ☐ Imm ☐ Digest |
| Client status change (portal) | ______ | ______ | ☐ Imm ☐ Digest |
| (add) ______ | ______ | ______ | ☐ Imm ☐ Digest |

**Defaults if unspecified:** Email + SMS, immediate, to the Account Manager + the role responsible for the next action. Confirm or override above.

---

# 7. Integration Reality Check / Vérification des intégrations

> Be precise — this decides whether Phase 1 captures references manually or builds a real integration. **When unsure, mark "Manual only" and we proceed with reference-tracking.**

| System | API available? | File export? | CSV/Excel export? | Manual only? | Login required? | Who owns access? | Notes |
|---|---|---|---|---|---|---|---|
| **GAINDE** | ☐ Yes ☐ No ☐ Unknown | ☐ Yes ☐ No | ☐ Yes ☐ No | ☐ | ☐ Yes ☐ No | ______ | ______ |
| **Orbus Infinity** | ☐ Yes ☐ No ☐ Unknown | ☐ Yes ☐ No | ☐ Yes ☐ No | ☐ | ☐ Yes ☐ No | ______ | ______ |
| **Maya** (invoicing) | ☐ Yes ☐ No ☐ Unknown | ☐ Yes ☐ No | ☐ Yes ☐ No | ☐ | ☐ Yes ☐ No | ______ | ______ |
| **Sage** (accounting) | ☐ Yes ☐ No ☐ Unknown | ☐ Yes ☐ No | ☐ Yes ☐ No | ☐ | ☐ Yes ☐ No | ______ | ______ |

**Follow-up per system**
- GAINDE: which exact reference numbers/fields must the platform store and display? → ______
- GAINDE: is there any official Gaïndé 2000 integration programme / web service we can request access to? → ______
- Orbus Infinity: what disbursement data can be exported, and in what format? → ______
- Maya → replacement timing (Phase 2): any data we must read from Maya in the meantime? → ______
- Sage: what should eventually flow Effitrans-platform → Sage (billed files), and in what format (CSV/API)? → ______

---

# Decision Log / Journal des décisions

Record every confirmed rule. This becomes the authoritative source the development docs are updated against.

| # | Topic | Decision (final rule) | Decided by | Date | Updates which doc |
|---|---|---|---|---|---|
| 1 | ______ | ______ | ______ | ______ | ______ |
| 2 | ______ | ______ | ______ | ______ | ______ |
| 3 | ______ | ______ | ______ | ______ | ______ |
| 4 | ______ | ______ | ______ | ______ | ______ |
| 5 | ______ | ______ | ______ | ______ | ______ |
| 6 | ______ | ______ | ______ | ______ | ______ |
| 7 | ______ | ______ | ______ | ______ | ______ |
| 8 | ______ | ______ | ______ | ______ | ______ |

---

# Open Questions / Questions ouvertes

Anything unresolved at the end of the workshop. Each must get an owner and a due date before development of the affected sprint begins.

| # | Open question | Affects (doc / sprint) | Owner | Due date | Status |
|---|---|---|---|---|---|
| 1 | ______ | ______ | ______ | ______ | ☐ Open |
| 2 | ______ | ______ | ______ | ______ | ☐ Open |
| 3 | ______ | ______ | ______ | ______ | ☐ Open |
| 4 | ______ | ______ | ______ | ______ | ☐ Open |
| 5 | ______ | ______ | ______ | ______ | ☐ Open |

**Pre-loaded open questions from the planning docs (must be answered here):**
| Ref | Question |
|---|---|
| BLK-1 | GAINDE / Orbus real API availability? (Section 7) |
| BLK-3 | Complete document list + validity periods + block-vs-warn (Sections 2–3) |
| BLK-6 | File-numbering scheme per type |
| BLK-10 | POD acceptance criteria (Section 5) |
| BLK-SM2 | Which checklist items are mandatory vs advisory per stage |
| BLK-SM4 | Legitimate backward (rework) transitions |
| BLK-DC3 | Validity fixed per type vs entered per instance |

---

# Sign-off / Validation finale

By signing, the parties confirm the decisions recorded above are the agreed business rules for Phase 1 development. Changes after sign-off go through the Decision Log with a new dated entry.

| Role | Name | Signature | Date |
|---|---|---|---|
| Chief of Transit (business owner) | ______ | ______ | ______ |
| Operations / Coordination (witness) | ______ | ______ | ______ |
| Project facilitator | ______ | ______ | ______ |
| IT / Development lead | ______ | ______ | ______ |

**Post-workshop action:** the facilitator updates [state-machine.md](../state-machine.md), [document-catalog.md](../document-catalog.md), [requirements.md](../requirements.md), and [architecture.md](../architecture.md) to match this signed Decision Log, then closes the corresponding `BLK-*` items.
