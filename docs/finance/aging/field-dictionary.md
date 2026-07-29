# FIN-AGING · Field Dictionary — the permanent Finance reference

Every field appearing anywhere in the Aging Balance workbook, defined once. Columns:
**Source** names the authoritative table/column (existing unless marked *proposed*);
**E/C** = Entered (manual/selected/imported) vs Calculated (derived, never hand-entered);
**Tabs** use B=Tableau de Bord, D=Données Brutes, C=Analyse Clients, K=Dossiers Critiques,
G=Graphiques. Validation is enforced server-side; the workspace mirrors it inline.

Conventions inherited by all fields: tenant-scoped (`tenant_id` on every row, RLS-guarded);
money is `numeric(14,2)` in the invoice currency (v1 reports: XOF only, no conversion);
dates are `date` (no time); every mutation is audited append-only.

## Invoice-level fields (Données Brutes / Dossiers Critiques rows)

| # | FR label | EN label | Description | Type | Req | E/C | Source | Validation | Default | Export | Tabs | Widgets | Used in calculations |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Facture | Invoice number | Official invoice identifier | text | ✔ | E (system at issuance; keyed only for legacy import) | `invoice.invoice_number` | unique per tenant; non-empty | minted by `next_invoice_number` | D-A, K-A | D, K | — | row identity |
| 2 | Date édition | Issue date | Date the invoice was issued | date | ✔ | E (system at issuance; keyed for legacy) | `invoice.issue_date` | ≤ arrêté for inclusion; ≤ échéance | issuance day | D-B `dd/mm/yyyy`, K-B | D, K | — | population rule |
| 3 | Échéance | Due date | Contractual payment deadline | date | ✔ for aging | E (from payment terms or keyed) | `invoice.due_date` | valid date; ≥ date édition | `dueDateFromTerm` | D-C, K-C | D, K | — | **days_overdue** |
| 4 | Dossier | Dossier reference | Operational file the invoice bills | text ref | ○ (✔ per Q-08) | E (selected) | `operational_file.reference` via `invoice.file_id` | must exist, same tenant | — | D-D, K-D | D, K | — | grouping/links |
| 5 | Client | Client | Debtor | entity ref | ✔ | E (selected) | `client.name` via `invoice.client_id` | must exist, same tenant, active | dossier's client | D-E, K-E | D, C, K, G | Top-10 chart | client grouping |
| 6 | Montant (FCFA) | Outstanding amount | **Encours**: what remains owed at the arrêté | numeric(14,2) | ✔ | **C** (derived; keyed ONLY at legacy import, then derived forever) | derivation over `invoice_line` − `payment` (spec §3) | > 0 to appear; legacy keyed value requires import provenance | — | D-F `#,##0`, K-F, C-C, G-C/B | D, C, K, G | KPI 1/4/6; both bar charts | every aggregate |
| 7 | Jours retard | Days overdue | arrêté − échéance, whole days (negative = not yet due) | int | ✔ | **C — never enterable** | computed | integer; null if due date missing → exception list | — | D-G int, K-G | D, K | — | bucket, risk, averages, critical filter |
| 8 | Tranche | Aging bucket | One of the 7 labels | enum | ✔ | **C** | computed from #7 | closed vocabulary (calc spec §2) | — | D-H | D, B, G | bucket table; charts 1–2 | bucket aggregates |
| 9 | Risque | Risk level | Row-level risk class | enum | ✔ | **C** | computed from #8 | closed vocabulary; dashboard uses emoji variants | — | D-I | D, B | bucket table col G | — |
| 10 | Commentaires | Collection comments | Free-text note on a critical invoice | text | ○ | E | `collection_follow_up.note` (permanent) — snapshot copies text at finalization; pending Q-10 | length-bounded | — | K-H | K | — | — |

## Client-level fields (Analyse Clients)

| # | FR label | EN label | Description | Type | E/C | Source | Export | Widgets | Calculation |
|---|---|---|---|---|---|---|---|---|---|
| 11 | Client | Client | Group key | ref | C (grouping) | `client.id/name` | C-A | Top-10 | — |
| 12 | Nb factures | Invoice count | Client's open invoices | int | C | derived | C-B | — | count |
| 13 | Montant total (FCFA) | Client outstanding | Σ #6 for the client | numeric | C | derived | C-C `#,##0` | Top-10 chart | Σ |
| 14 | Retard moy. (j) | Average delay | mean(#7), rounded to int (mode: Q-07) | int | C | derived | C-D | — | risk input |
| 15 | Retard max (j) | Maximum delay | max(#7) | int | C | derived | C-E | — | — |
| 16 | Part encours (%) | Portfolio share | #13 ÷ grand total; Σ = 100 % | fraction | C | derived | C-F `0.00%`, G `0.0%` | pie (bucket variant) | Top-10 |
| 17 | Niveau risque | Client risk | bucket-risk of #14 **with floor `Faible`** (avg ≤ 30, incl. negative → Faible; no « Non échu » at client level — empirically verified) | enum | C | derived | C-G | — | — |

## Bucket-level fields (Tableau de Bord rows 9–15 / Graphiques rows 4–10)

| # | FR label | EN | Description | E/C | Export | Widgets |
|---|---|---|---|---|---|---|
| 18 | Tranche d'ancienneté | Bucket label | The 7 labels, fixed order | C | B-A, G-A | bar + pie categories |
| 19 | Nb factures (tranche) | Bucket count | count per bucket | C | B-B, G-B | — |
| 20 | Montant (FCFA) (tranche) | Bucket amount | Σ #6 per bucket | C | B-C, G-C `#,##0` | chart 1 series |
| 21 | Part encours | Bucket share | Σ ÷ total (fraction) | C | B-D `0.0%`, G-D | chart 2 series |
| 22 | Nb clients (tranche) | Bucket clients | distinct clients in bucket | C | B-E | — |
| 23 | Retard moyen (tranche) | Bucket avg delay | mean #7 in bucket | C | B-F | — |
| 24 | Niveau de risque (tranche) | Bucket risk | fixed mapping, **emoji labels** on dashboard | C | B-G | — |

## Report-level fields (KPI cards + parameters)

| # | FR label | EN | Description | Type | E/C | Source | Export | Calculation |
|---|---|---|---|---|---|---|---|---|
| 25 | Date d'arrêté | Reporting date | The as-of date every figure is computed at | date | **E — report parameter** | `aging_report.reporting_date` *(proposed)* | titles of B/D tabs (`12 juin 2026` long + `12/06/2026` short) | all as-of derivations |
| 26 | Total encours | Total outstanding | Σ #6 | money | C | derived | B card A `#,##0 [$FCFA]` | — |
| 27 | Nb factures | Invoice count | rows | int | C | derived | B card B | — |
| 28 | Nb clients | Client count | distinct clients | int | C | derived | B card C | — |
| 29 | Montant en retard | Overdue amount | Σ #6 where #7 ≥ 1 | money | C | derived | B card D | — |
| 30 | Retard moyen | Average delay | mean #7 (population: Q-04) | int | C | derived | B card E `0" jours"` | — |
| 31 | Montant > 1 an | Amount > 1 year | Σ #6 where #7 > 365; = critical total | money | C | derived | B card F (purple) | ties K total |
| 32 | TOTAL GÉNÉRAL / TOTAL / TOTAL – Dossiers critiques | Total rows | per-tab totals; critical total's G column holds the **count** | C | derived | B16 / C73 / K84 | cross-tab invariants (calc spec §9.11) |

## Snapshot/lifecycle fields (platform-side, *proposed* — no workbook counterpart)

Report number, lifecycle status, preparer, validator, finalized-at, template code+version,
renderer version, artifact SHA-256 per format, source-row pinning. These exist so a FINAL
report is immutable and reproducible; defined in [schema-and-erd.md](schema-and-erd.md).

**Future modules note**: fields #1–#9, #25 and the derivation rules are the shared
vocabulary for Treasury, Cash Management, AP, GL, client statements and BI — new modules
must reference this dictionary rather than redefine terms.
