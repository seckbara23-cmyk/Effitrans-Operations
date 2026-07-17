# Backup & Disaster Recovery — Phase 8.0A

**Honest status: backup capability is UNVERIFIED from the engineering environment** (Supabase management API not reachable here — F-4). This document defines the required posture and the drill whose *evidence* is a release condition (C2). A backup policy without a tested restore is not sufficient — the drill below is mandatory before real operational data.

## Required posture

| Item | Requirement | Status |
|---|---|---|
| Supabase plan | Paid tier (daily automated backups included) | ⚠️ operator to confirm plan tier |
| Backup frequency | Daily (platform); PITR add-on decision recorded | ⚠️ confirm; PITR recommended before GA (RPO minutes vs 24 h) |
| Retention | ≥ 7 days (plan-dependent) | ⚠️ confirm |
| Storage buckets (`documents`, `brand-assets`) | **NOT covered by DB backups.** Decision required: accept risk for pilot (docs re-uploadable) or schedule object copies | ⚠️ decision + record |
| Auth data (`auth.*` schema) | included in Supabase backups | confirm in drill |
| Audit log preservation | `audit_log` is append-only (UPDATE/DELETE blocked); included in DB backup | ✅ by design; verify in drill |
| Restore owner | named operator with Supabase org access | ⚠️ assign |
| Restore credentials | Supabase org owner + Vercel env access, stored in the company password manager (never in the repo) | ⚠️ confirm |

## Objectives (pilot)

- **RPO:** 24 h (daily backup) — acceptable for pilot ONLY while dossier volume is low and paper trail exists; PITR before GA.
- **RTO:** 4 h — restore to new project + repoint Vercel env vars + verify.

## Mandatory restore drill (release condition C2)

1. In Supabase: create a scratch project. Restore the latest production backup into it (dashboard → Backups → Restore, or download + `psql`).
2. Verify: migration count = 50 (`supabase migration list`), `select count(*) from audit_log` plausible, one known dossier readable, RLS enabled on spot-checked tables (`select relrowsecurity from pg_class where relname='operational_file'`).
3. Point a Vercel **preview** deployment's env at the scratch project; log in; open one dossier; confirm the app functions against restored data.
4. Record: date, backup timestamp used, elapsed restore time (RTO evidence), verifier name — in this file, under Evidence.
5. Delete the scratch project.

## Recovery procedures

**Database corruption / bad write:** identify blast radius via `audit_log` → restore to scratch → either repair forward in prod (preferred, audited) or full restore + replay manual entries. A full restore LOSES writes after the backup point — communicate to pilot users, re-enter from paper.

**Migration failure on deploy:** migrations are forward-only and additive (verified I-3 — no destructive ops). A failed migration leaves prior tables intact: fix forward with a corrective migration. **Never** roll code back below the schema baseline (rollback-plan.md §Data rule).

**Storage loss:** documents bucket has no automated copy (see table). Pilot mitigation: source files exist outside the platform; re-upload. GA requirement: scheduled bucket replication.

**Full project loss:** new Supabase project → run the 50-migration sequence + seed (proven clean-apply in CI) → restore data over it or accept data loss to backup point → rotate keys → repoint Vercel envs.

## Incident communication

DB-restore incidents are announced to all pilot users before the restore (expected data-loss window stated), and recorded in the incident log with the audit evidence exported first.

## Evidence

| Date | Drill | Backup point | RTO measured | Verifier |
|---|---|---|---|---|
| — | *none yet — release condition C2* | — | — | — |
