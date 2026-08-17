# EFFITRANS-HR-9 — Reporting RH: architecture & current-state audit

**Date:** 2026-08-17 · **Status: AUDIT ONLY — nothing implemented.** ·
**Baseline:** HR-8 closed COMPLETE/PRODUCTION-VALIDATED at `c11d5d3` (CI #492); carryover
cleanup at `6f94ec0` (ledger parity repaired, Intégration evidence parity shipped).
Governing scope: HR-0F Audit 5 — « Reporting | **HR-9** | aggregates, k-anonymity,
exports » — and `hr-documents-permissions-scopes` §2, which names the permission and the
privacy floor.

**Verdict: CONDITIONAL GO — four material decisions must be answered first (RQ-9.1…RQ-9.4),
and one of them determines whether HR-9 can display anything at all today.**

---

## 1. What already exists (verified from source)

| Capability | Where | Reusable for HR-9? |
|---|---|---|
| **Platform reporting subsystem** | `lib/bi/` (`aggregate`, `reports`, `service`, `xlsx`, `zip`, `date-range`), `lib/reports/` (`report-pdf`, `executive-pdf`, `powerbi`, `brand`, `templates`) | **Yes — the builders.** Pure functions over injected rows; CSV, XLSX (multi-sheet), branded PDF and Power BI packages already exist and are tested |
| **Export route** | `app/api/reports/export/route.ts` — GET, five standard reports + executive PDF + Power BI, audited `report.export.*`, « derived-only … no new aggregation » | **Builders yes, gate no** — it is gated on `analytics:read` (see §5) |
| **HR dashboard** | `app/departments/hr/page.tsx` — StatCards + `DeptAttentionCard`, composed from `employeeStats`, `hrDashboardCounts`, `hrOperationsCounts`, `leaveCounts`, `offboardingCounts`, `getHrCenterData` | **Yes** — HR already has live counters; HR-9 must not restate them differently |
| **HR read models** | `lib/hr/read.ts` (registry + `employeeStats`), `workspace.ts` (`getHrCenterData`, expiring contracts/documents, `recentHrActivity`), `leave.ts`, `onboarding.ts`, `offboarding.ts`, `performance.ts`, `training.ts`, `payroll.ts` | **Yes — these are the authoritative read models.** All server-only, admin-client, tenant-filtered |
| **Event ledger** | `hr_employee_event` (append-only, `status_changed` carries `{from,to}`) | **Yes** — the only truthful source of *movement* over time |
| **xlsx writer for HR** | `lib/hr/xlsx.ts` — `buildXlsxWorkbook` / `buildXlsx` (already used by the import template) | **Yes** |
| **k-anonymity helper** | **Does not exist anywhere in the repository** | Must be written (small, pure) |
| **`hr:reports:read`** | **Not catalogued, not granted, absent from code and from the production `permission` table** | See RQ-9.1 |

**Nothing in the platform reports on HR today.** The five standard reports are revenue,
clients, operations, SLA and finance; none touches an HR table.

## 2. Authoritative models — and the rule that follows

The HR read modules above are the model of record. HR-9 **reads them, aggregates in pure
functions, and stores nothing**. That gives the phase its shape:

* **No new database objects.** Every figure HR-9 can honestly produce is derivable from
  existing rows. No table, no view, no materialisation, no migration — a snapshot table
  would be a second source of truth for numbers that are already true.
* **No parallel read layer.** Where the hub already computes a figure, HR-9 consumes the
  same function; a second definition of « effectif » is how two screens start disagreeing.
* **Pure aggregation, injected rows** — the `lib/bi/aggregate.ts` idiom exactly.

## 3. The data reality (production, read-only, at audit time)

| Table | Rows |
|---|---|
| `employee` | **3** — of which **ACTIVE: 0** (all three terminated during the HR-8 UAT sessions) |
| `employment_contract` | **0** |
| `hr_leave_request` | **0** |
| `hr_attendance_day` | 3 |
| `hr_org_unit` | 1 |
| `hr_equipment_assignment` | 1 |
| `hr_offboarding_case` | 3 |
| `hr_employee_event` | 32 |

**This is the finding that shapes the phase.** The ratified privacy floor suppresses any
group smaller than **5**. With three employees in the registry, **every group is below the
floor**, so a faithfully-implemented HR-9 renders a page of « masqué » — and even without
the floor, the honest figures today are *zero active employees, zero contracts, zero
leave*. HR-9 is buildable and would be correct; it would simply have nothing to say until
the registry is populated, which is itself blocked on the second HR Officer designation
(the import batch `HR-IMP-MST7EF6P` still awaits its four-eyes approval).

This is the HR-7 « complete but empty » situation, one degree stronger: there, empty meant
zero rows; here, the privacy rule actively hides what little exists.

## 4. KPIs that can be derived truthfully (and those that cannot)

**Derivable today, from existing rows, with no invention:**

| KPI | Source | Note |
|---|---|---|
| Effectif (headcount) by status | `employee.status` | Already on the hub |
| Effectif by department / unit | `employee.department`, open PRIMARY `employee_assignment` | Unit placement is the HR-A2 authoritative rule — reused, not recomputed |
| Entrées / sorties over a period | `employee.hire_date`, `termination_date`, corroborated by `hr_employee_event.status_changed` | The dates are stamped facts |
| Ancienneté distribution | `hire_date` | Buckets are presentation, not policy |
| Motifs de départ | `employee.termination_reason` (free text today — RQ-8.1 unanswered) | Groupable only once the vocabulary exists |
| Congés: demandes par statut/catégorie, charge sur une période | `hr_leave_request` (dated, `day_tenths`) | HR-5 model, unchanged |
| Présence: jours et minutes saisis | `hr_attendance_day` | Facts as recorded; no schedule model exists (Q9) |
| Contrats arrivant à échéance | `expiringContracts` | Already on the hub |
| Documents arrivant à échéance | `expiringDocuments` | Already on the hub |
| Intégrations / départs en cours, étapes en retard | onboarding + offboarding readers | Already on the hub |
| Équipements attribués / restitutions attendues | `hr_equipment_assignment` open-row idiom | Already on the hub |
| Formation: sessions, inscriptions, certificats expirant | HR-6 training readers | Already on the hub |
| Performance: cycles, revues à finaliser, objectifs en retard | HR-6 performance readers | Counts only — **never** ratings or comments (C3) |

**NOT derivable — must not be invented:**

* **Turnover rate** — needs a ratified numerator/denominator and period convention (RQ-9.3).
* **Absenteeism rate** — needs an expected-working-days baseline; **no schedule model
  exists** (HR-7 Q9 left it open). A rate over an undefined denominator is a fabrication.
* **Headcount « as of » an arbitrary past date by department** — status history is
  reconstructible from `hire_date`/`termination_date`, but *placement* history requires
  walking dated assignments; see RQ-9.4.
* **Any monetary figure** — DEC-B63 stands; payroll preparation holds no amounts.
* **Any performance content** (scores, competencies, prose) — C3, and Q2's disclosure rule
  is identity-scoped, not aggregate-scoped.

## 5. Tenant / RBAC / RLS

* **Permission:** `hr:reports:read` is **inside the ratified nine-code ceiling** (HR-0 §10,
  DEC-B61/B63) — the *code* needs no new ratification. Its **grants are explicitly « a
  ratification item »** (RQ-9.1). It is currently catalogued nowhere and held by nobody.
* **The existing export route is the wrong gate.** `/api/reports/export` is gated on
  `analytics:read`, which CEO, DAF, commercial and recouvrement roles all hold. Adding an
  HR report type there would disclose HR aggregates to every analytics reader. HR-9 must
  reuse the **builders** (`toCsv`, `toXlsx`, the PDF layer) behind **its own**
  `hr:reports:read` gate — composition, not a shared door.
* **Reads:** admin-client, tenant-filtered, exactly as every HR reader (the tenant-scope
  guard enforces it). Aggregates never leave the tenant.
* **SYSTEM_ADMIN holds no `hr:*`** (DEC-B61) and must not gain `hr:reports:read`.
* **C3 stays out.** Aggregates are counts; no sensitive identifier, no document content, no
  performance prose enters a report — the EXECUTIVE_SUMMARY scope is « no row access at
  all ».

## 6. Historical / as-of semantics

Three honest levels, in increasing cost:

1. **Current state** (what the hub does today) — no history needed.
2. **Period movement** — entrées/sorties/congés between two dates, from stamped dates and
   the append-only ledger. Truthful today.
3. **True as-of reconstruction** — « effectif par département au 31/12 » requires replaying
   dated `employee_assignment` rows (append-and-close, so it is reconstructible) plus
   status history. Buildable, but it is a distinct engine and the first place a reporting
   phase silently becomes a data-warehouse.

**Recommendation:** HR-9 v1 = levels 1 and 2. Level 3 only if Effitrans asks for it
(RQ-9.4), and then as an explicit, separately-tested reader — never as a by-product.

## 7. Material decisions (must be answered before implementation)

| # | Question | Recommendation |
|---|---|---|
| **RQ-9.1** | **Who holds `hr:reports:read`?** The code is ratified; the grants are not. The ratified proposal grants it to HR_OFFICER and CEO, and explicitly not to DAF or SYSTEM_ADMIN. | Catalogue the code; grant to **HR_OFFICER** (who already reads every row, so an aggregate discloses nothing new) and to **CEO** only if RQ-9.2 is answered as « floor applies ». Park otherwise, the HR-7 idiom. |
| **RQ-9.2** | **Does the k-anonymity floor (<5) apply to a reader who already holds row access?** The ratified text attaches the floor to the EXECUTIVE_SUMMARY scope — « no row access at all ». | **Floor binds aggregate-only audiences (CEO/executive), not the HR desk.** Suppressing a number the HR Officer can obtain by counting the registry protects nobody and makes the workspace useless. This must be ratified explicitly, because it decides what the CEO sees. |
| **RQ-9.3** | **Turnover definition** — numerator (departures of which statuses?), denominator (opening headcount, average, closing?), period convention. | Do not invent. Until answered, publish **entrées** and **sorties** as counts, not a rate. |
| **RQ-9.4** | **Are true as-of (historical) aggregates required in v1**, or is current-state + period-movement enough? | Current-state + period-movement in v1. |

**A fifth, non-blocking observation:** with three employees and zero active, HR-9 will
display zeros and — under the floor — suppressed groups. Effitrans may prefer to sequence
HR-9 **after** the registry is populated (which needs the second HR Officer for the import
four-eyes). The phase is not blocked by this; its *value* is.

**RQ-8.1–8.8 remain untouched.** One dependency is worth naming rather than answering:
**RQ-8.1** (the termination-reason vocabulary) determines whether « motifs de départ » can
be grouped at all. Until it is answered, HR-9 reports departure *counts* and leaves the
free-text motive out of any grouping — no vocabulary is invented to make a chart look
better.

## 8. Proposed implementation plan (on GO, after RQ-9.1–9.4)

* **HR-9A — reporting core (no UI, no migration):** `lib/hr/reporting/model.ts` (pure:
  period types, bucket helpers, and the **k-anonymity function** — one place, tested
  against the ratified floor) + `lib/hr/reporting.ts` (server-only readers composing the
  existing HR read models; no new query patterns). Vitest for the pure layer; a SQL suite
  only if a reader needs a rule the database must hold — on current evidence, none does.
* **HR-9B — the workspace:** `/departments/hr/rapports`, gated on `hr:reports:read`, in
  French, replacing the last `SoonTile` (« Reporting RH »). Sections mirror the hub's
  vocabulary so no figure is named twice differently.
* **HR-9C — export:** CSV/XLSX (and branded PDF if wanted) via the **existing builders**,
  behind `hr:reports:read`, audited as `hr.report.export` — never through the
  `analytics:read` route.
* **HR-9D — closure:** operator UAT + completion report, exactly as HR-8.

Migration expected: **one only if RQ-9.1 requires cataloguing `hr:reports:read`** (a
permission row plus, if ratified, its grants) — not for any reporting object.

**HR-10 — Guide utilisateur & SOP RH** does not begin until HR-9 is completed and
validated (HR-0F §3 addendum).
