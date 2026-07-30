# FIN-AGING-3A — Preview Runbook & Visual Review

The Aging Balance workspace exists and is CI-green, but it has **never been seen
running**. This document is what turns that into a sign-off: how to stand the
preview up, what to look at, and what is already known to be imperfect.

---

## 1. Preview deployment approach

No new framework. Four existing gates, all of which must be true at once — and
in production at least two of them are false today, which is why the workspace
cannot leak there.

| # | Gate | Preview | Production today |
|---|---|---|---|
| 1 | Deployment | a Vercel **preview** build of `main` | production build |
| 2 | `EFFITRANS_FINANCE_AGING_ENABLED` | `true` (preview env var only) | **unset ⇒ route 404s** |
| 3 | Migration 72 applied | yes, on the preview database | **not applied** |
| 4 | A login holding `finance:aging:read` | yes | **impossible — the permission row does not exist** |

Gates 3 and 4 are the real protection: with migration 72 unapplied the
permission cannot be held by anybody, whatever an environment variable says.

### Steps (preview/staging only)

```bash
# 1 — apply migration 72 to the PREVIEW database (never production)
psql "$PREVIEW_DATABASE_URL" -f supabase/migrations/20260729000002_aging_balance_foundation.sql

# 2 — load the synthetic dataset (creates its OWN demo tenant; refuses to touch real data)
psql "$PREVIEW_DATABASE_URL" -f supabase/demo/aging_preview_dataset.sql

# 3 — enable the feature on the PREVIEW deployment only
#     Vercel → Project → Settings → Environment Variables → Preview
#     EFFITRANS_FINANCE_AGING_ENABLED = true

# 4 — give the reviewer a login in the demo tenant
#     app_user.tenant_id = 00000000-0000-0000-0000-00000000de00
#     with a role holding finance:aging:read (e.g. FINANCE_OFFICER or DAF)
```

Then open **`/departments/finance` → « Balance âgée »**, or `/finance/aging`
directly. Useful URLs for the review:

- `/finance/aging` — today's arrêté
- `/finance/aging?date=2026-06-12` — a back-dated arrêté (figures must change)
- `/finance/aging?currency=EUR` — the other currency present in the dataset
- `/finance/aging?population=OVERDUE_ONLY` — the Q-04 alternative

### Teardown

The dataset script ends with a commented teardown block that removes every row
it created, including the demo tenant.

---

## 2. Synthetic dataset

`supabase/demo/aging_preview_dataset.sql`. Everything is invented; the reference
workbook is not in this repository and no production record is touched.

**Four safety properties**: it creates its own tenant and writes nowhere else;
it aborts if that tenant ever holds a non-demo invoice; every row is prefixed
`DEMO-` / « Démo »; re-running replaces rather than duplicates.

**25 invoices across 12 clients**, shaped to hit each visual state:

| State | How |
|---|---|
| All seven buckets | due dates at −45, 0, 12, 30, 31, 60, 61, 90, 91, 180, 181, 365, 366, 742, 1580, 2505 days |
| The critical boundary | 365 (**not** critical) and 366 (critical) side by side |
| Not yet due / due today | −45, −30, −58 and exactly 0 |
| Partial payment | `DEMO-INV-0023`, 8 000 000 with 3 000 000 paid |
| Settled → excluded | `DEMO-INV-0024`, paid in full |
| Overpayment | `DEMO-INV-0025`, 500 000 billed / 620 000 paid → unapplied credit |
| Dispute | `DEMO-INV-0017`, flagged and still aged normally |
| Legacy opening import | four `OPENING_IMPORT` rows, no dossier, preserved `DEMO-LEG-…` references |
| Foreign currency | one EUR invoice → exclusion notice |
| Client « Faible » floor | *Client Démo Futur*, entirely not-yet-due |
| Top-10 cut-off | 12 clients, so the chart genuinely truncates |
| As-of behaviour | `DEMO-PAY-FUTURE` dated ahead, so back-dating the arrêté visibly changes a balance |

---

## 3. What changed in this phase (defects found by reviewing my own markup)

| Finding | Severity | Fix |
|---|---|---|
| Tab strip had `role="tab"` + `aria-selected` but **no tabpanel, no `aria-controls`, no arrow keys** — announcing a widget then failing to behave like one, worse than plain buttons | **High** | Full ARIA pattern: `role="tabpanel"`, `aria-controls`, `aria-labelledby`, roving `tabIndex`, ←/→ navigation |
| SVG charts exposed only a title: `role="img"` **hides their contents**, so the figures were unreachable | **High** | `ChartDataTable` — a visually-hidden table built from the same series |
| `TopClientsChart` had `role="img"` on a `<ul>`, hiding real text it already exposed | **High** | Role removed; the list is its own alternative |
| Body text at `text-slate-400` ≈ **2.8:1** on white, below the 4.5:1 minimum | Medium | Raised to `slate-500` (≈ 4.8:1) in 6 places |
| 50-row table scrolled past its own headings — « Montant » and « Jours retard » are easy to confuse without them | Medium | `sticky top-0` header |
| No column sorting in Données Brutes | Medium | Sortable on 6 columns, display-only, `aria-sort` announced, third click restores the engine's order |
| Footer linked to `/finance` rather than the Finance hub | Low | Corrected to `/departments/finance` |
| No visible focus ring on tabs and sort buttons | Low | `focus-visible:ring` added |

---

## 3b. FIN-AGING-3B — visual consistency pass

Presentation only; no rule, calculation, query, permission or schema touched.

| Finding | Why it mattered | Fix |
|---|---|---|
| Amounts printed « FCFA », the currency selector printed « XOF » | The platform's own rule is stated in `lib/operations/kpi/format.ts` — *"explicit currency code (never abbreviated ambiguously)"* — and FCFA appeared in **no other component**. This module was the sole outlier. | ISO code everywhere |
| KPI cards used tinted backgrounds | Nothing else in Effitrans does. `StatCard` is the house pattern: white `surface`, coloured accent bar, `tabular` figure. | Adopted `StatCard`'s shape |
| Tabs were teal underlines with emoji | `ShippingNav` is the house tab pattern (navy pill), and platform navigation carries no emoji | Pill styling, labels only — the workbook's ratified dashboard risk emoji stay |
| No breadcrumb | Every other workspace states where it sits, because the sidebar is a frozen contract | « Finance › Balance âgée » |
| Native date input renders in the **browser's** locale (`07/30/2026` on en-US) and no CSS can change it | The arrêté is the single most important parameter on the page | Control kept (picker + a11y); the date restated in French beneath it, wired with `aria-describedby` |
| Plain one-line empty cells | The platform's empty states explain themselves | `TableEmpty` + chart empties in the house language, each saying *why* it is empty |
| Footer competed with content | Provenance is metadata, not content | Recedes by size and a hairline rule — **not** by colour: `slate-400` is ≈2.8:1 and fails AA. My own contrast guard caught the first attempt. |
| `tabular-nums` vs the house `.tabular` class | Consistency of figure rendering | 28 occurrences switched |

## 4. Review checklist for the Finance Manager

Nothing below is a code change — it is what to look at.

**Tableau de bord** — KPI hierarchy and spacing; is « Total encours » clearly the
headline? Do the tooltips (`?`) explain « Retard moyen » and « Dossiers
critiques » adequately? Does the bucket table read top-to-bottom as
green→red? Is « TOTAL GÉNÉRAL » prominent enough?

**Données brutes** — density at 50 rows; does the sticky header help? Are the
six filters the right six? Is the « N affichée(s) sur M » sentence clear enough
that a filtered view is never mistaken for a smaller portfolio?

**Analyse clients** — is the ranking readable? Do the risk badges carry meaning
without colour alone? Is « Part encours » to one decimal right?

**Dossiers critiques** — is the urgency visible enough? Are the legacy
references and dispute markers legible? Should the follow-up column be wider?

**Graphiques** — legibility of bucket labels at this width; colour consistency
with the dashboard; behaviour when the window is narrow.

**Terminology** — every French label against the workbook's own wording. This is
the item I most want challenged: labels were transcribed from the workbook, but
only you can confirm they read naturally to the team.

**Mobile** — KPI cards stack; tables scroll horizontally inside their own
container (the page itself must never scroll sideways); tabs wrap.

---

## 5. Performance observations (from code, not measurement)

Honest framing: **no runtime measurement was taken** — there is no browser
tooling in this repository and no local database, so the numbers below are
structural expectations, not results.

| Aspect | Expectation at ~430 rows | Note |
|---|---|---|
| Server query | 6 round trips, all batched, none per-row | 1 invoice query + lines, payments, clients, files, follow-ups |
| Engine | one pass plus a sort; integer arithmetic | trivial at this size |
| Payload | whole report serialised to the client | ~430 rows × ~15 fields ≈ a few hundred KB |
| Tab switching | pure state change, no refetch | instant |
| Filtering / sorting | in-memory over an already-loaded array, memoised | instant |
| Charts | inline SVG, ≤ 7 + 10 shapes | negligible |
| Arrêté / currency change | full server round trip (a new URL) | correct — the figures genuinely change |

**Two things to watch, neither worth fixing yet** (no premature optimisation):

1. **The invoice query has no `LIMIT`.** Correct for a complete balance, but a
   tenant with tens of thousands of open receivables would pull them all. If
   that becomes real, aggregate in SQL for the dashboard and paginate the raw
   tab server-side.
2. **The whole report crosses to the client.** Fine at 430 rows; at ~10 000 it
   would be worth sending only the current page.

---

## 6. Known limitations

- **No screenshots.** No Playwright/jsdom (vitest runs in `node`) and no local
  database, so the workspace cannot be rendered here. The build proves it
  compiles; only the preview proves how it looks.
- **No runtime performance numbers**, per above.
- **Contrast was reasoned, not instrumented** — slate-500 on white is ≈ 4.8:1 by
  the standard formula, but a real audit tool on the deployed page is better
  evidence.
- **Q-04 unresolved**: « Retard moyen » defaults to ALL_ROWS and says so in its
  tooltip. Confirming the intended population is a Finance decision.
- **Q-01 unconfirmed**: that « Montant » is the outstanding balance. Everything
  rests on it, and FIN-AGING-4 will write 430 rows on that assumption.
- **Credit notes and adjustments do not exist yet** (D-02/D-03), so the balance
  formula currently reduces by payments only.
