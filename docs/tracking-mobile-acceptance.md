# Tracking Mobile Acceptance (Phase 8.4)

Same evidence discipline as prior phases: EXECUTED = CI-verified here; OPERATOR = needs a real
device/browser (no browser exists in the engineering environment — those rows are not claimed).

## Executed (CI-pinned)

| Standard | Evidence |
|---|---|
| Map responsive height, no scroll-trap | `h-[260px] sm:h-[340px]`, `scrollWheelZoom={false}` (8.3+8.4) |
| Map + journal one selection state | `tests/tracking-8-4.test.ts` §sync |
| Source/age labels French, no raw enum, no liveness | `tests/tracking-8-4.test.ts` §labels |
| Recency truthfulness | `tests/tracking-8-4.test.ts` §recency (direct) |
| Coordinate validation app + DB | app validator test + migration CHECK test |
| Journal immutable, read-only coordinator | test |
| Desktop unbroken | full suite 2,365 green |

## OPERATOR — device pass (360×800, 390×844, 768×1024, 1440×900)

Precondition: seed or operator-enter coordinates for a test shipment (Shanghai→Dakar).

| Check | 360 | 390 | 768 | 1440 |
|---|---|---|---|---|
| Ocean shipment detail: no horizontal overflow | ☐ | ☐ | ☐ | ☐ |
| Map renders, pan/zoom by touch, page still scrolls | ☐ | ☐ | ☐ | ☐ |
| Tap a marker → journal row highlights; tap a row → map pans | ☐ | ☐ | ☐ | ☐ |
| Current status + source + age visible above the fold | ☐ | ☐ | ☐ | ☐ |
| Manual Tracking Studio one-column, 16px inputs (no zoom) | ☐ | ☐ | ☐ | ☐ |
| Portal tracking: map + timeline readable vertically | ☐ | ☐ | ☐ | ☐ |
| No-coordinate shipment: honest « Carte indisponible » | ☐ | ☐ | ☐ | ☐ |

## PWA / cache (OPERATOR, `NEXT_PUBLIC_PWA_ENABLED=true` in Preview)

| Check | ☐ |
|---|---|
| Service-worker cache contains NO tracking API / shipment response (cache-policy §Verification) | ☐ |
| Offline: /offline shows, no stale shipment data replayed | ☐ |
| Reconnect → clean reload → live data returns | ☐ |
