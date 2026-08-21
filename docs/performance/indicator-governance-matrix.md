# ICTD / ICAM / IPAM — Indicator Governance Matrix (Phases 0E–0F)

**Audit only.** Who supplies, validates and consumes each fact — merged from the
methodology (§12) and the AM workbook's own per-KPI dictionary
(PARAMETRES A32:G47), which refines it. Plus the pilot rules as explicit state.

## 1. Role boundaries (§12, verbatim intent)

| Actor | Supplies | Validates | Consumes |
| --- | --- | --- | --- |
| **Déclarant** | daily dossier facts in his/her own sheet: volumes (NF, NPSH), dates, type, DPI/TE/cotations, operational fields; keeps proofs | — | own indicators (read) |
| **Account Manager** | one SAISIE row per dossier: activity counters, dates, and the results **of which they are the source**; proofs in Maya/platform | — | own indicators (read) |
| **Superviseur / responsable de service** | QERR & CRECL raw events (per dictionary) | completeness; coefficients/exceptions; jours actifs; SLA; causes; **imputabilité**; « Non applicable »; double counting | team steering |
| **Responsable Qualité** | — | imputable errors & conformity items; incident analysis | quality view |
| **Finance / Comptabilité** | — | economic indicators: débours, surcoûts, contrôles, transmissions de factures (ECOUT/ECTRL/EFACT) | economic view |
| **Contrôle de gestion / Direction** | — | consolidation; **calibration of targets**; comparability; parameter-change approval | reviews, calibration |
| **Management** | — | — | workload balancing, coaching, improvement — **never automatic sanction** |

**Self-evaluation limit (§12):** the collaborator records facts they know; sensitive
elements (imputability, causes, N/A, parameters) bind only after validation.
**An unvalidated self-entry can never establish imputability.**

## 2. Per-KPI saisie/validation owners (workbook dictionary A32:G47)

| KPI | Saisie | Validation |
| --- | --- | --- |
| ICAM (charge) | Account Manager | Superviseur |
| P (productivité) | Superviseur (jours actifs) | Direction / Contrôle de gestion (cible) |
| QDOC | Account Manager | Superviseur |
| **QERR** | **Superviseur** | **Responsable qualité** |
| QTRAC | Account Manager | Superviseur |
| DOUV / DREP / DFIN / DCOORD | Account Manager | Superviseur |
| **CRECL** | **Superviseur** | **Management** |
| CRET | Account Manager | Superviseur |
| **CSAT** | **Superviseur** | **Management** |
| ECOUT / ECTRL / EFACT | Account Manager | **Finance / Superviseur** |

Note the pattern: anything that can **blame** (QERR, CRECL) or **rate satisfaction**
is NOT entered by the person being measured.

## 3. Governance rules as calculation contracts (cross-ref GOV-01…12)

| Rule | Where it is a FORMULA (not advice) |
| --- | --- |
| Blank ≠ success | every truth table returns blank on missing input; FP needs 4/4; Q/D/C/E need all sub-KPIs; IPAM needs all 5 dimensions |
| « Non évalué » ≠ conforme | score blank + coverage 0 |
| N/A only under control | separate list value; removes from numerator AND denominator; justification via proof column + supervisor validation |
| Imputability before penalty | CRECL two-key truth table (fondée × imputable); « En analyse » never penalizes; QERR is defined as **imputable** error |
| External causes not auto-attributed | Cause_Retard (9 external causes) recorded as evidence; no formula converts a cause into a score |
| Minimum volume | MIN_DOSSIERS = 10 → Provisoire below |
| Coverage threshold | 80 % → Non classé below; coverage = évalués ÷ éligibles (N/A out) |
| Provisional / non-classified / classified | status ladders (ICTD-R16 / AM-R28) — ⚠ precedence divergence DV-02 pending Q2 |
| Critical incident blocking | AM ladder rung 3: « Revue managériale — non classé » |
| Ranking eligibility | Classé only; AM rank compares the SAME month only |
| Three-month trend | M-1/M-2 single-match; 3-month mean only when complete; ±5 pts stability band |
| Active days | manual, supervisor-validated (Q9: platform pre-fill allowed?) |
| Pilot / calibration state | targets EMPTY ⇒ P, score global, IPAM blank by construction — not zero, not 100 |

## 4. Pilot phase (0F) — explicit machine states, not a narrative

| State | Trigger | Effect (already in the formulas) |
| --- | --- | --- |
| **Pilot / uncalibrated** | `CAPACITE_CIBLE` (ICTD B5) empty; EQUIPE targets + `CAPACITE_DEFAUT` empty | P blank → score global blank → IPAM blank; AM status falls to « Provisoire » via the `G=""` rung; charge (ICTD/ICAM), quality rates, coverage and statuses keep computing |
| Calibrated | targets filled after 3 valid months + management validation (§18 M3) | scores/ranks become available — usable only with the §17 controls |
| Parameter change | any unit/coefficient/weight/cap/SLA/target | requires justification + effect date + validation + identifiable version + **non-retroactivity** (§17.2). ⚠ Excel recomputes history on change — the platform must **pin parameter versions per period** (the proven workflow-policy pinning pattern) |
| Monthly close | end of period | §17.1 checklist: duplicates, unusual values, sample-to-proof reconciliation, jours actifs, causes/imputabilité, coverage, documented corrections |

Month-by-month pilot focus (§18): M1 reliable entry (no HR use of scores) · M2
coherence of charges, caps, double counts, portfolios · M3 calibration + backtest
**before any ranking or bonus use**. End-of-pilot decisions (targets, coefficients,
portfolio comparability, mandatory pre-publication controls, authorized managerial
use) belong to Effitrans, formally.

## 5. Explicit boundary for the future « Performance Manager » role

The methodology's governance (F.T.'s note) gives the consolidator calibration and
review authority — **not** authority over source facts. In platform terms, mirroring
OPS-SEC/RATIFY-OPSSEC2-2A doctrine:

* may: maintain parameters (versioned), run closes, consolidate, calibrate targets,
  organize reviews;
* may NOT: edit operational history (dossiers, documents, customs, transport,
  audits), overwrite declarant/AM-entered facts, bypass validator roles, or reprice
  closed periods retroactively (§17.2).

Any implementation must encode this as authority separation, not convention.
