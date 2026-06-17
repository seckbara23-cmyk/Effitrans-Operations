# Phase 3.0 — Business Intelligence & Reporting

**Date:** 2026-06-17
**Goal:** management intelligence + executive reporting, derived entirely from existing records. Analytics/reporting only — no workflow/lifecycle changes, no new tables, no ETL/warehouse/cron/copies.

**Validation:** `tsc --noEmit` clean · **259 tests** pass (+10) · `next build` succeeds · boundary + secrets checks clean.

---

## Dashboards added

- **`/dashboard/executive`** (Area 7) — one-page executive overview (audience: CEO / SYSTEM_ADMIN / OPS_SUPERVISOR, all hold `analytics:read`): revenue KPIs, operations, financial exposure (aging), SLA compliance per department, top clients, operational bottlenecks. Composes `getBusinessIntelligence` + `getControlTower`.

The existing **`/analytics`** (reused) provides the revenue/collection/shipment **12-month trends** (Area 10) via `getExecutiveAnalytics`, and **`/departments/management`** the live management funnel — no duplication.

## Reports added (Area 8) — `/reports`

Replaces the old placeholder. Five reports with a **date-range filter** (revenue/clients/finance/operations filter by issue/created/paid date) and per-report **CSV / XLSX export**:
Revenue · Clients · Operations (department productivity) · SLA (compliance %) · Finance (receivables aging + top overdue).

## Exports added (Area 9)

`/api/reports/export?type=<…>&format=csv|xlsx[&from&to]` — gated by `analytics:read`. Dependency-free, no external integration:
- **CSV** — RFC-4180 with a UTF-8 BOM (Excel-friendly).
- **XLSX** — a minimal **stored-ZIP OOXML** writer (`lib/bi/xlsx.ts`) — valid single-sheet workbook, no library. (No PDF this phase.)

## Analytics services added

| Module | Kind | Purpose |
|---|---|---|
| `lib/bi/aggregate.ts` | PURE | revenue metrics, client intelligence (ranking + outstanding + payment delay + last activity), receivables aging, department productivity, CSV |
| `lib/bi/xlsx.ts` | PURE | dependency-free stored-ZIP XLSX writer |
| `lib/bi/reports.ts` | PURE | 5 report-table builders (shared by page + export) |
| `lib/bi/service.ts` | SERVER | single tenant-scoped raw load → composes the BI areas (gated `analytics:read`; finance figures gated `finance:read`) |

Reuses existing services: `getAnalytics` / `getExecutiveAnalytics` (trends, health) and `getControlTower` (SLA, bottlenecks, avg times) — no duplicate reporting logic.

## BI areas coverage

| Area | Where |
|---|---|
| 1 Revenue intelligence | `revenueMetrics` → executive + Revenue report; trends via /analytics |
| 2 Client intelligence | `clientIntelligence` → executive top clients + Clients report |
| 3 Operational performance | control-tower avg times + `departmentProductivity` → Operations report |
| 4 SLA performance | control-tower `slaByDept` → SLA report (compliance %); **trend vs previous month = N/A** (no SLA history is stored — point-in-time only) |
| 5 Department productivity | `departmentProductivity` → Operations report |
| 6 Financial exposure | `receivablesAging` (0–30/31–60/61–90/90+) + top overdue → executive + Finance report |
| 7 Executive dashboard | `/dashboard/executive` |
| 8 Reporting center | `/reports` |
| 9 Export CSV/XLSX | `/api/reports/export` |
| 10 Trend analysis | reused `getExecutiveAnalytics` 12-month series on /analytics |

**Documented limitations:** SLA month-over-month trend and average documentation-verification time are shown as "Not enough data available" where no source history exists (point-in-time only) — consistent with the spec's fallback.

## Permissions

All BI surfaces gated by **`analytics:read`** (held by CEO / SYSTEM_ADMIN / OPS_SUPERVISOR / ACCOUNT_MANAGER / FINANCE_OFFICER). **Finance figures** (revenue, outstanding, aging, collection) are included only with **`finance:read`** — otherwise shown as `—`. No new permissions seeded (the suggested `executive:read` / `reports:read` can be added later without code change); no RBAC/RLS changes; tenant-scoped throughout (admin client + explicit tenant filter, the established analytics pattern). No cross-tenant analytics.

## Files changed

**New:** `lib/bi/aggregate.ts`, `lib/bi/xlsx.ts`, `lib/bi/reports.ts`, `lib/bi/service.ts`; `app/dashboard/executive/page.tsx`; `app/reports/page.tsx` (replaces ModulePage); `app/api/reports/export/route.ts`; `tests/bi.test.ts`; `docs/phase-3.0-business-intelligence.md`.
**Edited:** `lib/nav.ts` (Executive + Reports links, `analytics:read`); `lib/i18n.ts` (`t.bi` + nav labels); `tests/departments-nav.test.ts` (/reports is now a real page).

## Tests added

`tests/bi.test.ts` (10): revenue metrics (month/last/YTD/outstanding/collected/avg), client intelligence ranking + active count + payment delay, receivables aging buckets, department productivity (counts + durations + rates), CSV escaping/BOM, the **stored-ZIP XLSX** validity (PK magic + worksheet part + cell values), and the revenue/clients/SLA report builders (incl. compliance %). Deterministic fixtures — no time-sensitive failures.

## Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 259 passed (+10) |
| `next build` | ✅ success (/dashboard/executive, /reports, /api/reports/export) |
| boundary grep | ✅ no client imports the server-only BI service / admin; the 3 BI pure modules are server-only-free |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## Live testing checklist

1. As CEO/SYSTEM_ADMIN/OPS_SUPERVISOR: `/dashboard/executive` shows revenue, operations, exposure, SLA compliance, top clients, bottlenecks; nav shows "Tableau exécutif" + "Rapports".
2. `/reports`: five reports render; set a date range → revenue/clients/finance update; export CSV and XLSX per report (files download; XLSX opens in Excel).
3. A user with `analytics:read` but **without** `finance:read` sees BI surfaces with revenue/outstanding/aging as `—` (no finance figures).
4. A user without `analytics:read` cannot open the executive dashboard / reports (forbidden) and the export route returns 403.
5. Receivables aging buckets and top-overdue clients match the finance data; client ranking matches revenue.
6. Tenant isolation: figures only reflect the caller's tenant.

## Constraints honoured

No workflow / lifecycle changes · no notifications · no cron / background workers · no warehouse / ETL · no duplicate tables / analytics copies · everything derives from existing operational data + existing analytics/SLA/control-tower services · tenant-scoped, no RLS weakening.
