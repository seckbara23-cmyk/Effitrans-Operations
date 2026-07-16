# Executive Intelligence Dashboard — Architecture (Phase 7.7)

## Composition chain (mandatory)

```
/dashboard/executive           (server-rendered page — owns NO data)
        ↓
lib/executive/reader.ts        getExecutiveIntelligence()  [executive:dashboard:read, cache()]
        ↓  Promise.allSettled — degrade by section
├── getControlTower(perms)        [analytics:read]   ops · SLA · avg times · risk
├── getBusinessIntelligence()     [analytics:read]   revenue · aging · clients
├── getAnalytics(canFinance)      [analytics:read]   portal adoption KPIs
├── getCommandCenter()            [transport:read]   road · ocean · air · customs · attention
├── getDocIntelDashboard()        [document:read]    OCR queue · conflicts
├── getCopilotUsageSummary()      [audit:read:all]   AI usage · latency · tokens
├── readNotificationKpis()        [executive:…]      the ONE documented gap
├── readFleetMap()                [executive:…]      aggregate map (reuses tracking model)
└── readExecutiveTimeline()       [executive:…]      merged chronology (no event store)
        ↓
lib/executive/compose.ts       PURE: normalize · merge · rank · format · map-adapt
```

**No module knows the dashboard exists.** The dependency points one way — asserted by test.

## Read-only

No form, no server action, no mutation, no provider control, no shipment write, no AI write. The
page's only write is the append-only audit row recording that it was *viewed*.

## Degrade by section (Missing ≠ Negative)

Every underlying reader self-authorizes. They run under `Promise.allSettled`, so a reader the
executive cannot read (or that fails) marks its section `unavailable`. The UI then renders
"section non incluse" — **never a confident zero**. Concretely:

- no `finance:read` → the Financial row is **withheld**, not shown as 0 revenue;
- no `transport:read` → no operations cards and no fleet map;
- no `audit:read:all` → no AI row;
- a `null` KPI renders as `—`, never `0` (enforced by test).

## Performance

- **Bounded**: every reader is capped. The fleet map issues ONE newest-first, indexed query per
  mode capped at `EVENT_SCAN` (400) rows and picks the latest-per-shipment in memory — cost is
  independent of history size. The timeline reads `PER_ORIGIN` (25) rows per origin.
- **Never a full tracking scan** — the phase's hard rule, enforced structurally by test.
- **No N+1**: dossier labels resolve through ONE batched `in()` lookup per reader.
- **Concurrent**: all nine readers run in parallel.
- **Request-cached**: `getExecutiveIntelligence` is `cache()`-wrapped, so the page and the AI panel
  share one snapshot per request. `getAnalytics` is independently `cache()`-wrapped upstream.
- **No provider call**: AI availability is configuration state (`getCopilotConfig`), never a probe.
  The model is called only when a user explicitly asks the executive copilot.

## Aggregate map

Reuses the existing projection engine end to end. `toShipmentProjection()` (pure) adapts the
executive markers to `ShipmentMapProjection`, which the existing lazy Leaflet renderer
(`ShipmentMapLoader`) draws. Status, **freshness**, **confidence** and **source** ride through from
the tracking event row unchanged — `classifyFreshness()` is the same engine, with the same
per-source thresholds, the shipping and air maps use.

The one lossy step is cosmetic and deliberate: the shared renderer's marker vocabulary is
`origin|destination|port|current|milestone`, so movers (ship/aircraft/road) map to `current` and
places (port/airport) to `port`; the executive kind survives as an emoji prefix in the label.

## Executive AI

The third copilot sibling — same provider chain, untouched:

```
ExecutiveCopilotPanel → /api/executive/copilot → getExecutiveIntelligence() (cached)
  → deterministic cards → runCopilotDetailed() → lib/ai → configured provider
```

`lib/ai` and `generateAI()` are never imported by the executive layer. Ten deterministic card kinds
(Revenue Risk, Operational Bottleneck, Customs Congestion, Late Deliveries, High-Risk Customers,
Document Backlog, Cash Collection Risk, Capacity Warning, Measured Delays, Provider Availability)
are computed with **no model**, and are the provider-down fallback.

## Audit

Access only, never metrics:

- `executive.dashboard.viewed` — sections available/unavailable, alert counts;
- `executive.dashboard.exported` — reserved for export;
- `executive.copilot.query` — provider, model, duration, tokens, outcome.

No executive metric is stored: figures are derived on read from the authoritative modules.

## Drill-down

Every KPI, module card, alert and timeline entry links to the workspace that **owns** the number.
The dashboard creates no screen of its own. Targets live in `lib/executive/links.ts` and every one
is asserted to resolve to a real page.

| Executive figure | Owning workspace |
|---|---|
| Shipping KPIs | `/shipping` |
| Air KPIs | `/air` |
| Road / operations | `/departments/transport` |
| Customs KPIs | `/customs/intelligence` |
| Financial | `/departments/finance` |
| Customers | `/clients` |
| Documents | `/departments/documentation` (no global Doc-Intelligence workspace exists — it is per-document) |
| AI | `/settings/ai` |
