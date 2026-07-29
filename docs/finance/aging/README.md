# FIN-AGING-0 — Accounts Receivable & Aging Balance: Audit and Architecture

**Status: audit complete · no implementation · no migrations · recommendation at the end.**
Analyzed 2026-07-29 against the working tree at `fc03136` and the Finance Manager's
workbook `TEST BALANCE AGEE CLIENTS.xlsx` (dissected at OOXML level; the file itself is
**not** committed — this repository is public and the received copy still contains real
client data on the Graphiques tab).

## The documents

| Doc | Deliverable |
|---|---|
| [workbook-specification.md](workbook-specification.md) | **A** — all five tabs: structure, every column, formats, merges, palette, charts, empirical rule verification |
| [aging-calculation-spec.md](aging-calculation-spec.md) | **E** — exact buckets (verified on 430 rows), outstanding derivation, edge cases, pseudocode, boundary tests |
| [repository-audit.md](repository-audit.md) | §1 — reusable / incomplete / missing / conflicting / deprecated |
| [field-dictionary.md](field-dictionary.md) | **Field Dictionary** — the permanent Finance reference |
| [schema-and-erd.md](schema-and-erd.md) | **B, C, D** — source-to-target mapping, ERD, schema proposal (no migration yet) |
| [ui-and-renderers.md](ui-and-renderers.md) | **F, G** — workspace, Excel v1 / PDF / print / sharing, fidelity testing |
| [roadmap-and-decisions.md](roadmap-and-decisions.md) | **H, I** — 8 gated phases, RBAC impact, risks, decision register, Finance Manager questions |

## Architecture discovered (one paragraph)

The prompt's layered target is already half-built. Sources exist end-to-end
(`client` → `operational_file` → `invoice`/`invoice_line` → `payment` with maker-checker
verification, dispute flag, append-only collection follow-ups). The money calculator is
single-sourced (`lib/finance/calc.ts`); a pure aging engine with the right doctrines
(injected reporting date, due-today-not-overdue, missing-due-date exception, dispute
freeze) exists at coarser bucket granularity (`lib/collections/aging.ts`); the immutable
report-snapshot pattern is proven (UAT-2B official invoice: rendered once, SHA-256, DB
uniqueness, delete protection); PDF chrome exists (`ReportLayout`); a dependency-free XLSX
writer exists but unstyled (`lib/bi/xlsx.ts`); template registries, per-tenant numbering,
email delivery, public-token routes, RLS/tenancy/audit rails and the granular-permission
pattern are all established. What is genuinely new: the 7-bucket scheme as registry data,
the arrêté-parameterized AR position, report lifecycle tables, the styled+charted XLSX
renderer, secure report share links, legacy import, and the `finance:aging:*` family.

## Workbook findings that bind the design (each verified, not assumed)

1. **The workbook is itself a generated artifact** (openpyxl; zero formulas — all values
   precomputed). The calculation-vs-renderer separation the prompt demands is how the
   original is produced.
2. **Aging rules, proven on 430 rows**: `days = arrêté − échéance`; `d ≤ 0 → Non échu`
   (due-today included); buckets 1–30 / 31–60 / 61–90 / 91–180 / 181–365 / >365; risk
   mapping exact with **two label sets** (plain on data tabs, emoji on the dashboard).
3. **« Critique » is solely `> 365 jours`** — title says it, 81 rows confirm it (366 in,
   365 out), no amount threshold, sorted descending, total row carries the count in the
   days column.
4. **Client risk has a floor**: average ≤ 30 days — even negative — is « Faible »; no
   « Non échu » exists at client level (8 counter-examples prove the naive rule wrong).
5. **The arrêté is a stated parameter** (12/06/2026 in three titles), never "today".
6. **Only open receivables appear** (« Recouvrement en cours ») — paid/void/zero rows are
   excluded upstream, not shown at zero.
7. The received copy was **incompletely anonymized** — real client names/amounts survive on
   Graphiques. Operator note below.

## Missing Finance components (build list)

Aging report snapshot + lifecycle tables · report template registry · styled/charted XLSX
renderer · PDF chart primitives · secure report share links · legacy-import staging ·
`finance:aging:*` permissions · (provisioned but deferred: credit notes, adjustments,
write-offs, opening-balance doctrine per D-01).

## Recommendation — **CONDITIONAL GO**

The architecture is sound, heavily reuse-based, and the workbook's rules are now pinned by
evidence rather than assumption. Implementation (FIN-AGING-1, the pure engine, dark) can
start immediately — it depends on no open decision. The conditions before anything
user-visible ships:

1. **Q-01/Q-03 answered** (Montant = outstanding; partial-payment treatment) — they freeze
   the import mapping.
2. **D-01 ratified** (legacy receivable representation) — it shapes the only schema touch
   on `invoice`.
3. **D-11 ratified** (role grants) — permissions land granted-to-nobody until then.
4. **Confidentiality handled**: a truly clean workbook copy for fixtures, and the original
   kept off the public repo (done in this audit; must stay the rule).

Everything else in the decision register can be resolved phase-by-phase without blocking.

## ⚠️ Operator notes

- The workbook was analyzed from `Downloads/TEST BALANCE AGEE CLIENTS.xlsx` and **must not
  be committed**. The Graphiques tab of the "anonymized" copy still lists the top-10
  clients by name with amounts, and the analysis tabs retain real totals. If that copy
  circulates further, re-anonymize including Graphiques (and remember blanked cells keep
  their derived G/H/I values — true anonymization must strip those relationships too).
- Nothing in this phase changes existing Finance behavior. No migration exists yet;
  FIN-AGING-2's migration will follow the ratifications above.
