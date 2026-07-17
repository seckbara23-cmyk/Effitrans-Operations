# Tracking Provider Integration Guide (Phase 8.4)

8.4 ships NO external provider (none is contracted). This is the clean boundary a future
provider plugs into — and the rules it must honor so the trust model stays intact.

## Current provider

**ManualTrackingProvider** — operator-entered positions/milestones via the Manual Tracking
Studio. Every write is `source=MANUAL`, `confidence=MANUAL`, attributed to the authenticated
actor, audited. The provider panels honestly show carrier/AIS/airline as `not_configured`.

## Adding a real provider (contract)

A provider is an adapter that writes into the EXISTING event journals — it never gets its own
tracking store or its own map. To onboard one:

1. **Normalize into a journal event**: map the provider's payload to an `ocean_tracking_event`/
   `air_tracking_event` row with the correct `source` (CARRIER/AIS/AIRLINE/…), `confidence`,
   `occurred_at` (the provider's timestamp, preserved), `received_at` (ingestion time), and a
   deterministic `fingerprint` (so the `unique(tenant_id, shipment_id, fingerprint)` dedup holds).
2. **Service-role ingestion only**: providers write through the admin client; there is no client
   INSERT policy. A client can never spoof a provider event or a `tenant_id`.
3. **Never overwrite**: append only. A correction is a new superseding event, never an UPDATE.
4. **Preserve source identity + timestamp**: the trust model labels the row from these; do not
   collapse them.
5. **Reject invalid coordinates**: reuse `isValidCoordinate`; the DB CHECK is the backstop.
6. **Freshness thresholds**: add/adjust the source's thresholds in the ONE freshness classifier
   (`classifyFreshness`), centrally, with a test.
7. **Audit**: audit that a provider event was accepted/rejected — metadata only, NEVER the raw
   payload (may contain sensitive data).

## The live-data contract (before any « En direct » label)

A position may use liveness language ONLY when ALL hold: the provider contract defines the feed
as real-time/near-real-time; the position's age is within the configured threshold; the UI shows
the age; source + timestamp remain visible. Until a contracted provider meets this, the platform
uses age language (« À jour ») and source language — never a generic green "Live" badge.

## Out of scope (deferred, not faked)

Paid AIS; Maersk/MSC/CMA CGM/airline/telematics production APIs; continuous GPS; driver
background location; satellite/weather/congestion overlays; automatic rerouting; AI-generated
coordinates or ETAs; geofencing; offline mutation queue; push. The interfaces above are ready;
no fake adapter exists.
