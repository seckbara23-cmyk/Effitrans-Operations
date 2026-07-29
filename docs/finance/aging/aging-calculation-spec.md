# FIN-AGING-0 · Deliverable E — Aging Calculation Specification

Deterministic, pure, and **empirically pinned to the workbook**: every boundary below was
verified against all 430 rows of the reference workbook's `Jours retard → Tranche → Risque`
columns (which survived anonymization). Zero exceptions were found.

## 1. The day count

```
days_overdue = date_arrete − due_date          -- whole calendar days, integer
```

- Both operands are **dates**, not timestamps. The workbook's values are all integers.
- `date_arrete` (« date d'arrêté » / reporting date) is a **report parameter**, never
  `now()`. The reference workbook is itself arrêté au 12/06/2026 — a date stated in three
  tab titles. Historical reports re-render with their own arrêté.
- The tenant timezone matters only when *defaulting* the parameter to "today"
  (reuse `todayInTimezone` from `lib/collections/aging.ts`).
- Negative values are meaningful (due in the future) and appear in the data (min −122).

## 2. The seven buckets — exact, closed, ordered

| # | `days_overdue` d | Label (data tabs) | Risk (data tabs) | Risk (dashboard) |
|---|---|---|---|---|
| 1 | d ≤ 0 | `Non échu (≤ 0 j)` | `Non échu` | `✅ Sain` |
| 2 | 1 ≤ d ≤ 30 | `1 – 30 jours` | `Faible` | `🟡 Faible` |
| 3 | 31 ≤ d ≤ 60 | `31 – 60 jours` | `Modéré` | `🟠 Modéré` |
| 4 | 61 ≤ d ≤ 90 | `61 – 90 jours` | `Modéré` | `🟠 Modéré` |
| 5 | 91 ≤ d ≤ 180 | `91 – 180 jours` | `Élevé` | `🔴 Élevé` |
| 6 | 181 ≤ d ≤ 365 | `181 – 365 jours` | `Élevé` | `🔴 Élevé` |
| 7 | d ≥ 366 | `> 365 jours` | `Critique` | `⛔ Critique` |

Empirical support: observed ranges per bucket were [−122,0], [1,30], [31,60], [63,87],
[91,179], [182,350], [366,2505] — each strictly inside its bucket, with the critical
boundaries (0↔1, 30↔31, 365↔366) all directly exercised by the data.

**Due today (d = 0) is NOT overdue** — it is `Non échu`. This matches the existing
collections doctrine ("the client still has the day to pay"), though the workbook folds
`DUE_TODAY` into `Non échu` rather than giving it its own bucket.

## 3. The outstanding amount (« Montant », « encours »)

The workbook carries one amount per invoice row and calls every aggregate « encours »
(outstanding). The platform derives it — never accepts it as an eternal manual value:

```
outstanding(invoice, D) =
    Σ invoice_line amounts (tax included)                    -- lib/finance/calc invoiceTotals
  − Σ payments      where paid_at ≤ D and not reversed_as_of(D)
  − Σ credit-note allocations where allocated_at ≤ D          -- future (credit notes not yet in platform)
  ± Σ approved adjustments   where approved_at ≤ D            -- future
```

- **Population rule** (from the sheet title « Recouvrement en cours »): a report includes an
  invoice iff `status ∈ {ISSUED, PARTIALLY_PAID}` as of D **and** `outstanding(D) > 0`.
  Fully paid, VOID, DRAFT and zero-balance invoices are excluded — not shown at zero.
- Partial payments reduce the amount (they cannot *create* rows). Overpayment clamps at 0
  and therefore drops the row (surface overpayments in the workspace as a data-quality
  signal, not in the report).
- `paid` uses **non-reversed payments**, the same sum that drives `invoice.status`
  (`lib/finance/calc.ts paidAmount`) — deliberately NOT verified-only, mirroring the
  collections-module doctrine: a verified-only balance would disagree with the invoice
  status on every payment awaiting verification. Pending verification is a *signal*, not a
  different number.
- The workbook shows no credit notes, no adjustments, no disputes, no write-offs, and no
  currency other than FCFA. Those lines in the formula are marked *future* and are gated by
  decisions D-02/D-03 — they are architectural provisions, not workbook rules.

## 4. Edge cases — each with its verdict and its source

| Case | Verdict | Source |
|---|---|---|
| Due today (d=0) | `Non échu` | workbook, 430-row verification |
| Future due date (d<0) | `Non échu`, negative d preserved in data column | workbook (87 rows ≤ 0) |
| Missing due date | **Excluded from aging buckets; reported in a « Sans échéance » exception list** — never invented, never called overdue | platform doctrine (`DUE_DATE_MISSING`, lib/collections/aging.ts); the workbook has no such rows to contradict it |
| Paid invoice | excluded (population rule) | workbook title + absence of zero rows |
| Partially paid | included at the reduced outstanding | Q-03 to confirm; consistent with « encours » |
| Cancelled (VOID) | excluded as of the date it was voided | platform status model |
| Credit note | reduces outstanding via allocation (future) | architecture (D-02) |
| Disputed invoice | **collections queue freezes disputes; the workbook has no dispute concept.** Proposal: include in aging (money is still owed) with a dispute marker column in the workspace; final call Q-05 | conflict, decision required |
| Overpayment | outstanding clamps at 0 → excluded; flagged in workspace | derivation rule |
| Zero balance | excluded | population rule |

## 5. Client-level rules (Analyse Clients)

```
per client (over the client's included rows):
  nb_factures   = count
  montant_total = Σ outstanding
  retard_moy    = round(mean(days_overdue))        -- rounding mode Q-07 (integers observed)
  retard_max    = max(days_overdue)
  part_encours  = montant_total / grand_total      -- fraction; Σ over clients = 1.0 (verified)
  niveau_risque = risk(bucket(retard_moy))  EXCEPT retard_moy ≤ 30 (including ≤ 0) → 'Faible'
```

The exception is empirical: 8 of 70 clients have negative average delay yet are rated
`Faible` — the client scale has **no « Non échu » level**; its floor is `Faible`.
Sort: `montant_total` descending. TOTAL row: Σ counts, Σ amounts, 100%.

## 6. Critical list (Dossiers Critiques)

```
include  iff days_overdue > 365       -- the workbook's ONLY criterion (title + 81-row check)
sort     days_overdue descending
total    F = Σ montant, G = row count -- count sits in the days column of the total row
```

## 7. Dashboard KPIs

```
total_encours     = Σ outstanding (all included rows)
nb_factures       = row count
nb_clients        = distinct clients over included rows
montant_en_retard = Σ outstanding where d ≥ 1
retard_moyen      = mean(d) over 【Q-04: all rows | overdue rows only】
montant_plus_1_an = Σ outstanding where d > 365   -- ties to the critical TOTAL
```

## 8. Reference pseudocode

```
function buildAgingReport(inputs: {
  arrete: Date,                       // the report parameter
  invoices: InvoiceAsOf[],            // derived per §3, population per §3
}): AgingReportView {
  rows = invoices.map(inv => {
    d      = wholeDays(inputs.arrete − inv.dueDate)      // null dueDate → exception list
    bucket = bucketOf(d)                                  // §2 table
    return { ...inv, daysOverdue: d, bucket, risk: RISK[bucket] }
  })
  return {
    arrete: inputs.arrete,
    rows: sortBy(rows, r => r.invoiceNumber),             // Données Brutes order: D-09
    buckets: SEVEN_BUCKETS.map(aggregate(rows)),          // count, Σ, part, clients, mean d
    clients: groupByClient(rows) |> clientRules(§5) |> sortDesc(montant_total),
    critical: rows.filter(r => r.daysOverdue > 365) |> sortDesc(daysOverdue),
    kpis: §7,
    charts: { bucketAmounts, bucketShares, top10: clients.slice(0, 10) },
    exceptions: { missingDueDate: [...], overpaid: [...] },
  }
}
```

Pure function; no I/O, no clock, no `Intl` in anything that feeds a hashed artifact
(established deterministic-PDF rule). Same view model feeds web, XLSX, PDF and print.

## 9. Boundary tests the implementation must ship

1. d ∈ {−122, −1} → bucket 1; d = 0 → bucket 1 (the due-today rule).
2. d ∈ {1, 30, 31, 60, 61, 90, 91, 180, 181, 365} → buckets 2,2,3,3,4,4,5,5,6,6.
3. d = 366 → bucket 7; d = 2 505 → bucket 7 (max observed).
4. Client with all-negative delays (avg −44) → `Faible`, never `Non échu`.
5. Client avg exactly 30 → `Faible`; 31 → `Modéré`; 90/91 → `Modéré`/`Élevé`;
   365/366 → `Élevé`/`Critique`.
6. `part_encours` over clients sums to 1.0 exactly (banker's drift guarded).
7. Critical list: d = 366 included, d = 365 excluded; strictly descending; total row count
   equals list length; critical Σ equals the `> 365` bucket Σ equals KPI `Montant > 1 an`.
8. Invoice paid in full on D − 1 → absent; paid on D + 1 → present at full outstanding
   (as-of correctness).
9. Payment reversed after D → still counted at D (reversal is later knowledge…) — **or
   not counted** (— …but arithmetic must match the snapshot doctrine): pinned by D-06.
10. Null due date → in `exceptions.missingDueDate`, in no bucket, in no KPI except a
    disclosed count.
11. Cross-tab invariants: Σ bucket amounts = total encours; Σ bucket counts = nb factures;
    top-10 fractions = first ten client fractions; dashboard totals = client-tab TOTAL row.
```
