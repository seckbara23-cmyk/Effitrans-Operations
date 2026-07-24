# Phase 10.0A — Centre d'Opérations : Architecture Audit

**Date:** 2026-07-24 · **Type:** architecture audit only — **no implementation, no migration, no permission/role/RLS/route/widget change**
**Repo state audited:** commit `6fa62de` (post-HR-1, CI green)
**Scope:** how every operational module converges into one intelligent command center without duplicating business logic.

---

## 1. Executive summary

**The Centre d'Opérations already exists — the mission is to complete it, not to create it.** The sidebar's primary item « Centre d'opérations » (`lib/nav.ts:56`) routes to `/dashboard`, whose page title is the same string (`lib/i18n.ts:312`) and which already composes **eleven permission-gated sections** across files, tasks, control tower, process tower, departments, activity, presence, messaging and finance (`app/dashboard/page.tsx:72–105,167–196`). It is the only page in the platform that composes every domain into one screen. Phase 10.0 is therefore an **evolution in place** of `/dashboard`, not a new route — which also respects the frozen-sidebar contract.

Three structural findings drive the whole recommendation:

1. **The composition machinery is already built and proven.** `getExecutiveIntelligence()` (`lib/executive/reader.ts:56`) is a `cache()`-wrapped composer that fans out to nine domain readers under `Promise.allSettled`, degrades by section, normalizes alert severities through one fixed map, and merges/dedupes/caps them (`lib/executive/compose.ts:45,60,83`). `getCommandCenter()` (`lib/logistics/reader.ts:131`) does the same for the four transport modes. The cockpit needs a **third sibling — `getOperationsCockpit()` in a new `lib/operations/`** — that composes the existing readers, exactly as the executive reader composes them today. Zero engine or domain-logic change.
2. **Most cockpit metrics already exist as bounded readers.** Of the ~45 candidate widgets/KPIs catalogued below (§11), **~70 % EXIST** behind current readers (`getControlTower`, `getAnalytics`, `getCommandCenter`, `getIntelligenceDashboard`, `getShippingDashboard`, `getAirDashboard`, `getFinanceQueue`/`getFinanceKpis`, `getReconciliation`, `getCollectionsQueue`, `getProcessTower`, `getQueueCounts`, `getMessagingDashboardSummary`, `unreadStaffMessagingCount`), ~20 % are DERIVABLE with new *aggregation-only* readers over existing columns, and only ~10 % genuinely need new data (caisse balances — no treasury tables exist; escalations — no concept exists; ETA accuracy — no history source).
3. **The genuinely new work is narrow and additive:** (a) a tenant-wide `finance_request` queue reader — today finance requests are readable only per dossier (`lib/finance/request-actions.ts:600`); (b) per-user / per-team workload GROUP-BYs — the columns (`assigned_user_id`, `assigned_team_code`, `owner_user_id`) all exist, no reader groups by them; (c) "today"-scoped variants of month/all-time counters; (d) adapter functions feeding the already-working alert merge with the producers it does not yet ingest (analytics RED/AMBER, document expiry, comms `FAILED`, `process_blocker` counts).

**Recommendation: GO for 10.0B** — build `lib/operations/` as a composition-only layer (consume, never own), then re-render `/dashboard` over it with Suspense streaming (§16), following the phase ladder in §25. No migration, no new permission, no new route is needed until 10.0F (one permission for the Operations Copilot, flagged as DEC-B32).

---

## 2. Current cockpit architecture (`/dashboard`)

`app/dashboard/page.tsx` — async server component, `export const dynamic = "force-dynamic"` (`:35`), no Suspense, no `loading.tsx`. Data resolves in **two concurrent stages** with per-section `.catch()` degradation:

- **Stage 1** (`:72–77`): `getFileOverview()`, `getRecentFiles(8)`, `getDashboardTasks()`, `getEffectivePermissions(user.id)` — session-light counts + the permission set, in one round.
- **Stage 2** (`:84–105`): six heavy sections, each individually permission-gated *before* the call:
  | Section | Reader | Gate | Null-safe |
  |---|---|---|---|
  | Control tower | `getControlTower(permissions)` — `lib/control-tower/service.ts:116` | `analytics:read` | ✅ |
  | Department cards | `getDepartmentCards(permissions)` — `lib/departments/dashboard.ts:28` | per-dept perms inside | ✅ |
  | Recent activity | `getRecentActivity(canFinance)` — `lib/activity/feed.ts:43` | `audit:read:all` | ✅ |
  | Presence | `getPresenceSummary()` — `lib/users/*` | `admin:users:manage` | ✅ |
  | Process tower | `getProcessTower(tenantId, permissions)` — `lib/process/queues/control-tower.ts:43` | `process:read` + workspaces flag | ✅ (null when flag off) |
  | Messaging summary | `getMessagingDashboardSummary(userId, tenantId)` — `lib/messaging/dashboard.ts:20` | `messaging:manage` | ✅ |

- **Render** (`:167–196`): `DashboardKpis` → `ProcessTowerSection` → `ControlTower` → `DepartmentCards` → `RecentActivity` → `AdminPresenceCard` → `MessagingSummaryCard` → `DashboardFinanceKpis` → `DashboardTasks` → `DashboardRecentFiles` → `DashboardBreakdown` — all from `components/dashboard/` (+ `components/process/process-tower`).

**What this already achieves:** one screen, permission-shaped per viewer (a CEO with `analytics:read`+`finance:read` sees the executive KPI band; a supervisor sees process tower + queues; finance sees finance KPIs) — precisely the "five personas, one screen" vision. **What it lacks:** the Transit/Finance/Messaging/Alerts/Workload sections are partial (no customs/shipping/air depth, no finance-request queue, no unified alert center, no workload bars), everything is fetched before first paint (no streaming), and section composition is inline in the page rather than behind one testable reader.

---

## 3. Existing dashboards reviewed (overlap analysis)

| Page | Route | Composer | Gate | Verdict for cockpit |
|---|---|---|---|---|
| **Centre d'opérations** | `/dashboard` | inline 2-stage `Promise.all` (`page.tsx:72–105`) | per-section | **The cockpit. Evolve in place.** |
| Tableau exécutif | `/dashboard/executive` | `getExecutiveIntelligence()` (`lib/executive/reader.ts:56`) | `executive:dashboard:read` | **Remains separate** (direction-level read-only view + copilot). Its *reader and compose layer* are the cockpit's backbone. |
| Logistics Command Center | `/departments/transport` | `getCommandCenter()` (`lib/logistics/reader.ts:131`) | `transport:read` | **Remains separate** (transport workspace). Cockpit consumes its headline + attention outputs. |
| Finance département | `/departments/finance` | 5 readers batched (`page.tsx:45–51`) | `finance:read` | Remains separate; cockpit reuses the same readers (`getFinanceQueue`, `getReconciliation`, `getFinanceMonthRevenue`, `readyForBillingCount`, `getDepartmentSlaSummary`). |
| Customs / Documentation départements | `/departments/{customs,documentation}` | queue + SLA + handoff readers | `customs:read` / `document:read` | Remain separate; same-reader reuse. |
| Direction | `/departments/management` | `getAnalytics(canFinance)` + `pendingHandoffsCount()` | `analytics:read` | **Highest overlap** with the cockpit's KPI band (7 StatCards all present elsewhere). Candidate for later absorption — kept out of 10.0 scope. |
| Mon travail | `/my-work` | `getDepartmentQueue` per queue + `buildWorkbench` | `process:read` + flag | Remains separate (personal workbench ≠ org cockpit). |
| Analytics | `/analytics` | `AnalyticsBody` → `getAnalytics` + `getExecutiveAnalytics` | `analytics:read` | Remains separate (deep-dive). **Only page using Suspense streaming** (`app/analytics/page.tsx:34–36`) — the pattern the cockpit should adopt. |
| Centre de rapports | `/reports` | `getBusinessIntelligence` + `getControlTower` | `analytics:read` | Remains separate (exports). |
| Hubs Opérations / Transit | `/departments/{operations,transit}` | none (nav-only link grids) | any-of perms | Remain separate (navigation, not data). |

**Duplicated KPIs found (computed in ≥3 places):** active dossiers (`ControlTower` kpis, `getAnalytics().operations.active`, executive kpis, BI); revenue-this-month / outstanding (control tower, management page, finance dept `financeCards`, executive financial row); customs/transport in-process (management page vs dedicated depts); SLA-by-department (dashboard control tower, three dept pages, `/reports`). These are *presentation* duplicates over shared readers in most cases — the true *computation* duplicate is `getExecutiveAnalytics` (`lib/analytics/executive-service.ts:31`), a Phase-1.13B stack feeding only `/analytics`, overlapping `getBusinessIntelligence` + `getControlTower` (§27, DEC-B33).

---

## 4. Existing readers (inventory + classification)

Full trace: every reader below was opened and its signature, tables and consumers verified.

### 4.1 Composition-grade readers (cockpit backbone)

| Reader | file:line | Returns | Caching | Classification |
|---|---|---|---|---|
| `getExecutiveIntelligence()` | `lib/executive/reader.ts:56` | full executive snapshot: KPI row, per-mode operations, financial, customers, documents, AI usage, governance, map, timeline, merged alerts | React `cache()` | **REUSABLE AS-IS** — the model to copy |
| `getCommandCenter()` | `lib/logistics/reader.ts:131` | road/ocean/air/customs cards, `HeadlineKpis`, unified attention queue, upcoming movements | none | **REUSABLE AS-IS** (add `cache()`) |
| `getControlTower(perms)` | `lib/control-tower/service.ts:116` | `ExecutiveKpis` (active, delivered-month, revenue-month, outstanding, avg customs/delivery days), funnel/flow/aging, bottlenecks, needsAttention, risk queue, `slaByDept`, avgTimes | none | **REUSABLE AS-IS** (add `cache()`) |
| `getAnalytics(includeFinance)` | `lib/analytics/service.ts:42` | financial/operations/customs/transport/portal/team KPIs | React `cache()` | **REUSABLE AS-IS** — authoritative KPI source |
| `getBusinessIntelligence(perms, range)` | `lib/bi/service.ts:46` | revenue metrics, client intelligence, receivables aging, dept productivity | none | REUSABLE (reports-oriented; cockpit needs only aging) |
| `getProcessTower(tenantId, perms)` | `lib/process/queues/control-tower.ts:43` | ~30 process-stage counters in 4 groups (intake/customs/parallel/postDelivery) | none | **REUSABLE AS-IS** (flag-gated, null-safe) |

### 4.2 Domain readers consumed today (all REUSABLE AS-IS)

Finance: `getFinanceQueue` (`lib/finance/service.ts:219`, `cache()`), `getFinanceKpis` (`:433`), `getReconciliation` (`:287`), `getFinanceMonthRevenue` (`lib/departments/service.ts:83`). Collections: `getCollectionsQueue` (`lib/collections/service.ts:79`, paginated, aging buckets). Customs: `getCustomsQueue` (`lib/customs/service.ts:77`), `getIntelligenceDashboard` (`lib/customs/intelligence/service.ts:47` — pending/released/inspection/avgClearanceDays/providers incl. GAINDE status). Ocean: `getShippingDashboard` (`lib/shipping/intelligence/service.ts:55`), `getAttentionQueue` (`manage-service.ts:157`). Air: `getAirDashboard` (`lib/air/intelligence/service.ts:34`), `getAirAttentionQueue`. Transport: `getTransportQueue` (`lib/transport/service.ts:78`). Files: `getFileOverview` (`lib/files/service.ts:112`), `getRecentFiles` (`:145`). Tasks: `getDashboardTasks` (`lib/tasks/service.ts:133`). Handoffs (legacy task-based): `readyForCustomsCount/readyForDeclarationCount/readyForDispatchCount/readyForBillingCount/pendingHandoffsCount` (`lib/handoffs/service.ts:148–166`). Queues: `getDepartmentQueue` (`lib/process/queues/service.ts:124`), `getQueueCounts` (`:408` — one query, open executions per department). Messaging: `getMessagingDashboardSummary` (`lib/messaging/dashboard.ts:20`), `unreadStaffMessagingCount` (`lib/messaging/service.ts:143`). Deposits: `listTenantDeposits` (`lib/deposit/service.ts:215`). Executive sub-readers: `readNotificationKpis` (`lib/executive/readers/portal-ops.ts:34`), `readFleetMap` (`readers/fleet-map.ts:70`), `readExecutiveTimeline` (`readers/timeline.ts:66`).

### 4.3 NEEDS-EXTENSION / MISSING

| Gap | Evidence | Effort class |
|---|---|---|
| Tenant-wide finance-request queue (pending approvals / pending disbursements) | `finance_request` read ONLY per-file via `getFinanceState(fileId)` (`lib/finance/request-actions.ts:600`); grep confirms no other reader | New reader, existing table |
| Per-user / per-team workload GROUP-BY | `filters.assigneeId` filters exist (`queues/service.ts:151`) but nothing groups counts by `assigned_user_id` / `assigned_team_code` / `owner_user_id` | New reader, existing columns |
| Open `process_blocker` / `process_decision` counts | writers exist (`lib/process/engine/structures-actions.ts:314,157`); no aggregate reader | New reader, existing tables |
| "Today"-scoped counters (files created today, customs released today, deliveries today) | existing readers are all-time or month-scoped (`releasedCount` all-time `customs/intelligence/dashboard.ts:17`; `deliveredThisMonth` `control-tower/aggregate.ts:134`) | New filters over existing tables |
| Caisse balances / cash alerts | migration `20260724000001` creates **no treasury tables** (its own comment L22-27); `/finance/caisse` is a shell | **Blocked on future Caisse phases** — not a cockpit gap |
| Messaging escalations | no escalation concept anywhere (`lib/sla/config.ts:5` — "no escalation/notifications") | New concept — out of 10.0 scope |
| SLA per process step | every engine `sla.state` hardcoded `"unconfigured"` (`queues/service.ts:359`) | Config work, separate decision |
| `documentationDays` avg / `missingRequired` docs / `etaAccuracyPercent` | honest nulls (`control-tower/service.ts:365`, `executive/reader.ts:157,204`) | Needs new upstream timestamps — not a reader edit |

### 4.4 DUPLICATE

`getExecutiveAnalytics` (`lib/analytics/executive-service.ts:31`) — health/alerts/scorecard/trends for `/analytics` only; overlaps BI + control tower. The Phase-7.7 `lib/executive/*` stack deliberately does not use it. Cockpit must not consume it (DEC-B33).

---

## 5. Existing composition patterns (to reuse verbatim)

1. **Guard preamble** — `requireUser()` → `getEffectivePermissions(user.id)` → `hasPermission` gate → `Promise.all/allSettled` of readers. Verbatim on every department/command page.
2. **Composition reader** — one `cache()`-wrapped server-only function fanning out under `Promise.allSettled` with per-section degradation and permission-degraded sections (`lib/executive/reader.ts:56`; `lib/logistics/reader.ts:131`).
3. **Severity normalization + merge** — `normalizeSeverity` via one fixed `SEVERITY_MAP`, `mergeExecutiveAlerts` (dedupe on origin|reference|reason, rank, cap 40), `countAlertsByLevel` (`lib/executive/compose.ts:29–96`).
4. **`StatCard`** (`components/departments/stat-card.tsx`) — the universal KPI tile (tone + optional drill-down `href`), used by 6 pages.
5. **Section-level graceful degradation** — `.catch(() => default)` per reader so one failing domain never blanks the page (`app/dashboard/page.tsx:72–105`).
6. **Flag-gated null** — engine-backed sections return `null` when the workspaces flag is off; the page renders without them (`getProcessTower`, `dashboard/page.tsx:99–101`).
7. **Suspense streaming** — cheap gate renders immediately, heavy body inside `<Suspense fallback={skeleton}>` (`app/analytics/page.tsx:34–36`) — used exactly once today; the cockpit should generalize it.
8. **Reuse-not-recompute** — `getControlTower` prefers `getAnalytics`'s `avgCustomsDays` over its own (`control-tower/service.ts:342`); `getExecutiveIntelligence` reuses `getAnalytics` + `getCommandCenter` wholesale. This is the anti-duplication doctrine the cockpit must follow.

---

## 6. Workflow integration

**Two parallel workflow truths exist; the cockpit must read both and own neither.**

- **Canonical 26-step registry:** `EFFITRANS_PROCESS` (`lib/process/effitrans-process.ts:31`, `PROCESS_STEP_COUNT = 26` `:1099`) + 3 parallel activities (`:882`) = 29 engine nodes (`lib/process/engine/state.ts:24`). State lives in `process_instance` (6 statuses), `process_step_execution` (11 states), `process_handoff` (4 statuses) — `lib/process/engine/types.ts:11,39,60`; DDL `supabase/migrations/20260713000001_process_engine.sql` + structures `20260723000001`. The engine **never writes `operational_file`** — no duplicate status truth.
- **Customer-safe journey:** 10 `ClientJourneyStage`s (`effitrans-process.ts:1084`) — the Customer → … → Completed pipeline in the mission maps onto the 20-stage `CANONICAL_LIFECYCLE` (`lib/process/lifecycle-map.ts:40`), each stage validated against real registry step keys.
- **Legacy lifecycle:** `operational_file.status` (5+1 states, `lib/files/status.ts:10`) + derived 15-step tracker (`lib/files/lifecycle.ts:104`) + task-based handoffs (`lib/handoffs/rules.ts:24`). Flag-free, always available.
- **Live metrics already exposed by the engine:** `getProcessTower` (~30 stage counters), `getQueueCounts` (per-department open-execution depth, ONE query), `getDepartmentQueue` (paginated queue with priority/blockers/maker-checker state), `buildWorkbench`/`actionableCount` (per-user partition, `lib/navigation/workbench.ts:147,170`), `getAmPortfolio` (`lib/process/panels/account-manager.ts:70`).
- **Stages with useful live metrics today:** intake, customs chain (8 counters), parallel transport-readiness gates, post-delivery/billing chain — all via `getProcessTower`. Stages with none: cotation (step 1 `missing`), courier/deposit steps 23–25 (deposit custody covered separately by `listDeposits`).

**Rule (already platform doctrine, restated for the cockpit):** the cockpit **consumes** `getProcessTower` / `getQueueCounts` / read-model outputs; it never reads `process_step_execution` directly and never mutates workflow state. When tenant flags are off it falls back to the legacy readers exactly as `/dashboard` does today.

---

## 7. Finance integration

| Cockpit metric | Status | Source |
|---|---|---|
| Invoices pending / outstanding / overdue count | **EXISTS** | `getFinanceKpis()` (`lib/finance/service.ts:433`) |
| Revenue MTD | **EXISTS** | `getFinanceMonthRevenue()` / `computeFinancial().revenueThisMonth` (`lib/analytics/calc.ts:50`) |
| Collections due / overdue receivables | **EXISTS** | `getCollectionsQueue` (`lib/collections/service.ts:79`) + aging buckets (`lib/collections/aging.ts:80`); amount via `computeFinancial().overdue` |
| Reconciliation alerts | **EXISTS (partial)** | `getReconciliation().counts` + `onlineIntents` FAILED/EXPIRED (`lib/finance/service.ts:287`) |
| Pending finance requests / approvals | **DERIVABLE — new tenant-wide reader needed** | today per-file only: `getFinanceState` (`lib/finance/request-actions.ts:600`); statuses REQUESTED/APPROVED/… already modeled |
| Pending disbursements | **DERIVABLE — same reader** | status `APPROVED` not yet DISBURSED; clearance logic exists (`lib/finance/requests.ts:169`) |
| Cash alerts (caisse) | **MISSING — blocked** | no treasury tables (migration `20260724000001` comment); do not fake it |
| Ready for billing | **EXISTS** | `readyForBillingCount()` (`lib/handoffs/service.ts:161`) |

The cockpit never replaces `/finance`, `/collections`, `/finance/reconciliation`, `/finance/caisse` — every card drills into those pages. Finance figures stay behind `finance:read` (money-blind rendering for others), which the readers already enforce internally.

## 8. Messaging integration

| Cockpit metric | Status | Source |
|---|---|---|
| Unread (staff badge) | **EXISTS** | `unreadStaffMessagingCount()` (`lib/messaging/service.ts:143`) — RLS-scoped |
| Customer conversations (open / waiting-us / waiting-customer / urgent) | **EXISTS** | `getMessagingDashboardSummary()` (`lib/messaging/dashboard.ts:20`) — already on `/dashboard` |
| Internal conversations count | **DERIVABLE** | `listStaffConversations()` returns all types (`direct_staff`/`department`/`dossier`) with `unreadCount`; filter by `type` (`lib/messaging/service.ts:94`) |
| Failed notifications | **DERIVABLE** | comms rows carry `status/retry_count/last_error` (`lib/comms/service.ts:13–30`); count = `listCommunications({status:"FAILED"}).length` — a `head:true` count variant is a trivial extension |
| Notification delivery KPIs | **EXISTS** | `readNotificationKpis()` (`lib/executive/readers/portal-ops.ts:34`) |
| Escalations | **MISSING** | no escalation concept in the codebase — stays inside Messaging roadmap, not cockpit 10.0 |

What stays inside Messaging: conversation lists, threads, assignment, moderation. The cockpit shows counts + urgent indicator and links to `/messages`.

## 9. Transit integration

| Cockpit metric | Status | Source |
|---|---|---|
| Customs waiting (in-process) | **EXISTS** | `getIntelligenceDashboard().dashboard.pending` (`lib/customs/intelligence/service.ts:47`) |
| Customs released today | **DERIVABLE** | `released` is all-time (`dashboard.ts:17`); `listDeclarations` exposes `releasedAt` but filters on `declaration_date` (`service.ts:162`) — needs a today-filter |
| Deliveries today | **DERIVABLE** | only `deliveredThisMonth` exists (`control-tower/aggregate.ts:134`); `getTransportQueue` rows carry `deliveryPlanned/deliveryActual` |
| Delayed deliveries | **EXISTS** | road `kpis.overdue` + alerts (`lib/logistics/reader.ts:54–59`); ocean/air `dashboard.delayed` + `DELIVERY_OVERDUE` codes (`lib/shipping/intelligence/alerts.ts:38`) |
| Vehicles dispatched / fleet activity | **DERIVABLE — no fleet entity** | `readyForDispatchCount` + transport status counts; `vehicle_plate` is free text on `transport_record`; a vehicle registry would be a future phase |
| Containers | **EXISTS** | `getShippingDashboard` container aggregates (`lib/shipping/intelligence/service.ts:55,102`) |
| POD status | **EXISTS** | bottleneck `awaiting_pod` (`control-tower/aggregate.ts:108`); road `podRequired` (`logistics/reader.ts:55`); driver evidence (`lib/driver/service.ts:148`) |
| Avg clearance / delivery time | **EXISTS** | `averageClearanceDays` (`customs/intelligence/dashboard.ts:27`); `avgTimes` (`control-tower/service.ts:330–343`) |
| GAINDE status | **EXISTS (honest stub)** | `resolveProviderConfig("GAINDE")` → `status:"unsupported"`, readiness checklist (`lib/customs/intelligence/config.ts:83,39–53`) — the cockpit surfaces the honest "non connecté" state, never fakes liveness |

## 10. Operations integration

| Cockpit metric | Status | Source |
|---|---|---|
| Active files | **EXISTS** | `getFileOverview().active` (`lib/files/aggregate.ts:60`) |
| Files created today | **MISSING (trivial)** | no date-scoped count; `aggregateFiles` ignores dates (`aggregate.ts:39`) — one `count head:true` query |
| Waiting documentation | **DERIVABLE** | `getDocumentationQueue` rows with `missing>0` (`lib/departments/service.ts:66`) or `getQueueCounts()["customs_declaration"]` |
| Waiting customer | **DERIVABLE (engine) / MISSING (count)** | per-dossier `documentsAwaited` (`account-manager.ts:220`); blocker category `CUSTOMER_RESPONSE_REQUIRED` exists (`structures-actions.ts:308`) with no count reader |
| Waiting assignment | **DERIVABLE** | `getQueueCounts()["operations"]` or `getDepartmentQueue({filters:{unassigned:true}})` (`queues/service.ts:152`) |
| Files blocked | **DERIVABLE** | `getAnalytics().operations.blocked`; formal `process_blocker` count reader missing |
| Files overdue | **EXISTS (two meanings)** | shipment-ETA overdue: `FileOverview.overdueShipments` (`aggregate.ts:33`); invoice overdue: `getFinanceKpis().overdueCount` |
| Tasks today / overdue / mine | **EXISTS** | `getDashboardTasks()` (`lib/tasks/service.ts:133`) |

## 11. KPI catalog (executive)

| KPI | Classification | Source / gap |
|---|---|---|
| Active files | **Existing** | `ControlTower.kpis.activeDossiers` / `getAnalytics().operations.active` |
| Monthly revenue | **Existing** | `kpis.revenueThisMonth` (finance-gated) |
| Outstanding / receivables aging | **Existing** | `kpis.outstanding`; `receivablesAging` (`lib/bi/aggregate.ts:114`) |
| Declarations (pending/released/inspection) | **Existing** | `getIntelligenceDashboard()` |
| Containers | **Existing** | `getShippingDashboard()` |
| Deliveries (month) | **Existing** | `transportTimeKpis.deliveredThisMonth` |
| Deliveries (today) | **Derivable** | today-filter over `transport_record.delivery_actual` |
| Finance throughput (requests approved/disbursed) | **Derivable** | needs the tenant-wide `finance_request` reader (§4.3) |
| Collection rate | **Existing** | `computeFinancial().collectionRate` (`lib/analytics/calc.ts:50`) |
| Avg clearance time | **Existing** | `avgTimes.customsDays` (analytics-preferred, `control-tower/service.ts:342`) |
| Avg delivery time | **Existing** | `avgTimes.transportDays` / `avgDeliveryDays` |
| Avg documentation time | **Needs new data** | hardcoded null (`service.ts:365`) — needs stage timestamps |
| ETA accuracy | **Needs new data** | honest null (`executive/reader.ts:204`) — needs ETA history |
| Caisse position | **Needs new data** | no treasury tables — **not recommended** until Caisse ships |
| Per-client / per-route activity | **Existing** | `getBusinessIntelligence` / `routeActivity` — deep-dive pages, **not recommended** on the cockpit (density) |

## 12. Alert catalog (for the Unified Alert Center, 10.0E)

**The merge engine already exists** — `normalizeSeverity` / `mergeExecutiveAlerts` / `countAlertsByLevel` (`lib/executive/compose.ts:45,60,83`) with the canonical unified shape `ExecutiveAlert {level, origin, reference, clientName, reason, href, occurredAt, sourceSeverity}` (`lib/executive/types.ts:49`). Today it ingests **only** the Command Center's `UnifiedAlert`s (`executive/reader.ts:219–231`).

| # | Producer | file:line | Shape | Wired into merge today? |
|---|---|---|---|---|
| 1 | Logistics `UnifiedAlert` (road overdue, POD, customs blocked, ocean/air top alerts) | `lib/logistics/compose.ts:32`; producers `reader.ts:54–99` | severity ✅ link ✅ code ✖ | **YES** |
| 2 | Shipping alerts (7 codes incl. `DELIVERY_OVERDUE`, `STALE_CARRIER_DATA`) | `lib/shipping/intelligence/alerts.ts:38` | severity ✅ code ✅ | Indirect (top-1 per shipment via attention queue) |
| 3 | Air alerts | `lib/air/intelligence/alerts.ts:32` | severity ✅ code ✅ | Indirect (same) |
| 4 | Control-tower `needsAttention` + `bottlenecks` + risk queue | `lib/control-tower/aggregate.ts:105,172` | priority string, no level | **NO** |
| 5 | Analytics `buildAlerts` (RED/AMBER/GREEN) | `lib/analytics/executive.ts:69` | level ✅ (map already supports it, `SEVERITY_MAP`) | **NO** |
| 6 | `process_blocker` rows (10 categories, severity column) | `lib/process/engine/structures-actions.ts:314` | severity ✅ category ✅ | **NO** (no count/list reader) |
| 7 | Finance: overdue invoices, reconciliation pending/missing-reference, FAILED/EXPIRED intents | `lib/finance/service.ts:287` | statuses, no typed alert | **NO** |
| 8 | Document expiry (`expired`/`expiring`) | `lib/documents/expiry.ts:25` | state enum | **NO** |
| 9 | Comms `FAILED` (email delivery) | `lib/comms/service.ts:62` + `types.ts:4` | status + `last_error` | **NO** |
| 10 | Deposit blockers / stale custody | `lib/deposit/service.ts:79` (`blocker`, `ageHours`) | derived per row | **NO** |
| 11 | Stale tracking | via codes in #2/#3 + `classifyTrackingHealth` | code | Indirect |

**Conclusion:** the Unified Alert Center is ~40 % built. Remaining work = **adapter functions** projecting producers #4–#10 into `ExecutiveAlert` and appending them to the `rawAlerts` array, plus (optionally, additively) widening `ExecutiveAlert` with a `code?` field so shipping/air codes survive the merge. No new alert engine.

## 13. Team workload model

**Verdict: per-department depth EXISTS; per-user and per-team aggregation are NEW (aggregation-only).**

- EXISTS: `getQueueCounts(tenantId, permissions)` (`lib/process/queues/service.ts:408`) — one query, open executions bucketed by the 15 queue departments; roll up to the 4 canonical departments via `QUEUE_DEPARTMENT_TO_CANONICAL` (`lib/organization/departments.ts:173`) for the cockpit's Operations/Finance/Transit/Customs bars.
- NEW (columns exist, readers don't): GROUP-BY `assigned_user_id` over open `process_step_execution` (the "Ahmed ██ 12" visualization), GROUP-BY `assigned_team_code` (AIBD vs MARITIME), open finance requests per approver. All are single-query aggregations; **no schema change**.
- Constraint (platform doctrine): workload uses org metadata for display rollups only — `lib/organization/departments.ts:21–27`: "NEVER AUTHORIZATION."
- Privacy note for 10.0B design: named per-person workload bars expose colleague performance; gate the per-person widget behind a supervisory permission (existing `analytics:read` suffices — no new permission needed).

## 14. Realtime strategy

**Audited state:** zero Supabase Realtime anywhere (confirmed by grep; also asserted in `components/messaging/messaging-center.tsx:6–14`). Messaging polls every 8 s (`POLL_MS`, `messaging-center.tsx:32,100–105`; portal identical). Notification bell is load-on-mount/open. Everything else is request-driven: `force-dynamic` pages, `revalidatePath` on every mutation, React `cache()` for intra-request dedup (`getEffectivePermissions`, `resolveFileScope`, `getAnalytics`, `getExecutiveIntelligence`, `getFinanceQueue`).

**Recommendation for the cockpit:** stay request/poll-driven. v1 (10.0C): fresh on load + streaming sections. v1.1: an opt-in client refresher polling one consolidated summary endpoint (reusing the composition reader) at 60–120 s — matching the messaging precedent, far cheaper than per-widget polling. **Do not adopt Supabase Realtime in 10.0** — it would be the platform's first channel usage, a new infrastructure class for marginal cockpit benefit; revisit only with a measured need (DEC-B31).

## 15. AI readiness

**Ready without redesign.** The seam is `runCopilot` / `runCopilotDetailed(messages: CopilotChatMessage[])` (`lib/copilot/engine.ts:139,156`) — five copilots (dossier, logistics, executive, portal, platform) already compose against it identically with: bounded context builders (`buildLogisticsCopilotContext` `lib/logistics/copilot/context.ts:31`), shared budget caps (`lib/copilot/budget.ts:13`), audit-log-based rate limiting (`lib/copilot/rate-limit.ts:31`), deterministic provider-down fallback (e.g. `app/api/logistics/copilot/route.ts:100–108`), and explicit-only provider fallback (`lib/ai/provider.ts:97–118`).

A 10.0F **Operations Copilot** ("show delayed shipments", "which finance requests need attention", "what should Operations prioritize today") = three additive files: `buildOperationsContext()` composing `getOperationsCockpit()` outputs, a prompt serializer, and `app/api/operations/copilot/route.ts`. The deterministic card engine pattern (`buildRecommendations`/`deterministicSummary`) answers all three example questions **without any LLM** — the LLM adds narrative only. One new permission (`operations:copilot:read`) will be needed *in that phase* (DEC-B32); nothing in 10.0B–10.0E requires it. Crucially, 10.0B's composition reader is *the same context the copilot will consume* — build once, serve both (proven by `getExecutiveIntelligence` serving page + copilot with one `cache()`d read).

## 16. Performance strategy

**Today:** `/dashboard` awaits ~9 readers before first paint; `getControlTower` is the heaviest (per-dossier lifecycle pass + finance joins); only 2 of ~18 readers memoize; no streaming.

**Composition strategy for 10.0B/C:**
1. **One composition reader** (`getOperationsCockpit()`) under `Promise.allSettled`, `cache()`-wrapped — page + future copilot + future summary endpoint share one read.
2. **Add React `cache()`** to `getControlTower`, `getCommandCenter`, `getBusinessIntelligence` (one-line each, same as `getAnalytics`) — removes intra-request double-reads (e.g. control tower already calls `getAnalytics`; the cockpit calling both costs nothing extra once cached).
3. **Suspense streaming per section** (the `/analytics` pattern): hero + cheap Stage-1 counts paint immediately; each heavy section streams behind its own `<Suspense>` with a skeleton. This converts wall time from SUM(sections) to MAX(section).
4. **Lazy below-the-fold widgets** (map, timeline) via dynamic import — precedent: `ShipmentMapLoader` (lazy Leaflet).
5. **Reuse single-query counters** where they exist (`getQueueCounts` = 1 query for all department depths; head-only counts for new "today" metrics).
6. **Caps everywhere** (existing doctrine: attention cap 12, alerts cap 40, working-set caps 2000) — the cockpit renders top-N + link, never unbounded lists.
7. Estimated query budget for the full cockpit: ~25–30 Supabase queries per cold render (dominated by control tower + command center), all tenant-indexed; with `cache()` and streaming this is comparable to today's `/dashboard` + `/departments/transport` combined, on one screen.

## 17. Proposed cockpit architecture

```
app/dashboard/page.tsx  (« Centre d'opérations » — evolved in place, route unchanged)
│  requireUser → getEffectivePermissions → render shell immediately
│
├─ <Suspense> OperationsSection   ← files/tasks/queues counters
├─ <Suspense> TransitSection      ← customs + ocean + air + road headline
├─ <Suspense> FinanceSection      ← invoices/collections/reconciliation/requests*
├─ <Suspense> MessagingSection    ← unread + customer-support summary
├─ <Suspense> AlertsSection       ← unified alert center (merged ExecutiveAlerts)
├─ <Suspense> KpiBand             ← executive KPIs (analytics:read)
└─ <Suspense> WorkloadSection     ← dept bars (exists) + per-user/team bars (new readers)

        all sections read from ONE composition layer:

lib/operations/            (NEW in 10.0B — composition only, owns NOTHING)
├─ reader.ts    getOperationsCockpit(): cache() + Promise.allSettled over
│               existing readers (§4.1/4.2) — the executive-reader pattern
├─ compose.ts   pure projection/merge (reuses lib/executive/compose severity map)
├─ workload.ts  NEW group-by readers (assigned_user_id / assigned_team_code)
├─ finance-requests.ts  NEW tenant-wide finance_request queue reader
└─ types.ts     OperationsCockpit shape
```

Principles (all existing doctrine, restated): consume never own; per-section permission gating before fetch; per-section degradation; flag-gated engine sections null-safe; money-blind without `finance:read`; honest stubs (GAINDE "non connecté", caisse absent) — never fabricated liveness.

**Persona fit on one screen (no per-role pages):** CEO → KPI band + alerts + finance (has `analytics:read`+`finance:read`); Operations Director / Supervisor → operations + workload + alerts + process tower; Chief of Transit → transit + customs + workload; Finance Manager → finance + collections + alerts. The permission system already shapes the single page per viewer — this is the existing `/dashboard` mechanism, extended.

## 18. Widget inventory

| Widget | Section | Reader | Status |
|---|---|---|---|
| Files today / active / blocked / overdue | Operations | `getFileOverview` + new today-count | Existing + trivial ext |
| Waiting documentation / customer / assignment | Operations | `getQueueCounts` + `getDocumentationQueue` + new customer-wait count | Derivable |
| Tasks (today/overdue/mine) | Operations | `getDashboardTasks` | Existing (on page today) |
| Process tower (stage counters) | Operations | `getProcessTower` | Existing (on page today) |
| Customs queue / released today / avg clearance | Transit | `getIntelligenceDashboard` + today-filter | Existing + ext |
| Ocean/Air/Road headline + delayed | Transit | `getCommandCenter().headline/cards` | Existing |
| Deliveries today / POD required | Transit | today-filter + `podRequired` | Derivable/Existing |
| GAINDE status chip | Transit | `resolveProviderConfig` | Existing (honest) |
| Invoices pending / outstanding / revenue MTD | Finance | `getFinanceKpis` + `getFinanceMonthRevenue` | Existing (on page today) |
| Collections due (top-N + count) | Finance | `getCollectionsQueue` | Existing |
| Reconciliation alerts | Finance | `getReconciliation().counts` | Existing |
| Pending requests / disbursements | Finance | **new** `finance-requests.ts` reader | New reader |
| Unread + customer-support summary | Messaging | `unreadStaffMessagingCount` + `getMessagingDashboardSummary` | Existing |
| Failed notifications count | Messaging/Alerts | comms FAILED count variant | Derivable |
| Unified alerts (top-N by level + counts) | Alerts | `mergeExecutiveAlerts` + new adapters (§12) | 40 % existing |
| Executive KPI band | KPIs | `getControlTower.kpis` (`ControlTower` component exists) | Existing |
| Department workload bars | Workload | `getQueueCounts` + canonical rollup | Existing |
| Per-user / per-team bars | Workload | **new** `workload.ts` group-bys | New reader |
| Recent activity / presence / recent files / breakdown | (retained) | current readers | Existing (on page today) |

## 19. Data ownership matrix

| Domain | Owner (writes) | Cockpit consumes via | Cockpit may write? |
|---|---|---|---|
| Workflow state | `lib/process/engine` only | `getProcessTower`, `getQueueCounts`, read-model | **NEVER** |
| Files/dossiers | `lib/files/actions` | `getFileOverview`, `getRecentFiles` | NEVER |
| Finance (invoices/payments/requests) | `lib/finance/*actions` | `getFinanceKpis`, `getReconciliation`, new request reader | NEVER |
| Collections | `lib/collections` actions | `getCollectionsQueue` | NEVER |
| Customs | `lib/customs/*` | `getIntelligenceDashboard`, `getCustomsQueue` | NEVER |
| Ocean/Air/Road | `lib/shipping`, `lib/air`, `lib/transport` | dashboards + attention queues | NEVER |
| Messaging | `lib/messaging/actions` | summary + unread counts | NEVER |
| Alerts | each producer domain | adapters → `mergeExecutiveAlerts` | NEVER (alert center is a *view*, alerts resolve in their owning module) |
| Workload | derived | group-by readers | NEVER |
| KPIs | `lib/analytics` (authoritative), composed by control-tower/executive | `getAnalytics` et al. | NEVER |

`lib/operations/` owns **zero tables, zero mutations, zero business rules** — only composition, projection and (new) read-only aggregation.

## 20. Security boundaries

- **Server-only readers** — every composed reader is `server-only`; the cockpit page is a server component; client components receive projected props only (existing pattern).
- **Per-section permission gating before fetch** (`app/dashboard/page.tsx:84–105` pattern) — a viewer without `finance:read` triggers no finance query and receives no finance bytes.
- **Money-blind rendering** — finance figures gated `finance:read` inside readers themselves (`getAnalytics(includeFinance)`, control tower finance joins).
- **File-visibility scoping** — service-role list reads mirror RLS via `resolveFileScope`/`isFileVisible` (`lib/authz/visibility.ts:31,49` — same RPC as the DB policies); messaging reads use the RLS user client where "the query IS the authorization" (`lib/messaging/service.ts:1–12`). New workload/finance-request readers MUST follow one of these two idioms.
- **Org metadata is never authorization** — `lib/organization/departments.ts:21–27`; workload rollups are display-only.
- **Copilot boundaries (10.0F)** — bounded context, allowlisted aggregates, audit-logged, rate-limited via `audit_log` (no new table), deterministic fallback: all five existing copilots prove the pattern.

## 21. RBAC review

Cockpit-relevant permissions all exist (seed `supabase/seed.sql`; typed mirror `lib/platform/role-templates.ts`, parity-tested by `tests/role-templates.test.ts`): `analytics:read`, `executive:dashboard:read`, `file:read(:all)`, `task:read(:all)`, `document:read`, `customs:read`, `transport:read`, `finance:read`, `process:read`, `messaging:manage`, `audit:read:all`, `admin:users:manage`, `logistics:copilot:read`, `collections:manage`, `communication:read`. Enforcement: `assertPermission` (`lib/auth/require-permission.ts:19`) in readers; `getEffectivePermissions` (`lib/rbac/permissions.ts:23`, `cache()`) + pure `hasPermission` (`lib/rbac/check.ts:10`) for page-level shaping.

**No new permission is needed for 10.0B–10.0E**: every section maps onto an existing permission (§17 persona table), and each composed reader still self-authorizes (defense in depth — the executive-copilot precedent: the route gate "grants no operational capability; each underlying reader still self-authorizes"). The single future permission is `operations:copilot:read` in 10.0F (DEC-B32) — following the `logistics:copilot:read` playbook (migration + seed + role-templates parity + occurrence-count gate, per the Phase-7.6A checklist).

## 22. RLS implications

**None.** The cockpit adds no tables, no policies, no policy changes. New readers are read-only aggregations over RLS-covered tables (`process_step_execution`, `finance_request`, `communication`) and must reuse the established scoping idioms (§20). The RLS test suite (`supabase/tests/rls_tenant_isolation_test.sql`) is unaffected; no new fixtures required in 10.0A–10.0C. If 10.0D adds today-scoped SQL counts they use the same tenant-scoped clients as their parent modules.

## 23. Caching strategy

- **Request-scope:** React `cache()` on the composition reader + backfill onto `getControlTower`, `getCommandCenter`, `getBusinessIntelligence` (matching `getAnalytics`/`getExecutiveIntelligence`/`getFinanceQueue`). This is the highest-leverage single change: it makes "compose everything" cost the same as "compose once".
- **Page:** stay `force-dynamic` (operational freshness is the product); Suspense converts latency shape.
- **Invalidation:** continue `revalidatePath` on mutation (pervasive today); add `/dashboard` to the revalidate targets of high-churn actions where missing.
- **No `unstable_cache`/`revalidateTag` adoption** in 10.0 — zero usage today; cross-request caching would introduce a staleness class the platform has deliberately avoided. Revisit only if measured render cost demands it.

## 24. Future live-map integration (10.0G)

Already available: `readFleetMap()` (`lib/executive/readers/fleet-map.ts:70`) — one bounded org-wide map (ocean + air + road positions, ports/airports), consumed by the executive dashboard via the lazy `ShipmentMapLoader` (`components/shipping/shipment-map-loader`); Leaflet is a pure renderer over projections (Phase 7.2B doctrine). 10.0G = embed the same loader + `readFleetMap` in a lazy cockpit section, with drill-down to `/shipping`/`/air`/`/transport`. Known gaps (documented, honest): warehouse/customs-office markers lack a coordinate source (`fleet-map.ts:19–22`); driver live positions exist only where tracking is enabled (flag-gated). No new tracking infrastructure in 10.0.

## 25. Phase roadmap (10.0B–10.0G)

The proposed sequence is confirmed with one re-scope: the "Executive KPI Engine" (10.0D) is mostly wiring + today-variants, so it is lighter than its name suggests; the alert center (10.0E) is adapters over an existing engine.

| Phase | Scope | Key content |
|---|---|---|
| **10.0B — Operations Composition Layer** | lib only, no UI change | `lib/operations/{reader,compose,types,workload,finance-requests}.ts`; `cache()` backfill on 3 readers; tests. No migration/permission/route. |
| **10.0C — Cockpit UI & Widgets** | `/dashboard` re-render | Suspense sections + skeletons over `getOperationsCockpit()`; retain all current sections; `StatCard` idiom; drill-down links. |
| **10.0D — Executive KPI Engine** | KPI completeness | today-scoped counters; wire derivable KPIs; decide honest-null presentation for documentationDays/ETA-accuracy. |
| **10.0E — Unified Alert Center** | alert adapters | project producers #4–#10 (§12) into `ExecutiveAlert`; optional additive `code?` field; alert section UI with level counts. |
| **10.0F — Operations AI Copilot** | 3 additive files + 1 permission | `buildOperationsContext` + serializer + route; deterministic cards first; `operations:copilot:read` (migration + parity gate). |
| **10.0G — Live Operations Map** | lazy map section | reuse `readFleetMap` + `ShipmentMapLoader`; no new tracking infra. |

Order rationale: B before C (testable data layer before pixels); D/E after C (they light up sections the UI scaffolds); F after B (copilot context = composition reader); G last (highest render cost, lowest decision risk).

## 26. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Render-cost regression on `/dashboard` (adding transit/finance depth to an already 9-reader page) | High | Suspense streaming + `cache()` backfill *before* widget expansion (B before C); measure with existing perf doctrine (`docs/performance-p1.md`) |
| Duplicate-KPI drift (same number computed twice, diverging) | High | doctrine: cockpit consumes composition reader only; forbid direct table reads in `lib/operations` via structural test (the Phase-7.6B `code()` idiom) |
| Two-workflow-truth confusion (engine flag off ⇒ engine sections null) | Medium | keep the existing flag-gated-null pattern; label legacy vs engine metrics in types; never blend counts from both truths in one number |
| Permission leakage via composition (a section rendering data its viewer's gate didn't cover) | Medium | per-section gate *before* fetch + readers self-authorize (defense in depth, both already doctrine) |
| Per-person workload = surveillance perception | Medium | supervisory-gated widget (`analytics:read`), team/department defaults, per-person opt-in decision for management (DEC-B30) |
| Caisse/escalation widgets promised but unbuildable | Low | catalogued as blocked (§4.3); cockpit ships honest-absent, not fake |
| Frozen sidebar contract | Low | zero nav change — `/dashboard` keeps its entry; frozen-sidebar tests untouched |

## 27. Decisions requiring approval

- **DEC-B29 — Cockpit = `/dashboard` evolved in place.** No new route; « Centre d'opérations » label and sidebar entry unchanged; `/dashboard/executive` remains a separate direction-level view. *(Alternative rejected: a new `/operations` route would duplicate the existing cockpit and violate the frozen-sidebar contract.)*
- **DEC-B30 — Workload visibility.** Department/team bars for all `analytics:read` holders; **named per-person bars** shown only to supervisory viewers (`analytics:read`), with management sign-off on the people-visibility question before 10.0C ships the widget.
- **DEC-B31 — Refresh model.** Request-driven + Suspense in 10.0C; optional 60–120 s summary polling in a later increment; **no Supabase Realtime in 10.0**.
- **DEC-B32 — Operations Copilot permission.** `operations:copilot:read` created in 10.0F only (not before), via the standard migration + seed + role-templates parity gate. Proposed holders: CEO, OPS_SUPERVISOR, COORDINATOR, CHIEF_OF_TRANSIT, SYSTEM_ADMIN (final list at 10.0F).
- **DEC-B33 — Legacy executive-analytics stack.** `getExecutiveAnalytics` (`lib/analytics/executive-service.ts`) is declared legacy-`/analytics`-only; the cockpit must not consume it; retirement is a separate future cleanup, not part of 10.0.
- **DEC-B34 — Alert `code` field.** Additively widen `ExecutiveAlert` with optional `code?` in 10.0E so shipping/air/blocker codes survive the merge (enables filtering + copilot references). Purely additive; existing consumers unaffected.

## 28. Exact files expected to change in 10.0B

**New (all under `lib/operations/` + tests):**
- `lib/operations/types.ts` — `OperationsCockpit` shape
- `lib/operations/reader.ts` — `getOperationsCockpit()` (server-only, `cache()`, `Promise.allSettled`, per-section permission degradation)
- `lib/operations/compose.ts` — pure projections (reuses `normalizeSeverity`/`mergeExecutiveAlerts` from `lib/executive/compose`)
- `lib/operations/workload.ts` — `getWorkloadByDepartment()` (wraps `getQueueCounts` + canonical rollup), `getWorkloadByUser()`, `getWorkloadByTeam()` (new GROUP-BYs, scope-mirrored)
- `lib/operations/finance-requests.ts` — `getFinanceRequestQueue()` (tenant-wide, `finance:read`-gated, `financeExecution`-flag-safe)
- `tests/operations-cockpit.test.ts` (+ structural no-direct-table-read test)

**Modified (one-line-class changes):**
- `lib/control-tower/service.ts` — wrap `getControlTower` in React `cache()`
- `lib/logistics/reader.ts` — wrap `getCommandCenter` in `cache()`
- `lib/bi/service.ts` — wrap `getBusinessIntelligence` in `cache()`

**Explicitly NOT changed in 10.0B:** `app/dashboard/page.tsx` (UI waits for 10.0C), any migration, seed, role template, navigation, component, or route.

## 29. Acceptance criteria (for this phase, 10.0A)

- [x] Every conclusion grounded in repository evidence (file:line throughout; no assumed functionality)
- [x] All 14 audit-scope areas covered (§2–§16) + all mission deliverable sections present
- [x] Every candidate metric classified Existing / Derivable / Needs-new-data / Not-recommended (§7–§11, §18)
- [x] Documentation-only change — zero code, migration, permission, RLS, route or widget touched
- [x] Standard verification gates run before commit (typecheck + test suite)
- [x] Decisions enumerated for ratification (DEC-B29…B34) before 10.0B starts

## 30. Final recommendation

**GO — proceed to 10.0B once DEC-B29…B34 are ratified.** The platform is unusually well-positioned: the cockpit page, the composition pattern, the alert merge engine, the KPI sources, the copilot seam and the security idioms all exist and are proven in production. Phase 10.0 is fundamentally **an exercise in disciplined reuse** — one new composition layer, four small new aggregation readers, adapters into an existing alert engine, and a streaming re-render of the page that already bears the name « Centre d'opérations ». The main thing to protect is the doctrine that got the platform here: the cockpit consumes; it never owns.
