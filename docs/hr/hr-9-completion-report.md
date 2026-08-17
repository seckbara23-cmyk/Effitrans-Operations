# EFFITRANS-HR-9 — Reporting RH: completion report & production UAT closure

**Date:** 2026-08-17 · **Audit:** `8f3a879` (docs/hr/hr-9-reporting-audit.md, CONDITIONAL GO) ·
**Implementation:** `e8de65b` + `4cf6f79` (CI #496 GREEN) · **HR-9D closure:** this document.
**Migration 114** `20260905000001_hr_reports_activation.sql` — **applied and reconciled in
production**, parity confirmed through `20260905000001`.

## Closure status

# **HR-9: COMPLETE / PRODUCTION-VALIDATED.**

The operator exercised the workspace, both department filters and the CSV export in
production as Chargé RH, and every figure reconciled against the registry. The one
acceptance criterion not exercised interactively — the executive privacy floor — is proven
by evidence that is *stronger* than a session could provide today; the reconciliation is
recorded in full below rather than waved through.

One defect was found in the operator's own export evidence (F-1) and fixed in this commit.

## Production UAT evidence (operator-observed, recorded verbatim)

> **1. Reporting RH production workspace — PASS**
> Unfiltered production report loaded successfully. Observed:
> Employés au registre: 3 · Actifs: 0 · Suspendus: 0 · Sans compte de connexion: 1 ·
> Entrées: 0 · Sorties: 3 · Congés approuvés: 0 · Congés à décider: 0 ·
> Intégrations en cours: 0 · Départs en cours: 0 · Étapes de clôture à terminer: 0 ·
> Matériel à restituer: 0 · Restitutions attendues: 0 · Contrats expirant bientôt: 0 ·
> Documents expirant bientôt: 0 · Department breakdown: FINANCE 2 / TRANSIT 1 ·
> Status breakdown: Départ 3.
> The interface correctly states that no turnover rate is calculated because the method has
> not been ratified.
>
> **2. TRANSIT department filter — PASS**
> Employés au registre: 1 · Sorties: 1 · Actifs: 0 · Sans compte de connexion: 1.
> This reconciles with the original department breakdown.
>
> **3. FINANCE department filter — PASS**
> Employés au registre: 2 · Sorties: 2 · Actifs: 0 · Suspendus: 0 ·
> Sans compte de connexion: 1. Again, this reconciles exactly with the original report.
>
> **4. CSV export — PASS**
> Exported the FINANCE-filtered report for 2026-08-01 through 2026-08-17. The downloaded
> CSV preserved the selected scope and reported: Département: FINANCE · Employés au
> registre: 2 · Actifs: 0 · Suspendus: 0 · Sans compte de connexion: 1 · Entrées: 0 ·
> Sorties: 2 · TERMINATED: 2 · FINANCE: 2 · Finance organizational unit: 2. It also
> preserved the explicit note that no turnover rate is calculated because the method has
> not been established.
>
> **CEO privacy-floor UAT:** not performed interactively.

**Internal consistency of the evidence:** the two filtered runs sum exactly to the
unfiltered one (1 + 2 = 3 employees; 1 + 2 = 3 sorties), and the status breakdown
(« Départ 3 ») agrees with « Actifs: 0 ». The figures are the honest state of a registry
holding three departed employees — HR-9 reports what exists, and today that is mostly zero.

## RQ-9.2 — the executive privacy floor, reconciled without a CEO session

**Question:** is the delivered evidence sufficient to prove that a reader holding
`hr:reports:read` *without* row access has small-group breakdowns masked, absent an
interactive CEO login?

**Answer: yes — conclusively.** The invariant decomposes into three links, each proven:

**Link 1 — the rule itself.** `applyPrivacyFloor` is a pure function, and the test suite
*executes it*, it does not describe it: given groups of 12 / 4 / 1, a `ROW_HOLDER` receives
`[12, 4, 1]` unmasked, and an `AGGREGATE_ONLY` reader receives `[12, masqué, masqué]` — the
group labels retained, the counts withheld. The boundary is pinned inclusive at the ratified
floor of 5 (a group of exactly 5 is disclosed; 4 is not). This is the rule running, not a
proxy for it.

**Link 2 — which tier a reader lands in.** `reportViewerTier` keys on **row access, not
seniority**: `["hr:reports:read","hr:read"]` → ROW_HOLDER; `["hr:reports:read"]` →
AGGREGATE_ONLY; and `["hr:reports:read","analytics:read","executive:dashboard:read"]` →
AGGREGATE_ONLY, because executive breadth buys no row access. Its only input is the
effective permission list.

**Link 3 — where the real CEO accounts land, in production.** Verified read-only at closure:

| Role | `hr:*` held in production |
|---|---|
| `CEO` | **`hr:reports:read`** — and nothing else |
| `HR_OFFICER` | `hr:config:manage`, `hr:manage`, `hr:read`, `hr:reports:read` |
| `DGA` / `DAF` | `hr:leave:approve`, `hr:performance:finalize` — **no reporting, no row access** |

And at account level, **every active account carrying the CEO role resolves to
`has_row_access = false`** — including the broad multi-role accounts that hold fifteen to
twenty-three roles each. None of them acquires `hr:read` through any role.

Because link 2 is a deterministic function of the permission list, and link 3 establishes
that no CEO-role account's list contains `hr:read`, every such account resolves to
`AGGREGATE_ONLY` — after which link 1 governs what they see. Both surfaces consume that
tier: the workspace's breakdown component and the export route both call
`applyPrivacyFloor(rows, tier)`.

**Adversarial evidence.** Seven mutations were applied and each turned the suite red:
the floor ceasing to mask (U1), the floor lowered below 5 (U2), the tier keyed on
`analytics:read` instead of row access (U3), the export skipping the floor (U4), the
workspace gate dropping to `analytics:read` (U5), the grant sprayed to an unratified seat
(U6), and **CEO quietly gaining `hr:read`** (U7). The database refuses the same drift
independently: migration 114's assertion 3c raises if any unratified role holds
`hr:reports:read`, and the HR-A1 SQL suite asserts against the live database that CEO holds
`hr:reports:read` and nothing else.

**What a CEO session would add — and why it is less, not more.** It would confirm visually
that the rendered page shows « masqué ». That rendering path is the same component the
operator already exercised as Chargé RH; only the `tier` prop differs, and its value is
settled by links 2 and 3. Moreover, with today's data — three employees in groups of two
and one — a CEO session would show *every* breakdown masked, and so could not demonstrate
the mixed case at all. The automated evidence covers precisely that case (12 visible,
4 and 1 masked). **No previously ratified acceptance criterion requires an interactive
CEO session**, and none was withheld: creating a production user or synthetic HR data to
stage one would have manufactured the evidence rather than found it.

## Finding F-1 — the export printed a raw status code

**From the operator's own evidence:** the CSV reported « TERMINATED: 2 » where the
workspace shows « Départ ». The export wrote breakdown labels verbatim while the screen
translated them through the shared French vocabulary. A file that names the same fact
differently from the screen is a small lie about the same number.

**Resolved:** the export applies `EMPLOYEE_STATUS_FR` to the status breakdown, so the file
reads « Départ » exactly as the screen does. Department and org-unit labels are tenant data
and stay verbatim. No rule changed, no migration.

## What HR-9 is, and what it deliberately is not

Built entirely on what existed: the BI layer's CSV builder, the HR read models, the hub's
own counters. **No reporting table, no snapshot, no materialised view** — migration 114 adds
one permission and two grants, and asserts that no such object was created. The reader
performs no writes.

Absent by ratification, and asserted absent: any **turnover rate** (RQ-9.3 — the screen and
the file both say why), any absence rate (no schedule model exists), any monetary figure
(DEC-B63), any **as-of reconstruction** (RQ-9.4 — v1 is current state plus movements between
two dates; the event ledger is never replayed), and any grouping of the **free-text
departure motive** (RQ-8.1 remains unresolved).

## Open items carried out of HR-9 (none blocks the verdict)

1. **The registry is nearly empty** — three employees, none active — so the report truthfully
   shows zeros. Populating it is blocked on the second HR Officer designation, which the
   import's four-eyes approval requires. HR-9's value grows with the data; its correctness
   does not depend on it.
2. **RQ-9.3 (turnover methodology)** and **RQ-8.1 (termination-reason vocabulary)** remain
   open. When RQ-8.1 lands, grouping departure motives becomes possible; when RQ-9.3 lands,
   a rate may be added.
3. **RQ-8.2–8.8** are untouched.

## Next phase

**HR-10 — Guide utilisateur & SOP RH** (HR-0F §3 addendum) is now unblocked by this closure:
in-platform, French, concise, non-technical, organised around the actual HR workspaces, with
real production screenshots, numbered operating instructions, contextual « Aide » entry
points, and an optional printable branded PDF. It begins on an explicit GO, audit-first as
every phase has.
