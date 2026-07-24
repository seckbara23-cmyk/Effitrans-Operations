# Phase 10.0E-0 — Unified Operational Alert Center : Architecture Audit

**Date:** 2026-07-24 · **Type:** architecture & repository audit only — **no adapter, no /dashboard change, no /alerts route, no migration/table/permission/role/RLS/Realtime/polling/acknowledgement/notification change, no risk-engine alteration**
**Repo state audited:** commit `c60d14f` (post-10.0D-4, CI green)
**Mission:** unify existing operational warnings into one authoritative, permission-shaped alert layer — without a second risk engine, duplicated module logic, or permission bypass.

---

## 1. Executive summary

The 10.0A prediction holds and is now stronger: **the Unified Alert Center is mostly built.** The platform already has (a) a proven normalize/merge/dedupe engine (`lib/executive/compose.ts` — `normalizeSeverity` via ONE documented `SEVERITY_MAP`, `mergeExecutiveAlerts` cap 40, `countAlertsByLevel`), (b) a canonical unified shape (`ExecutiveAlert`, `lib/executive/types.ts:49`), (c) a shipped cockpit renderer (`CockpitAttentionPanel`, 10.0C — bounded, accessible, severity-labeled), (d) a Tier-1 producer pipeline (Command Center `mergeAttention` over road/ocean/air/customs), and (e) **THE single risk doctrine** (`lib/copilot/risk-engine.ts` — "SINGLE SOURCE OF TRUTH for risk scoring", per-dossier `reasons[]`/`actions[]`, `rankAttention` top-10, `riskKpis`) already excluding terminal dossiers since DEC-B43 (10.0D-1 construction guard, `lib/control-tower/service.ts:246–253`).

What 10.0E actually builds is therefore small and additive:
1. **A stable-code contract** (DEC-B34, approved but unimplemented): `OperationalAlert` = `ExecutiveAlert` + optional `code`/`entityType`/`entityId` — additive, existing consumers untouched (§5–6).
2. **A code-aware dedupe** (`code|entityType|entityId` when present; the legacy `origin|reference|reason` key as incremental-rollout fallback — the mission's "never dedupe solely by French text" fixed at last) (§7).
3. **Adapters** projecting the producers the merge does not yet ingest — risk-engine findings, finance-request pipeline, reconciliation exceptions, failed communications — plus code-stamping pass-through for the already-flowing Command Center alerts (§23).
4. **One composed reader** (`lib/operations/alerts/reader.ts`) in the exact KPI-engine idiom: per-adapter source-permission gates, `allSettled`, unavailable-vs-empty honesty, request-`cache()`.

Two genuine gaps surfaced (both honest deferrals, not blockers): the risk engine's `reasons[]` are **French display text with no machine-readable reason kinds** (the `REASON` table is module-private, `risk-engine.ts:59–71`) — so v1 risk alerts carry level-based codes (`operations.dossier.risk_critical`), per-reason codes deferred until the engine additively exposes kinds; and **no tenant-wide readers exist** for document expiry (`classifyExpiry` is per-document) or `process_blocker` aggregates (per-file/action reads only) — those adapters are 10.0E-2-later with new bounded read-only queries.

**Recommendation: GO for a compressed roadmap** — E-1 (contract + code-aware compose) → E-2 (initial adapters) → E-3 (rewire the existing `CockpitAttentionPanel` input) — with E-4 (/alerts workspace) and E-5 (persisted lifecycle) **deferred** pending real demand. DEC-B47…B58 await ratification (§27).

---

## 2. Existing alert inventory

Every producing source, with shape/owner/gate/destination/classification (paths verified; consumers current as of `c60d14f`):

| # | Source | Shape (fields) | Severity model | Tenant scope / gate | Destination | Consumers today | Classification |
|---|---|---|---|---|---|---|---|
| 1 | Command Center `UnifiedAlert` (`lib/logistics/compose.ts:32`; producers `reader.ts:54–99` — road overdue, POD requis, customs blocked/inspection/awaiting-payment, ocean/air top alert) | `{mode, severity, reference, clientName, reason, link, occurredAt?}` | `critical/warning/info` | tenant via readers; `transport:read` (+`customs:read` section) | ✅ link per alert | executive reader, 10.0C cockpit (`projectAttentionAlerts`) | **Authoritative as-is** (already normalized) — needs only code stamping |
| 2 | Shipping alerts (`lib/shipping/intelligence/alerts.ts:38`, 7 codes incl. `DELIVERY_OVERDUE`, `STALE_CARRIER_DATA`, `CUSTOMS_BLOCKED`) | `{code, severity, message}` | `info/warning/critical` | tenant; `transport:read` | none (attention queue adds link) | via #1 (top-1 per shipment) | **Reusable through adapter** — has codes TODAY; they are dropped by `UnifiedAlert` (10.0A finding, unchanged) |
| 3 | Air alerts (`lib/air/intelligence/alerts.ts:32`) | `{code, severity, message}` | idem | tenant; `transport:read` | none | via #1 | idem #2 |
| 4 | Risk engine findings (`lib/copilot/risk-engine.ts` — `rankAttention` → `AttentionRiskItem {fileId, fileNumber, clientName, department, level, score, primaryReason, priority, ageDays}` `:248–296`; `riskKpis` `:299`) | per-dossier level + French reasons/actions | `low/medium/high/critical` | tenant via CT pass; `analytics:read` (+finance inputs gated `finance:read` at construction, `ct/service.ts:290`) | fileId (→ `/files/{id}`) | CT `attentionQueue` table, `dossiers_intervention` KPI | **Authoritative as-is** (THE risk doctrine) — **missing stable reason identifier** (French text only) |
| 5 | CT `needsAttention` (`lib/control-tower/aggregate.ts:172` — blockers/waiting/priority/overdue-invoice) + `bottlenecks` (`:105`) | `AttentionItem {fileId, …, reason, daysWaiting, nextAction, priority}` | priority string, no level | tenant; `analytics:read` | fileId | CT table on /dashboard | **Duplicate** of #4's intent (pre-3.1B heuristic beside the risk queue) — do NOT adapt both; #4 wins (§3) |
| 6 | Analytics `buildAlerts` (`lib/analytics/executive.ts:69`) | `{level: RED/AMBER/GREEN, key, count}` | RED/AMBER/GREEN (already in `SEVERITY_MAP`) | tenant; `analytics:read` | none | `/analytics` page only (legacy stack) | **Legacy** (DEC-B33 boundary) — do not adapt; its facts (blocked ops, overdue) are owned elsewhere |
| 7 | Finance-request pipeline (`lib/operations/finance-requests.ts` — `getFinanceRequestQueue`: pendingReview / approvedNotDisbursed / evidenceMissing / evidenceToVerify + items w/ fileId/fileNumber/status/evidenceStatus/requestedAt) | typed counts + bounded items | none (statuses) | tenant; `finance:read` + `financeExecution` flags | `/finance` | KPI engine, cockpit finance card | **Reusable through adapter** (10.0B reader is the bounded source) |
| 8 | Reconciliation exceptions (`lib/finance/service.ts:287` — counts.pending/missingReference + `onlineIntents` FAILED/EXPIRED) | counts + rows | statuses | tenant; `finance:read` | `/finance/reconciliation` | cockpit finance card, KPI-adjacent | **Reusable through adapter** |
| 9 | Overdue receivables (`creances_retard` KPI path — `getFinanceQueue` + `overdueRowsAtTenantDay`, 10.0D-3) | per-currency amounts + count | n/a | tenant; `finance:read` | `/collections` | KPI strip | **Authoritative as-is** (KPI) — alert = threshold presence, same source |
| 10 | `process_blocker` rows (`structures-actions.ts:314` — 10 categories, severity column, OPEN/ACKNOWLEDGED) | per-file rows | own severity | tenant; engine flags; `process:blocker:manage` writes | fileId | per-file panels only — **no tenant-wide reader** (verified: all `.from("process_blocker")` sites are per-file/action) | **Reusable through adapter — requires new bounded reader**; flag-gated |
| 11 | Document expiry (`lib/documents/expiry.ts:25` — `classifyExpiry` → expired/expiring/valid/none) | per-document state | state enum | per-file reads; `document:read` | `/files/{id}/documents` | file document lists | **Reusable through adapter — requires new bounded reader** (no tenant-wide expired/expiring query exists — verified) |
| 12 | Failed communications (`lib/comms/service.ts:62` — `listCommunications({status:"FAILED"})`; rows carry status/retry_count/last_error/sent_at) | full rows | status | tenant; `communication:read` | `/communications` | comms hub | **Reusable through adapter** (a head-count/bounded variant is the perf-clean addition; `last_error` must be redacted, §24) |
| 13 | Messaging summary (`getMessagingDashboardSummary` — waitingEffitrans/urgentOpen) | counts | priority normal/urgent | tenant; `messaging:manage` | `/messages` | cockpit messaging card | **Reusable through adapter** (tenant-operational: urgent + waiting-us). `unreadStaffMessagingCount` = **personal — not suitable** for the tenant alert list (§12) |
| 14 | Deposit custody blockers (`lib/deposit/service.ts:79` — `blocker`, `ageHours`, `proofStatus`) | derived per row | none | tenant; `admin_service:manage`/`collections:manage` + flag | `/deposits` | deposits/courier pages | Reusable through adapter — **10.0E-2-later** (narrow audience) |
| 15 | KPI data-quality (`OperationsKpi.status partial/unavailable`, 10.0D) | typed statuses | n/a | per KPI gates | n/a | KPI strip | **Not suitable as operational alerts** — technical diagnostics; belongs in Administration surfaces (§4 platform/system) |
| 16 | GAINDE provider status (`resolveProviderConfig` → `unsupported`, honest) | config state | n/a | `customs:read` | `/customs/intelligence` | intelligence console | **Missing source data** for a "sync failure" alert — no sync exists; config state is already displayed honestly; not an alert |
| 17 | Messaging SLA / escalations / stale-dossier definitions | — | — | — | — | — | **Missing source data** (no first_response_at, no escalation concept, no staleness definition) — fabrication forbidden |

## 3. Existing normalize/merge engine & risk-engine relationship

**Engine (keep, extend additively — DEC-B47):** `normalizeSeverity(token)` via the ONE `SEVERITY_MAP` (`lib/executive/compose.ts:29–47` — logistics `critical/warning/info` → `critical/high/medium`; analytics `RED/AMBER/GREEN` → `critical/high/low`; unknown → `medium`, flagged by `isKnownSeverity`, never dropped/promoted); `mergeExecutiveAlerts(alerts, cap=40)` (`:60` — dedupe `origin|reference|reason`, order `LEVEL_RANK` then oldest-first, slice); `countAlertsByLevel` (`:83`). Consumers: executive reader (`reader.ts:219–231`), 10.0C cockpit (`lib/operations/compose.ts` `projectAttentionAlerts` + reuse of merge/count in `lib/operations/reader.ts`). Degradation: producers run under `allSettled`; a missing module contributes nothing. **Verdict: it becomes the unified engine's core — via a thin Operations wrapper** (`lib/operations/alerts/`), the exact pattern 10.0C already established; `mergeExecutiveAlerts` itself is NOT modified (the executive dashboard keeps its proven path) — the wrapper adds the code-aware dedupe + richer contract and both surfaces consume the same producers.

**Risk engine (consume, never fork):** categories = missing-docs (tiered), SLA warning/critical, customs inspection (plain/long >5 j), awaiting-POD, transit-over-SLA, finance overdue (plain/long >30 j) (`risk-engine.ts:41–52`). Emits BOTH per-dossier findings (`RiskAssessment.reasons[]/actions[]`; ranked top-10 `AttentionRiskItem` with `primaryReason`) AND aggregates (`riskKpis.critical/high`). Severity is authoritative (score→level `:83`). Terminal dossiers are excluded at row construction (DEC-B43, `ct/service.ts:246–253`) — the alert center inherits this for free. **Boundary (DEC-B57): the risk engine computes attention semantics; the alert center normalizes/dedupes/prioritizes/routes its findings. `dossiers_intervention` (KPI) = `riskKpis.critical+high`; alert items = `attentionQueue` — same single `getControlTower` pass (request-`cache()`d), so KPI and alerts cannot diverge.** One honest cap: `attentionQueue` is top-10 (`rankAttention` limit) while the KPI counts all — the UI labels this (« N dossiers, 10 premiers affichés »); raising the limit is an additive CT-reader option, not an engine change (flagged in DEC-B57). CT's older `needsAttention` heuristic (#5) is NOT adapted — one attention doctrine only.

## 4. Domain-source catalog (candidates vs evidence)

| Candidate | Verdict |
|---|---|
| **Operations:** blocked dossier / missing docs / high-risk / awaiting-POD / overdue step / finance-overdue-on-dossier | ✅ all six ARE the risk engine's categories — one adapter covers them (level-coded v1) |
| unassigned active dossier | Derivable (assigned_to null) — E-2-later, needs a bounded reader + destination `/files` (no unassigned filter → general) |
| stale dossier / awaiting-external-response / terminal-still-active | **Missing source data / not defined** — deferred (terminal-still-active is impossible post-DEC-B43 by definition) |
| **Customs:** inspection pending, declaration blocked, awaiting payment | ✅ already emitted as `UnifiedAlert`s (`logistics/reader.ts:96–99`) |
| long-running clearance / release data missing | Derivable from `listDeclarations` dates — E-2-later |
| GAINDE sync failure | **Missing source data** (no sync exists) |
| **Transport:** delayed delivery, POD owed | ✅ in `UnifiedAlert`s (road) |
| delayed pickup / vehicle-driver missing / record blocked | Derivable (`pickup_planned` vs now; null driver) — E-2-later |
| stale position | ✅ via freshness codes (ocean/air) ; road tracking flag-gated |
| **Maritime/Air:** vessel/flight delay, stale tracking, arrival overdue, low confidence | ✅ shipping/air alert codes exist (#2/#3) |
| missing container/AWB data | Partially (docintel indicators) — E-2-later |
| **Finance:** pending review / approved-not-disbursed / evidence owed | ✅ `getFinanceRequestQueue` |
| pending **too long** | **Missing threshold** — no ratified duration; v1 emits presence, not age-based severity (age shown, not scored) |
| reconciliation exception / payment reversal (FAILED-EXPIRED intents, missing reference) | ✅ `getReconciliation` |
| overdue receivable | ✅ `creances_retard` source |
| invoice missing data / unsupported currency | = KPI `basis.excluded` — **system diagnostics**, not operational alerts (§ below) |
| **Messaging:** failed notification (comms FAILED) | ✅ `listCommunications` |
| customer conversation waiting on us / urgent | ✅ `getMessagingDashboardSummary` (tenant-operational) |
| high-priority unread / escalation / SLA | unread = personal; escalation/SLA = **missing data** |
| **Documents:** expired / expiring / missing required / rejected | classify logic exists; **tenant-wide reader missing** → E-2-later (bounded read-only query over `document.expiry_date` + missing-required via existing doc summaries) |
| **Platform/system:** dark engine, absent migration, provider unconfigured, partial KPI | **Separated out** — technical diagnostics for Administration (`/platform/health`, settings), NOT the operational alert list. The alert center reports them only as *source availability* chips (§16), never as alert items |

## 5. Proposed alert contract (grounded in `ExecutiveAlert`)

```ts
// lib/operations/alerts/types.ts (PURE) — ADDITIVE extension of the proven shape
import type { ExecutiveAlert } from "@/lib/executive/types";

export type AlertDomain =
  | "operations" | "customs" | "transport" | "shipping" | "air"
  | "finance" | "documents" | "messaging" | "system";

export type OperationalAlert = ExecutiveAlert & {
  /** DEC-B34: stable machine code (domain.entity.condition). Optional during rollout. */
  code?: string;
  domain: AlertDomain;              // normalized domain (origin stays the raw module token)
  entityType?: "dossier" | "shipment" | "declaration" | "transport" | "finance_request"
             | "payment" | "invoice" | "conversation" | "communication" | "document";
  entityId?: string;                // internal id for dedupe/drill-down — NEVER rendered (§24)
};
// Inherited from ExecutiveAlert: level (critical/high/medium/low), origin, reference
// (display ref e.g. file number), clientName, reason (French), href, occurredAt,
// sourceSeverity (audit trail). Availability is carried by the SET, not the item:
export type OperationalAlertSet = {
  generatedAt: string;
  alerts: OperationalAlert[];                    // merged, deduped, capped
  counts: Record<"critical" | "high" | "medium" | "low", number>;
  sources: { key: string; status: "ok" | "unavailable" | "omitted" }[];  // §16 honesty
};
```
No UI styling in the type; `status: "resolved"` from the mission's illustration is deliberately absent — computed alerts have no resolved state (§9); "unavailable" is a *source* property, not an alert property. The executive dashboard can consume `OperationalAlert[]` unchanged (structural supertype).

## 6. Stable code convention (DEC-B51)

Format: **`domain.entity.condition`** — lowercase, dot-separated, snake_case segments; stable across French label changes; NEVER contains tenant ids, dossier numbers, names, or translated text; semantic change ⇒ new code (old one retired, never reused). Ownership: **adapter-owned typed unions per domain** (one `codes` const per adapter file, composed into a union in `types.ts`) — module ownership in spirit without churning shipped source modules; where a source already has codes (shipping/air `*_ALERT_CODES`), the adapter maps 1:1 (e.g. `SIGNIFICANT_ETA_DELAY` → `shipping.eta.delayed`, `STALE_CARRIER_DATA` → `shipping.tracking.stale`). Initial vocabulary (illustrative, fixed at E-1):
`operations.dossier.risk_critical` / `operations.dossier.risk_high` (level-based v1 — per-reason codes deferred until the risk engine exposes reason kinds additively) · `customs.declaration.blocked` / `customs.inspection.pending` / `customs.payment.awaited` · `transport.delivery.overdue` / `transport.pod.owed` · `shipping.eta.delayed` / `shipping.tracking.stale` / `air.eta.delayed` / `air.tracking.stale` · `finance.request.pending_review` / `finance.request.approved_not_disbursed` / `finance.disbursement.evidence_owed` / `finance.reconciliation.pending` / `finance.reconciliation.missing_reference` / `finance.intent.failed` / `finance.receivable.overdue` · `messaging.conversation.awaiting_reply` / `messaging.conversation.urgent` · `messaging.communication.failed` · `documents.document.expired` / `documents.document.expiring` (E-2-later).

## 7. Deduplication model (DEC-B52)

Key: **`code|entityType|entityId` when all three are present; legacy `origin|reference|reason` otherwise** (incremental rollout; never French-text-only once a code exists). Two modules CAN emit the same real-world fact (e.g. road overdue via Command Center AND transit-over-SLA via risk engine — different codes, same dossier): those are **distinct codes and deliberately survive** (different lenses); true duplicates share a code. On collision: **highest severity wins** the surviving item; **earliest `occurredAt`** is kept (matches the engine's oldest-first urgency doctrine); the survivor's `source` is the higher-severity producer; descriptions are NOT merged (keep the survivor's reason — merging French sentences fabricates copy). One alert MAY summarize multiple records only when the producer already aggregates (e.g. reconciliation counts) — the adapter then emits a count-style alert with no entityId (deduped by code alone).

## 8. Severity normalization (DEC-B50)

**The 4-level executive model (`critical/high/medium/low`) is the normalized severity** — it already exists, is documented, and both source vocabularies map into it. Additions to the documented mapping (adapter-level, `SEVERITY_MAP` untouched): risk levels `critical→critical`, `high→high` (medium/low findings are NOT alerts — decision urgency, not drama); `process_blocker.severity` (when adapted) maps by its own column; finance-request presence → `high` (pendingReview / evidence owed) and `medium` (approved-not-disbursed — authorized, awaiting execution); reconciliation missing-reference/failed-intent → `high`, pending-verification → `medium`; comms FAILED → `medium` (operational nuisance, not a shipment risk); messaging urgent → `high`, waiting-us → `medium`; documents expired → `high`, expiring → `medium`. Explicitly rejected: every-overdue-is-critical inflation.

## 9. Alert lifecycle (DEC-B48)

Today nothing stores alert state — all attention surfaces are computed per request. **10.0E: computed-only** — an alert is `active` while its source condition holds and disappears when resolved at the source (resolution derived, never stored). Classification: computed active/derived resolution = **Required for 10.0E**; acknowledge / dismiss / assign / history = **Deferred, requires schema, not recommended** without a real business requirement (none in evidence; would also create a second state the source modules don't know about).

## 10–12. Permission model, tenant/RLS, personal-vs-tenant

**Permissions (DEC-B49): no new permission; no blanket gate.** Each adapter is gated by its SOURCE permission before any read (the KPI-engine idiom): risk findings → `analytics:read` (their CT pass requires it; finance risk inputs already degrade without `finance:read` at construction); Command Center pass-through → `transport:read` (+`customs:read` for the customs card, enforced inside); finance adapters → `finance:read` (+ flags for the request family); comms → `communication:read`; messaging summary → `messaging:manage`. Missing permission ⇒ adapter **omitted** (absent ≠ zero ≠ unavailable). Executives see a broader set purely because they hold more permissions — never via bypass.

**Tenant/RLS:** every consumed reader is already tenant-scoped (CT/logistics/finance/comms all tenant-filter their admin reads; the tenant-scope guard covers registry tables). New bounded queries needed later (document expiry, process_blocker, unassigned) must use `scopedFrom`/explicit tenant filters + the structural-test expectations of 10.0D-2 (test pins `.eq("tenant_id"`). No platform-level data enters the tenant alert list.

**Personal vs tenant (DEC-B56): separate composition, one type.** The alert center carries TENANT-OPERATIONAL alerts only. Personal signals (my unread, my tasks) stay where they live today (cockpit summary band, messaging card, /my-work) — `unreadStaffMessagingCount` is RLS-per-viewer and must never appear as a tenant-wide executive alert. Executive view = the same tenant list (optionally severity-filtered), not a third pipeline.

## 13–15. Destinations, ordering, limits

**Destinations** (D-0 §16 route-filter audit reused): exact — `/files?status=…` (limited), `/collections` (rich), `/customs/intelligence?status=…`, `/transport?status=…`, `/finance?status=…`; general — `/finance/reconciliation`, `/messages`, `/communications`, `/deposits`, `/files/{id}` (per-dossier alerts — the best destination of all). No credible destination ⇒ **no href** (precedent: `dossiers_intervention`). No fabricated query params.

**Ordering (deterministic, explainable):** severity rank (critical→low) → oldest `occurredAt` first within a level (existing engine rule) → domain stability (fixed domain order as final tie-break: operations, customs, transport, shipping, air, finance, documents, messaging). No opaque scoring — the risk engine already did the scoring where scoring belongs.

**Limits (DEC-B55):** /dashboard keeps the shipped pattern — **8 primary alerts** (`PRIMARY_CAP`, 10.0C) + level counts + « N autres » line; engine-level cap 40 (existing). Grouping on the cockpit stays flat-with-counts (scannable); a grouped-by-domain view (Attention immédiate / Opérations / Transit / Finance / Documents / Communications) belongs to the future full page (E-4, deferred — DEC-B54). Executive dashboard keeps its own cap-40 list.

## 16–17. Data quality, freshness

Source failure / dark flag / absent migration ⇒ the adapter yields `status:"unavailable"` in `sources[]` — **never "0 alerts"**; missing permission ⇒ `omitted`; all sources ok with nothing found ⇒ a truthful « Aucune alerte opérationnelle » (already the 10.0C empty state). Malformed/duplicate rows are dropped by dedupe; unknown severities pass through `normalizeSeverity`'s medium+flag rule. Timestamps: alerts carry the producer's event timestamp where one exists (`occurredAt` — e.g. `deliveryPlanned`); condition-evaluations (risk, reconciliation) have none and sort after dated peers within their level (existing engine behavior). Freshness = request-time computation under the 10.0C header's « Dernière actualisation » label (DEC-B45 reuse). **No Realtime (DEC-B31), no polling.**

## 18–19. Notification & KPI relationships

**Alert ≠ notification.** An operational alert is a *condition*; a notification is a *delivered message* (`notification`/`client_notification` + comms). Failed *communications* are a legitimate alert *subject* (#12); the alert center itself delivers nothing. Future alert→notification triggers are out of 10.0E core (separate approval). **KPI:** `dossiers_intervention` (count) and the risk alerts (items) consume the SAME `getControlTower` pass — supported today, request-`cache()`d, no derivation from rendered UI in either direction (§3).

## 20. Current UI overlap (/dashboard)

| Surface | Today | 10.0E disposition |
|---|---|---|
| `CockpitAttentionPanel` (10.0C) | renders merged `cc.attention` only | **Becomes the unified renderer** — input switches to the composed alert reader (E-3); component/UX unchanged |
| Cockpit summary band urgent chips | counts | unchanged (personal/summary signals) |
| CT `attentionQueue` (risk top-10 table) | in « Analyse de direction » | **Remains in 10.0E** (management detail w/ scores/ages); candidate for a D-4-style suppression prop in a later phase once the unified panel proves sufficient — flagged, not done |
| CT `needsAttention` + `delayed` + `bottlenecks` tables | idem | remain (lifecycle/SLA detail the alert list doesn't replicate) |
| Executive dashboard alerts | own merge (cap 40) | unchanged; can adopt code-stamped items later at zero cost (supertype) |

Result: one *alert list* on the cockpit (the panel), with CT keeping its management-analysis tables — no duplicate alert panels.

## 21–22. AI readiness & performance

Stable codes + normalized severity + safe French reasons make `OperationalAlertSet` the natural grounding for the future Operations Copilot ("What needs attention?" ⇒ serialize the set; "Why is this dossier critical?" ⇒ risk `reasons[]` already exist) — permission-shaped by construction, so AI grounding inherits the viewer's boundaries. No AI in 10.0E.

Performance: E-2 adds **zero heavy reads** — risk findings and Command Center alerts ride the already-`cache()`d `getControlTower`/`getCommandCenter`; finance adapters reuse `getFinanceRequestQueue`/`getReconciliation` (the latter cache()-backed via `getFinanceQueue`); the only new query is a bounded FAILED-comms count/top-N. Pure normalization + one merge pass over ≤~80 items. No materialization justified.

## 23. Initial adapter set (DEC-B53)

**10.0E-2 (ships first — authoritative data + credible destinations):**
1. Risk-engine findings — `attentionQueue` → `operations.dossier.risk_critical/high` (href `/files/{id}`)
2. Command Center pass-through — existing `UnifiedAlert`s code-stamped (customs blocked/inspection/payment, road overdue/POD, ocean/air delayed+stale)
3. Finance requests — pending review / approved-not-disbursed / evidence owed (counts + top items; href `/finance`)
4. Reconciliation — pending / missing-reference / failed intents (count-style; href `/finance/reconciliation`)
5. Overdue receivables — presence alert from the `creances_retard` source (href `/collections`)
6. Failed communications — bounded count/top-N (href `/communications`; `last_error` NEVER copied into the alert)
7. Messaging — urgent + waiting-us (count-style; href `/messages`)

**10.0E-2-later (need a new bounded reader):** document expired/expiring; missing-required documents; `process_blocker` aggregate (flag-gated); unassigned active dossiers; delayed pickups; deposit custody. **Deferred — missing data:** GAINDE sync, messaging SLA/escalations, stale-dossier, ETA-confidence thresholds beyond existing codes.

## 24. Security & privacy

Cross-tenant: adapters consume tenant-resolved readers only; new queries follow the 10.0D-2 tenant-filter pins. Finance amounts: money NEVER appears in alert text (count-style alerts say « N facture(s) en retard », amounts stay on the KPI/collections pages behind `finance:read`). `entityId` is dedupe/drill-down metadata — never rendered (test-pinned); display uses `reference` (file number) exactly as today's panel. Personal signals excluded (§12). `last_error`/provider errors redacted to a generic reason. Codes are static adapter constants — no interpolation of tenant data into codes (injection-proof by construction). hrefs come from a fixed audited table, never string-built from source data beyond `/files/{id}` with a UUID path segment (existing pattern). AI consumption inherits the permission-shaped set only.

## 25. Testing strategy (E-1/E-2/E-3)

Pure: code-aware dedupe (code wins over text; severity/timestamp merge rules; legacy fallback), ordering determinism + tie-breaks, severity additions, count-style alerts, set-level source statuses. Structural (house `code()` idiom): adapters import their source readers only (no `.from(` business tables except the documented new bounded readers with tenant pins); no second risk scoring (`assessRisk`/`RISK_POINTS` never imported into alert code paths — only its OUTPUT via CT); no `getExecutiveAnalytics`; no mutations/`"use server"`/`revalidatePath`; no Realtime/`setInterval`; no new permission strings; codes match `^[a-z]+(\.[a-z_]+){2}$` and are unique; every href in the fixed table resolves to an existing route file; `entityId` never rendered by the panel; personal `unreadStaffMessagingCount` absent from the alert reader; terminal-dossier exclusion pinned via the existing DEC-B43 tests; `mergeExecutiveAlerts`/executive reader untouched (regression pin).

---

## 26. Exact implementation files (E-1 … E-3)

**New:** `lib/operations/alerts/types.ts` (contract + code unions) · `alerts/compose.ts` (pure: code-aware dedupe, ordering, set assembly — reuses `normalizeSeverity`, `LEVEL_RANK` semantics) · `alerts/adapters.ts` (or per-domain files: risk, command-center, finance, reconciliation, receivables, comms, messaging) · `alerts/reader.ts` (`getOperationalAlerts()` — requireUser, per-adapter gates, allSettled, cache()) · `tests/operations-alerts.test.ts`.
**Modified (E-3 only):** `components/operations/cockpit-sections.tsx` + `cockpit-attention-panel.tsx` (input type widens to `OperationalAlert` — display unchanged, optional code chip NOT rendered) · possibly `lib/operations/reader.ts` (alerts section fed by the new reader) · `lib/comms/service.ts` (additive bounded FAILED count, if chosen over reusing `listCommunications`).
**Explicitly untouched:** `lib/executive/*`, `lib/copilot/risk-engine.ts`, all source modules' semantics, /dashboard route, navigation, migrations, seed, RLS.

## 27. Decisions requiring approval (DEC-B47 … DEC-B58)

| # | Decision | Recommendation (trade-offs · evidence · impact) |
|---|---|---|
| **B47** | Existing engine authoritative? | **Yes** — executive compose stays the core; a thin `lib/operations/alerts` wrapper adds code-aware dedupe + contract. Replacing a proven engine buys nothing; two engines would drift. Impact: new lib dir only. |
| **B48** | Computed or persisted? | **Computed-only**; ack/dismiss/assign deferred (schema + a second state source modules don't know). |
| **B49** | New permission? | **No** — per-adapter source permissions; missing ⇒ omitted. The center must not out-see its viewer. |
| **B50** | Severity model | **The existing 4-level executive model** + documented adapter mappings (§8); no overdue→critical inflation. |
| **B51** | Code convention | **`domain.entity.condition`**, adapter-owned typed unions; 1:1 mapping of existing shipping/air codes; level-based risk codes v1 (per-reason codes need additive engine reason-kinds — separate future approval). |
| **B52** | Dedupe key | **code+entityType+entityId**, legacy origin\|reference\|reason fallback; highest severity, earliest timestamp, no description merging. |
| **B53** | Initial adapters | **The 7 of §23**; later/deferred lists as catalogued. |
| **B54** | /alerts route now? | **No** — cockpit panel + counts suffice; E-4 only with demonstrated need (no new route in 10.0E). |
| **B55** | /dashboard volume | **8 primary + level counts + « N autres »** (shipped 10.0C pattern); engine cap 40. |
| **B56** | Personal vs tenant | **Separate composition** — tenant-operational only in the center; personal signals stay in their existing surfaces. |
| **B57** | Risk-engine sharing | KPI = `riskKpis` counts; alerts = `attentionQueue` items; **same cache()d CT pass**. Top-10 cap labeled honestly; raising it = additive CT option needing its own approval. |
| **B58** | Unavailable sources | `sources[]` statuses (`ok/unavailable/omitted`) surfaced as a quiet chip — **never « 0 alertes »** for a dark source. |

## 28–30. Acceptance, sequence, recommendation

**Audit acceptance:** inventory complete with classifications ✅ · engine/risk boundary defined ✅ · contract/codes/dedupe/severity specified ✅ · lifecycle/permissions/tenant/personal-tenant resolved ✅ · destinations/ordering/limits/data-quality/freshness defined ✅ · notification/KPI/UI/AI/performance covered ✅ · initial adapters + deferrals recommended ✅ · security threat model + testing strategy ✅ · documentation-only ✅.

**Recommended sequence (compressed — the engine exists):**
- **10.0E-1** — contract + code unions + code-aware compose (pure) + structural tests.
- **10.0E-2** — the 7 initial adapters + `getOperationalAlerts()` reader.
- **10.0E-3** — rewire `CockpitAttentionPanel` input + source-status chip.
- **10.0E-4** (deferred) — full /alerts workspace, only with real demand.
- **10.0E-5** (deferred) — persisted lifecycle, only with evidence requiring persistence.

**Final recommendation: GO for 10.0E-1 once DEC-B47…B58 are ratified.** The alert center is the cheapest phase of the 10.0 arc: the engine, the renderer, the risk doctrine and most producers already exist — 10.0E's product is the *stable-code contract and the adapters that finally let every warning the platform already computes reach one honest, permission-shaped list.
