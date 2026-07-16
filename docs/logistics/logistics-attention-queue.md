# Phase 7.3C — Unified attention queue

A **read-only derived** queue composed from the existing per-domain alert contracts — no new
alert table, no persistence, no acknowledge/dismiss (none exist yet). Built in
`lib/logistics/reader.ts` (gathering) + `lib/logistics/compose.ts mergeAttention` (dedupe +
order + cap).

## Sources (reused alert derivations)

| Mode | Source | Items |
|---|---|---|
| Ocean | `getAttentionQueue()` (pure `deriveShipmentAlerts`) | top alert per attention shipment → `warning`/`critical`, link `/shipping/shipments/{id}` |
| Air | `getAirAttentionQueue()` (pure `deriveAirAlerts`) | top alert per attention shipment → link `/air/shipments/{id}` |
| Road | derived from `getTransportQueue` rows | overdue delivery (delivery_planned < now) and POD-required (status DELIVERED) → link `/files/{fileId}` |
| Customs | `getIntelligenceDashboard()` summary | blocked/rejected (critical), inspection (warning), awaiting-payment (warning) → link `/customs/intelligence` |

## Item shape (safe fields only)

`{ mode, severity, reference (file number/safe ref), clientName, reason (short, safe), link,
occurredAt? }`. **No raw provider error, no customer PII beyond the file number + client name
already shown on the authorized dashboards.**

## Ordering & bounding

- **Dedupe** by `mode | reference | reason` (same alert never appears twice).
- **Sort** by severity (critical → warning → info), then age (oldest `occurredAt` first;
  undatedlast).
- **Cap** at 12 items on the Command Center; "View all" links to the specialized alert pages
  (`/shipping/alerts`, `/air/alerts`).

## Degradation

If a module is unauthorized or its read fails, it simply contributes no items — the queue
still renders the rest. An empty queue shows "Aucune alerte active" (honest — not an error).
