# ICTD / ICAM / IPAM — Platform Data-Source Map (Phase 0D)

**Audit only — nothing implemented.** For every formula input: where the Effitrans
platform already owns the fact, and its sourcing class.

Classes: **AUTO** (platform fact, usable as-is) · **DERIVED** (computable from
existing platform facts, with the derivation noted) · **VALIDATED MANUAL** (human
judgement the methodology itself assigns to a validator) · **MANUAL** (human entry,
no validator gate required) · **NOT AVAILABLE** (no platform fact today — genuinely
new collection).

The governing principle from the GO: the target system must not reproduce Excel's
duplicate manual entry when the platform already owns the fact.

## A. Shared identity & population facts

| Input | Platform source | Class | Notes |
| --- | --- | --- | --- |
| Dossier identity / N° dossier | `operational_file.file_number` | **AUTO** | |
| Client | `operational_file.client_id → client` | **AUTO** | |
| Assigned Account Manager | `assign_commercial_owner` RPC → `assignment_event` (« Responsable client », TMS-1) | **AUTO** | designation is an audited act with history |
| Assigned Declarant | `customs:assign` + customs assignee (MAYA-P0.7-D) | **AUTO** | |
| Date réception | `operational_file.created_at` (or process intake reception) | **DERIVED** | ratify which timestamp is « réception » |
| Date ouverture Maya | platform equivalent = dossier creation / process `openDossierWorkflow` timestamp | **DERIVED** | the platform replaces Maya as source per DEC (Dossier = source of truth) |
| Date livraison / clôture | `transport_record` DELIVERED/POD timestamps; `operational_file` DELIVERED/CLOSED + `file_state_transition` | **AUTO** | Mois de clôture = EOMONTH of it (AM-S11) |
| Statut dossier (Ouvert/Clôturé/Annulé) | `operational_file.status` (+CANCELLED) | **AUTO** | mapping table needed to the 3-state list |
| Type d'opération (Import/Export/Transit/Transport/Entreposage/Autre) | `operational_file.type` | **AUTO** | vocabulary mapping |
| Jours actifs | HR attendance (`hr_attendance`, payroll snapshots HR-7) | **DERIVED → VALIDATED MANUAL** | methodology makes supervisor validation mandatory (§12); platform can PRE-FILL, validator confirms (Q9) |
| Jours fériés (FERIES) | **none** — no holiday calendar exists in the platform | **NOT AVAILABLE** | blocking for jours-ouvrés math (Q3); natural home: HR module reference table |

## B. ICTD inputs (declarant sheets)

| Input (col) | Platform source | Class | Notes |
| --- | --- | --- | --- |
| NF — nombre de factures (I) | count of dossier `document` rows `type_code='COMMERCIAL_INVOICE'` (active versions) | **DERIVED** | caveat: paper invoices not uploaded would undercount — ratify « facture traitée » = uploaded document |
| NPSH — positions SH (J) | **nothing stores SH line counts** | **NOT AVAILABLE** | Q4 — new capture at declarant step (or later GAINDE integration) |
| Titre d'exonération préparé par (K) | no TE fact/document-type flag today | **NOT AVAILABLE** | Q — could become a document type + « préparé par » attribute |
| Position tarifaire fournie par (L) | not modelled | **NOT AVAILABLE** | binary CLIENT/EFFITRANS at dossier level |
| Type déclaration (N) | `customs_record.regime` exists but uses another vocabulary (« Mise à la consommation »…) | **NOT AVAILABLE as-is** | Q5 — mapping or a dedicated field |
| Prise en charge DPI (AA) | not modelled | **NOT AVAILABLE** | Q6 |
| Nombre cotations (W) | `quotation` rows per dossier (QO-1 chain) | **AUTO** | « réellement réalisée et traçable » = sent/accepted states — ratify which statuses count |
| DOSSIER COMPLET date (Q) | derivable: the moment `missingCustomsDocCodes = ∅` (all required docs VERIFIED) — the platform computes this today (UAT-15) | **DERIVED** | needs an event/timestamp when completeness first holds (currently a live predicate, not a stored date) |
| DATE BAE (V) | `customs_record` release / `bae_reference` + `release_date`; BAE document | **AUTO** | proven in production (UAT-15: RELEASED + UAT-BAE-001) |
| SLA cible jours ouvrés (AD) | `lib/sla` policies exist per process | **DERIVED** | Q10 — policy-driven default with per-dossier override? |
| Erreur imputable (X) | not modelled | **VALIDATED MANUAL** | méthodo: saisie Superviseur, validation Responsable qualité |
| Redressement/pénalité imputable (AB) | not modelled | **VALIDATED MANUAL** | Finance/Qualité validation |
| Réclamation fondée (AC) | not modelled (no complaints register) | **VALIDATED MANUAL** | |
| RECEVABILITE (G) | `customs_record` receivability (MAYA-P0.7-A: RECEVABLE/NON_RECEVABLE/SOUS_RESERVE) | **AUTO** | input-only in workbook — platform already richer |
| VALIDATION CT (S) | `recordCustomsValidation` (PG-1, Chef de Transit) | **AUTO** | input-only in workbook |
| ENREGISTREMENT / GAINDE (T) | `recordGaindeRegistration` (MAYA-P1.1) | **AUTO** | |
| MANIFESTE / ETA (P/O) | `shipment` ETA fields (air/ocean intelligence) | **AUTO/DERIVED** | |

## C. ICAM activity counters (SAISIE M–T)

| Counter | Platform source | Class | Notes |
| --- | --- | --- | --- |
| NDOC — documents contrôlés/classés | `document` rows per dossier (uploaded+verified) | **DERIVED** | « distinct contrôlé et classé » ≈ verified versions; ratify whether upload alone counts |
| NREP — reportings formels | comms/notifications exist (`communication`, customer notices, messaging) | **DERIVED (partial)** | « prévu ou justifié, envoyé, horodaté » — platform has timestamps for its own sends; external emails not captured |
| NAD — autorisations de dépense | expense authorization chain (11.0B/C: `expense_authorization` + visas + voucher; SPENDING_AUTHORIZATION doc type) | **AUTO** | |
| NPAY — paiements en ligne | finance payments (`invoice` payments, payment proofs) | **AUTO/DERIVED** | « en ligne » subset — ratify |
| NFACT — factures fournisseurs contrôlées | `VENDOR_INVOICE` documents + verification | **AUTO** | |
| NCOORD — coordinations documentées | partial: process handoffs, tasks, messaging, audit events | **DERIVED (partial) / VALIDATED MANUAL** | definition is human (« événement documenté ») |
| NINC — retours/non-conformités NON imputables traités | no incident register | **NOT AVAILABLE → VALIDATED MANUAL** | imputability gate is mandatory anyway |
| NCOUR — récupérations physiques | **deposit/courier module** (`invoice_deposit` custody chain) | **AUTO (for deposits)** | other courier runs not modelled |

## D. IPAM sub-indicator facts (SAISIE AD–AV)

| KPI input | Platform source | Class | Notes |
| --- | --- | --- | --- |
| QDOC — dossier complet | required-documents engine (`missingCustomsDocCodes` / required doc types all VERIFIED) | **DERIVED** | the platform's own completeness, already governed |
| QERR — erreur imputable AM | not modelled | **VALIDATED MANUAL** | |
| QTRAC — Maya/tableau/checklist concordants | platform-internal consistency replaces the three-system comparison | **DERIVED (redefinition needed)** | in-platform: dossier/process/docs coherent by construction — ratify the platform-era definition |
| DOUV — ouverture dans le SLA | timestamps exist: réception (file created) → process opened (`openDossierWorkflow`) | **DERIVED (AUTO once SLA fixed)** | replaces manual Oui/Non |
| DREP — reporting/alertes SLA | platform sends (customer notices, alerts) have timestamps | **DERIVED (partial)** | |
| DFIN — autorisations/paiements/transmissions SLA | expense/payment/compta timestamps | **DERIVED** | |
| DCOORD — coordination sans retard imputable | imputability judgement | **VALIDATED MANUAL** | |
| Réclamation fondée / imputable AM | no register | **VALIDATED MANUAL** | |
| CRET — retour clôturé SLA | no returns register (NINC same gap) | **NOT AVAILABLE → VALIDATED MANUAL** | |
| Statut/Note satisfaction (CSAT) | no survey instrument | **NOT AVAILABLE** | Q11 |
| Montant prévu cotation (AQ) | `quotation` amounts | **AUTO** | |
| Montant engagé (AR) | expense authorizations / debours engaged | **DERIVED** | ratify the engaged-amount definition |
| Écart approuvé/justifié (AT) | expense approval chain carries approvals | **DERIVED / VALIDATED MANUAL** | |
| ECTRL — débours comparés avant engagement | expense flow order (authorization BEFORE engagement) is platform-enforceable | **DERIVED** | |
| EFACT — factures contrôlées/transmises SLA | vendor-invoice verification + transmission timestamps | **DERIVED** | |
| Cause retard / Imputabilité / Suspensions | causes list + validation | **VALIDATED MANUAL** | evidence fields, per DV-14 |
| Incident critique en analyse | not modelled | **VALIDATED MANUAL** (Direction) | |

## E. Classification totals

| Class | Count (of 47 distinct inputs) |
| --- | --- |
| AUTO | 13 |
| DERIVED (incl. partial) | 16 |
| VALIDATED MANUAL | 10 |
| MANUAL | 1 (jours actifs — with Q9 possibly → DERIVED+validation) |
| NOT AVAILABLE (new collection) | 7 — **NPSH, TE préparé-par, position fournie-par, type déclaration (vocabulaire), DPI, satisfaction, incident/retour register** (+ the FERIES calendar as reference data) |

**Reading:** ~60 % of the model's inputs are already platform facts or derivable
from them — including the entire ICTD skeleton except NPSH/type/DPI/TE, the whole
ICAM counter family except incidents, and every SLA timestamp the AM workbook
currently asks humans to re-type as Oui/Non. The genuinely new collections are the
customs-technical facts (NPSH, declaration type vocabulary, DPI, TE) and the
quality/claims/satisfaction registers.
