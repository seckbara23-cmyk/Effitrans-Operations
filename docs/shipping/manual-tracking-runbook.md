# Phase 7.2B — Manual tracking runbook

External carrier/AIS integrations are blocked (no verified contracts), so operators keep
ocean shipments current by hand. The Manual Tracking Studio
(`components/shipping/tracking-studio.tsx`, on the shipment detail page) makes this safe.

## Entering an event

1. Pick the **event** (any canonical milestone, or `POSITION_UPDATE` / `ETA_UPDATE`).
2. The studio shows the **effect before you submit** (pure `previewManualEvent`):
   - **Advance** — normal forward progress.
   - **Repeat** — same milestone again.
   - **Correction (regression)** — an earlier milestone; the submit is blocked until you
     tick the **confirmation** checkbox.
   - **Exception / Cancel / Complete** — clearly labelled; complete requires a prior delivery.
   - **Invalid** — terminal state or impossible transition; submit disabled.
3. Set the **occurred-at** time. An **out-of-order** timestamp (earlier than the last event)
   is warned but allowed — corrections are legitimate.
4. Optionally attach a container, a location name / UN/LOCODE, **validated** coordinates, and
   a note / exception reason.
5. Submit. The server (`addManualTrackingEvent`) re-validates everything, stores the event
   as **source=MANUAL / confidence=MANUAL**, deduplicates exact repeats
   (`unique(tenant,shipment,fingerprint)`), advances the milestone with **compare-and-set**
   on `tracking_version`, and recomputes position/alerts on the next render.

## What the server rejects

- unknown event type / invalid timestamp / invalid coordinate / invalid UN/LOCODE;
- an invalid or terminal milestone transition;
- a correction without confirmation (`confirmation_required`);
- a duplicate event (`duplicate_event`);
- a stale version (`stale_transition`) — reload and retry;
- a non-ocean shipment, or one outside the caller's tenant.

## ETA

Update the ETA with an explicit **source** (Manual / Carrier / Port / System estimate). The
prior value is preserved (`eta_previous`); a system estimate is never labelled
carrier-confirmed. Significant slips surface on the dashboard and the attention queue.

## Audit

Every manual action writes a safe audit event (`shipping.tracking.manual_event_added`,
`shipping.milestone.changed`, `shipping.eta.updated`) with the event type / milestones /
source — **never coordinates, notes content, or PII**. The high-volume events themselves
live in `ocean_tracking_event`, not the audit log.
