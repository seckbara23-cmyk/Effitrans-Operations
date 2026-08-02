# LOG-0 — Gap Register (ranked)

Ranked by (risk × operational reach), deliberately deflated: an observation is not a
feature. Every gap cites its evidence and its existing coverage.

| # | Gap | Kind | Evidence | Dept | Existing coverage | Recommended response | Phase home | Dependency | Risk | Priority |
|--:|---|---|---|---|---|---|---|---|---|---|
| G-1 | **Quotation entity absent** (devis → acceptance → conversion) | critical workflow | MODELE FACTURE DEVIS tab [O]; process registry step 1 verdict `missing` [R] | Commercial | intake skips cotation; invoice exists | implement per EC-0 ADR-EC-2 | **EC-3** (exists) | Q-COM-1..7 + DEC-EC-D5 | revenue leakage, untracked commitments | **P1** |
| G-2 | **Inventory/Warehouse domain absent** | data-model | 8 stock workbooks collected [O]; warehouse bons in KIT [O] | Operations | `WAREHOUSE_RECEIPT` doc type only | management decision FIRST — is warehousing a real Effitrans service? | **new phase (WH-0 audit)** if confirmed | Q-OPS-1 | two-sources-of-truth if Excel persists | **P2** |
| G-3 | **Vendor/procurement domain absent** | data-model | 13 procurement letters + PO template [O] | Achats | none (client-only party model) | decision first; letters imply the practice exists | new phase (PROC-0) | Q-PROC-1..3 | vendor exceptions handled off-platform | P2 |
| G-4 | **Postal mail + response deadlines outside EC** | integration | Registre de courriers: Supports + Délais sheets [O] | Operations/EC | EC-1 email-only | manual postal capture form + deadline field in EC-2 — **if ratified** | EC-2 extension | Q-COMM-1..2 | legal response deadlines missed | P2 |
| G-5 | **Insurance documents untracked** | document-catalog | 3 insurance templates [O] | Transit/Compliance | none | add 1–2 doc types + expiry reuse — after RLC | WES-4 catalog addition | Q-LEG-2 | uninsured cargo undetected | P2 |
| G-6 | **Quotation validity/acceptance evidence undefined** | compliance | absent from all sources [O-negative]; registry requires actor+date [R] | Commercial | registry fields named, nothing stores them | ratify evidence format before EC-3 | EC-3 | Q-COM-3/5 | disputes over accepted price | P1 (blocks G-1) |
| G-7 | **Claim/réclamation entity absent** | workflow | Avis de Réclamation template [O]; support conversations exist [R] | Operations | messaging only — no state, no outcome | decision: entity vs conversation-tag | new (CLM-0) or portal ext. | Q-OPS-3 | claims lost in chat history | P3 |
| G-8 | **Outbound letter templates: 19 exist on paper, ~0 in lib/comms** | usability/automation | letters [O]; comms hub template registry [R] | all | engine ready, content absent | add templates **only for workflows that exist** (delay notice, arrival notice first) | incremental, with owning phases | per-letter workflow | manual drafting continues | P3 |
| G-9 | **Mileage/fuel expense reimbursement unmodeled** | data-model | ndf workbook (kms, gazole) [O] | Finance | 11.0B/C authorization only | rate table is a management decision | finance minor phase | Q-FIN-2 | off-book reimbursements | P3 |
| G-10 | **Rail/TIR/river waybill types absent** | document-catalog | 4 waybill templates [O] | Transit | CMR/BL/AWB only | ask before adding — modes may be unused | catalog addition | Q-OPS-2 | none if modes unused | P4 |
| G-11 | Vehicle reservation (vs assignment) | usability | reservation workbook [O] | Transport | assignment exists | candidate for fleet phase | future | Q-OPS-4 | double-booking | P4 |
| G-12 | Caisse recette register semantics | data-model | admin-caisse workbook [O, legacy] | Finance | 9.3A shell | manual review of workbook, then decide | 9.3A continuation | manual review | P4 |
| G-13 | Contract-instance lifecycle (22 agreement kinds) | data-model | contract templates [O] | Direction | `COMMERCIAL_CONTRACT` type + has_contract gap | typed document slots probably suffice — confirm | HR-3-style doc typing | Q-LEG-1 | renewal dates missed | P4 |
| G-14 | Duplicate files in the source pack | duplicate/manual | 3 exact pairs [O] | — | n/a | Effitrans housekeeping; no platform action | none | — | none | P5 |

## Improvement opportunities (not gaps)

| # | Opportunity | Kind | Note |
|--:|---|---|---|
| I-1 | Quotation→invoice shared line model | automation | evidenced by the shared DEVIS/FACTURE shape [O]; conversion = projection, no re-keying |
| I-2 | File-number detection in inbound mail | AI-assist | EC-5, suggestions-only; the letters show refs are quoted in correspondence |
| I-3 | Type classification of inbound PDFs (invoice/BL/packing list) | AI-assist | docintel already has the doctrine + FR/EN classifier |
| I-4 | Arrival-notice capture → ETA update *suggestion* | AI-assist | never auto-write; ocean events exist |
| I-5 | Outbound delay/arrival notices from lifecycle events | automation | customer-notify pattern already proven |
| I-6 | Response-deadline attention item in EC-2 | reporting | live-computed, no scheduler — the standing pattern |
| I-7 | Amount-in-words on quotation PDF | usability | renderer already does it for invoices |
| I-8 | Insurance expiry surfacing | reporting | `expiry_date` idiom reuse |
| I-9 | Age-pyramid / effectifs analytics | reporting | HR-9 territory; formulas need ratification |
| I-10 | Knowledge/training content home | future | books show demand; licensing, not committing |
