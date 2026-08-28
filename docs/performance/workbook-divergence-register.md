# ICTD / ICAM / IPAM — Workbook Divergence Register (Phase 0A/0B)

**Audit only.** Contradictions are reported, never silently resolved — and never in
favour of the older spreadsheet. Severity: 🔴 must be answered before implementation
· 🟠 should be ratified · 🟡 recorded, low stakes.

## A. Methodology ⇄ canonical workbooks

| ID | Severity | Divergence | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| DV-01 | ✅ | ~~CDP 5th type DPE~~ **CLOSED (D1, 2026-08-28)**: Effitrans confirmed DPE is NOT a type — declarants sometimes wrote DPE instead of DEP and the workbook tolerated it to protect its formula. Platform: DEP only, 1,30; DPE normalized → DEP at the import boundary | ICTD PARAMETRES E2:F6 | Q1 answered |
| DV-02 | 🟠 | **Status-ladder precedence differs between the two canonical workbooks.** ICTD: coverage<80 % is tested BEFORE <10 dossiers (5 dossiers @ 70 % coverage → « Non classé »). AM: <10 dossiers is tested BEFORE coverage (same case → « Provisoire »). The methodology tables (§11.1/§11.2) don't state precedence | ICTD RECAP Q vs AM RECAP AB | **Q2** — harmonize or ratify the difference |
| DV-03 | 🟡 | Methodology §13 names `SUIVI_ICTD_VIERGE_06-08-2026.xlsx`; the delivered canonical is `SUIVI ICTD DECLARANT.xlsx` (same template presumed) | file names | **Q0** — confirm same artifact |
| DV-04 | 🟠 | **FERIES is empty in both canonical workbooks** while ICTD's délai (`NETWORKDAYS.INTL … FERIES!A2:A50`) depends on it — an unregistered public holiday counts as an elapsed working day, so computed délais come out **LONGER** and SLA compliance HARSHER on the déclarant (fixture F-SLA-06: 1 j vs 0 j for the same dossier). *(Corrected 2026-08-21 — an earlier revision of this row stated the opposite direction.)* AM FERIES is self-declared « volontairement vide » (its SLA fields are manual Oui/Non today) | ICTD FERIES; AM FERIES A2 | **Q3** — establish the holiday calendar source of truth before any délai/SLA is computed |
| DV-05 | 🟡 | **DPI units are stored twice** in ICTD PARAMETRES: display rows B13/B14 and the actual lookup table K2:L5 (formulas read ONLY K2:L5). Editing one without the other silently forks the parameter | ICTD PARAMETRES | Single-source in any implementation; flag in the workbook's mode d'emploi |
| DV-14 | 🟡 | AM SAISIE captures suspension fields (`Début/Fin suspension`, `Motif`, `Responsable réel du retard`) that **no formula consumes** — they are validation evidence only. Delays are NOT computed net of suspensions anywhere | AM SAISIE I–L | Confirm intended use (validation-only is coherent with §10.2) — **Q7** |
| DV-16 | 🟡 | Workbook-only constants absent from the methodology: `SEUIL_TENDANCE = 5 points` (Stable band), `CAPACITE_DEFAUT` fallback (empty), M-1/M-2 **exact-single-match** lookups (an ambiguous month → blank trend), 3-month average requiring **all three** months | AM PARAMETRES B10/B11; RECAP AF–AJ | Ratify as part of the register — reasonable refinements, not contradictions |
| DV-17 | 🟡 | ICTD workbook computes SLA **from dates** (NETWORKDAYS); AM workbook records every SLA outcome as **manual Oui/Non** although the methodology defines them as timestamp facts (§8.4). Not a contradiction — an automation gap the platform can close (see data-source map) | ICTD AM col vs AM SAISIE AG–AJ | Phase 0D |
| DV-18 | 🟡 | Score bands (90/75/60/40) and the ×100 scalings are the only values hard-coded inside canonical formulas rather than parameterized | ICTD RECAP P, AM RECAP AD | Mirror as constants with the same governance as parameters |

## B. Canonical ⇄ legacy (« SUIVI PERF ET RAPARTITION DECLARANT OFF »)

**The legacy workbook implements a materially different model. Not one of these may
be copied** (methodology §5.1 explicitly deprecates its aggregation).

| ID | Severity | Legacy behaviour | Canonical behaviour |
| --- | --- | --- | --- |
| DV-06 | 🔴 | **Aggregation multiplies monthly totals**: RECAP `ICTD = ((ΣNbDossiers + ΣUA-UF) × (ΣCCT × ΣCDP) + ΣTE + ΣBONUS) / 100` — dimensionally incoherent and exactly the « multiplier entre eux des totaux mensuels » §5.1 replaces | dossier-by-dossier ICTD, then SUM |
| DV-07 | 🔴 | Unit weights **reversed/different**: facture ×0,30 and position ×0,60 (`(I×0,3)+(J×0,6)`) | UF = 0,50/facture, UA = 0,30/position |
| DV-08 | 🔴 | **CCT is two-part and larger**: CCT1 (L: CLIENT 0,5 / EFFITRANS 1,3) + CCT2 (M vérification: CLIENT 0 / EFFITRANS 0,5) → up to 1,8; and it is **summed per month**, not applied per dossier to the SH component | single CCT 0,60/1,20 applied to the SH term only |
| DV-09 | ✅ | ~~legacy DPE 1,40, no DEP~~ **CLOSED (D1, 2026-08-28)**: the legacy value confirms the spelling-drift reading — one type, mislabelled. Historical rows labelled DPE normalize to DEP 1,30 | Q1 answered |
| DV-10 | 🔴 | **No DPI model, no cotation unit** (a « BONUS » column tests `W="C"` against a column whose header says « Nombre de cotation » — self-inconsistent semantics), no SLA/FP/coverage/status machinery at all | full additive DPI/TE/COT model + quality chain |
| DV-11 | 🔴 | **Copy-paste contamination**: inside `matar`, some rows compute from `ROKHAYA!` and `ousmane!` ranges; six columns carry 2–3 different formulas; `ousmane` AB has 2 variants. One declarant's history is partially priced off another declarant's rows | canonical columns are uniform (0 intra-column variants) |
| DV-12 | 🟡 | All coefficients hard-coded in ~12 000 formulas; no parameters sheet, no named ranges, no validations | fully parameterized |
| DV-13 | 🟡 | Contains ~6 000 rows of REAL 2025–2026 operational data (client names, dossier numbers). This audit reproduces **no data rows** from it | canonical files are blank templates |

## C. Presentation

| ID | Severity | Finding |
| --- | --- | --- |
| DV-19 | 🟡 | The 12 slides are full-page images with **no extractable text**; the PDF export equally. Content could not be machine-compared to the methodology. The two `.pptx` copies are byte-identical (true duplicate). Ranked lowest authority; nothing here relies on it — **Q8**: have Effitrans confirm the deck asserts nothing beyond the methodology |

## D. Open questions for Effitrans / F.T.

| Q | Question | Blocking? |
| --- | --- | --- |
| Q0 | Confirm `SUIVI ICTD DECLARANT.xlsx` = the `SUIVI_ICTD_VIERGE_06-08-2026.xlsx` named by the methodology | No |
| **Q1** | **Ratify the `DPE` declaration type and its CDP (workbook 1,30 / legacy 1,40 / methodology absent). Confirm DEP ≠ DPE.** | **Yes** |
| **Q2** | **Status precedence when BOTH volume < 10 AND coverage < 80 %: Non classé (ICTD order) or Provisoire (AM order)?** | **Yes** |
| **Q3** | **Official holiday calendar (Senegal) — source of truth and maintainer, before any jours-ouvrés computation is trusted.** | **Yes** |
| Q4 | NPSH (positions SH) is captured nowhere in the platform today — confirm the declarant remains the source and at which step it is entered/validated | Yes (data collection) |
| Q5 | Mapping between the workbook's TYPE_DECLARATION (SIMPLE/APE/DEP/DPE/OG) and the platform's customs vocabulary (`regime`, GAINDE) — same fact or a new field? | Yes (data collection) |
| Q6 | DPI prise en charge (4 states) — not modelled in the platform; where is it evidenced (GAINDE? document?) | Yes (data collection) |
| Q7 | AM suspension fields: validation-evidence only (no délai netting) — confirm | No |
| Q8 | Presentation content confirmation (image-only, unverifiable here) | No |
| Q9 | Jours actifs: manual per methodology — may the platform PRE-FILL from HR attendance with supervisor validation, or must it stay purely manual? | No (design) |
| Q10 | SLA cible per dossier (ICTD col AD is manual): fixed policy table or per-dossier override? | No (design) |
| Q11 | CSAT source: no satisfaction survey exists in the platform — external instrument? | No (pilot leaves CSAT often N/A) |
| Q12 | Legacy history: frozen as-is (recommended) or recomputed under canonical formulas for comparison? **Never both silently.** | No |
