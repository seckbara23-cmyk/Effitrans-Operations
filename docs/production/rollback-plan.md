# Rollback Plan — Phase 8.0A

## Triggers (any one ⇒ act immediately)

| Trigger | Severity | First action |
|---|---|---|
| Cross-tenant or cross-customer exposure | CRITICAL | suspend pilot; preserve evidence; investigate before any redeploy |
| Privilege escalation / unauthorized platform action | CRITICAL | suspend affected accounts (session revocation); investigate |
| Login broken for all users | CRITICAL | verify served SHA + env vars; roll deployment back |
| Data corruption | CRITICAL | stop writes (suspend users); assess via audit_log; restore path |
| Migration failure | HIGH | **fix forward** (see Data rule) — never redeploy old code over a newer schema |
| Dossier workflow blocked (no workaround) | HIGH | rollback deployment if regression; else hotfix forward |
| Document loss | HIGH | storage incident; re-upload; check bucket policies |
| AI exposing unauthorized data | HIGH | `AI_COPILOT_ENABLED=false` (all four copilots go dark, deterministic surfaces remain) |
| Portal isolation failure | CRITICAL | disable portal logins (suspend client_users); investigate |
| Sustained error rate > 5 % / 30 min | HIGH | roll back to last known-good deployment |
| p95 latency > 3× budget sustained | MEDIUM | investigate first; rollback only if a deploy caused it |

## Actions (smallest lever first)

1. **Feature kill switch** — AI: set `AI_COPILOT_ENABLED=false` (env change + redeploy takes effect); email: unset `COMMUNICATIONS_EMAIL_PROVIDER` (reverts to no-op stub); payments/tracking/process flags are already dark.
2. **Suspend pilot users** — portal: set client_user status DISABLED; staff: 6.0E session revocation (ban); tenant-wide: lifecycle suspension blocks at middleware.
3. **Revert deployment** — Vercel → Deployments → promote the last known-good build (recorded below). Then **verify** (§Verify).
4. **Restore database** — only for corruption/loss; follow backup-and-recovery.md; announce data-loss window first.
5. **Notify** pilot users (pilot lead) and stakeholders; customers only via the pilot lead.
6. **Preserve evidence** — export Vercel logs + relevant audit_log rows BEFORE remediation; audit_log is append-only, never truncate.
7. **Open incident log** entry (time, trigger, serving SHA, actions, resolution) and add a register finding.

## The data rule (migrations vs. code rollback)

Migrations are forward-only and additive (audited: no destructive ops in all 50). Therefore:

- **Code rollback is safe across our migrations** — older code ignores newer additive columns/tables. This has held for every phase to date.
- **Never** attempt a schema rollback; there are no down-migrations by design. A bad migration is fixed by a corrective forward migration.
- If a future migration ever backfills or rewrites data, "redeploy previous commit" is NOT sufficient — that migration's plan must ship with its own restore note. (None exist at this SHA.)

## Verify (after ANY deploy, rollback, or dashboard action) — added after F-5 was observed live

1. Vercel → Deployments: the current production deployment's `githubCommitSha` equals the intended SHA (release-manifest for the pilot).
2. `GET /login` → 200 (public, post-F-1); `GET /dashboard` unauthenticated → redirect to `/login` (not 404, not a loop).
3. One SHA-distinguishing route renders (for this RC: `/dashboard/executive` shows the Phase-7.7 composed rows).
4. Record the check (date, SHA, verifier) in the incident/ops log.

## Known-good ladder (at audit close)

| SHA | Phase | Status |
|---|---|---|
| `d9c2c26` | 7.7 | release candidate (this manifest) |
| `e93fdf9` | 7.6C | previous production — first rollback target |
| `fbd643b` | 7.6B | second rollback target |

All three share the same additive schema lineage — code rollback among them is schema-safe.
