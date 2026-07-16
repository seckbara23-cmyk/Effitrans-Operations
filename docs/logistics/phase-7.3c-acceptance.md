# Phase 7.3C — Logistics Command Center: acceptance

## DoD status

| Item | Status |
|---|---|
| `/departments/transport` is a unified Logistics Command Center | ✅ (route unchanged) |
| Road/Ocean/Air/Customs cards show real authorized data | ✅ platform cards from each domain's dashboard |
| Operational platform cards replace simple links | ✅ `PlatformCard` w/ KPIs + derived state + CTA |
| Bounded unified attention queue | ✅ `mergeAttention` (dedupe/severity+age/cap 12) |
| Upcoming movements | ✅ `sortUpcoming` (real dates only, chronological, cap 10) |
| Cross-modal journey summaries where data exists | ✅ batched snapshot over recent files |
| Every section links to a real specialized workspace | ✅ CTAs + quick nav + "view all" alert links |
| Partial permissions handled safely | ✅ customs gated (customs:read); Promise.allSettled |
| Empty & degraded states honest | ✅ "Aucune donnée opérationnelle" ≠ Normal; per-section degrade |
| No domain logic duplicated | ✅ reader calls existing services; composer only sums |
| No new backend/schema | ✅ no migration/table/RLS/permission/provider |
| Tenant isolation proven | ✅ tenant-scope leak guard green; admin reads tenant-filtered |
| tests/typecheck/build/RLS/CI | ✅ (below) |

## Sidebar label (Part 10)

Approved change: sidebar label **Transport → "Transport & Logistique"** (matches the page
identity). Route `/departments/transport`, permission `transport:read`, and the item `key`
are unchanged. The single frozen-nav assertion (`tests/journeys.test.ts`) was updated to the
new visible label; the rest of the sidebar is untouched.

## Empty / partial / error behavior

- No road/ocean/air/customs data → that platform card reads "Aucune donnée opérationnelle".
- No `customs:read` → the Customs card shows "Accès non autorisé", the customs headline KPI
  and journey column are omitted, and no customs count is exposed.
- One module read throwing → `Promise.allSettled` isolates it; the section renders empty and
  the rest of the page is unaffected (no full-page crash).
- Empty attention/upcoming → honest "Aucune alerte active" / "Aucun mouvement daté à venir".

## Security

Tenant + actor resolved server-side; admin reads tenant-filtered (leak-guard clean); no
client-provided tenant filter; alert/journey cards carry only file number + client + safe
reasons (existing authorized dashboard policy) — no raw provider error, no PII beyond that,
no service-role in the client bundle. This phase performs **no writes** and adds **no audit
event**.

## Performance & route size

- Query budget (fully authorized): road 2 · ocean 4 · air 4 · customs 2 · journey 4 — all
  concurrent via `Promise.allSettled`. No N+1 (journey uses `.in(file_id,…)`), no provider
  call, no tracking-event full scan.
- No Leaflet on the page. Route `/departments/transport` ≈ **266 B** (First-Load ≈ 96.8 kB),
  server-rendered — unchanged footprint vs. the prior road-only page.

## Verification

- `npx tsc --noEmit` clean (run after tests). `npx next build` clean.
- Full vitest: **2020 passed** (13 new in `tests/logistics-command-center.test.ts`).
- Tenant-scope leak guard green; sidebar contract updated to the approved label only.

## Remaining work — Phase 7.4A

- A true unified aggregate map (separate phase; must not scan all tracking events).
- A persisted cross-modal alert store with acknowledge/dismiss (needs a verified requirement).
- Per-file deep journey drill-down + notifications delivery.
- Request-level memoization of shared readers if the same service is called by multiple future
  surfaces.
