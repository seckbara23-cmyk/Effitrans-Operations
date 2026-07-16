# Phase 7.3A — Air provider readiness

7.3A ships the provider **abstraction** and honest **stubs** only. No airline, IATA,
FlightRadar, or ADS-B call is implemented — no official contract is verified. This lists,
per provider, exactly what must be verified before a live adapter may be written. **No value
below is invented.**

## Providers

| Code | Display | Status | Notes |
|---|---|---|---|
| `manual` | Saisie manuelle | **configured** | The current reality — operators enter milestones by hand. No external contract needed. |
| `airline` | Compagnie aérienne | **unsupported** | Generic airline stub. Requires the full checklist below. |

`AirlineProvider` advertises no capability and every op returns `not_configured`. The airline
status map (`AIRLINE_STATUS_MAP`) is **intentionally empty** until an official milestone
vocabulary is verified (each future entry must cite the source).

## Airline integration checklist (7.3B blocker)

1. Official airline / cargo API documentation
2. Sandbox or approved environment
3. Base URL
4. Authentication method
5. Supported identifier types (MAWB / HAWB)
6. Request & response schemas
7. Milestone / status vocabulary (for the allowlisted status map)
8. Rate limits
9. Retry requirements
10. Webhook or polling model (and signature scheme if webhook)
11. Data-license & redistribution restrictions
12. Customer-authorization requirements
13. Production credential provisioning

## Rule

A provider moves from `unsupported`/`not_configured` to `configured` only in a later phase,
only after its checklist is verified, and only with each status term added to the allowlist
**with a citation**. No airline endpoint, credential, env var, or status vocabulary is
invented in 7.3A.
