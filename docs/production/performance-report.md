# Performance Report — Phase 8.0A

**Honesty first:** live p50/p95 could not be measured in this audit — production sits behind the protection wall (F-1) and this environment has no authenticated session against any deployed instance. What follows is (a) verified build/bundle facts, (b) code-level query-cost analysis of the hot pages, (c) the pilot load model with budgets, and (d) the measurement plan that produces real numbers in pilot week 1. **No optimization was performed — no evidence of a problem exists yet.**

## Pilot load model

10–25 staff users · 5–10 concurrent · 100–500 dossiers · 500–2,000 documents · ~100 active shipments · ≤ 10 portal users · ≤ 50 AI requests/day. At this scale the platform's bounded readers are far below any obvious limit; the risks are single-page fan-out cost and cold starts, not throughput.

## Verified build facts (release SHA, local `next build`)

| Surface | First-load JS |
|---|---|
| Shared baseline (all pages) | **87.8 kB** |
| `/dashboard/executive` | 100 kB (3.69 kB route) |
| `/shipping/shipments/[id]` | 103 kB (6.67 kB route) |
| `/portal/files/[id]` | 123 kB (7.08 kB route) |
| `/tasks` (heaviest observed) | 118 kB |
| Middleware | 82.9 kB |

- **Leaflet is lazy-loaded client-side only** (`ShipmentMapLoader`, `ssr:false`) — the map bundle never loads on pages without a map and never blocks SSR.
- All operational pages are `force-dynamic` server-rendered; static prerender preserved for `/login` and `_not-found` (regression-guarded by test).
- `pdf-parse` is external to the bundle (server-only, `serverComponentsExternalPackages`).

## Code-level query-cost analysis (hot pages)

| Page | Cost shape | Assessment |
|---|---|---|
| `/dashboard/executive` | 9 readers under `Promise.allSettled`, request-cached; **heaviest: `getControlTower`** (reads up to 2,000 files + child tables in ~7 batched queries, then per-dossier pure computation) | At 100–500 dossiers: fine. Watch first when data grows (documented in 7.7 acceptance — the fix belongs in the control tower) |
| Logistics Command Center | per-module bounded readers (page-0, capped), `allSettled` | bounded by design |
| Shipping/air lists + detail | paginated lists; detail = fixed parallel reads; events capped at 200 | bounded |
| Portal dashboard/detail | `getPortalShipments`/`getPortalTracking`: fixed parallel batched reads, **no N+1** (asserted in code comments + review) | bounded |
| Copilot requests | context = bounded readers + one provider call (30 s timeout, rate-limited 12/min/user) | bounded; latency dominated by the model |
| DocIntel queue | capped range reads (0–CAP) | bounded |

No unbounded tenant-wide scan exists on any pilot-critical path (the executive fleet map and timeline were built with explicit caps in 7.7; the earlier dashboards are page-0/capped by design).

## Budgets (to hold in pilot; breach = investigate, then optimize)

| Metric | Budget |
|---|---|
| p95 server duration, list pages | < 1.5 s |
| p95 server duration, executive dashboard / command center | < 3 s |
| p95 login → dashboard | < 4 s (incl. cold start) |
| Cold start penalty | < 2 s (Node functions, iad1) |
| Copilot p95 (provider path) | < 15 s; fallback must render instantly |
| Error rate | < 2 % of requests |
| Map chunk | loads only on map pages (verified by lazy import) |

## Measurement plan (pilot week 1 — produces the real report)

1. Vercel → Observability: p50/p75/p95 per route, function duration, cold-start counts (no code change needed).
2. `[observe]` log lines already carry event labels for failures; add none until evidence demands.
3. One scripted browser pass (Lighthouse desktop + mobile against `/login`, `/dashboard`, `/portal`) once the protection wall is open — record TTFB/LCP/CLS.
4. Fill this table and re-issue the report:

| Route | p50 | p95 | err % | notes |
|---|---|---|---|---|
| /login · /dashboard · command center · /dashboard/executive · /shipping · shipment detail · map page · /customs/intelligence · /portal · portal shipment · docintel queue · copilot POST | — | — | — | *to be measured in pilot week 1* |
