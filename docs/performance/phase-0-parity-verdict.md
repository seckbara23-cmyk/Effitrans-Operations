# ICTD / ICAM / IPAM — Phase-0 Parity Verdict

**Date:** 2026-08-21 · **Scope:** audit and specification only. Nothing was
implemented; no schema, no RBAC, no UI, no production mutation. The implementation
roadmap is deliberately NOT proposed here — parity must be frozen first.

Companion documents: `formula-source-census.md` · `formula-contract-register.md` ·
`workbook-divergence-register.md` · `formula-parity-fixtures.md` ·
`platform-data-source-map.md` · `indicator-governance-matrix.md`.

## 1. Formulas fully ratified (methodology AND canonical workbook agree, verified cell-level)

* **ICTD dossier chain** — `[UD + UF·NF + UA·NPSH·CCT] × CDP + U_DPI + U_TE + U_COT`
  with every coefficient identical in both sources (UD 1,00 · UF 0,50 · UA 0,30 ·
  CCT 0,60/1,20 · SIMPLE/APE/DEP/OG = 1,00/1,40/1,30/1,50 · COT 1,00 · TE 0,80 ·
  DPI 1,00/0,50/0/0). The methodology's own example computes to **12,34 UTD**
  under the workbook's exact rounding order. Blank rules included.
* **Délai jours ouvrés** (NETWORKDAYS.INTL, complet→BAE, floor 0) and the SLA flag.
* **FP dossier** — 35/30/25/10, all-four-required, ROUND 4 — and
  **score global 40/60** with the §6.5 example reproducing (0,9420 → 96,52).
* **Monthly ICTD**: sum-per-dossier, UTD/jour, moyen/dossier, part de charge,
  evaluated-only rates, contribution ajustée (Σ ICTD×FP).
* **ICAM** — base 1,00 + eight `MIN(coef×n, plafond)` components, coefficients and
  caps identical to §7.2 to the cent; §7.4 example reproduces (**4,45**); per-dossier
  ceiling 8,00; closed-dossiers-only scoring population.
* **IPAM** — 25/25/20/20/10 over P/Q/D/C/E with sub-weights 35-35-30 / 25-35-20-20 /
  40-35-25 / 50-30-20 exactly as §8; §8.7 example reproduces (**86,70**); five
  dimensions all-required.
* **Governance as formulas**: blank ≠ success; Non évalué ≠ conforme; N/A
  denominator exclusion; CRECL imputability truth table; CSAT no-survey ≠ 100 %;
  coverage = évalués ÷ éligibles with the 13-KPI pooled global coverage; 10-dossier
  and 80 % gates; AM×month duplicate → Non classé; critical incident → Revue
  managériale; Classé-only same-month ranking; M-1/M-2/3-month trend with ±5 pts
  stability; pilot blanks (targets empty ⇒ P/score/IPAM blank).

## 2. Workbook-only calculations not yet ratified by the methodology

| Item | Where | Proposed treatment |
| --- | --- | --- |
| **DPE type, CDP 1,30** | ICTD PARAMETRES/LISTES | **Q1 — must be ratified or removed** |
| Status precedence (volume vs coverage) differing between ICTD and AM | RECAP ladders | **Q2 — harmonize** |
| `SEUIL_TENDANCE = 5`, `CAPACITE_DEFAUT` fallback, exact-single-match M-1/M-2, all-3-months average | AM RECAP/PARAMETRES | ratify as written (sensible refinements) |
| ECOUT adjudication logic (dépassement approuvé) & CSAT validity guards | AM SAISIE | ratify as written |
| Intermediate rounding order (bloc ROUND 2 before CDP; FP ROUND 4; global ROUND 1) | ICTD sheets | ratify as written — cent-level differences otherwise |

## 3. Legacy formulas that must NOT be copied (all confirmed divergent)

Monthly-totals multiplication `((ΣB+ΣH)×(ΣE×ΣG)+ΣF+ΣI)/100` — the very formula
§5.1 deprecates · inverted units (facture 0,30 / position 0,60) · two-part CCT up to
1,80 · DPE 1,40 with no DEP · no DPI/cotation model · hard-coded coefficients ·
**copy-paste contamination across declarant sheets** (matar pricing rows off
ROKHAYA/ousmane). The legacy file is history and comparison material only (Q12).

## 4. Contradictions requiring Effitrans / F.T. clarification

**Blocking (4):** Q1 DPE · Q2 status precedence · Q3 holiday calendar (FERIES empty
while délai math depends on it) · Q4–Q6 as a group: NPSH capture, declaration-type
vocabulary mapping, DPI evidence (new data collection design).
**Non-blocking (6):** Q0 filename, Q7 suspension fields, Q8 image-only presentation,
Q9 jours-actifs pre-fill, Q10 SLA-cible policy vs per-dossier, Q11 CSAT instrument,
Q12 legacy history disposition.

## 5. Inputs the platform already owns

13 AUTO + 16 DERIVED of 47 distinct inputs (~60 %) — dossier identity/status/dates,
AM & declarant assignments, cotations (quotation chain), BAE (proven in production),
receivability/validation/GAINDE acts, document counts & completeness (QDOC), expense
authorizations (NAD), vendor invoices (NFACT), payments, deposit/courier (NCOUR),
every SLA timestamp the AM workbook currently re-types as Oui/Non, and amounts
prévu/engagé for ECOUT/ECTRL. Detail in `platform-data-source-map.md`.

## 6. Genuinely new data collection required

NPSH · declaration-type (SIMPLE/APE/DEP/DPE/OG) vocabulary · DPI prise en charge ·
titre d'exonération préparé-par · position tarifaire fournie-par · quality/claims
registers (erreur imputable, redressement, réclamation + imputabilité, retours,
incident critique) · satisfaction survey · **holiday calendar (reference data)** ·
jours actifs validation flow.

## 7. Blockers before implementation

1. Answers to **Q1, Q2, Q3** (formula-level) and the **Q4–Q6** capture design.
2. Parameter **version pinning** design (Excel recomputes history on change; §17.2
   forbids retroactivity — the platform's workflow-policy pinning pattern applies).
3. The governance matrix's authority separation encoded as roles, not convention
   (incl. the Performance-Manager boundary: consolidation ≠ editing source history).
4. Pilot-state semantics carried as data (targets empty ⇒ blank scores), never
   defaulted.

## 8. Verdict

**Phase 0: GO — parity is provable and frozen** on the pair (methodology ×
2026 canonical workbooks), which agree on every coefficient, weight, cap, gate and
worked example tested (48 950 formula cells → 112 column contracts + 12 governance
contracts; 3 methodology examples reproduced exactly; 60+ fixtures frozen, 2 marked
provisional pending Q1/Q2).

**Implementation: NO-GO until the four blocker groups above are cleared.** The
legacy workbook is excluded from parity by evidence, not preference.
