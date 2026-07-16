# Phase 7.3C — Unified Logistics Command Center

`/departments/transport` is now the tenant **Logistics Command Center** — one consolidated
overview across Road / Ocean / Air / Customs. It is an **overview + navigation surface**; it
does not duplicate the specialized workspaces and introduces no new backend, schema, RLS,
permission, or provider integration.

## Architecture (composition only)

```
app/departments/transport/page.tsx   (server component — the Command Center)
  → lib/logistics/reader.ts getCommandCenter()   (SERVER-ONLY orchestrator)
        Promise.allSettled per module (degrade-by-section):
          road    → getTransportQueue + transportCards + readyForDispatchCount
          ocean   → getShippingDashboard + getAttentionQueue + listOceanShipments
          air     → getAirDashboard + getAirAttentionQueue + listAirShipments
          customs → getIntelligenceDashboard        (only if customs:read)
          journey → bounded operational_file + shipment/customs_record/transport_record (batched)
  → lib/logistics/compose.ts   (PURE — platformState / mergeAttention / headlineKpis / sortUpcoming)
  → components/logistics/platform-card.tsx   (presentational)
```

**No domain calculation is re-implemented.** Each domain's existing bounded read service
produces the aggregates; the composer only combines the safe numbers.

## Reused services

`lib/transport/service` (getTransportQueue) · `lib/departments/classify` (transportCards,
transportNextAction) · `lib/handoffs/service` (readyForDispatchCount) ·
`lib/shipping/intelligence/{service,manage-service}` (getShippingDashboard, getAttentionQueue,
listOceanShipments) · `lib/air/intelligence/{service,manage-service}` (getAirDashboard,
getAirAttentionQueue, listAirShipments) · `lib/customs/intelligence/service`
(getIntelligenceDashboard) · `StatCard`, `PageHeader`, i18n.

## Page structure

1. Header — **Transport & Logistique** / "Pilotage consolidé des opérations routières,
   maritimes, aériennes et douanières."
2. Cross-modal headline KPIs (6) — see logistics-kpi-definitions.md.
3. Operational platform cards (Road / Ocean / Air / Customs) with derived state + CTA.
4. Unified attention queue — see logistics-attention-queue.md.
5. Upcoming movements (real dates only, chronological, bounded).
6. Cross-modal journey snapshot (projection over authoritative domain facts; each module
   stays authoritative — no second state machine).
7. Road dispatch queue (the road workspace continues to live here).
8. Quick navigation + Tracking-center entry (links to each platform's maps).

## Permissions & degradation

Baseline `transport:read` (this IS the transport department). Road/Ocean/Air use
`transport:read`; Customs uses `customs:read` (card shows "Accès non autorisé" and the
customs KPI/journey column are omitted when absent). Every module read is isolated —
**one failure or missing permission degrades only its section; the page never crashes.**

## Performance

Bounded, parallel, server-side. Query budget per load (authorized): road 2, ocean 4
(dashboard 2 + attention 1 + list 2), air 4, customs 2, journey 4 → all run concurrently via
`Promise.allSettled`. No N+1 (journey uses `.in(file_id, …)` batched), no provider/API call,
no tracking-event full scan, no Leaflet on the page (route ≈ 266 B, First-Load ≈ 96.8 kB —
server-rendered). Working-set caps are the underlying services' (disclosed there).

## Security

Tenant + actor resolved server-side (`assertPermission`); admin reads tenant-filtered
(leak-guard clean); no client-provided tenant filter; alert cards carry only file number /
client (existing authorized dashboard policy) and safe reasons — no raw provider error, no
service-role in the client bundle. No write, no new audit event.
