# LOG-0 — Domain Classification

Every artifact classified into the mission's domain taxonomy. The pack divides into
five coherent groups; classification is group-level with per-file exceptions noted.
Evidence class per the source discipline: **[O]** observed in source · **[I]** inferred.

## Group A — KIT TRANSIT: Documents administratifs (28 docx)

**Domains:** Transit/Customs (primary) · Ocean Freight · Road Transport · Operations ·
Commercial. **Owner [I]:** Transit department; Operations for the bons.
**Classification:** blank fill-in operational document templates, customer- and
authority-facing.

| Sub-set | Files | Domain |
|---|---|---|
| Maritime transport docs (Connaissement, Direct Maritime, Manifeste) | 3 | Ocean Freight |
| Road/rail/river/intermodal waybills (Lettre de Voiture, CMR-style, CIM, TIR, Fluvial, Intermodale, Routier National) | 6 | Road Transport / Cross |
| Customs & regulatory (Déclaration en Douane, Autorisation de Transit, Certificat d'Origine) | 3 | Transit/Customs |
| Commercial (Facture Commerciale, Facture Pro Forma, Bon de Commande) | 3 | Commercial / Finance |
| Operational bons (Chargement, Livraison, Réception, Retour, Sortie, Dépôt) | 6 | Operations / Warehouse |
| Insurance (Certificat Assurance Transporteur, Déclaration, Police Cargo) | 3 | Compliance / Legal |
| Tracking & notices (Bulletin de Suivi, Avis d'Arrivée, Avis de Réclamation) | 3 | Operations / Customer Portal |
| Packing (Liste de Colisage) | 1 | Operations |

## Group B — KIT TRANSIT: Contrats et accords (22 docx, 1 exact duplicate)

**Domains:** Compliance/Legal (primary) · Transit/Customs. **Owner [I]:** Direction +
Transit. **Classification:** contract/agreement templates (customs representation,
transit commission, bonded warehousing, guarantees, franchises, data management,
dispute management, subcontracting). Internal/legal; low frequency; template-only.

## Group C — KIT SUPPLYCHAIN: correspondence letters (19 docx + 4 pdf/doc references)

**Domains:** Procurement/Vendor (folder 2) and Commercial/Operations (folder 3).
**Owner [I]:** Achats for folder 2; Commercial/Operations for folder 3.
**Classification:** business correspondence letter templates — each one is an
**exception-path communication**: goods rejection, incomplete delivery, defective
products, late shipment, substitution, return authorization, order-execution
incapacity, verbal-order confirmation. Placeholder-only ([LIEU], [DATE],
VOTREEMAIL@VOTRECIE.COM).

## Group D — PROGICIELS EXCEL (39 workbooks) — classified per file

Third-party freeware tools with demo data. **They are evidence of the *tool categories*
Effitrans collected — presumably capabilities it wants or performs in Excel today [I]** —
not of its actual registers.

| Workbook(s) | Domain | Platform echo |
|---|---|---|
| gestion-de-stock / Gestion-Stocks / gestionstock23 / Stock-Pratique / LOGICIEL DE GESTION DE STOCKS / gestion-de-stock-et-facturation (8 incl. 1 dup pair) | **Inventory / Warehouse** | none — the one unserved domain |
| admin-caisse-recettes | Finance (caisse) | 9.3A Caisse shell |
| ndf-formulaire-v5 (notes de frais, kms, TVA) | Finance (expense) | 11.0B/C expense documents |
| modele DEVIS · MODELE FACTURE (FCFA, TVA 18% + CA 5% — **Senegal-localized**) | Commercial / Finance | EC-3 quotation gap + invoice module |
| Registre de courriers (Arrivée/Départ/Délais/Statistiques) | **Enterprise Communications** | EC-1/EC-2 — and a POSTAL mail question |
| Gestion des EPI (PPE issue/return per agent) | HR (equipment) | HR-4 equipment custody |
| gestion-demandes-formation (requests/sessions/stages) | HR (training) | HR-6 training register |
| Tableau de bord RH (headcount, pyramide) | HR (reporting) | HR dashboards |
| suivi-personnel | HR | HR-2/HR-5 |
| reservation-vehicules · planning_interventions_machines | Road Transport / Fleet | transport module (partial) |
| gestion-de-projets · gestion_multiprojets · planning-pratique | Cross (planning) | process engine (different concept) |
| Calendrier de Planification des Transports (Group A's xlsx) | Operations planning | control tower (partial) |
| Suivi de comptes ×2 · Budget personnel · Loi PINEL · gestion_patrimoine_bati · chambres d'hôtels · générateur de mot de passe · MEMO ×2 · gestionnaires de fichiers ×3 (1 dup) · mailoutllok · Mon-planning-perso · Gestion du temps · vocabulary-list · bom-pratique · geromemo | **Out of scope** (personal/hotel/property/utility tools) | none — noise in the kit |

## Group E — Livres + course PDF (9 files, ~87 MB)

**Domain:** Training/Knowledge. Third-party published books (Scribd IDs): supply-chain
design, logistics outsourcing, industrial management, a 463-page logistics manual, a
16-page transport-to-logistics course. **Copyright-restricted — never commit.**
Relevant to a future knowledge/training feature only as *content Effitrans would license*,
not as platform requirements.

## Ownership summary

| Domain | Artifacts | Primary owner [I] |
|---|--:|---|
| Transit / Customs | 31 | Transit |
| Commercial / Quotation | 6 | Commercial (Cotation) |
| Procurement / Vendor | 13 | Achats (no platform module) |
| Operations / Warehouse bons | 8 | Operations |
| Inventory / Warehouse | 8 | **unassigned — no module** |
| Finance | 4 | Finance |
| HR | 5 | HR |
| Enterprise Communications | 1 | Operations/EC |
| Compliance / Legal | 25 | Direction |
| Training / Knowledge | 9 | — |
| Out of scope | 17 | — |
