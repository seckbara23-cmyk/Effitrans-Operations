# Observability & Incident Response Plan — Phase 8.0A

## What exists today (audited)

| Signal | Where | State |
|---|---|---|
| Application errors/events | `reportError()` (`lib/observability/report.ts`) → one structured `[observe]` line per event → Vercel runtime logs | ✅ operational (single integration point, all call sites routed) |
| Runtime error clusters | Vercel error aggregation | ✅ operational — 7-day review executed in this audit (only the F-7 auth-refresh cluster; no 5xx) |
| Audit trail | `audit_log` (append-only, UPDATE/DELETE blocked by trigger) | ✅ operational — auth events, portal events, copilot queries (metadata only), lifecycle actions |
| AI usage | `getCopilotUsageSummary()` over audit rows (`audit:read:all`) + `/api/logistics/copilot/usage` | ✅ operational — requests/answered/fallback/latency/tokens |
| AI provider failures | classified `CopilotError` codes, audited as `outcome: fallback` + `failureCode` | ✅ operational |
| Email failures | comms provider returns typed errors (`resend_not_configured`, `resend_testing_sender_blocked`, …), audited | ✅ code-level; delivery monitoring = provider dashboard |
| Supabase logs | Supabase dashboard (api/auth/postgres) | ✅ platform-provided; not readable from the engineering environment |
| Error monitor (Sentry) | integration point + `monitoringEnabled()` only | ❌ **not wired** (F-9) |
| Alerting | — | ❌ **none configured** (F-9) |
| Cron jobs | none exist in the codebase | n/a |

**Non-logging guarantees (verified by tests):** no secrets, no document contents, no AI prompts/answers, no customer message bodies in logs or audit rows.

## Pilot operating mode (accepted for CONDITIONAL GO)

No automated alerting during the pilot; instead a **daily 15-minute review** (pilot lead):

1. Vercel → project → Errors (runtime clusters, last 24 h) — anything new beyond F-7?
2. Vercel logs filtered on `[observe]` — count by `scope`/`event`; investigate new event labels.
3. App → `/settings/audit` — auth anomalies (repeated `portal.login.rejected`, `auth.login.rejected`), unexpected platform actions.
4. AI usage endpoint — fallback ratio, latency, token consumption vs. expectation (≤ ~50 requests/day pilot budget).
5. Supabase dashboard — auth error rate, database health, storage errors.

## Required alerts (to wire with the monitor, post-pilot — definitions ready)

| Alert | Condition (initial threshold) | Channel |
|---|---|---|
| Sustained 5xx | > 5 5xx in 5 min on any route | immediate |
| Auth failure spike | > 20 failed logins / 10 min or > 5 for one account | immediate |
| DB connection failure | any `ECONNREFUSED`/pool exhaustion `[observe]` event | immediate |
| Migration failure | CI `rls-tests` or deploy-time migration job red | immediate |
| RLS test failure | CI `rls-tests` red on main | immediate (release-blocking) |
| AI cost spike | tokens/day > 3× 7-day average, or > tenant rate-limit ceiling | daily |
| AI provider timeout | fallback ratio > 30 % over 1 h | daily |
| Email failure rate | > 10 % provider errors over 1 h | daily |
| Storage upload failure | > 3 failures / 10 min | daily |
| Portal error | any 5xx on `/portal/*` | immediate (customer-facing) |
| Stale tracking data | manual: attention queues already surface `staleTracking` in-app | in-app (exists) |
| Backup failure | Supabase backup alert (platform) — enable email notifications | immediate |

## Incident response

1. **Detect** (daily review or user report) → open an incident note (time, surface, impact, SHA serving).
2. **Classify** against rollback triggers (rollback-plan.md). Isolation/privilege incidents: stop the pilot first, investigate second.
3. **Mitigate** with the smallest lever: feature kill switch (`AI_COPILOT_ENABLED=false`, provider unset), user suspension (session revocation exists), deployment rollback, or DB restore — in that order of preference.
4. **Preserve evidence:** export relevant Vercel logs + audit rows before any change; never truncate `audit_log` (append-only by design).
5. **Communicate:** pilot users via the agreed channel; customers by the pilot lead only.
6. **Post-incident:** finding added to the register with classification + regression test where code was at fault.
