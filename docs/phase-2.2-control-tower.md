# Phase 2.2 — Operations Control Tower

**Date:** 2026-06-17
**Goal:** turn `/dashboard` into a true logistics operations control tower — funnel, department flow, bottlenecks, needs-attention queue, aging, executive KPIs — all **derived** from existing records and the existing lifecycle classifier. No schema, no migrations, no new states/tasks/notifications/cron, no duplicated lifecycle logic.

**Validation:** `tsc --noEmit` clean · **220 tests** pass (+9) · `next build` succeeds · boundary + secrets checks clean.

---

## Deliverables (all derived, read-only)

| # | Deliverable | How |
|---|---|---|
| 1 | **Operational funnel** (8 stages) | per-dossier `getDossierLifecycle()` → `funnelStage()` buckets (`draft/documents/customs/transport/delivered/invoiced/paid/archived`) |
| 2 | **Department workload** | satisfied by the existing **Department cards** section (Documentation/Customs/Transport/Finance metrics from Phase 2.0 classifiers) |
| 3 | **Bottleneck detection** | derived counts from lifecycle: docs-blocked, customs inspection, awaiting POD, overdue invoices |
| 4 | **Needs-attention queue** (top 10) | dossiers blocked / waiting / high-priority / overdue, ranked by priority then days waiting |
| 5 | **Operations flow** (Doc→Customs→Transport→Finance→Archive) | dossier count per `currentDepartment` (closed → Archive) |
| 6 | **Aging analysis** | active dossiers bucketed by age from `created_at`: 0–2 / 3–5 / 6–10 / 10+ days |
| 7 | **Enhanced recent activity** | existing audit feed **grouped by department** (Documentation/Customs/Transport/Finance/Autres) |
| 8 | **Executive KPIs** | `getAnalytics()` (active, revenue, outstanding, avg customs days) + derived delivered-this-month & avg delivery days from transport actuals |

The funnel/flow/aging/bottlenecks/needs-attention all come from running the **existing `getDossierLifecycle`** once per dossier over batch-loaded rows — the single source of truth, reused not duplicated.

## Data sources used

`operational_file`, `document` + `document_type`, `customs_record`, `transport_record`, `invoice` + `invoice_line` + `payment` (finance-gated), the existing `getDossierLifecycle` classifier, `getAnalytics` (KPIs), and `audit_log` (recent activity). All loaded in a handful of tenant-scoped batch queries (no per-dossier N+1).

## Permission model

- **Control tower** (funnel/flow/bottlenecks/needs-attention/aging/exec KPIs): gated by **`analytics:read`** (management) via `assertPermission` + the admin client + tenant scope — the same crossing-domains pattern as `getAnalytics`. Not shown to non-management users.
- **Finance data** (invoice balances, overdue, revenue, outstanding) loaded/shown only when the viewer also holds **`finance:read`**; otherwise those signals are absent (KPIs show `—`, overdue-bottleneck is 0).
- **Department cards**: each card only with its read permission (unchanged).
- **Recent activity**: still `audit:read:all` (RLS) + finance-filtered (unchanged); now grouped by department.

No RBAC/RLS weakening — reads use the established gated admin-client analytics pattern; nothing new is exposed.

## Files changed

**New:**
- `lib/control-tower/aggregate.ts` (PURE: funnel/flow/aging/bottlenecks/needs-attention/transport-time + `funnelStage`/`ageDays`)
- `lib/control-tower/service.ts` (SERVER: batch load → per-dossier lifecycle → aggregate + KPIs)
- `components/dashboard/control-tower.tsx`
- `tests/control-tower.test.ts`
- `docs/phase-2.2-control-tower.md`

**Edited:**
- `app/dashboard/page.tsx` (fetch control tower for `analytics:read`, render near the top)
- `components/dashboard/recent-activity.tsx` (group by department — D7)
- `lib/i18n.ts` (`t.controlTower`)

## Tests added

`tests/control-tower.test.ts` (9): `funnelStage` mapping across every lifecycle position; funnel/flow/aging totals; bottleneck detection (docs/customs/POD/overdue); needs-attention ranking + closed-exclusion; `ageDays`; `transportTimeKpis` (delivered-this-month + avg duration). Built from the **real** `getDossierLifecycle` so the aggregations are validated against actual lifecycle output.

## Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 220 passed (+9) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only control-tower service / admin client; `aggregate.ts` is pure |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## Live test checklist

1. As **CEO / SYSTEM_ADMIN / OPS_SUPERVISOR** (analytics:read): the control tower appears near the top — executive KPIs, funnel (8 stages summing to all dossiers), Doc→Customs→Transport→Finance→Archive flow with counts, aging buckets, bottlenecks, and a top-10 needs-attention table linking to dossiers.
2. Create a dossier with a missing required doc → funnel "Documents" +1, flow Documentation +1, "Dossiers bloqués par la documentation" bottleneck appears, dossier shows in needs-attention.
3. Release customs on a dossier → it moves from Customs to Transport in funnel/flow.
4. Mark POD received + issue an invoice → moves toward Delivered/Invoiced; pay it → Paid; close → Archived.
5. A **CUSTOMS_DECLARANT** (no analytics:read) does **not** see the control tower (keeps the basic dashboard).
6. A viewer without `finance:read` sees the tower with revenue/outstanding KPIs as `—` and no overdue-invoice bottleneck.
7. Recent activity is grouped under Documentation / Dédouanement / Transport / Finance / Autres.
8. Responsive: funnel/flow wrap on tablet/mobile; needs-attention table scrolls horizontally.

## Constraints honoured

No schema changes / migrations · no workflow or new states · no new task system · no notifications / cron / background workers · no duplicate lifecycle logic (reuses `getDossierLifecycle`) · all intelligence derived from operational_file, documents, customs/transport records, invoices/payments + existing classifier/analytics.
