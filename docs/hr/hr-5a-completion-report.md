# HR-5A — HR Workspace Activation: Completion Report

**Date:** 2026-08-02 · **Type:** UI activation. **Zero migrations, zero permissions, zero
grants, zero RLS changes, zero business-model changes** — all test-pinned.

## 1. Repository and route audit (done first)

| Finding | Detail |
|---|---|
| HR routes | **9**, all gated on `hr:read` server-side: hub · `registre` · `organisation` · `configuration` · `imports` · `onboarding` · `equipement` · `conges` · `[id]` |
| Duplicate employee entry points | **none** — one directory (`/registre`), one profile (`/[id]`) |
| **Broken link found and fixed** | the registry's filter links still pointed at `/departments/hr`, which became the hub in HR-1: **every filter click left the registry and lost the filter**. Now `/departments/hr/registre`. Test-pinned |
| Sidebar entry | **already existed and was already correct** — added HR-1, `IconTeam` since HR-4. Verified, not duplicated |
| Global search | **no search engine exists.** The topbar input is a decorative `<input type="search">` with no handler, form or query anywhere |
| Scheduler / cron | **none exists.** No `app/api/cron*`, no scheduled producer |
| Executive dashboard | a genuine plug-in pattern (`EXECUTIVE_SECTIONS` + `KPI_SOURCES` + `readers/*`) |

## 2–4. Activation delivered

**Sidebar** — unchanged by design: « Ressources humaines », `IconTeam`, `hr:read`, under
MANAGEMENT (the ratified placement; DÉPARTEMENTS stays at its ratified three). Department
marks remain distinct: Opérations `IconGear` · Transit `IconTruck` · Finance `IconFinance` ·
RH `IconTeam` (≠ Administration's `IconUsers`). No emoji.

**HR Operations Center** at the same route `/departments/hr` — no competing dashboard route
was created. Headline effectifs, a house-pattern attention card, twelve canonical tiles,
structure counts, and a recent-activity feed projected from the append-only ledger.

**Canonical navigation** — one workspace tile per completed capability (pinned as exactly
one each). Roadmap tiles disabled and named by phase: Performance/Formation (HR-6), Paie
(HR-7), Offboarding (HR-8), Reporting (HR-9). **Recruitment is not listed** — the frozen
roadmap excludes ATS from current scope, so promising it would be dishonest.

## 5. Employee profile

Identité · Emploi · Affectation · Chronologie · Contrats · Documents · Équipements ·
Congés · **Présence** (new panel; the *entry* stays in the Congés workspace rather than
duplicating a page). C3 documents remain invisible without `hr:sensitive:read`; leave
decision controls remain invisible without `hr:leave:approve`.

## 6. Executive dashboard — integrated, self-gated

Six HR KPIs via a new `readers/hr.ts` that **composes existing HR services only** — it
contains no query of its own (pinned: no `.from(`, no admin client). **It self-gates on
`hr:read` and returns null without it**, so a viewer holding `executive:dashboard:read`
alone sees HR reported as *unavailable*, never as zero — the same withholding shape
`canFinance` already uses. Turnover, absence rate and average onboarding duration are
**excluded by name**: they need ratified formulas and a period model that do not exist.

## 7. Global search — **DEFERRED**, with evidence

There is no global-search infrastructure to integrate with. Adding HR results would have
meant building the search engine itself, which the phase forbids. **Delivered instead,
inside the existing page pattern:** a name / matricule / fonction filter on the registry,
querying only columns the table already displays — pinned unable to reach
`personal_email`, `personal_phone`, identifiers or compensation.

## 8. Notifications — **DELIVERY DEFERRED**, attention panel delivered

The notification engine exists (`lib/notifications/*`) but **no scheduled producer does** —
no cron, no queue worker. Contract/document expiry and overdue signals are time-based and
need a producer; inventing a scheduler would breach "no new scheduler, queue, table or
migration". **Delivered instead:** the HR attention card, computed live on page load from
the same sources a future producer would read — so when a scheduler exists, it consumes
`lib/hr/workspace.ts` rather than replacing it.

## 9–11. Files and tests

**Created:** `lib/hr/workspace.ts` (read-only composition, failure-isolated) ·
`lib/executive/readers/hr.ts` · `tests/hr-5a-activation.test.ts` (22 contracts) · this
report. **Modified:** the hub (rewritten to Operations Center standard) · `registre`
(canonical links + filter form) · `[id]` (Présence panel) · `lib/hr/read.ts` (filter) ·
`lib/executive/{types,reader,links}.ts` · two pins updated deliberately.

**Gates: 196 files / 4714 tests green · tsc clean · build clean.**

## 12. Accessibility & responsive

Filter input carries an `sr-only` label; disabled tiles use `aria-disabled` and are not
links; the ledger feed is a list, not a table; every grid is `grid-cols-2 … lg:grid-cols-4`
so cards stack on mobile; contrast follows the house `slate-500`-minimum rule (the guard
that has caught regressions twice remains in force).

## 13. Permission & security review

Every gate intact and pinned: nine routes on `hr:read`; configuration on
`hr:config:manage`; approval on `hr:leave:approve`; C3 documents on `hr:sensitive:read`;
executive HR self-gated. **No grant, no new code, no bypass, no backdoor.** The three
catalogued-but-ungranted permissions remain granted to nobody, and the UI *names* what it
is waiting for instead of hiding it.

## 14. Deferred activation items

| Item | Why | Unblocked by |
|---|---|---|
| Global search integration | no search infrastructure exists | a search-infrastructure phase (not HR) |
| Scheduled notification delivery | no scheduled producer exists | a scheduler/queue phase (not HR) |
| Configuration, sensitive documents, leave approval | permissions ungranted | HRQ-D2 + `hr:leave:approve` ratification (HR-5A activation plan, P1/P2) |
| Meaningful content in every workspace | tables are empty | B2 structure answers, entered through the UI |

## 16. Readiness

HR is a first-class workspace for authorized users; every completed capability is reachable
by exactly one canonical route; every gate is intact and test-pinned; the two items that
could not be honestly delivered are deferred with their evidence rather than half-built.
**HR-6 has not begun.**
