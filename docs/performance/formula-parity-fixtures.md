# ICTD / ICAM / IPAM — Formula Parity Fixtures (Phase 0C)

**Audit only.** Deterministic fixtures freezing the contracts of
`formula-contract-register.md`. Expected values were computed from the contract
formulas (including their exact rounding order) with an independent implementation —
NOT copied from workbook cells — and the methodology's own worked examples reproduce
exactly. Any future implementation must match every row to the cent shown.

Parameters assumed: the canonical PARAMETRES values (UD 1,00 · UF 0,50 · UA 0,30 ·
CCT 0,60/1,20 · CDP 1,00/1,40/1,30/1,30/1,50 · U_COT 1,00 · U_TE 0,80 ·
U_DPI 0/0/0,50/1,00 · FP 35/30/25/10 · score 40/60 · ICAM coefs/caps per §7.2 ·
IPAM 25/25/20/20/10 with sub-weights per §8).

## A. ICTD dossier (`ICTD = ROUND(ROUND(UD + UF·NF + UA·NPSH·CCT, 2) × CDP, …) + U_DPI + U_TE + U_COT`, final ROUND 2)

| Fixture | NF | NPSH | CCT | CDP | DPI | TE | Cot. | **Expected ICTD** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **F-ICTD-01 — the methodology §5.4 example** | 3 | 10 | EFFITRANS 1,20 | APE 1,40 | EFFITRANS 1,00 | EFFITRANS 0,80 | 2 | **12,34 UTD** (bloc 6,10 → ×1,40 = 8,54 → +3,80) |
| F-ICTD-02 — simple minimal | 1 | 1 | CLIENT 0,60 | SIMPLE 1,00 | SANS DPI | — | 0 | **1,68** |
| F-ICTD-03 — type SIMPLE | 2 | 5 | EFFITRANS | 1,00 | SANS DPI | — | 0 | **3,80** |
| F-ICTD-04 — type APE | 2 | 5 | EFFITRANS | 1,40 | SANS DPI | — | 0 | **5,32** |
| F-ICTD-05 — type DEP | 2 | 5 | EFFITRANS | 1,30 | SANS DPI | — | 0 | **4,94** |
| F-ICTD-06 — **normalization: historical « DPE » → DEP** *(repurposed by D1, 2026-08-28)* | 2 | 5 | EFFITRANS | 1,30 | SANS DPI | — | 0 | **4,94** — a historical row labelled DPE must land as DEP and produce exactly F-ICTD-05's value |
| F-ICTD-07 — type OG | 2 | 5 | EFFITRANS | 1,50 | SANS DPI | — | 0 | **5,70** |
| F-ICTD-08 — CCT CLIENT vs EFFITRANS (same dossier) | 2 | 5 | 0,60 / 1,20 | SIMPLE | SANS DPI | — | 0 | **2,90 / 3,80** (CCT touches only the SH term) |
| F-ICTD-09 — DPI ladder (1 facture, 2 SH, EFFITRANS CCT, SIMPLE) | 1 | 2 | 1,20 | 1,00 | SANS DPI / CLIENT-EXPÉDITION / CLIENT-GLOBALE / EFFITRANS | — | 0 | **2,22 / 2,22 / 2,72 / 3,22** |
| F-ICTD-10 — TE by CLIENT (no unit) | 1 | 2 | 1,20 | 1,00 | SANS DPI | CLIENT → 0 | 0 | **2,22** |
| F-ICTD-11 — cotations only added AFTER CDP | 0 | 0 | — (blank NPSH ⇒ SH term 0) | OG 1,50 | SANS DPI | — | 3 | bloc = 1,00 → ×1,50 = 1,50 → +3,00 = **4,50** (cotations NOT amplified by CDP) |
| F-ICTD-12 — blank dossier number | — | — | — | — | — | — | — | **entire row blank** (no zero, no charge) |
| F-ICTD-13 — CDP missing (type not in list) | 2 | 5 | 1,20 | ∅ | SANS DPI | — | 0 | **ICTD blank** (VLOOKUP fails ⇒ AL guard) |

## B. ICTD délai / SLA / FP chain

| Fixture | Inputs | Expected |
| --- | --- | --- |
| F-SLA-01 | DOSSIER COMPLET = Mon 2026-08-10, DATE BAE = Thu 2026-08-13, no holidays | délai = NETWORKDAYS−1 = **3 j ouvrés** |
| F-SLA-02 | same day complete/BAE | **0** (floor) |
| F-SLA-03 | complete Fri 2026-08-07, BAE Mon 2026-08-10 | **1** (weekend skipped) |
| F-SLA-04 | délai 3, SLA cible 3 | RESPECT SLA = **1**; cible 2 → **0** |
| F-SLA-05 | DATE BAE empty | délai blank ⇒ SLA blank ⇒ FP blank; **coverage ↓** |
| F-SLA-06 — holiday sensitivity (**Q3**) | complete 2026-08-14 (Fri), BAE 2026-08-17 (Mon); 2026-08-17 listed as férié | with férié: **0**; with FERIES empty (as shipped): **1** — same dossier, different délai |
| F-FP-01 — methodology §6.5 | SLA 0,90 · sans erreur 0,95 · sans redress. 0,98 · sans récl. 0,97 | FP = **0,9420**; score global (P=100) = 0,40×100 + 0,60×94,20 = **96,52** |
| F-FP-02 — one flag missing | 3 of 4 present | FP **blank**, dossier NOT covered (ICTD coverage counts FP presence) |
| F-FP-03 — all four at « OUI »/limits | erreur=OUI, redress=OUI, récl=OUI, SLA missed | FP = **0,0000** (not blank — evaluated and bad) |
| F-CONTRIB-01 | ICTD 12,34 · FP 0,9420 | contribution ajustée = ROUND(12,34×0,9420) = **11,62** |

## C. ICTD monthly / status / ranking

| Fixture | Inputs | Expected |
| --- | --- | --- |
| F-REC-01 | dossiers {12,34; 1,68; 4,94}, all in period | ICTD mensuel **18,96**; moyen/dossier **6,32** |
| F-REC-02 | ICTD 18,96, jours actifs 4 | UTD/jour **4,74** |
| F-REC-03 — pilot | cible vide | score productivité **blank**, score global **blank**, statut still computed |
| F-REC-04 — post-calibration | UTD/j 4,74, cible 5 | P = MIN(100; 94,8) = **94,8** |
| F-REC-05 — P cap | UTD/j 12, cible 5 | P = **100** (not 240) |
| F-STAT-01 | 0 dossiers | **« Aucune donnée »** |
| F-STAT-02 | 12 dossiers, coverage 70 % | **« Non classé »** |
| F-STAT-03 | 6 dossiers, coverage 100 % | **« Provisoire »** |
| F-STAT-04 | 12 dossiers, coverage 90 % | **« Classé »** |
| F-STAT-05 — ~~the Q2 precedence case~~ | **VOID (D2, 2026-08-28)** — the coverage rung it ordered is retired, so there is nothing to order: 5 dossiers → « Provisoire » regardless of any coverage notion |
| F-RANK-01 | scores {Classé 96,5; Classé 88; Provisoire 99; Classé 88} | ranks: 1, 2, —, 2 (ties share rank; Provisoire unranked) |
| F-COV-01 | 10 dossiers, 8 with all four quality flags | couverture qualité = **0,80** → exactly at threshold ⇒ NOT below ⇒ eligible |

## D. ICAM (per dossier)

| Fixture | Counts (NDOC,NREP,NAD,NPAY,NFACT,NCOORD,NINC,NCOUR) | Expected ICAM |
| --- | --- | --- |
| **F-ICAM-01 — methodology §7.4 example** | 6,3,2,1,2,2,1,1 | 1 + 0,60+0,45+0,50+0,30+0,30+0,60+0,50+0,20 = **4,45** |
| F-ICAM-02 — base only | all 0 | **1,00** |
| F-ICAM-03 — every cap saturated | 15,6,5,4,6,5,3,3 | 1 + 1,00+0,75+1,00+0,90+0,75+1,20+1,00+0,40 = **8,00** (hard ceiling per dossier) |
| F-ICAM-04 — single-activity caps | NDOC=11 → 1,00 (not 1,10); NREP=6 → 0,75; NCOUR=3 → 0,40 | each component individually capped |
| F-ICAM-05 — open dossier | H=« Ouvert » | ICAM computed (charge is tracked) but **Mois de clôture blank ⇒ excluded from every monthly KPI and count** |
| F-ICAM-06 — reprise imputable | per §9.1, an AM-caused rework must NOT increment counters | governance fixture: counters unchanged (enforced by validation, not formula) |

## E. IPAM (monthly)

| Fixture | Inputs | Expected |
| --- | --- | --- |
| **F-IPAM-01 — methodology §8.7 example** | P 80 · Q 90 · D 85 · C 92 · E 88 | **86,70** → « Très bonne performance » |
| F-IPAM-02 — Q dimension alone | QDOC 100 · QERR 80 · QTRAC 90 | Q = 35+28+27 = **90,00** |
| F-IPAM-03 — D dimension | DOUV 100 · DREP 80 · DFIN 100 · DCOORD 50 | D = 25+28+20+10 = **83,00** |
| F-IPAM-04 — C dimension | CRECL 100 · CRET 60 · CSAT 75 | C = 40+21+18,75 = **79,75** |
| F-IPAM-05 — E dimension | ECOUT 90 · ECTRL 100 · EFACT 50 | E = 45+30+10 = **85,00** |
| F-IPAM-06 — a dimension missing | Q blank (QERR never evaluated in month) | **IPAM blank** (all five required) — never renormalized over 4 |
| F-IPAM-07 — pilot | capacité cible vide ⇒ P blank | **IPAM blank**; statut « Provisoire » via the `G=""` rung |

## F. Governance fixtures (the rules AS calculations)

| Fixture | Case | Expected |
| --- | --- | --- |
| F-GOV-01 — blank ≠ success | QDOC left empty on a closed dossier | score blank; coverage flag **0**; month coverage ↓ |
| F-GOV-02 — « Non évalué » | explicitly selected | identical to F-GOV-01 (eligible, not evaluated) |
| F-GOV-03 — « Non applicable » | selected with justification | score blank; coverage flag **blank** ⇒ removed from numerator AND denominator |
| F-GOV-04 — imputability (CRECL truth table) | (fondée=Non) → 1 · (Oui, imputable Oui) → 0 · (Oui, imputable **Non**) → **1** · (Oui, imputable blank/« En analyse ») → score blank + coverage 0 | exactly as listed — an external-fault réclamation never penalizes; a pending analysis never auto-blames |
| F-GOV-05 — ECOUT truth table | engagé≤prévu → 1 · dépassement approuvé (Oui) → 1 · dépassement non approuvé (Non) → 0 · dépassement non adjugé → blank + coverage 0 | as listed |
| F-GOV-06 — CSAT guards | « Évalué » + note 4/5 → 0,80 · note 6/5 → blank (invalid) · « Non évalué » → blank + cov 0 · no survey ≠ 100 % | as listed |
| F-GOV-07 — <10 dossiers | 9 closed, everything else perfect | **Provisoire** |
| F-GOV-08 — coverage <80 % | 10 closed, global coverage 79 % | **Non classé** |
| F-GOV-09 — duplicate AM×month | two EQUIPE rows same AM+month | O=« DOUBLON » ⇒ **Non classé** (both) |
| F-GOV-10 — critical incident | EQUIPE M=« Oui » | **« Revue managériale — non classé »**, wins over volume/coverage rungs below it |
| F-GOV-11 — month boundary | dossier closed 2026-08-31 vs 2026-09-01 | `EOMONTH` windows: August vs September, no overlap, no gap |
| F-GOV-12 — M-1/M-2/trend | IPAM (M)=88 · (M-1)=82 · (M-2)=85 | M-1 82; M-2 85; moyenne 3 mois **85,0**; delta +6 > seuil 5 ⇒ **« Hausse »**; delta +4 ⇒ « Stable » |
| F-GOV-13 — trend needs 3 months | M-2 absent | moyenne blank; delta computed vs M-1 only if M-1 exists |
| F-GOV-14 — ranking same-month | AM ranked only against same `Mois de clôture`, Classé only | per AM-R31 |

**Freeze note (updated 2026-08-28):** F-ICTD-06 is repurposed as the D1 normalization fixture; F-STAT-05 is void under D2. Original text: F-ICTD-06 (DPE) and F-STAT-05 (precedence) were provisional pending
Q1/Q2. Every other fixture is derivable from methodology + canonical workbook in
agreement, and is frozen.
