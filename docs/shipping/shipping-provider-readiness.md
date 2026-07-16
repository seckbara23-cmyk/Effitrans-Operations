# Phase 7.2A — Shipping provider readiness

7.2A ships the provider **abstraction** and honest **stubs** only. No carrier, aggregator,
port, terminal, or AIS network call is implemented, because no official provider contract
has been verified. This document states, per provider, exactly what must be verified
before a live adapter may be written. **No value below is invented** — each item is a
requirement to obtain, not a filled-in credential or endpoint.

Until every item for a provider is verified, its adapter stays `not_configured` /
`unsupported`, its `capabilities()` advertise nothing it cannot do, and every operation
returns a safe negative result.

## Universal carrier-integration checklist

Every carrier adapter requires ALL of:

1. Official API documentation
2. Sandbox or approved test environment
3. Base URL
4. Authentication method
5. Supported identifier types (booking / master BL / house BL / container)
6. Request & response schemas
7. Event / status vocabulary (for the status-mapping allowlist)
8. Rate limits
9. Retry requirements
10. Webhook or polling model (and, if webhook, the signature scheme)
11. Data-license restrictions
12. Storage & redistribution restrictions
13. Customer-authorization requirements (whose shipments may be queried)
14. Production credential provisioning process

## Carrier stubs (all `unsupported` in 7.2A)

| Provider code | Display name | Status | Notes |
|---|---|---|---|
| `manual` | Saisie manuelle | **configured** | The current reality — operators enter milestones by hand. No external contract needed. |
| `maersk` | Maersk | unsupported | Requires the full checklist above. Maersk publishes APIs, but none are verified/onboarded here. |
| `msc` | MSC | unsupported | Requires the full checklist. |
| `cma-cgm` | CMA CGM | unsupported | Requires the full checklist. |
| `hapag-lloyd` | Hapag-Lloyd | unsupported | Requires the full checklist. |
| `cosco` | COSCO | unsupported | Requires the full checklist. |
| `one` | Ocean Network Express | unsupported | Requires the full checklist. |
| `evergreen` | Evergreen | unsupported | Requires the full checklist. |
| `aggregator` | Tracking aggregator | unsupported | A multi-carrier aggregator would additionally need its per-carrier coverage matrix and its own license terms. |

The stub set is deliberately small and honest. Adding a code here does not imply any
integration exists — the `configured` flag and `capabilities()` are the source of truth.

## AIS is a SEPARATE data source

AIS (vessel positions) is not a shipping line and has its own provider interface and, in
particular, its own **redistribution licensing**. An AIS adapter additionally requires:

1. Official AIS provider API documentation
2. Sandbox / approved environment
3. Base URL & authentication
4. Position message schema (lat/lon/SOG/COG/heading/nav-status)
5. Identifier support (IMO and/or MMSI)
6. Rate limits & polling/stream model
7. **Redistribution & storage license** — whether positions may be stored, for how long,
   and whether they may be shown to end customers
8. Freshness/latency guarantees
9. Production credentials

| Provider code | Status | Notes |
|---|---|---|
| `ais-generic` | unsupported | No AIS provider is contracted. Redistribution rights are unverified, so no position may be sourced or shown as live. |

## Rule

A provider moves from `unsupported`/`not_configured` to `configured` only in a later phase,
only after its checklist is verified, and only with each status-vocabulary term added to
the allowlisted status map **with a documentation citation**. Guessing any of these is
exactly what the stub design prevents.
