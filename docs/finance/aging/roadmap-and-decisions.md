# FIN-AGING-0 · Deliverables H, I — Roadmap, RBAC Impact, Risks, Decision Register

## H. Implementation roadmap — small, gated phases

Each phase ends with the full gate sequence (typecheck after last edit, tests, build, RLS
suites where schema changed, CI verified per job) and its own commit(s). No phase starts
before its predecessor's decisions are ratified.

| Phase | Scope | Gate to exit |
|---|---|---|
| **FIN-AGING-1** — engine, dark | `lib/finance/aging/` pure engine: 7-bucket scheme as data, arrêté parameter, client rules incl. the Faible floor, critical filter, KPIs, view model; the full boundary-test suite (calc spec §9); **no schema, no UI, no permission** | 430-row synthetic fixture reproduces every cross-tab invariant |
| **FIN-AGING-2** — foundation schema | Migration: `report_template`, `aging_report`, `aging_report_row`, `report_artifact`, `report_share_link`, counter RPC, triggers (lifecycle, maker-checker, append-only, share-FINAL-only), RLS + new RLS suite (runs LAST in ci.yml, per the 2026-07-29 rule); `finance:aging:*` permission rows **granted to no role yet** | CI green incl. new RLS suite; operator applies migration |
| **FIN-AGING-3** — workspace read-only | `/finance/aging` dashboard + grid + client/critical/chart screens over LIVE data (DRAFT preview semantics); nav entry; permission gates wired (visible only with grants — dark until FIN-AGING-8) | UAT walkthrough with Finance Manager against the June workbook |
| **FIN-AGING-4** — legacy import | staging grid (paste + xlsx upload), validation, `OPENING_IMPORT` provenance (per D-01), duplicate defense, draft staging; due-date completeness report | the real 430-invoice backlog imported on staging by Finance |
| **FIN-AGING-5** — lifecycle | snapshot writer, validate/finalize maker-checker, supersede/cancel, totals cross-check invariant, audit + IP | RLS + lifecycle suites green; immutability proven in CI |
| **FIN-AGING-6** — Excel renderer v1 | styled XLSX writer + 3 charts; parity suite vs recorded reference schema; determinism test | parity suite green; Excel-side-by-side sign-off |
| **FIN-AGING-7** — PDF + print | chart primitives in the PDF core; `aging-pdf-v1`; print stylesheet | hash-stable renders; Finance visual sign-off |
| **FIN-AGING-8** — sharing + rollout | share links + email delivery; role grants per D-11 ratification; module flag (`EFFITRANS_FINANCE_AGING_ENABLED` — two-layer rollout rule) | permissions review signed; production enable |

Deferred (own future phases, not blocking): credit notes (D-02), adjustments/write-offs
(D-03), client statements from the same snapshot machinery, collections-queue migration to
the shared bucket registry.

## RBAC impact (§9) — proposed, granted to NOBODY until D-11

New family (colon convention, granular-from-day-one):
`finance:aging:read · finance:aging:import · finance:aging:comment ·
finance:aging:validate · finance:aging:finalize · finance:aging:export ·
finance:aging:share · finance:aging:templates`

Notes: entering invoices/payments/credit notes stays under the existing `finance:create/
update/payment` authorities — aging adds no second door to the ledger. Restricted-client
visibility (spec §9 "view restricted clients") has no platform precedent — parked as an
explicit non-goal for v1 (Q-12). Likely grants to discuss: FINANCE_OFFICER
(read/import/comment/export), COLLECTIONS_OFFICER (read/comment), DAF (validate/finalize/
share), CEO/DGA (read), SYSTEM_ADMIN (templates, no finalize — signing convention).
Maker-checker: validator ≠ preparer enforced by trigger, mirroring payment verification.

## Risks

1. **Data debt is the real project**: 430 legacy invoices with due dates must be imported
   before the first platform-native report matches the workbook. Mitigation: FIN-AGING-4
   staging + completeness reporting; the arrêté report refuses to claim completeness while
   unimported legacy remains (banner, not silent).
2. **`Montant` semantics** (Q-01/Q-03): if the workbook's amount were *original* rather
   than outstanding, aggregates change meaning. Empirics say « encours », but confirmation
   is required before import mapping is frozen.
3. **Chart OOXML fidelity** across Excel versions — mitigated by using the reference
   workbook's own chart XML as the fixture and a real-Excel manual gate.
4. **Two aging vocabularies** coexisting (collections queue vs aging report) could confuse
   users — mitigated by explicit labels and the later deliberate queue migration.
5. **Historical reconstruction vs snapshot**: recomputing an old arrêté after late data
   entry gives different numbers than the FINAL snapshot — by design; the UI must always
   label which one is displayed. (Snapshot doctrine, UAT-2B precedent.)
6. **Confidentiality**: the received "anonymized" workbook leaked client names/amounts via
   Graphiques, and this repository is public — fixtures and docs must stay synthetic
   (rule applied throughout this audit; flagged to the operator).
7. **Scale**: 430 rows is trivial; the design (virtualized grid, snapshot rows) holds to
   tens of thousands, but the XLSX writer should stream sheets to keep memory flat.

## I. Decision register — Finance Manager / management decisions

| # | Decision | Options (recommended first) | Status |
|---|---|---|---|
| D-01 | Representation of legacy receivables | (a) import as `invoice` rows w/ `source='OPENING_IMPORT'` + one synthetic line — one engine, one truth; (b) separate opening-balance table | OPEN |
| D-02 | Credit notes (avoirs) | build in a dedicated phase with allocations; out of aging v1 (workbook shows none) | OPEN (scope/timing) |
| D-03 | Adjustments / write-offs | dedicated phase; approval workflow (maker-checker) | OPEN |
| D-04 | Report cadence & arrêté rules | monthly arrêté + on-demand; future-dated arrêté forbidden | OPEN |
| D-05 | Disputed invoices in the aging report | include with marker (recommended — money still owed); exclude like the collections queue | OPEN (= Q-05) |
| D-06 | As-of treatment of late reversals | reversal after arrêté does not rewrite that arrêté (knowledge-date rule, snapshot-consistent) | OPEN |
| D-07 | Rounding for `Retard moy.` | round-half-up to integer (displays match workbook int format) | OPEN |
| D-08 | Chart series colors | theme-default (faithful) vs risk-palette pinned (improvement) | OPEN |
| D-09 | Données Brutes row order | workbook order is opaque (anonymized); propose invoice-number asc | OPEN |
| D-10 | Report numbering format | `EFT-BAL-YYYY-NNNNN` (invoice-counter pattern) | OPEN |
| D-11 | Role grants for `finance:aging:*` | table above as starting point; **nothing granted until ratified** | OPEN |
| D-12 | Emoji in exported sheet names | keep (faithful; the file is proven to carry them) vs strip for tool-compatibility | OPEN |

## §12 Questions for the Finance Manager (cannot be answered from workbook or repo)

- **Q-01** « Montant (FCFA) » in Données Brutes: confirm it is the **remaining outstanding**
  at the arrêté (all evidence says yes), not the original invoice amount.
- **Q-02** May an arrêté be back-dated only, or also future-dated? Standard cadence?
- **Q-03** Partial payments: confirm they reduce the row (vs a separate "paid to date"
  column you'd like added as an improvement).
- **Q-04** « Retard moyen » KPI: mean over **all** invoices (negatives pulling it down) or
  over **overdue invoices only**? (The blanked cell can't tell us.)
- **Q-05** Disputed invoices: in or out of the aging report? (Collections queue freezes
  them; the workbook has no dispute concept.)
- **Q-06** Client risk floor: confirm the observed rule — a client whose *average* is ≤ 30
  days (even negative) is « Faible », never « Non échu ». Intentional?
- **Q-07** Rounding rule for average delays (the workbook shows integers).
- **Q-08** Is « Dossier » mandatory on every AR invoice, or may pure-finance invoices exist
  without a dossier? (Current schema requires `file_id`.)
- **Q-09** Currencies: is any receivable ever non-XOF? (v1 renders one currency per report,
  no conversion.)
- **Q-10** « Commentaires » on Dossiers Critiques: permanent collection notes (recommended
  — they live in `collection_follow_up` and the snapshot copies them) or per-report
  annotations?
- **Q-11** Share links: is an optional password required by your clients' auditors, and
  what default expiry?
- **Q-12** Who may see the full portfolio? Any client-restricted finance viewers?
- **Q-13** Who validates and who finalizes (DAF? DGA?) — the maker-checker seats.
- **Q-14** Source of invoice data going forward: platform-issued invoices only, or does a
  parallel accounting system remain the issuer (then imports are recurring, not one-time)?
