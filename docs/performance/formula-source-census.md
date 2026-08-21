# ICTD / ICAM / IPAM — Formula Source Census (Phase 0A)

**Audit only. Nothing implemented.** Census date: 2026-08-21. Extraction: pure-stdlib
XLSX/DOCX/PPTX XML parsing (openpyxl unavailable); every number below was read from
the files' own XML, not estimated.

## 1. Sources and authority order

| # | Authority | File (as supplied) | SHA-256 (16) | Size | Producer |
| --- | --- | --- | --- | --- | --- |
| 1 | **Methodology** | `Note méthodologie calcul indice déclarants et Account manager.docx` | — | 168 KB | Word |
| 2 | **ICTD canonical** | `SUIVI ICTD DECLARANT.xlsx` | — | 310 KB | LibreOffice/Collabora (absolute rel targets, inline strings) |
| 3 | **ICAM/IPAM canonical** | `SUIVI PERFORMANCE ACCOUNT MANAGERS EFFITRANS.xlsx` | — | 297 KB | LibreOffice/Collabora |
| 4 | **Legacy (reference only)** | `SUIVI PERF ET RAPARTITION DECLARANT OFF (1).xlsx` | — | 1 069 KB | Excel (classic) |
| 5 | Presentation | `Presentation ICTD ICAM IPAM.pptx` + `(1).pptx` | `4a4875a22b6a76cd` (both) | 20 MB each | PowerPoint |

Notes:
* The two presentation files are **byte-identical** (same SHA-256) — a true duplicate,
  not a revision.
* A `~$SUIVI PERF…` file alongside the legacy workbook is an **Excel lock artifact**,
  not a source.
* **The presentation's 12 slides contain no text layer** (`<a:t>` empty on every
  slide — full-page images). Its content could not be machine-verified with available
  tooling. It is ranked lowest in authority; nothing in this audit depends on it, and
  its claims are NOT silently assumed to match the methodology. (Open question Q8.)
* The methodology (§13) names the ICTD file `SUIVI_ICTD_VIERGE_06-08-2026.xlsx`; the
  supplied file is `SUIVI ICTD DECLARANT.xlsx`. Same template presumed, unverifiable
  from content alone. (Open question Q0 — low stakes.)
* The methodology text (32 254 characters) was extracted and read **in full**.

## 2. Workbook census

Formula totals: **ICTD 20 523 · ICAM/IPAM 16 160 · legacy 12 267 = 48 950 formula
cells**, collapsing to **112 distinct calculated-column contracts** (per-row copies
of one column formula are one contract).

### 2.1 `SUIVI ICTD DECLARANT.xlsx` — canonical ICTD (a BLANK template: no data rows filled)

| Sheet | Class | Cells | Formulas | Validations | Hidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `Bamba`, `matar`, `maguette`, `ousmane`, `mme sarr`, `ROKHAYA` | Input + Calculation | 3 445 each | 3 400 each | 7 each | — | 200 dossier rows × 17 calculated columns; 45 header/name cells. Column E hardcodes the declarant name **per sheet** (`IF(B#="","","BAMBA")` etc.) |
| `RECAP` | Recap / Dashboard | 155 | 123 | 0 | — | 6 declarant rows × 20 calculated columns + period header. **Column F (JOURS ACTIFS) is the single manual input** |
| `PARAMETRES` | Parameters | 85 | 0 | 0 | — | All units/coefficients/weights/thresholds; B5 (capacité cible) **deliberately empty** per pilot rule |
| `FERIES` | Reference | 2 | 0 | 0 | — | **EMPTY** (headers only) — yet `NETWORKDAYS.INTL(...,FERIES!$A$2:$A$50)` depends on it |
| `MODE EMPLOI` | Reference | 37 | 0 | 0 | — | Usage instructions |
| `LISTES` | Reference | 21 | 0 | 0 | **hidden** | Dropdown sources (inline strings) |

Named ranges (10 + filter artifacts): `DATE_DEBUT`, `DATE_FIN`, `CAPACITE_CIBLE`,
`MIN_DOSSIERS`, `COUVERTURE_MIN`, `OUI_NON`, `CLIENT_EFFITRANS`, `RESPONSABLE_3`,
`TYPE_DECLARATION`, `DPI`.

Hidden rows/columns: none. Hidden sheets: `LISTES` only.

### 2.2 `SUIVI PERFORMANCE ACCOUNT MANAGERS EFFITRANS.xlsx` — canonical ICAM/IPAM (also a BLANK template; EQUIPE has 0 data rows)

| Sheet | Class | Cells | Formulas | Validations | Hidden | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `SAISIE DOSSIERS` | Input + Calculation | 9 587 | 9 500 | 31 | — | 250 dossier rows × 38 calculated columns (U..AC ICAM; AS écart; AX month; AY..BX score/coverage pairs; BY active flag) |
| `EQUIPE` | Input + Reference | 197 | 180 | 7 | — | Left: AM referential (name, portefeuille, actif, dates, validateur, **capacité cible/AM**). Right: **one row per AM × month** (jours actifs, incident critique, commentaire) + col O duplicate detector |
| `RECAP` | Recap / Dashboard | 6 518 | 6 480 | 0 | — | 180 AM×month rows × 36 calculated columns — ICAM, P/Q/D/C/E, coverage, status, IPAM, rank, M-1/M-2/3-month trend |
| `PARAMETRES` | Parameters + Reference | 223 | 0 | 5 | — | Coefficients/caps/weights/thresholds **plus a per-KPI governance dictionary (A32:G47)**: definition, frequency, proof source, saisie owner, validation owner |
| `FERIES` | Reference | 6 | 0 | 1 | — | **Deliberately empty by design** — its own notice: « Table volontairement vide, prévue pour les futurs calculs de SLA en temps ouvré » |
| `MODE EMPLOI` | Reference | 38 | 0 | 0 | — | Usage instructions |
| `LISTES` | Reference | 47 | 0 | 0 | **hidden** | 9 lists incl. the four-state `Oui/Non/Non évalué/Non applicable` and `Imputabilité (Oui/Non/En analyse/Non évalué)` |

Named ranges (50 + filters): thresholds (`SEUIL_COUVERTURE`, `MIN_DOSSIERS`,
`SEUIL_TENDANCE`, `CAPACITE_DEFAUT`), 8× `COEF_*`/`PLAF_*` pairs, `ICAM_BASE`,
5× `POIDS_[PQDCE]`, 13× `POIDS_<KPI>` sub-weights, 9 list ranges, `Liste_AM`.

### 2.3 `SUIVI PERF ET RAPARTITION DECLARANT OFF (1).xlsx` — LEGACY (contains REAL historical data; data rows are NOT reproduced in this audit)

| Sheet | Class | Cells | Formulas | Notes |
| --- | --- | --- | --- | --- |
| 6 declarant sheets | Historical Input + Calculation | 8 486–11 531 | 2 019–2 068 | ~1 000 data rows each; **all coefficients hard-coded inside formulas**; no parameters sheet; no named ranges; no validations |
| `RECAP` | Historical Recap | 72 | 49 | Aggregates **totals**, then multiplies them (see divergence register DV-06) |

**Intra-column inconsistencies (hand-edit damage):** `matar` columns AD/AE/AF/AG/AH/AI
each contain 2–3 different formulas, including rows whose formulas reference
**`ROKHAYA!` and `ousmane!`** ranges from inside `matar` (copy-paste contamination);
`ousmane` AB has 2 variants. The canonical workbooks have **zero** such
inconsistencies (every calculated column is one uniform formula).

## 3. Function-class inventory (canonical workbooks)

| Class | Where |
| --- | --- |
| Dates / working days | `INT(date)` (ICTD A); `NETWORKDAYS.INTL(Q,V,1,FERIES!A2:A50)-1` floor 0 (ICTD AM); `EOMONTH(G,0)` closure month (AM AX); `EOMONTH(B,-1)+1..B` month windows (AM RECAP); `EOMONTH(B,-1)/(B,-2)` trend lookups |
| Caps | `MIN(COEF×N, PLAF)` ×8 (ICAM); `MIN(100, …)` productivity (both); `MIN(1, note/max)` CSAT |
| Ratios / rates | evaluated-only denominators via `SUMIFS/SUMPRODUCT(ISNUMBER)` (ICTD RECAP) and `AVERAGEIFS` over 1/0/"" flags (AM RECAP) |
| Ranking | competition rank `1 + SUMPRODUCT((statut="Classé")×(score>mine))` (ICTD V); `1 + COUNTIFS(same month, Classé, score>mine)` (AM AE) |
| Rolling periods | M-1/M-2 single-match lookups (AM AF/AG), 3-month average only when all three exist (AH), delta + `SEUIL_TENDANCE` stability band (AI/AJ) |
| Lookup of parameters | `VLOOKUP` into PARAMETRES tables (ICTD CCT/CDP/U_DPI); named ranges everywhere in AM |
| Hard-coded values inside formulas | Canonical: only the score bands `90/75/60/40` and scaling `×100`/`MIN(100,…)` (niveau/productivity formulas). **All business coefficients are parameterized.** Legacy: **every coefficient hard-coded** (0.3, 0.6, 0.5, 1.3, 0.8, 1.4, 1.5, /100) |

## 4. Where each calculation lives (quick provenance map)

| Contract family | Workbook · sheet · columns |
| --- | --- |
| ICTD dossier chain | ICTD · declarant sheets · A, E, AE–AS (17 cols) |
| ICTD monthly / rates / status / rank | ICTD · RECAP · B–V (20 cols; F manual) |
| ICAM activity units + total | AM · SAISIE · U–AC (9 cols) |
| Closure month + per-dossier KPI flags | AM · SAISIE · AX; AY–BX (27 cols); AS; BY |
| IPAM dimensions, coverage, status, rank, trend | AM · RECAP · A–AJ (36 cols) |
| AM×month uniqueness | AM · EQUIPE · O |
| Parameters | ICTD PARAMETRES (B3–B20 + 3 lookup tables); AM PARAMETRES (B8–B23, G6–G27) |
| Governance dictionary | AM · PARAMETRES · A32:G47 |

Full machine-readable dumps (all cells, all formulas, normalized per-column
patterns) are retained in the session scratchpad (`parity/out/*.json`); they are not
committed because the legacy dump contains real operational data.
