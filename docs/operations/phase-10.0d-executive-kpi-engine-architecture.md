# Phase 10.0D-0 — Executive KPI Engine : Architecture & Definition Audit

**Date:** 2026-07-24 · **Type:** architecture & KPI-definition audit only — **no KPI reader, no /dashboard change, no Tableau exécutif change, no migration/table/view/RPC/permission/role/RLS/Realtime/polling/chart, no Control Tower behavior change**
**Repo state audited:** commit `d732c8b` (post-10.0C, CI green)
**Mission:** define the authoritative KPI layer so that no attractive-but-misleading number ever reaches the cockpit or executive reporting.

---

## 1. Executive summary

The audit's central finding: **the platform's KPI arithmetic is largely consistent — its KPI *semantics* are not.** Formulas for revenue-invoiced, outstanding, receivables aging and customs clearance MATCH across `lib/analytics`, `lib/bi` and `lib/control-tower` (verified line-by-line, §4). But four silent semantic traps exist today:

1. **Two different numbers are both called revenue.** "Revenu du mois" on the Finance page and cockpit finance card is Σ *payments received* (`getFinanceMonthRevenue`, `lib/departments/service.ts:83–97`, `payment.paid_at`), while the Control Tower's "Revenue" is Σ *invoices issued* (`lib/analytics/calc.ts:68–70`, `invoice.issue_date`). Both are legitimate metrics; sharing one French label is not. → DEC-B44.
2. **"Dossiers actifs" has FOUR definitions.** Canonical predicate `isActiveStatus = status ∉ {CLOSED, CANCELLED}` (`lib/files/status.ts:53`) vs analytics `≠ CLOSED` (counts CANCELLED **and** DRAFT as active, `lib/analytics/calc.ts:122`) vs `FileOverview.active = rows − CLOSED` (same flaw, `lib/files/aggregate.ts:60`) vs the control-tower fallback `∉ {CLOSED, DRAFT}` (counts CANCELLED, `lib/control-tower/service.ts:342`). → DEC-B43.
3. **Every monetary aggregate except one sums blindly across currencies.** The schema is multi-currency-capable (`invoice.currency` default `'XOF'`, `organization.currency` default `'XOF'`); `payment` has **no currency column at all**; the only currency-safe aggregate in the codebase is customs `dutyTotals` (per-currency array, `lib/customs/intelligence/dashboard.ts:39–45`). Today every tenant is de-facto XOF (no UI writes another currency), so numbers are *currently* correct — but nothing guards that. → DEC-B40.
4. **"Today" is UTC everywhere except collections.** `organization.timezone` exists (default `'Africa/Dakar'`, migration `20260712110000:25`) but is honored only by collections aging (`todayInTimezone`, `lib/collections/aging.ts:155`). Dakar = GMT+0 year-round, so UTC≡Dakar *today* — the audit codifies tenant-timezone resolution before that assumption ever breaks. → DEC-B39.

**Recommendation:** one authoritative KPI engine as a **new bounded read model inside `lib/operations/` (`lib/operations/kpi/`)** — composing the existing authoritative readers plus a small set of event-timestamp "today/MTD" readers — with a typed contract carrying window, per-currency values, basis counts and status. Control Tower, cockpit, Tableau exécutif and Reports become consumers over time; **nothing is deleted or changed in this phase**. Initial approved set: **8 primary KPIs + 1 conditional** (§14). Windows in 10.0D: **Today + Month-to-date** only (§6). Snapshot trends are **deferred** — no snapshot history exists and none may be fabricated (§19).

---

## 2. Existing KPI inventory

Every KPI-producing reader was audited (all paths verified; `lib/dashboard/`, `lib/billing/`, `lib/delivery/` do **not** exist — their concerns live in `lib/departments/`, `lib/finance/`, `lib/transport/`/`lib/logistics`). Full formula traces in §4–§5; classification summary:

| KPI (current label) | Reader | Formula / date field | Classification |
|---|---|---|---|
| Dossiers actifs | `getAnalytics().operations.active` (`calc.ts:122`) | count status ≠ CLOSED — includes DRAFT + CANCELLED | **Misleading** (definition) |
| Dossiers actifs (cockpit band) | `FileOverview.active` (`files/aggregate.ts:60`) | rows − CLOSED | **Misleading** (same flaw) |
| Revenu du mois (Finance page/cockpit) | `getFinanceMonthRevenue` (`departments/service.ts:83`) | Σ non-reversed `payment.amount`, `paid_at` ≥ UTC month start | **Authoritative with clarification** — it is *Encaissé*, not revenue |
| Revenue this month (CT/analytics/BI) | `computeFinancial` (`calc.ts:68`), `revenueMetrics` (`bi/aggregate.ts:47`) | Σ `invoice.total`, status ∈ {ISSUED, PARTIALLY_PAID, PAID}, `issue_date` in UTC month | **Authoritative with clarification** — *Facturé*; currency-blind sum |
| Outstanding / Encours | `calc.ts:61`, `bi/aggregate.ts:53`, `getFinanceKpis` (`finance/service.ts:436`) | Σ `balance`, status ∈ {ISSUED, PARTIALLY_PAID} | **Authoritative as-is** (formulas match ×5 sites); currency-blind sum |
| Overdue amount / count | `calc.ts:63` / `isOverdue` (`finance/calc.ts:92`) | balance>0 ∧ `due_date` < UTC-midnight-today | **Authoritative with clarification** (UTC boundary → tenant-day) |
| Collection rate | `calc.ts:82` | Σ paid / Σ billed over ALL-TIME issued set | **Authoritative with clarification** — lifetime realization, not windowed; must never be presented as monthly |
| Receivables aging | `bi/aggregate.ts:114` | balance-sum buckets by `due_date` overdue days | Authoritative as-is (server-instant boundary noted) |
| Avg customs days | `calc.ts:156`, `bi/aggregate.ts:151`, CT local (`service.ts:334`) | avg(`release_date` − `declaration_date`), RELEASED | **Authoritative as-is** (3 sites match) |
| Avg clearance (Customs Intelligence) | `customs/intelligence/dashboard.ts:27` | avg(`releasedAt` − `submittedAt`) — provider lens | **Duplicated with different semantics** — keep, label distinctly, never mix |
| Delivered this month | `transportTimeKpis` (`ct/aggregate.ts:138`) | count `delivery_actual` ≥ UTC month start | Authoritative as-is |
| Delivered (analytics) | `calc.ts:124` | all-time count status = DELIVERED | **Misleading if windowed** — status count, not an event flow |
| Avg delivery days | `ct/aggregate.ts:147` | avg(`delivery_actual` − `pickup_actual`) | Authoritative as-is |
| Time-to-invoice / time-to-payment | `ct/service.ts:336–339` | `delivery_actual`→`issue_date` / `issue_date`→`paid_at` | Authoritative as-is (canFinance) |
| Customs queue (pending) | `getIntelligenceDashboard` (`dashboard.ts:13`) | !cleared ∧ !terminal | Authoritative as-is |
| Customs releases (all-time) | `dashboard.ts:17` | isCleared count | **Derivable → today-scope** via `release_date` (DATE-grain) or `audit_log customs.released` |
| Ocean/air delayed, stale, arriving | shipping/air dashboards | eta-vs-planned formulas (§4) | Authoritative as-is |
| Finance requests pipeline | `getFinanceRequestQueue` (10.0B) | status buckets, `requested_at` | Authoritative as-is (flag-gated) |
| Queue depths / workload | `getQueueCounts`, 10.0B workload | open executions GROUP-BY | Authoritative as-is (flag-gated) |
| Messaging summary / unread | `getMessagingDashboardSummary`, `unreadStaffMessagingCount` | conversation status/priority; RLS unread | Authoritative as-is |
| Failed notifications | `communication.status='FAILED'` | no `failed_at` column | **Derivable** (count); "failed today" = **Missing source data** |
| Escalations / messaging SLA | — | no first-response or escalation data | **Missing source data** (per 10.0A) |
| Risk KPIs / attention | `risk-engine.ts` + CT | additive scoring (§4) | Authoritative as-is (its own doctrine) |
| Documentation-complete rate, doc cycle time | — | `avgTimes.documentationDays` hardcoded null (`ct/service.ts:369`) | **Missing source data** |
| ETA accuracy | — | honest null (`executive/reader.ts:204`) | **Missing source data** |
| getExecutiveAnalytics stack | `analytics/executive-service.ts` | formulas match bi (§21) | **Legacy** (DEC-B33 quarantined; `/analytics` only) |

---

## 3. Current `cockpit.kpis.executive` contract

- **Shape:** `CockpitKpis = { executive: ExecutiveKpis | null }` (`lib/operations/types.ts`), populated `ct ? { executive: ct.kpis } : null` (`lib/operations/reader.ts`) — gated `analytics:read` before the fetch.
- **The six figures + currency** (`ExecutiveKpis`, `lib/control-tower/service.ts:57–65`; composition `:341–349`):

| Field | Origin | Computed twice? |
|---|---|---|
| `activeDossiers` | `analytics.operations.active` ?? CT fallback (different definition!) | **Yes — divergent fallback** (`:342`) |
| `deliveredThisMonth` | CT-local `transportTimeKpis` (`delivery_actual`, UTC month) | No |
| `revenueThisMonth` | reused from `getAnalytics().financial` | No (reuse) |
| `outstanding` | reused from `getAnalytics().financial` | No (reuse) |
| `avgCustomsDays` | analytics preferred ?? CT-local (same formula) | Benign duplicate (matching) |
| `avgDeliveryDays` | CT-local `transportTimeKpis` | No |
| `currency` | `analytics.currency ?? "XOF"` — i.e. the literal `"XOF"` (`analytics/service.ts:117`) | Hardcoded |

- **Presentation:** the Control Tower component owns it (`components/dashboard/control-tower.tsx:44–55`, preserved via `DashboardSupporting` since 10.0C). The cockpit's own `kpis` section is deliberately **not** rendered as a second strip (10.0C decision to avoid duplication).
- **Verdict:** raw values are projected once (no double computation except the `activeDossiers` fallback divergence), but the **type is insufficient for 10.0D**: no window, no per-currency safety, no status/freshness, no basis counts, no comparison semantics. → A dedicated KPI bounded read model is needed (`lib/operations/kpi/`, §20), with `cockpit.kpis.executive` retained unchanged during the transition (the preserved Control Tower keeps consuming it) — **one source of truth is preserved by making the new engine compose the same authoritative readers, never by re-deriving.**

---

## 4. KPI duplication map

Verified formula-level (file:line in §2 and agent traces):

| Metric | Sites | Verdict |
|---|---|---|
| revenue-invoiced (month) | `analytics/calc.ts:68` = `bi/aggregate.ts:47` = CT reuse = legacy banner reuse | **MATCH** (issue_date, ISSUED-set, UTC month) |
| cash-collected (month) | `bi/aggregate.ts:54` (paid_at) = `departments/service.ts:83` (paid_at ≥ UTC month start) | MATCH each other; **DIVERGE from revenue-invoiced** — different business fact mislabeled as the same |
| outstanding | analytics = bi = getFinanceKpis = per-file = reconciliation = client-intelligence | **MATCH** (Σ balance, ISSUED/PARTIALLY_PAID). One diverging site: CT export row sums balance over *any* status (`ct/service.ts:302`) — export-only, flag for later cleanup |
| activeDossiers | 4 definitions (§1.2) | **DIVERGE** → DEC-B43 |
| avgCustomsDays | analytics = bi = CT-local (`declaration_date→release_date`) vs Customs Intelligence (`submittedAt→releasedAt`) | 3 MATCH + 1 intentional provider-lens variant — never blend |
| delivered | analytics status-count (all-time) vs CT event-flow (month) | **DIVERGE** — flow (delivery_actual) is the authoritative event; status-count retired from KPI use |
| overdue boundary | `finance/calc.ts:100` = `analytics/calc.ts:63` = legacy `executive-service.ts:91` | MATCH (UTC-midnight) — all move to tenant-day under DEC-B39 |

## 5. Business ownership matrix

| KPI domain | Owner (semantics) | Authoritative source | KPI engine may |
|---|---|---|---|
| Dossier states, active/opened/closed | Operations (`lib/files`) | `operational_file` + `file_state_transition` | count, window — never redefine `isActiveStatus` |
| Process/queue depth, blockers | Workflow engine (`lib/process`) | `process_step_execution` etc. | reuse `getQueueCounts`/tower — never read engine tables directly |
| Customs clearance | Customs (`lib/customs`) | `customs_record.declaration_date/release_date` | window + average — the declared↔released pair is fixed |
| Transport/delivery | Transport (`lib/transport`) | `transport_record.pickup_actual/delivery_actual` | window + average |
| Ocean/Air movement | `lib/shipping` / `lib/air` | their dashboards | reuse dashboards as-is |
| Invoiced revenue, outstanding, overdue | Finance/Billing (`lib/finance`) | `invoice` (+lines) via `invoiceTotals/balanceDue/isOverdue` | window + per-currency grouping — never re-implement totals |
| Cash collected | Finance | `payment` (non-reversed; currency via joined invoice) | window + per-currency via invoice join |
| Collections aging | Collections (`lib/collections`) | `evaluateAging` + tenant-day | reuse verbatim — the ONLY tenant-tz-correct module today |
| Finance requests | Finance execution (`lib/finance/requests`) | `finance_request` statuses via 10.0B queue | reuse `getFinanceRequestQueue` |
| Caisse | — (no tables) | none | **nothing** — defer |
| Messaging | `lib/messaging` / `lib/comms` | conversation/communication statuses | count; SLA/escalation = missing data |
| Executive composition | `lib/operations` (10.0B+) | composition only | normalize/window/present — zero business semantics |

---

## 6. Time-window policy

**Supported in 10.0D (DEC-B38): `today` and `month_to_date` only**, plus the implicit `current` for snapshots. Rationale: these two are what the cockpit vision needs, both are computable from verified event fields, and every additional window multiplies the definitional surface before the engine has proven itself. Yesterday / last-7 / previous-month / QTD / YTD / rolling-30 / custom: **deferred** (previous-month is computed internally only as the comparison basis for MTD flows).

Rules (all windows):
- **Timezone:** tenant operating timezone = `organization.timezone` (exists, NOT NULL, default `'Africa/Dakar'`, `20260712110000:25`; provisioning honors input `20260715000001:148`). Resolution reuses the proven `todayInTimezone` mechanic (`lib/collections/aging.ts:155–167`, fallback `'Africa/Dakar'` as in `collections/service.ts:97`), to be lifted into a shared helper in 10.0D-1. **UTC boundaries are forbidden for business-day KPIs** (currently harmless only because Dakar = GMT+0 with no DST). No schema change needed — no blocker. Gap noted: no tenant-settings UI writes `timezone` (provisioning-only); acceptable for 10.0D.
- **Boundaries:** a day is `[00:00, 24:00)` in tenant tz — inclusive start, exclusive end. MTD = `[1st 00:00 tenant-tz, now]`. DATE-grain columns (`issue_date`, `paid_at`, `release_date`, `disbursed_at`) compare as calendar dates against the tenant-tz today string (the collections idiom) — never converted through UTC instants.
- **Inclusion timestamp:** each KPI names ONE timestamp (§7). `updated_at` is forbidden as a proxy (no repository evidence anywhere that it is authoritative for any event).
- **Comparison window:** MTD flows compare to the *full* previous tenant-month (labeled "vs mois précédent (complet)" — an MTD-vs-full-month comparison must say so). Today flows: no comparison in 10.0D (yesterday deferred). Snapshots: no comparison (§8).

## 7. "Today" event definitions

| Today-KPI | Inclusion timestamp | Grain | Evidence |
|---|---|---|---|
| Dossiers ouverts aujourd'hui | `file_state_transition.occurred_at` where `to_status='OPENED'` (fallback `operational_file.opened_at`) | instant | append-only, app-written since 2026-06-14 (`20260614000002:135–151`; writers `lib/files/actions.ts:178,400`) |
| Dossiers clôturés aujourd'hui | `file_state_transition.occurred_at`, `to_status='CLOSED'` | instant | already analytics' closure source (`analytics/service.ts:56`) |
| Livraisons terminées aujourd'hui | `transport_record.delivery_actual` | instant | timestamptz (`20260615000003:30`) |
| Mainlevées (BAE) aujourd'hui | `customs_record.release_date` | **DATE** | date column (`20260615000002:42`); true instant exists only in `audit_log customs.released` — DATE-grain is the honest primary source; the audit-log alternative is a 10.0D-2 implementation choice, never both |
| Factures émises aujourd'hui | `invoice.issue_date` | **DATE** | no `issued_at` timestamptz exists (`20260615000004:78`) |
| Encaissements reçus aujourd'hui | `payment.paid_at` (non-reversed) | **DATE** (user-editable, defaults today) | `20260615000004:108`; recording instant = `created_at` |
| Demandes finance approuvées aujourd'hui | `finance_request.reviewed_at` (status APPROVED) | instant | `20260723000002:62` |
| Demandes finance décaissées aujourd'hui | `finance_request.disbursed_at` | **DATE** | `:71` |

Key structural facts: `operational_file` has **no** `closed_at`/`delivered_at` column — dossier-completion "today" KPIs MUST use `file_state_transition` (or `audit_log`); and DATE-grain events can never claim time-of-day precision (they are whole-tenant-day facts).

## 8. Snapshot vs flow classification

| Kind | KPIs | Trend arrows valid? |
|---|---|---|
| **Snapshot** (state now) | Dossiers actifs, file douane, demandes finance en attente, créances en retard, backlog d'affectation, blocages, non-lus, queue depths, workload | **NO** — no snapshot history exists; comparing a snapshot to a "previous period" without stored history fabricates a trend. Deferred until periodic capture exists (DEC-B42). |
| **Flow** (events over window) | Ouverts/clôturés aujourd'hui, livraisons du jour, mainlevées du jour, facturé MTD, encaissé MTD, demandes approuvées/décaissées | **YES** — reconstructable from event timestamps; MTD-vs-previous-full-month comparison allowed with explicit labeling (§6). |

## 9. Currency policy

Evidence: `invoice.currency` default `'XOF'`; `billing_charge.currency`, `payment_intent.currency`, `finance_request.currency` exist; **`payment` has no currency column** (`20260615000004:100–113`) — a payment's currency is its invoice's; `organization.currency` default `'XOF'`. **XOF is de-facto sole operational currency (every default + no UI writes another) but is NOT schema-guaranteed.** All monetary aggregates except customs `dutyTotals` sum currency-blind (§1.3); `bi/service.ts:95` even stamps the *last invoice's* currency on a cross-currency sum (last-writer-wins).

**Binding policy (DEC-B40):** every monetary KPI in the engine is computed **grouped by currency** (the 10.0B `pendingAmounts: {currency, amount}[]` pattern, already shipped and test-pinned). Rendering: exactly one currency present → scalar with its currency; several → per-currency list; zero → null. **No conversion, no invented rates, no cross-currency scalar — ever.** Payment amounts take the joined invoice's currency; a payment whose invoice is unknown is excluded from money KPIs and counted in the data-quality basis (§18). Classification of monetary KPIs: *per-currency rendering required* (all of: facturé, encaissé, encours, retard). *Conversion infrastructure exists:* none. *Must be deferred:* any single-scalar "total company revenue" across currencies.

---

## 10–13. KPI catalogs (candidates, evidence-classified)

### 10. Operations

| Candidate | Classification | Evidence / gap |
|---|---|---|
| Active dossiers | **Existing (definition to ratify)** | 4 divergent definitions → DEC-B43 |
| Dossiers created today | **Derivable now** | `created_at` / transition OPENED (§7) |
| Dossiers completed today | **Derivable now** | `file_state_transition` CLOSED (§7) |
| Dossiers overdue (ETA) | Existing | `FileOverview.overdueShipments` (`files/aggregate.ts:33`) |
| Dossiers blocked | Existing (two lenses) | analytics `blocked` (customs/transport BLOCKED, `calc.ts:140`); engine blockers flag-gated |
| Average dossier cycle time | Existing | `computeTeam.avgClosureDays` (`calc.ts:248`, created→CLOSED transition) |
| Documentation-complete rate | **Requires new event data** | no doc-verified timestamp (`ct/service.ts:369` null) |
| Assignment backlog | Derivable now | `assigned_to_user_id is null` on active files / engine `unassigned` |

### 11. Transit & Customs

| Candidate | Classification |
|---|---|
| Customs queue | Existing (`dashboard.pending`) |
| Customs releases today | **Derivable now** (`release_date` = tenant-today, DATE-grain) |
| Customs files overdue | Requires definition (no customs SLA data; per-step SLA "unconfigured") — **not recommended** in 10.0D |
| Average clearance time | Existing (declaration→release) |
| Declarations processed (window) | Derivable (`declaration_date` window) |
| Transport movements active | Existing (transport status counts / `getCommandCenter`) |
| Deliveries due today | Derivable now (`delivery_planned` in tenant-day) |
| Deliveries completed today | **Derivable now** (`delivery_actual`) |
| Delayed deliveries | Existing (road overdue + ocean/air delayed) |
| POD completion rate | Derivable with caution (podRequired vs delivered; rate denominator needs definition) — defer to reports |

### 12. Finance

| Candidate | Classification |
|---|---|
| Requests pending review / approved-not-disbursed / evidence owed | **Existing** (10.0B `getFinanceRequestQueue`) |
| Invoices issued (count, window) | Derivable now (`issue_date`) |
| Amount invoiced (MTD) | Existing formula; **needs per-currency guard** |
| Collections received (MTD) | Existing formula (paid_at); needs per-currency via invoice join; **rename** (DEC-B44) |
| Collection rate | Existing but **lifetime-only**; windowed rate (encaissé-MTD ÷ facturé-MTD) is a mismatched ratio — **not recommended** as a primary KPI; keep lifetime version in Reports with explicit "depuis l'origine" label |
| Overdue receivables | Existing (amount + count; boundary → tenant-day) |
| Reconciliation exceptions | Existing (10.0C indicators) |
| Caisse / cash position | **Requires new schema** — no treasury tables; **forbidden to fabricate** |

### 13. Messaging & service

| Candidate | Classification |
|---|---|
| Unread operational conversations | Existing (`unreadStaffMessagingCount`, RLS-scoped per viewer — a *personal* signal, not a tenant KPI; keep in cockpit summary, exclude from executive set) |
| Conversations awaiting reply | Existing (`waiting_effitrans`) |
| Failed notifications (count) | Derivable (`communication.status='FAILED'`); "failed today" lacks `failed_at` — **Missing source data** |
| Escalations | **Missing source data** (no concept) |
| Messaging SLA breaches | **Missing source data** (no `first_response_at`; derivable only via message-ordering reconstruction — defer) |

---

## 14. Proposed initial executive KPI set (DEC-B37)

**8 primary + 1 conditional.** Every entry: French label · stable key · decision question · formula · source · default window · comparison · permission · currency · freshness · drill-down · limitations.

| # | Label (FR) | Key | Question | Formula & source | Window | Comparison | Permission | Currency | Drill-down | Limitations |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dossiers actifs | `dossiers_actifs` | How much work is in the house? | count `operational_file` where ratified active-predicate (DEC-B43) — via files/analytics reader | current | none (snapshot) | `analytics:read` (base `file:read` figures already on cockpit) | — | `/files` (exact filters exist) | definition ratification pending |
| 2 | Dossiers ouverts (jour) | `dossiers_ouverts_jour` | Is intake moving today? | count `file_state_transition` to OPENED in tenant-day (§7) | today | none (yesterday deferred) | `analytics:read` | — | `/files?status=OPENED` (general) | transitions live since 2026-06-14 only |
| 3 | Livraisons terminées (jour) | `livraisons_jour` | Are we delivering today? | count `transport_record.delivery_actual` in tenant-day | today | none | `analytics:read` | — | `/transport?status=DELIVERED` (exact) | road records only (ocean/air arrival ≠ delivery) |
| 4 | File douane | `douane_en_cours` | What's stuck at customs? | `getIntelligenceDashboard().pending` | current | none | `analytics:read` (source self-gates `customs:read`) | — | `/customs/intelligence?status=…` (exact filters exist) | visibility-scoped for non-`file:read:all` viewers |
| 5 | Mainlevées (jour) | `mainlevees_jour` | Is customs releasing today? | count `customs_record.release_date` = tenant-today | today | none | `analytics:read` | — | `/customs/intelligence` (general) | DATE-grain (whole-day fact) |
| 6 | Facturé (mois) | `facture_mtd` | How much have we billed? | Σ `invoice.total`, ISSUED-set, `issue_date` in tenant-MTD — per-currency | MTD | vs previous full month | `analytics:read` **AND** `finance:read` (absent otherwise) | per-currency | `/finance?status=ISSUED` (exact) | DATE-grain; reuses `invoiceTotals` |
| 7 | Encaissé (mois) | `encaisse_mtd` | How much cash came in? | Σ non-reversed `payment.amount`, `paid_at` in tenant-MTD — currency via invoice join | MTD | vs previous full month | `analytics:read` AND `finance:read` | per-currency | `/finance/reconciliation` (general) | `paid_at` user-editable DATE; orphan payments excluded+counted |
| 8 | Créances en retard | `creances_retard` | What cash is at risk? | Σ balance + count where `isOverdue` at tenant-day boundary | current | none (snapshot) | `analytics:read` AND `finance:read` | per-currency | `/collections` (exact filters exist) | boundary moves UTC→tenant-day (same result while Dakar) |
| 9* | Demandes finance à traiter | `demandes_finance` | What needs Finance action? | `pendingReview + approvedNotDisbursed` (10.0B reader) | current | none | `analytics:read` AND `finance:read` | counts only | `/finance` (general) | *conditional: only when `financeExecution` live; absent otherwise (never zero)* |

Deliberately excluded from the primary set: collection rate (lifetime-only, §12), unread messages (personal not tenant-level), avg clearance/delivery days (already on the preserved Control Tower — avoid the double-render 10.0C prevented; revisit when CT becomes a consumer), anything caisse/escalation/ETA-accuracy (no data).

## 15. Persona visibility (role-specific views)

**One KPI definition set; visibility varies only by permission (existing doctrine).** No per-persona formulas, no new permissions. Effective views fall out of role templates: Managing Director / CEO (`analytics:read`+`finance:read`) → all 9; Operations Director / OPS_SUPERVISOR → 1–5 (+6–9 if finance-granted); Chief of Transit (`analytics:read` holder per templates) → 1–5; Finance Manager (`analytics:read`+`finance:read`) → all, most interested in 6–9; a viewer without `analytics:read` sees **no executive strip at all** (cockpit summary band remains their view). Partial sets are allowed and already the platform's degradation model.

## 16. Drill-down matrix (audited `searchParams` support)

| Route | Filters actually parsed | Class |
|---|---|---|
| `/files` | `search,status,type,priority,client,mode,mine,overdue,sort` (`app/files/page.tsx:36–47`) | **Exact filter** |
| `/tasks` | `filter=mine\|overdue\|all` | Exact filter |
| `/finance` | `status` | Exact filter |
| `/collections` | `bucket,page,mine,unassigned,disputed,missed,promise,noFollowUp,ready,verify,partial,paid,q` (`:37–81`) | **Exact filter** |
| `/customs/intelligence` | `q,status,provider,office,from,to,page` (`:53–62`) | **Exact filter** |
| `/transport` | `status` | Exact filter |
| `/queues/[key]` | `q,page,unreceived,blocked,unassigned,rejected` (no `assignee`) | Exact filter |
| `/departments/customs`, `/messages`, `/finance/reconciliation`, `/deposits` | none (static) | **General destination** |
| `/my-work` | `tab` | Exact filter |

No KPI in §14 promises a filter that does not exist; "needs future filter support": deliveries-today on `/transport` could later gain a date param (currently lands on `?status=DELIVERED`, acceptable).

## 17. Freshness & caching

Current state: request-driven, `force-dynamic`, React `cache()` on the composition path (10.0B/C), `revalidatePath` on mutations, manual header refresh (10.0C), zero Realtime/polling (DEC-B31 — preserved). **Policy for 10.0D:** every KPI is `freshness: "live-request"`; request-level `cache()` on the KPI reader is sufficient; acceptable staleness = one page view (the header's truthful « Dernière actualisation » timestamp is the UI label — DEC-B45); **no cross-request caching, no scheduled aggregates** until live-query cost proves inadequate (§18 shows it does not). A future scheduled snapshot appears only with 10.0D-6 evidence (and would then honestly label `freshness: "snapshot"`).

## 18. Performance analysis

The proposed set adds **at most 5 small new queries** per cockpit render (today-transitions, today-deliveries, today-releases, MTD-invoices, MTD-payments) — each a tenant-scoped, date-bounded, indexed-column count/sum; everything else reuses already-fetched readers (request-`cache()`d since 10.0B). Existing relevant indexes: `audit_log(occurred_at)`; `file_state_transition` PK+file FK (an `occurred_at` filter over a tenant's transitions is small); invoice/payment tables are tenant-indexed. No N+1 (batch idiom mandatory, as 10.0B). Working-set caps follow house style. **Recommendation: new lightweight read-only readers inside `lib/operations/kpi/` composing existing bounded readers — NO views, NO RPCs, NO materialization** (no evidence live queries are inadequate; the heaviest existing pass — control tower — is already request-cached and unchanged).

## 19. Historical-trend readiness

| KPI class | Readiness |
|---|---|
| Facturé / Encaissé monthly series | **Historical event timestamps exist** (`issue_date`, `paid_at`) — 12-month reconstruction valid today (bi/legacy already do it) |
| Dossiers ouverts/clôturés series | Reconstructable from `file_state_transition` **since 2026-06-14 only** (not backfilled — label the series start honestly) |
| Livraisons / mainlevées series | Reconstructable (`delivery_actual`; `release_date` DATE-grain) |
| Active count, queues, backlog, overdue receivables, open alerts | **Requires snapshots** — deferred (DEC-B42); reconstructing "active as of date X" from transitions is possible in principle but unproven and out of 10.0D scope |
| Avg clearance/delivery trends | Reconstructable per release/delivery month |

## 20. Proposed type contract (10.0D-1)

Refined to house conventions (traceable source + href like `lib/executive/types.ts`; per-currency arrays like 10.0B; Missing ≠ Negative):

```ts
// lib/operations/kpi/types.ts (PURE)
export type KpiWindowKey = "current" | "today" | "month_to_date";
export type KpiWindow = {
  key: KpiWindowKey;
  /** tenant-tz ISO bounds actually used (audit/debug; start inclusive, end exclusive) */
  start: string | null; end: string | null;
  timezone: string; // resolved organization.timezone
};
export type KpiMoney = { currency: string; amount: number };
export type OperationsKpi = {
  key: string;               // stable, e.g. "facture_mtd"
  label: string;             // French display label
  kind: "count" | "amount" | "rate" | "duration";
  /** count/rate/duration value; null = not available (never zero) */
  value: number | null;
  /** kind="amount": per-currency values; scalar rendering only when length === 1 */
  amounts?: KpiMoney[];
  unit?: "days" | "percent";
  window: KpiWindow;
  comparison?: {
    label: string;           // e.g. "vs juin (mois complet)" — honest phrasing mandatory
    value: number | null;
    direction: "up" | "down" | "flat" | "unknown";
    changePercent: number | null;  // null when prior null/0 (DEC-B41)
  };
  source: string;            // authoritative reader key (traceability)
  freshness: "live-request"; // only value in 10.0D
  status: "ready" | "partial" | "unavailable";
  /** data-quality basis: rows considered / rows excluded as invalid (§21) */
  basis?: { included: number; excluded: number; note?: string };
  href?: string;             // §16-verified destination only
};
```

No styling/tone fields in the domain contract (tone stays a UI mapping, per 10.0C `CockpitSummaryIndicator` precedent — which remains the *summary band's* type; `OperationsKpi` is the executive contract).

## 21. Data-quality policy (DEC-B46)

Default behavior: **exclude invalid rows, count them in `basis.excluded`, mark `status:"partial"` when exclusions > 0** — never silently report false precision, never fail the section.

| Condition | Behavior |
|---|---|
| Missing completion timestamp (e.g. RELEASED without `release_date`) | exclude + count |
| Null due date | excluded from overdue (already `DUE_DATE_MISSING` in collections — reuse) |
| Payment without resolvable invoice currency | exclude from money + count |
| Mixed currencies | per-currency output (not a defect) |
| Legacy/unknown state value | exclude + count |
| Engine/migration absent (`financeExecution` etc.) | KPI `status:"unavailable"`, value null (existing null-degrade idiom) |
| Source reader failed | `unavailable` (allSettled), section renders others |
| Prior-period value 0 or null | `direction:"unknown"`, `changePercent:null` (DEC-B41 — never ∞/100 %) |

## 22. Permission model

- **The executive KPI strip is gated `analytics:read`** (DEC-B36) — the platform's established management/supervision boundary (Control Tower, Direction, `/reports`, per-user workload DEC-B30). No new permission (none created in this audit; none needed for 10.0D at all).
- **Monetary KPIs additionally require `finance:read`** — money-blind doctrine preserved: without it, KPIs 6–9 are ABSENT (never zero), matching `getAnalytics(includeFinance)` and 10.0C behavior.
- Partial sets are normal (§15). Sources keep self-authorizing (defense in depth). SYSTEM_ADMIN sees exactly what its granted permissions imply — no implicit business-metrics grant (consistent with the HR precedent of deliberate non-grants).

## 23. Security & privacy

KPI responses contain **only normalized values and safe labels** — no raw rows, no UUIDs, no client names in the executive strip (drill-downs lead to permission-gated pages that render detail under their own rules). Revenue/collections visibility strictly behind `finance:read`; named workload stays under DEC-B30 (untouched); tenant scoping via the established `scopedFrom`/tenant-filter idioms (cross-tenant aggregation impossible by construction — every reader is tenant-resolved); comparison metadata carries no sensitive payloads; exports unchanged (Reports keeps its own gated path). No compensation-adjacent figures exist anywhere in the set (HR boundary respected).

## 24. Control Tower relationship (DEC-B35 + B-CT)

**One authoritative engine, multiple consumers — introduced without breaking anything:**

| Surface | 10.0D state | Target state |
|---|---|---|
| `lib/operations/kpi/` (new) | THE definitions + windows + currency policy | authoritative engine |
| Control Tower | **unchanged** (presentation + `ExecutiveKpis` intact; independent initially) | becomes a consumer in a later phase (its 6-KPI band reads the engine) |
| `cockpit.kpis.executive` | unchanged (feeds preserved CT render) | superseded by the engine's strip, then retired |
| Cockpit `/dashboard` | unchanged in 10.0D-0; 10.0D-4 renders the new strip | consumer |
| Tableau exécutif | unchanged (`getExecutiveIntelligence`) | 10.0D-5 (optional): its KPI row consumes the engine |
| `/reports` | unchanged (CT/BI) | consumer for headline figures; report tables stay on BI |

Duplication prevention: the engine **composes** `getAnalytics`/`getFinanceKpis`/`getIntelligenceDashboard`/10.0B readers for everything they already own and adds only the windowed event counts nothing owns; a structural test (10.0B idiom) will forbid the engine from re-implementing owned formulas (`invoiceTotals` import allowed; local re-derivation banned).

## 25. Legacy analytics quarantine (DEC-B33 — preserved)

`getExecutiveAnalytics` (`lib/analytics/executive-service.ts`) is consumed **only** by the `/analytics` page (`components/analytics/analytics-body.tsx:44`); cockpit exclusion is test-pinned (`tests/operations-cockpit.test.ts`, `tests/operations-cockpit-ui.test.ts`). Its formulas were verified to MATCH the bi basis (revenue12/collectionsTrend use the same issue_date/paid_at semantics) — the quarantine is architectural, not arithmetic. **The KPI engine will not import it.** Retirement path (future, separate approval): re-render `/analytics`'s executive panels over `getBusinessIntelligence` + the KPI engine, then delete the stack. Not part of 10.0D.

---

## 26. Decisions requiring approval (DEC-B35 … DEC-B46)

> Numbering note: DEC-B29–B34 (Phase 10.0) were ratified in the Phase-10.0B authorization and are recorded in `phase-10.0a-…md` §27 + commit history, but have not yet been entered into `docs/decision-register.md`; the register also contains a pre-existing collision (two blocks both using DEC-B25–B27 — driver/AI-era vs HR-era). **Recommend a register-hygiene pass as a separate docs commit.** 10.0D proposals continue the phase series as B35+.

| # | Decision | Recommendation | Trade-offs / evidence / impact |
|---|---|---|---|
| **DEC-B35** | One authoritative KPI engine? | **Yes** — `lib/operations/kpi/` composes owners; CT/cockpit/exec/reports become consumers over time | prevents 4-way drift (§4); impact: new lib dir only; CT untouched initially |
| **DEC-B36** | `analytics:read` gates the executive strip? | **Yes**, + `finance:read` for money (absent otherwise) | reuses the established supervision boundary (CT/Direction/reports/DEC-B30); no new permission |
| **DEC-B37** | Initial KPI set | **The 8+1 of §14** | small, decision-mapped, all evidence-backed; excluded items listed with reasons |
| **DEC-B38** | Windows in 10.0D | **today + month_to_date only** (prev-full-month as comparison basis) | each extra window multiplies definitional surface; impact: `windows.ts` helper only |
| **DEC-B39** | Tenant timezone resolution | **`organization.timezone`** (exists, default Africa/Dakar) via shared `todayInTimezone` lift; UTC forbidden for business days | zero schema change; today UTC≡Dakar so no number changes; codifies before it breaks |
| **DEC-B40** | Monetary KPIs per-currency? | **Always computed per-currency**; scalar render only when exactly one currency | schema is multi-currency-capable, aggregates are blind (§9); 10.0B pattern proven |
| **DEC-B41** | %-comparison when prior = 0/null | **direction "unknown", changePercent null** | never renders ∞/fabricated 100 % |
| **DEC-B42** | Snapshot trends | **Deferred** until snapshot history exists; flow trends allowed from real events | no fabrication; 10.0D-6 only with evidence |
| **DEC-B43** | « Dossiers actifs » definition | **`status ∈ {OPENED, IN_PROGRESS, DELIVERED}`** — i.e. canonical `isActiveStatus` (∉ CLOSED, CANCELLED) **minus DRAFT** *(alternative for ratification: full `isActiveStatus`, DRAFT included)* | today CANCELLED+DRAFT count as "active" in two shipped KPIs (§1.2 — a real correctness fix; numbers on /dashboard will change slightly); alignment target: `lib/files/status.ts` |
| **DEC-B44** | Dual revenue naming | **« Facturé » (invoice.issue_date) vs « Encaissé » (payment.paid_at)** as two distinct KPIs; the label « Revenu du mois » on payment sums is retired at 10.0D-4 | both facts are needed; one label for two numbers is the platform's worst current misleader |
| **DEC-B45** | Freshness label | **« Dernière actualisation : <timestamp> »** (existing 10.0C header) as the page-level label; per-KPI `freshness:"live-request"` internal | truthful; no "live/temps réel" language (DEC-B31 spirit) |
| **DEC-B46** | Data-quality behavior | **Exclude-invalid + basis counts + `partial` status; `unavailable` on dark/failed sources** (§21) | never false precision; never a crashed section |

## 27. Exact implementation files expected to change (10.0D-1 … D-4)

**New:** `lib/operations/kpi/types.ts` · `kpi/windows.ts` (tenant-tz day/MTD bounds; lifted `todayInTimezone` — either re-exported from collections or moved to a shared `lib/time/` with collections re-import) · `kpi/compose.ts` (pure: per-currency grouping, comparisons, basis) · `kpi/reader.ts` (`getOperationsKpis()`, cache()+allSettled, composes existing readers + the ≤5 new windowed counts) · `components/operations/executive-kpi-strip.tsx` (10.0D-4) · `tests/operations-kpi.test.ts` (+ structural no-re-derivation test).
**Modified:** `lib/operations/reader.ts` (wire `kpis` v2 alongside the retained `cockpit.kpis.executive`) · `components/operations/cockpit-sections.tsx` (render strip, 10.0D-4) · possibly `lib/collections/aging.ts` (export-only if `todayInTimezone` is lifted).
**Explicitly NOT changed:** Control Tower (component + service semantics), `app/dashboard/executive/*`, `/reports`, any migration/seed/role/RLS/nav.

## 28. Acceptance criteria (this audit) & recommended sequence

Audit acceptance: all mission sections present with file:line evidence ✅ · every candidate KPI classified ✅ · decisions enumerated with trade-offs ✅ · documentation-only ✅ · gates green before commit ✅.

**Recommended sequence (collapsed from the proposed 7):**
- **10.0D-1** — types + windows + currency core + `getOperationsKpis()` over *existing* readers (no new queries yet); structural tests.
- **10.0D-2** — the ≤5 windowed event readers (today/MTD; §7 timestamps; tenant-tz).
- **10.0D-3** — finance per-currency computation (facturé/encaissé/retard) + DEC-B44 renaming at the reader level.
- **10.0D-4** — cockpit executive strip (render + retire the « Revenu du mois » label on the finance card).
- **10.0D-5** *(optional, separate approval)* — Tableau exécutif KPI row consumes the engine.
- **10.0D-6** — **deferred indefinitely** (snapshot infra only with evidence).

**Final recommendation: GO for 10.0D-1 once DEC-B35…B46 are ratified.** The engine is small because the platform already owns almost every number — 10.0D's real product is the *contract* that stops the four semantic traps (§1) from ever reaching an executive's screen.
