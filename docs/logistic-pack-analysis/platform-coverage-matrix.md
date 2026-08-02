# LOG-0 — Platform Coverage Matrix

Verdicts: SUPPORTED · PARTIALLY SUPPORTED · NOT SUPPORTED · SUPERSEDED · DUPLICATE ·
OUT OF SCOPE · REQUIRES MANAGEMENT DECISION (RMD) · REQUIRES LEGAL/REGULATORY
CONFIRMATION (RLC). Mapped against real entities/routes/permissions, not aspirations.

## A. KIT TRANSIT — Documents administratifs

| Artifact (template) | Verdict | Platform mapping |
|---|---|---|
| Connaissement Maritime | **SUPPORTED** | `BILL_OF_LADING` in the WES-4 catalog (`docs/document-catalog.md`); `public.document` + governance |
| Liste de Colisage | **SUPPORTED** | `PACKING_LIST` |
| Facture Commerciale | **SUPPORTED** | `COMMERCIAL_INVOICE` (valeur en douane) |
| Facture Pro Forma | **SUPPORTED** | `PROFORMA_INVOICE` |
| Bon de Commande | **SUPPORTED** | `PURCHASE_ORDER` |
| Déclaration en Douane | **SUPPORTED** | `CUSTOMS_DECLARATION` + customs_record lifecycle (7.1B) |
| Certificat d'Origine | **SUPPORTED** | `CERTIFICATE_OF_ORIGIN` |
| Bon de Livraison | **SUPPORTED** | `DELIVERY_NOTE` / `POD` |
| Lettre de Voiture (CMR-style) | **SUPPORTED** | `CMR_WAYBILL` |
| Avis d'Arrivée | **PARTIALLY** | `ARRIVAL_NOTICE` exists in ocean event model (7.2); as a *document type* it is not in the WES-4 catalog — RMD before adding |
| Manifeste de Cargaison | **PARTIALLY** | ocean/air track manifests as events, no doc type — RMD |
| Bulletin de Suivi | **SUPERSEDED** | live tracking (7.2/8.4) + portal replace a paper tracking report |
| Avis de Réclamation | **PARTIALLY** | Messaging/portal carry complaints; no claim entity — see gap G-7 |
| Bons (Réception/Retour/Sortie/Dépôt/Chargement) | **PARTIALLY** | `WAREHOUSE_RECEIPT`, `PICKUP_ORDER`, `PORT_HANDLING_DOC` cover part; Retour/Sortie/Dépôt as types — RMD (warehouse domain) |
| Insurance set (3) | **NOT SUPPORTED** | no insurance doc types, no policy tracking — RMD + RLC |
| Lettre de Voiture CIM / TIR / Fluviale / Intermodale / Routier National | **PARTIALLY** | CMR + AWB + BL exist; rail/river/TIR variants absent — RMD (does Effitrans use them at all?) |
| Autorisation de Transit | **PARTIALLY** | customs lifecycle covers Senegal chain; this generic form — RLC |

## B. Contrats et accords (22)

**All: PARTIALLY SUPPORTED, RMD + RLC.** The platform stores client contracts as a
concept (`COMMERCIAL_CONTRACT`, `client.has_contract` *gap* noted in the registry) but
has **no contract-instance entity** (parties, validity, renewal) for the 20+ customs
agreement kinds. Verdict: these are *legal templates* Effitrans issues offline; the
platform needs at most a typed document slot per contract, not a contract engine —
unless management says contract lifecycle matters (Q-LEG-1). One **DUPLICATE** pair.

## C. Correspondence letters (19)

**PARTIALLY SUPPORTED as a channel, NOT SUPPORTED as content.** `lib/comms` has the
template registry + queue + Resend; none of these 19 letters exists as a template.
Procurement letters additionally lack their domain (no vendor entity). Verdict per
letter: outbound template candidates for `lib/comms` **if and when** their triggering
workflow exists. Do not build letters for workflows that do not exist (gap G-8).

## D. PROGICIELS

| Workbook | Verdict | Mapping |
|---|---|---|
| Gestion des EPI | **SUPPORTED** | `hr_equipment` + custody + return outcomes (HR-4) — platform is *stronger* (maker rules, RLS, audit) |
| gestion-demandes-formation | **SUPPORTED** (register) / **PARTIALLY** (self-service requests = HRQ-P1, deferred) | `hr_training_*` (HR-6) |
| Tableau de bord RH | **SUPPORTED** | HR dashboards + effectifs KPIs; pyramide des âges absent (HRQ-P3-adjacent — reporting formulas unratified) |
| suivi-personnel | **SUPPORTED** | employee registry + leave + attendance (HR-1/2/5) |
| ndf-formulaire (notes de frais) | **PARTIALLY** | finance expense (11.0B/C) covers authorization; **mileage/kms reimbursement absent** — RMD |
| admin-caisse-recettes | **PARTIALLY** | 9.3A caisse shell exists; recette register semantics unbuilt |
| modele DEVIS + MODELE FACTURE | **PARTIALLY** | invoice module exists (renderer, UAT-proven); **quotation entity does not** — the ratified step-1 gap, EC-3 |
| Registre de courriers | **PARTIALLY** | EC-1 captures *email*; Départ = `communication_message`; **postal mail + legal response deadlines** unsupported — RMD (Q-COMM-1..3) |
| Stock suite (8) | **NOT SUPPORTED** | no inventory/warehouse module — the largest coherent uncovered domain (gap G-2) |
| reservation-vehicules / planning machines | **PARTIALLY** | transport assignment exists; a reservation calendar per vehicle does not — RMD |
| gestion-de-projets ×3 | **OUT OF SCOPE** | generic project tools; the process engine is the platform's model |
| Personal/hotel/property/utility set (17) | **OUT OF SCOPE** | kit noise — no business meaning for Effitrans |

## E. Livres / courses (9)

**OUT OF SCOPE** for platform features; copyright-restricted for the repo. A future
knowledge/training-content feature would license content, not commit it.

## Summary

| Verdict | Count (of 120) |
|---|--:|
| SUPPORTED | 13 |
| PARTIALLY SUPPORTED | 40 |
| NOT SUPPORTED | 12 |
| SUPERSEDED | 1 |
| DUPLICATE (redundant copies) | 3 |
| OUT OF SCOPE | 26 |
| RMD / RLC overlays | 45 / 26 |
| Reference-only (books, course, samples) | 25 |

**Reading:** the platform already out-models the kit's customs/document core. The
uncovered ground is procurement/vendor, inventory/warehouse, insurance, claims,
postal-mail registration and the quotation entity — each needing a management decision
before any table exists (per the mission: a spreadsheet tab is not a data model).
