# Phase 7.3C — Logistics KPI definitions

Every consolidated KPI is a **documented SUM of per-mode counts** already computed by the
domains' bounded read services (`lib/logistics/compose.ts headlineKpis`). They count
MOVEMENTS/operations across modes, **not distinct files** — a dossier active in two modes is
counted in each. An unauthorized or unavailable module contributes **0** (never a fabricated
value). No incompatible concepts are summed without the definition below.

## Headline KPIs

| KPI | Definition | Source fields |
|---|---|---|
| **Mouvements en cours** | ocean in-transit + air in-flight + road in-transit | ocean `inTransit` (milestone VESSEL_DEPARTED/IN_TRANSIT/TRANSSHIPMENT_*) + air `inFlight` (milestone DEPARTED) + road `inTransit` (transport status PICKED_UP/IN_TRANSIT) |
| **Arrivées prévues sous 7 jours** | ocean + air shipments whose ETA is within [now, now+7d] and not yet arrived | ocean `vesselsArrivingWithin7Days` + air `arriving` |
| **Opérations en retard** | delayed ocean + delayed air + overdue road | ocean `delayed` (ETA slipped ≥1d or overdue vs plan) + air `delayed` + road `overdue` (active transport with `delivery_planned` < now) |
| **Alertes critiques** | count of `critical`-severity items in the merged attention queue | derived from the unified queue |
| **En attente de douane** | customs declarations pending + ocean containers awaiting customs | customs `pending` (declarations not cleared/terminal; needs customs:read) + ocean `containersAwaitingCustoms` (shipments at DISCHARGED/CUSTOMS_PROCESSING) |
| **Exceptions** | ocean + air shipments in EXCEPTION | ocean `exceptions` + air `exceptions` |

## Platform-card KPIs (per module, from the module's own dashboard)

- **Road** — Prêt au dispatch (`readyForDispatchCount` handoff, else transport NOT_STARTED/
  PLANNED), Chauffeur affecté (DRIVER_ASSIGNED), En transit (PICKED_UP/IN_TRANSIT), POD requis
  (DELIVERED), En retard (active + delivery_planned < now).
- **Ocean** — En transit, Conteneurs chargés, Arrivées 7 j, Retards, Suivi ancien, Exceptions
  (all straight from `getShippingDashboard().dashboard`).
- **Air** — Vols aujourd'hui, Attente chargement, En vol, Arrivées proches, Retards, Exceptions
  (from `getAirDashboard().dashboard`).
- **Customs** — En cours (`pending`), Inspections (`inspectionQueueSize`), Attente paiement
  (`statusBreakdown.AWAITING_PAYMENT`), Mainlevées (`released`), Bloquées/rejetées
  (`statusBreakdown.REJECTED + CANCELLED`). From `getIntelligenceDashboard().dashboard`.

## Honesty rules

- "Mainlevées" is the cumulative cleared count from the customs dashboard, not "released
  today" (no per-day service exists) — labelled accordingly.
- An empty module is shown as **"Aucune donnée opérationnelle"**, never "Normal" — a zero is
  not proof the module is configured.
- Dates are used only when real; a missing ETA/delivery date excludes the item (upcoming
  movements are never inferred).
