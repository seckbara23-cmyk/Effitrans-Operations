# Production Readiness Checklist & Deployment Runbook

Part of [RELEASE-0](README.md). The checklist is walked and *recorded* (copied into the
release directory with checkboxes and names) at the Production Readiness Review.

## 1. Production Readiness Checklist

### Database
- [ ] Backup completed and verified restorable (procedure: `docs/production/backup-and-recovery.md`); checkpoint id recorded
- [ ] Migration order verified against the manifest; bundle has executed in CI from empty
- [ ] No migration in the bundle was ever hand-applied (information_schema probes)
- [ ] Ledger state clean (migration history matches applied objects — 9.0F check)
- [ ] Rollback stance documented per migration (forward-fix path named)
- [ ] Duration estimated; any table-rewrite DDL flagged (none permitted without a window plan)
- [ ] **No test fixtures in the production DB** (the 8.0C guard — RLS fixture rows were once found in prod; the check stays forever)

### Application
- [ ] CI green on the manifest SHA — **per job, per step, 0 skipped**
- [ ] Typecheck clean after the last edit; full test count recorded
- [ ] Build clean; route inventory diff reviewed (new/removed routes named in the notes)
- [ ] `/api/version` on production will be compared to the manifest SHA post-deploy
- [ ] All new surfaces correctly dark pre-activation (permission absent / flag off / tenant row absent)

### Business
- [ ] Owning-seat approvals recorded per the governance matrix (Finance: DAF/DGA · HR: HR admin · Operations: OPS seat · CEO where required)
- [ ] UAT scripts agreed with the owners *before* the window opens
- [ ] Open ratification items affecting the bundle: **none** (a release never ships an unratified decision)

### Security
- [ ] New permissions reviewed: codes, grants, and **who deliberately does NOT get them** (the SYSTEM_ADMIN-exclusion pattern) recorded
- [ ] RLS: every new table in the CI suite; suite count recorded; leak-guard (tenant-scope test) green
- [ ] Audit events verified for every new privileged action; redaction rules honored (no sensitive values in payloads)
- [ ] Secrets: no new env var in code without an entry in `docs/production/environment-matrix.md`
- [ ] Public-repo hygiene: no real client/personal data in the diff (grep sweep recorded)

### Operations
- [ ] Window agreed (minutes-scale for additive bundles; announced if any user-visible risk)
- [ ] Communication plan: who is told before/after (pilot lead template)
- [ ] Monitoring ready: Vercel runtime-errors view open during the window; error-rate triggers from rollback-plan.md active
- [ ] Support contacts + escalation named for week one
- [ ] Operator instructions written as exact commands (nothing "from memory")

## 2. Deployment Runbook (reusable, per release)

### Before
1. Cut the manifest (SHA, migrations, activations, approvals) → `docs/releases/<version>/`
2. Walk the readiness checklist; record it; go/no-go per governance
3. Confirm production serves the manifest SHA (`/api/version`) — the code half is already live by design
4. Backup checkpoint; freeze merges

### During
5. Execute the migration bundle per `migration-governance.md` §4 (apply → probe → record, stop on failure)
6. Apply activations in manifest order: env flags (Vercel env + redeploy where needed) → tenant rollout rows → any role-grant scripts
7. Keep the runtime-errors view open throughout

### After
8. Core smoke sweep: `node scripts/gate/verify-production.mjs` (SHA, public routes, auth walls, uniform-404s) + `/platform/operations` migration probe
9. Module smoke for every affected module (library in smoke-tests-and-uat.md)
10. Unfreeze merges

### Smoke fails / incident
11. Smallest lever first (rollback-plan.md order): kill-switch → suspend affected users → promote-previous deployment (never backwards across a migration) → restore (last resort, announced)
12. Incident note in the release directory: what, when, lever used, follow-up

### Business validation & closure
13. UAT window with the owning seats; results recorded against the agreed scripts
14. Sign-off document (release-decision template) with names + dates
15. Manifest marked DEPLOYED; deployment history + dashboard updated; release notes circulated

## 3. Rollback strategy (philosophy + tiers)

**Philosophy: the platform is engineered so the cheapest rollback is *deactivation*, not
reversal.** Because expand precedes activate, most failures are cured by turning the
activation off (flag, grant, tenant row) while the schema stays — data-safe, seconds, no
loss. The full ladder, smallest lever first:

| Tier | Lever | When | Cost |
|---|---|---|---|
| 0 | Feature kill-switch / revoke grant / disable tenant row | activated behavior misbehaves | seconds; nothing lost |
| 1 | Suspend affected users / tenant (existing session-revocation rails) | user-facing harm, cause unclear | minutes; access only |
| 2 | Vercel promote-previous | code regression, schema NOT moved | minutes; **forbidden backwards across a migration** |
| 3 | Forward-fix migration (through CI) | schema moved and is wrong | hours; the default for DB faults |
| 4 | PITR / backup restore | corruption or loss only | announced data-loss window; CRITICAL path of rollback-plan.md |

- **Before migration**: abort is free — nothing has happened; the bundle simply doesn't run.
- **During migration**: each migration is transactional; a failure rolls that migration
  back whole; the bundle stops (never skip forward).
- **After migration**: tiers 0/3 preferred; tier 2 only if the schema is untouched by the
  bundle (documentation/flag releases).
- **Communication**: any tier ≥ 1 notifies the owning seat; tier 4 notifies the CEO before
  execution. Every rollback produces an incident note; recurring triggers feed the
  known-issues document of the next release.
