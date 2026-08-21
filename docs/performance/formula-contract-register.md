# ICTD / ICAM / IPAM — Formula Contract Register (Phase 0B)

**Audit only.** Every calculation performed by the canonical workbooks, as a
contract. Source cells cite the canonical workbooks; methodology references cite the
« Note méthodologique » sections. Platform-source candidates are classified in
`platform-data-source-map.md`; this register states WHAT is computed and under WHICH
rules.

Register size: **112 column contracts** (ICTD-D×17, ICTD-R×20, AM-S×38, AM-R×36,
AM-E×1) **+ 12 governance contracts** (GOV-01…12) = **124 entries**.

Legend: *Blank rule* = behaviour when an input is empty. *N/A rule* = behaviour on
« Non applicable ». *Population* = which rows/dossiers feed it.

---

## A. ICTD — dossier level (sheet: each declarant tab, rows 2–201)

**Population:** every dossier row with `B (N° dossier)` non-empty. Every contract
below returns blank when `B` is blank (blank ≠ 0 ≠ success).

| ID | Business name | Formula (workbook, row-normalized) | Source cell | Méthodo |
| --- | --- | --- | --- | --- |
| ICTD-D01 | Date de référence | `IF(C="","",INT(C))` — date réception, time-stripped | col A | §13.2 |
| ICTD-D02 | Déclarant | constant per sheet (`"BAMBA"` …) | col E | §13.2 |
| ICTD-D03 | Compteur dossier | `IF(B="","",1)` | col AE | — |
| ICTD-D04 | **CCT** — coefficient classement tarifaire | `VLOOKUP(L, PARAMETRES!H2:I3, 2, FALSE)` → CLIENT 0,60 · EFFITRANS 1,20 | col AF | §5.2 |
| ICTD-D05 | **CDP** — coefficient type de déclaration | `VLOOKUP(N, PARAMETRES!E2:F6, 2, FALSE)` → SIMPLE 1,00 · APE 1,40 · DEP 1,30 · **DPE 1,30 (workbook-only)** · OG 1,50 | col AG | §5.2 + DV-01 |
| ICTD-D06 | **U_DPI** | `VLOOKUP(AA, PARAMETRES!K2:L5, 2, FALSE)` → SANS DPI 0 · CLIENT-EXPEDITION 0 · CLIENT-GLOBALE 0,50 · EFFITRANS 1,00 | col AH | §5.2 |
| ICTD-D07 | **U_TE** | `IF(K="EFFITRANS", B12, 0)` → 0,80 if EFFITRANS, else 0 (CLIENT or SANS OBJET) | col AI | §5.2 |
| ICTD-D08 | **U_COT** | `IF(W="",0, W × B11)` → 1,00 per cotation; empty count = 0 | col AJ | §5.2 |
| ICTD-D09 | **UTD BASE** (bloc principal) | `ROUND(UD + UF×N(NF) + UA×N(NPSH)×N(CCT), 2)` = `ROUND(B8 + B9×I + B10×J×AF, 2)` | col AK | §5.2 |
| ICTD-D10 | **ICTD dossier** | `IF(OR(U_DPI="",CDP=""),"", ROUND(AK×AG + AH + AI + AJ, 2))` | col AL | §5.2, §5.4 |
| ICTD-D11 | Délai de traitement (jours ouvrés) | `IF(OR(Q="",V=""),"", MAX(0, NETWORKDAYS.INTL(Q, V, 1, FERIES!A2:A50) − 1))` — Q = DOSSIER COMPLET, V = DATE BAE; weekend Sat–Sun; same-day = 0 | col AM | §13.3 |
| ICTD-D12 | Respect SLA (dossier) | `IF(OR(AM="",AD=""),"", −−(AM ≤ AD))` — AD = SLA cible saisi | col AN | §5.3 |
| ICTD-D13 | Sans erreur (dossier) | `IF(X="","", −−(X="NON"))` | col AO | §5.3 |
| ICTD-D14 | Sans redressement (dossier) | `IF(AB="","", −−(AB="NON"))` | col AP | §5.3 |
| ICTD-D15 | Sans réclamation (dossier) | `IF(AC="","", −−(AC="NON"))` | col AQ | §5.3 |
| ICTD-D16 | **FP dossier** | `IF(COUNT(AN:AQ)<4, "", ROUND(0,35×AN + 0,30×AO + 0,25×AP + 0,10×AQ, 4))` — **all four required** | col AR | §6.3 |
| ICTD-D17 | Contribution ajustée (dossier) | `IF(AR="","", ROUND(AL×AR, 2))` | col AS | §5.3 |

**Contract details that a re-implementation MUST reproduce:**
* **Rounding order:** the bloc principal is `ROUND(…,2)` **before** ×CDP, and the
  final ICTD is `ROUND(…,2)` again. FP is `ROUND(…,4)`; contribution `ROUND(…,2)`.
* Coefficients resolve at **calculation time** from PARAMETRES (a parameter change
  re-prices history in Excel — see GOV-11 versioning).
* `N()` coercion: empty NF/NPSH count as 0 in the bloc (but the dossier still scores).
* Inputs and their vocabularies: `L ∈ {CLIENT, EFFITRANS}`, `N ∈ TYPE_DECLARATION`,
  `AA ∈ DPI(4)`, `K ∈ {SANS OBJET, CLIENT, EFFITRANS}`, `X/AB/AC ∈ {OUI, NON}`
  (no N/A state on the declarant side).
* Input-only columns (captured, not consumed by any formula): D, F, G, H, M, O, P,
  R, S, T, U, Y, Z — process milestones for supervision/evidence.

## B. ICTD — monthly RECAP (sheet RECAP, one row per declarant)

**Population:** rows of the declarant tab with `A (date)` within
`[DATE_DEBUT, DATE_FIN]` (PARAMETRES B3/B4 — currently 06/08/2026–31/08/2026).

| ID | Business name | Formula | Cell | Méthodo |
| --- | --- | --- | --- | --- |
| ICTD-R01 | Nombre de dossiers | `COUNTIFS(tab!A, in period)` | B | §5.3 |
| ICTD-R02 | Nombre de factures | `SUMIFS(tab!I, in period)` | C | — |
| ICTD-R03 | Nombre de positions SH | `SUMIFS(tab!J, in period)` | D | — |
| ICTD-R04 | **ICTD charge (mensuel)** | `SUMIFS(tab!AL, in period)` — sum of dossier ICTDs | E | §5.3 |
| ICTD-R05 | Jours actifs | **MANUAL input** (only manual cell of RECAP) | F | §13.5 |
| ICTD-R06 | **UTD / jour** | `IF(OR(E=0,F="",F=0),"", E/F)` | G | §5.3 |
| ICTD-R07 | Cible UTD/jour | `IF(B5="","",B5)` — empty during pilot | H | §6.2 |
| ICTD-R08 | **Score productivité P** | `IF(OR(G="",H="",H=0),"", MIN(100, G/H×100))` | I | §6.2 |
| ICTD-R09..R12 | Taux SLA / sans erreur / sans redressement / sans réclamation | `Σ flag ÷ COUNT(ISNUMBER(flag))` in period — **denominator = evaluated dossiers only** | J,K,L,M | §5.3, §3.3 |
| ICTD-R13 | FP moyen | same evaluated-only average over AR | N | §6.3 |
| ICTD-R14 | **Score global** | `IF(OR(I="",N=""),"", ROUND(0,40×I + 0,60×N×100, 1))` | O | §6.4 |
| ICTD-R15 | Niveau | bands 90/75/60/40 → 5 labels | P | §11.3 |
| ICTD-R16 | **Statut** | `B=0 → "Aucune donnée"; T<80% → "Non classé"; B<10 → "Provisoire"; else "Classé"` | Q | §11.1 + DV-15 |
| ICTD-R17 | Contribution ajustée (mensuelle) | `SUMIFS(tab!AS, in period)` | R | §5.3 |
| ICTD-R18 | ICTD moyen / dossier | `IF(B=0,"", E/B)` | S | §5.3 |
| ICTD-R19 | **Couverture qualité** | `COUNT(rows in period with numeric FP) ÷ B` — a dossier counts as covered only when **all four** quality inputs are filled | T | §10.1 |
| ICTD-R20 | Part de charge | `E ÷ Σ(E5:E10)` | U | §5.3 |
| ICTD-R21 | Rang | `IF(Q≠"Classé","", 1 + Σ(Classé & score>mine))` — competition ranking, Classé only | V | §11.1 |

*(R05 is an input; 20 calculated columns + 1 manual = the RECAP row.)*

## C. ICAM — dossier level (sheet SAISIE DOSSIERS, rows 8–257)

**Population:** rows with `B (N° dossier)` non-empty. **Scoring population** (KPI
flags, closure month): additionally `H = "Clôturé"` and `G (date livraison/clôture)`
filled — open dossiers are tracked but not scored (§14.3).

| ID | Business name | Formula | Cell | Méthodo |
| --- | --- | --- | --- | --- |
| AM-S01..S08 | ICAM composantes (documents, reportings, autorisations, paiements, factures, coordinations, incidents, coursier) | `MIN(COEF_x × N(count), PLAF_x)` with (coef; plafond): NDOC (0,10; 1,00) · NREP (0,15; 0,75) · NAD (0,25; 1,00) · NPAY (0,30; 0,90) · NFACT (0,15; 0,75) · NCOORD (0,30; 1,20) · NINC (0,50; 1,00) · NCOUR (0,20; 0,40) | U..AB | §7.2–7.3 |
| AM-S09 | **ICAM dossier** | `ICAM_BASE + SUM(U:AB)` = 1 + capped components (max possible 8,00) | AC | §7.3 |
| AM-S10 | Écart engagé−prévu | `IF(OR(AQ="",AR=""),"", AR−AQ)` | AS | §8.6 |
| AM-S11 | **Mois de clôture** | `IF(OR(B="", H≠"Clôturé", G=""),"", EOMONTH(G,0))` | AX | §14.3 |
| AM-S12..S24 | **KPI score per dossier** (13): QDOC, QERR, QTRAC, DOUV, DREP, DFIN, DCOORD, CRECL, CRET, CSAT, ECOUT, ECTRL, EFACT | see truth tables below | AY,BA,…,BW (odd) | §8.3–8.6 |
| AM-S25..S37 | **KPI couverture per dossier** (13) | see coverage rules below | AZ,BB,…,BX (even) | §10.1 |
| AM-S38 | Ligne active | `IF(B="",0,1)` | BY | — |

**Score truth tables (the governance heart):**
* Simple Oui-favourable KPIs (QDOC, QTRAC, DOUV, DREP, DFIN, DCOORD, CRET, ECTRL,
  EFACT): `Oui→1 · Non→0 · Non évalué→"" (blank) · —` and coverage
  `Oui/Non→1 · Non évalué→0 · Non applicable→"" (excluded from denominator)`.
* Non-favourable KPI (QERR — erreur imputable): `Non→1 · Oui→0 · else ""` (same
  coverage shape).
* **CRECL (imputability-gated)**: `AK(réclamation fondée)="Non" → 1`;
  `AK="Oui" ∧ AL(imputable AM)="Oui" → 0`; `AK="Oui" ∧ AL="Non" → 1`
  (**founded but NOT imputable does not penalize**); `AK="Oui" ∧ AL blank → score
  blank AND coverage 0` (pending imputability reduces coverage, never auto-blames).
* **CSAT**: only when `AN="Évalué"` and `0 ≤ note ≤ max`, `MIN(1, AO/AP)`;
  « Non évalué » → blank + coverage 0 (**no survey ≠ 100 %**); « Non applicable » →
  excluded.
* **ECOUT**: `engagé ≤ prévu → 1`; else `écart approuvé/justifié = Oui → 1`,
  `Non → 0`, blank → blank. Coverage 1 only when amounts are numeric AND
  (within budget or écart adjudicated).

## D. IPAM — monthly RECAP (sheet RECAP, one row per AM × month from EQUIPE)

**Population:** SAISIE rows for that AM whose `G` falls in the month
(`EOMONTH(B,−1)+1 … B`) and `H="Clôturé"`.

| ID | Business name | Formula | Cell | Méthodo |
| --- | --- | --- | --- | --- |
| AM-R01/02 | AM / Mois | echo of EQUIPE J/K | A,B | §14.2 |
| AM-R03 | Dossiers clôturés | `COUNTIFS(D=AM, G in month, H="Clôturé")` | C | §11.2 |
| AM-R04 | **ICAM total** | `SUMIFS(AC …)` same filter | D | §7.3 |
| AM-R05 | Jours actifs | echo EQUIPE L (manual) | E | §14.2 |
| AM-R06 | **ICAM / jour actif** | `D/E` | F | §7.3 |
| AM-R07 | Capacité cible | per-AM EQUIPE G, else `CAPACITE_DEFAUT`, else blank | G | §8.2 |
| AM-R08 | **P** | `MIN(100, 100×F/G)` | H | §8.2 |
| AM-R09..R11 | QDOC/QERR/QTRAC (mois) | `100 × AVERAGEIFS(flag …)` — evaluated-only mean | I,J,K | §8.3 |
| AM-R12 | **Q** | all 3 present → `0,35×QDOC + 0,35×QERR + 0,30×QTRAC` | L | §8.3 |
| AM-R13..R16 | DOUV/DREP/DFIN/DCOORD | AVERAGEIFS as above | M..P | §8.4 |
| AM-R17 | **D** | all 4 present → `0,25/0,35/0,20/0,20` weights | Q | §8.4 |
| AM-R18..R20 | CRECL/CRET/CSAT | AVERAGEIFS | R..T | §8.5 |
| AM-R21 | **C** | all 3 → `0,40/0,35/0,25` | U | §8.5 |
| AM-R22..R24 | ECOUT/ECTRL/EFACT | AVERAGEIFS | V..X | §8.6 |
| AM-R25 | **E** | all 3 → `0,50/0,30/0,20` | Y | §8.6 |
| AM-R26 | **Couverture globale** | `Σ(13 coverage flags) ÷ Σ(13 eligible counts)` — eligible = coverage cell non-blank (N/A excluded); **13 sub-indicators pooled, P excluded** | Z | §10.1 |
| AM-R27 | Incident critique | echo EQUIPE M | AA | §11.2 |
| AM-R28 | **Statut de fiabilité** | ladder: `C=0 → Aucune donnée`; `EQUIPE O="DOUBLON" → Non classé`; `AA="Oui" → Revue managériale — non classé`; `C<10 → Provisoire`; `Z<80 % → Non classé`; `G="" → Provisoire`; else `Classé` | AB | §11.2 + DV-15 |
| AM-R29 | **IPAM** | **all five** dimensions present → `0,25×P + 0,25×Q + 0,20×D + 0,20×C + 0,10×E` | AC | §8.1 |
| AM-R30 | Niveau | bands 90/75/60/40 | AD | §11.3 |
| AM-R31 | Rang | same month, Classé only, competition rank | AE | §11.2 |
| AM-R32/33 | IPAM M-1 / M-2 | exact single-match lookup of the same AM at `EOMONTH(B,−1)/(B,−2)`; ambiguous/absent → blank | AF,AG | §3.5 |
| AM-R34 | Moyenne 3 mois | `AVERAGE(AC,AF,AG)` only when **all three** exist | AH | §3.5 |
| AM-R35 | Delta M-1 | `AC−AF` | AI | — |
| AM-R36 | **Tendance** | `>+SEUIL_TENDANCE → "Hausse"; <−seuil → "Baisse"; else "Stable"` (seuil = 5 pts) | AJ | §3.5 + DV-16 |
| AM-E01 | Contrôle unicité AM×mois | `COUNTIFS(J,K pair)=1 → "OK" else "DOUBLON"` | EQUIPE O | §11.2 |

## E. Governance contracts (calculation rules, not UI)

| ID | Contract | Enforced by | Méthodo |
| --- | --- | --- | --- |
| GOV-01 | **Blank ≠ success.** Missing input → blank score; never 1/100 | every score truth table; FP requires COUNT=4; IPAM requires all 5 dims | §3.3 |
| GOV-02 | **« Non évalué » ≠ conforme** — scores blank AND coverage 0 (eligible, not evaluated) | AM coverage columns | §3.3 |
| GOV-03 | **N/A excluded only under control** — « Non applicable » removes the item from the denominator; it is a selectable, auditable state, not a blank | AM coverage `=""` on N/A; list `Oui_Non_NonEval_NA` | §3.3, §10.1 |
| GOV-04 | **Imputability before penalty** — CRECL truth table; QERR is « erreur imputable »; NINC adds charge only when NOT imputable; Imputabilité list has « En analyse » (→ not yet a fault) | AM-S CRECL/NINC; LISTES F | §3.4, §10.2 |
| GOV-05 | **External causes not auto-attributed** — `Cause_Retard` list (9 causes incl. client, fournisseur, transporteur, administration, système, force majeure) is recorded for validation; no formula converts an external cause into a personal penalty | SAISIE L + K (input-only) | §3.4 |
| GOV-06 | **Minimum dossiers = 10** (`MIN_DOSSIERS` both workbooks) → below: Provisoire | ICTD-R16, AM-R28 | §11.1/11.2 |
| GOV-07 | **Coverage threshold = 80 %** (`COUVERTURE_MIN`/`SEUIL_COUVERTURE`) → below: Non classé | ICTD-R16/R19, AM-R26/R28 | §10.1 |
| GOV-08 | **Status ladder** incl. Aucune donnée / Provisoire / Non classé / Revue managériale (AM only) / Classé; duplicate AM×month → Non classé | ICTD-R16, AM-R28, AM-E01 | §11 |
| GOV-09 | **Critical incident blocks classification** (AM): « Revue managériale — non classé » | AM-R28 | §11.2 |
| GOV-10 | **Ranking eligibility** — Classé only; same-period comparison (AM rank filters on identical month) | ICTD-R21, AM-R31 | §11.2 |
| GOV-11 | **Parameters are governed** — single PARAMETRES source, named ranges, change requires justification/date/validation/version/non-retroactivity. ⚠ Excel itself recomputes history on change (no version pinning) — a platform implementation MUST pin parameter versions per period (the platform already owns this pattern: workflow-policy pinning) | PARAMETRES sheets | §17.2 |
| GOV-12 | **Pilot state** — capacité cible (ICTD B5, AM EQUIPE G / CAPACITE_DEFAUT) deliberately EMPTY → P, score global and IPAM stay blank; statuses still computable; ranking not exploitable before calibration | ICTD-R07/08/14, AM-R07/08/29 | §6.2, §8.2, §18 |
