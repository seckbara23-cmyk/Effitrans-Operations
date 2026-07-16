# Executive Intelligence Dashboard — Architecture Audit & Reuse Analysis (Phase 7.7)

An honest accounting of what already existed, what was reused, what had to be new, and what could
not be sourced at all.

## The audit's headline finding

**An executive dashboard already existed.** `/dashboard/executive` ("Tableau exécutif") shipped in
Phase 1.13B, sits in the *frozen* five-section sidebar under Management, and was gated on
`analytics:read`. It rendered revenue + control-tower KPIs — but it **predates** Customs
Intelligence (7.1), Shipping (7.2), Air Cargo (7.3), Document Intelligence (7.4), the Portal depth
(7.5) and the Copilots (7.6).

So 7.7 is an **upgrade in place**, not a new screen: same route, same frozen nav entry, now
composing the 7.1–7.6 modules onto the original base. This satisfies "no duplicated screens" and
required no sidebar change (which is contractually frozen and asserted verbatim in
`tests/journeys.test.ts`).

## Reused AS-IS (zero change to the module)

| Executive need | Authoritative existing reader | Gate |
|---|---|---|
| Active dossiers, delivered/month, needs-attention | `getControlTower()` | `analytics:read` |
| Avg customs / delivery / transport days, time-to-invoice, time-to-payment | `getControlTower().avgTimes` + `.kpis` | `analytics:read` |
| SLA by department, bottlenecks, risk queue | `getControlTower()` | `analytics:read` |
| Revenue (month/YTD/collected/avg invoice), outstanding, receivables aging, active clients, top overdue clients, client table | `getBusinessIntelligence()` | `analytics:read` (+`finance:read`) |
| **Portal adoption** (users, active clients, shared docs, downloads, invoice views) | `getAnalytics().portal` → `computePortal()` | `analytics:read` |
| Road / Ocean / Air / Customs module cards, headline KPIs, attention queue, upcoming movements | `getCommandCenter()` (7.3C) | `transport:read` |
| Shipping KPIs · Air KPIs · Customs KPIs | reached **through** `getCommandCenter()`, which already composes `getShippingDashboard` / `getAirDashboard` / `getIntelligenceDashboard` | — |
| OCR queue, failures, conflicts, backlog | `getDocIntelDashboard()` | `document:read` |
| AI usage: requests, answered, fallbacks, latency, tokens, providers | `getCopilotUsageSummary()` | `audit:read:all` |
| AI provider availability | `getCopilotConfig()` (config only — **no provider call**) | — |
| Map rendering | `ShipmentMapLoader` / `shipment-map` (Leaflet, lazy) | — |
| Map projection contract, freshness, confidence, source | `ShipmentMapProjection`, `classifyFreshness()`, `TrackingSource`/`TrackingConfidence` | — |
| Alert severities | `AttentionSeverity` (critical/warning/info), `AlertLevel` (RED/AMBER/GREEN) | — |
| Model call | `runCopilotDetailed()` → `lib/ai` (**untouched**) | — |
| Budgeting | `lib/copilot/budget` (`capSerialized`) — the shared primitive from 7.6C | — |
| Rate limiting | `lib/copilot/rate-limit` (`checkAuditRateLimit`) — shared from 7.6C | — |

**No duplicated logic:** the executive reader runs no lifecycle, risk, SLA, or finance calculation
of its own, queries **no table directly**, and holds no Supabase client (enforced by test).

## Genuinely NEW — and why nothing could be reused

| New | Why |
|---|---|
| `lib/executive/reader.ts` | The composition point. Calls the readers above under `Promise.allSettled`, projects their output, degrades by section. Request-cached (`cache()`), so one render reads each module once. |
| `lib/executive/compose.ts` | Pure: severity **normalization**, alert merge/rank, timeline merge, map adapter, KPI formatting. |
| `lib/executive/types.ts` / `links.ts` | The executive projection + drill-down targets. |
| `lib/executive/readers/portal-ops.ts` | **The one real data gap.** No reader answers "how many customer notifications did this tenant deliver / are unread?" — `listClientNotifications` is customer-scoped by portal RLS. Two `head:true` COUNTs, nothing else. Portal *adoption* is NOT recomputed — `getAnalytics().portal` is authoritative and reused. |
| `lib/executive/readers/fleet-map.ts` | No aggregate multi-shipment map existed (`buildShipmentMapProjection` is per-shipment). Reuses `classifyFreshness` + the tracking vocabulary; adds only the bounded query + latest-per-shipment pick. |
| `lib/executive/readers/timeline.ts` | No unified event store exists (ocean/air/road/customs/docs/finance each keep their own rows). Bounded read per origin + pure merge. **No event is written.** |
| `lib/executive/copilot/*` | Third copilot sibling. Context = the already-composed snapshot (no extra query). |

## Severity: normalized, never invented

The brief asked for Critical/High/Medium/Low **and** "never invent alert severity". Two vocabularies
already exist, so the executive layer maps each engine's own token through ONE fixed table
(`compose.ts SEVERITY_MAP`) and never scores an alert itself:

| Source engine | Token | → Executive |
|---|---|---|
| `lib/logistics/compose` (Command Center, shipping/air queues) | `critical` | Critical |
| | `warning` | High |
| | `info` | Medium |
| `lib/analytics/executive` | `RED` | Critical |
| | `AMBER` | High |
| | `GREEN` | Low |

Each alert carries `sourceSeverity` (the original token) so the normalization is auditable. An
unknown token becomes `medium` — neither silently dropped nor promoted to critical.

## Permission decision

`executive:dashboard:read` is a **real narrowing**, not a synonym for `analytics:read`:

| | analytics:read (5 roles) | executive:dashboard:read (3 roles) |
|---|---|---|
| SYSTEM_ADMIN | ✅ | ✅ (platform administrator) |
| CEO | ✅ | ✅ (Direction générale) |
| OPS_SUPERVISOR | ✅ | ✅ (genericName `MANAGER` ≈ COO) |
| ACCOUNT_MANAGER | ✅ | ❌ — keeps /reports + Direction |
| FINANCE_OFFICER | ✅ | ❌ — keeps /reports + Direction |

**There is no COO / Managing Director / Executive Director role in this platform** — the tenant
registry has 23 roles and only `CEO` is executive-tier. Rather than invent three roles (which would
change role provisioning for every tenant), the permission was granted to the executive/management
tier that exists. Creating those roles remains an open option.

Executives inherit **no** operational update capability: the permission grants read access to the
dashboard only, and every module reader still enforces its own read permission underneath.

## What could NOT be sourced (reported honestly, never faked)

| Brief item | Status | Why |
|---|---|---|
| **ETA accuracy** | `null` | No promised-vs-actual ETA history is kept anywhere. Reported "NON MESURÉE"; the prompt forbids estimating it. |
| **Missing required documents (tenant-wide)** | `null` | Only per-file readers exist (`getPortalTracking`, control-tower's own pass). No global reader; not recomputed here. |
| **Warehouse map markers** | omitted | No warehouse table exists. |
| **Customs office map markers** | omitted | No customs-office table with coordinates exists. |
| **"Growing delays"** | retitled | No period-over-period history ⇒ the card reports measured **levels** and its title says so ("Délais opérationnels mesurés"). Asserting growth would be a fabricated trend. |
| **Customer satisfaction indicators** | omitted | The portal `Satisfaction` component is UI-only with no persistence — there is no score to report. |

## Direction of dependency

The dashboard depends on the modules; **no module imports `@/lib/executive`** — asserted by test
across the ten reader modules it composes.
