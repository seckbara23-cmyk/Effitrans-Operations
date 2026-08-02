# LOG-0 — Spreadsheet Analysis

44 workbooks (39 PROGICIELS + 1 KIT planner + 4 legacy .xls among them). Structural
descriptions only; no cell data is committed beyond synthetic illustrations. 12 legacy
OLE files (.xls/.doc/.ppt) could not be safely parsed here and are inventoried for
manual review; their nature is inferable from siblings.

## Verdict framework

Every workbook received one of: **REPLACE** (platform already does it better) ·
**INTEGRATE** (platform should absorb the capability — gated on a decision) ·
**RETAIN-EXTERNAL** (legitimate external tool, no platform claim) · **DISCARD-NOISE**
(no business meaning for Effitrans).

## Individually significant workbooks

### MODELE FACTURE.xlsx — the one Senegal-localized artifact
Sheets: FACTURE, DEVIS. Line grid (désignation/qté/PU HT/total HT), then TOTAL HT →
TVA 18% → CA 5% → Net à payer; amount-in-words; RIB block; DG signature seat.
**Business rules vs presentation:** the 18%/5% cascade is a real (configurable) rule;
amount-in-words is presentation the platform's renderer already handles for invoices.
**Verdict: REPLACE** — invoices exist (UAT-proven); the DEVIS tab's model feeds EC-3.
**Import/export candidate:** none (template, no data).

### Registre de courriers.xlsm (VBA)
Sheets: Accueil · Arrivée · Départ · **Délais** · Supports · Services · Rédacteurs ·
Statistiques ×2 · Paramètres · Listes. Chrono numbering, multi-support
(électronique/postal/télécopie), `Délai légal en jours` → `Date limite de réponse`,
criticité, per-service routing, arrival/departure statistics.
**Real rules:** chrono sequence; deadline arithmetic; routing vocabulary.
**Verdict: INTEGRATE (partially)** — EC-1/EC-2 absorb the email half; postal +
deadlines are Q-COMM-1/2. Until then RETAIN-EXTERNAL for postal mail.

### ndf-formulaire-v5.xlsm (VBA)
Sheets: cb/saisie/BD/explic/ndf/cpt — expense claims with **mileage (kms compteur),
fuel, tolls, HT/TVA/TTC split**, bank reconciliation marks.
**Real rules:** mileage-based reimbursement exists as a practice [I].
**Verdict: INTEGRATE candidate** — 11.0B/C covers authorization; mileage rates are a
management decision (Q-FIN-2). RETAIN-EXTERNAL meanwhile.

### Gestion des EPI.xlsm / gestion-demandes-formation.xlsm / Tableau de bord RH / suivi-personnel
Issue-return per agent · request→session→stage · effectifs dashboard with age pyramid ·
personnel follow-up. **Verdict: REPLACE** — HR-4 custody, HR-6 training, HR dashboards
already exceed them (RLS, audit, maker rules). The pyramid/āge analytics are the only
extra — HR-9 territory, unratified formulas.

### admin-caisse-recettes.xls (legacy)
**Verdict: INTEGRATE candidate** into 9.3A caisse (recette register semantics) — manual
review needed to enumerate its actual columns before any claim.

### Stock suite (8 workbooks, 1 dup pair)
Consistent shape across them [I from parsed ones]: articles · entrées · sorties ·
inventaire · alertes seuil · (one adds facturation).
**Verdict: INTEGRATE only if management opens the warehouse domain (Q-OPS-1 / G-2)**;
RETAIN-EXTERNAL until then. **Duplicated data entry risk:** stock-facturation overlaps
the invoice module — two sources of truth if both live.

### reservation-vehicules.xlsm / planning_interventions_machines
Vehicle/room-style reservation calendars, French holidays baked in.
**Verdict: INTEGRATE candidate** for fleet reservation (transport module has assignment,
not reservation); RETAIN-EXTERNAL meanwhile.

### Calendrier de Planification des Transports.xlsx (KIT)
Single sheet, sample lanes (Shanghai→Rotterdam…). **Verdict: REPLACE** — control tower
+ shipments already model real movements; this is a sample, not a register.

## The rest

Suivi de comptes ×2, Budget personnel, Loi PINEL, patrimoine bâti, chambres d'hôtels,
générateur de mots de passe, MEMO ×2, gestionnaires de fichiers ×3 (dup pair),
mailoutllok, planning perso, Gestion du temps, vocabulary-list, bom-pratique, geromemo,
gestion-de-projets ×3: **DISCARD-NOISE / OUT OF SCOPE** (personal-productivity and
unrelated-vertical freeware bundled with the kit). No import target, no platform claim.

## Cross-cutting cautions

* **VBA everywhere** (27 xlsm) — macros were NOT executed during this audit; static
  ZIP/XML reads only.
* **No workbook is a data source** for the platform: all demo data. The
  import-pipeline idiom (FIN-AGING/HR staging) remains the pattern *if* Effitrans later
  supplies real registers to migrate.
* Legacy .xls manual-review list: admin-caisse-recettes, Budget personnel, générateur
  de mot de passe, Gestion du temps, Gestion-Stocks, gestionstock23, Loi PINEL,
  modele DEVIS, Modèle-de-gestion-de-stock + le-connaissement.doc + 2 .ppt courses.
