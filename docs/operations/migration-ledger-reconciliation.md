# Production Migration Ledger Reconciliation

**Type:** metadata-only reconciliation (no schema, application, data, or rollout change)
**Project:** `xtpppzhkiagdpmnghdlc` (Effitrans Operations, production)
**Repo state at reconciliation:** commit `2f6037be605f6df3027a5b309d911d8762b7b62a`, branch `main` (= deployed SHA)

---

## Problem discovered

`supabase migration list --linked` showed **every** local migration with a blank
`Remote` value. Investigation (read-only SQL as `postgres`) found the root cause:
the **`supabase_migrations` schema does not exist** in production —
`select ... from supabase_migrations.schema_migrations` returns
`42P01 relation does not exist`, and `pg_namespace` lists only `public`,
`extensions`, `graphql`. The migration-history tracking table was never created.

Meanwhile the **production schema is fully current**: production was built by an
out-of-band apply path (not the CLI's `db push`/history mechanism), so the DDL
exists but the ledger records none of it. This is a *tracking* gap, not a
*schema* gap.

## Evidence collected (read-only, before any write)

All via `env -u SUPABASE_ACCESS_TOKEN npx supabase db query --linked "<SELECT>"`
(connection role `postgres`, full `pg_catalog` visibility):

- **Ledger absent:** `supabase_migrations` schema missing; `schema_migrations`
  relation does not exist.
- **Structural equivalence — the 3 most recent migrations** (`20260722000001`
  messaging, `20260723000001` workflow_structures, `20260723000002`
  finance_requests) verified **equivalent** to the repository across: tables (9),
  columns (names/defaults/nullability), PK/FK/unique/check constraints (counts +
  content, incl. the `notification`/`client_notification` superset CHECK swaps),
  indexes (incl. `uq_finance_request_dedup`), triggers (incl.
  `trg_process_decision_immutable`, `trg_process_owner_tenant`), functions
  (`messaging_*` SECURITY DEFINER + `search_path=public, pg_temp`; `enforce_*`
  INVOKER), RLS enabled + policies (staff/portal), permission catalog (9
  `messaging:*` + 6 `process:*`) and role grants.
- **Historical sample** (partial-apply risk): `customs_record` intel cols 5/5,
  `payment` verification cols 3/3, `invoice` maker-checker cols 4/4,
  `app_user.status`, `operational_file.archived_at`, `document_type`=29,
  `permission`=92 (exact expected total), **73** public tables. All present.
- **Pre-repair ledger:** 55 local migrations, 0 with a populated Remote.

## Why the schema was NOT replayed

The objects already exist. Re-running the migrations (`db push` / `migration up`)
would execute `create table …` (which lack `if not exists`) against existing
tables and **fail** with *"relation already exists"* — fail-fast and
non-corrupting, but the wrong tool. The correct, supported action for a
"schema present, history absent" project is **metadata-only**
`supabase migration repair --status applied <version>`, which creates
`supabase_migrations.schema_migrations` (if absent) and inserts the version
rows **without running any migration SQL**.

## Repair date

**2026-07-23**, against project `xtpppzhkiagdpmnghdlc` at repo commit `2f6037b`.

## Commands executed

All run with the CLI's **stored login** — the ambient `SUPABASE_ACCESS_TOKEN`
env var is a truncated `sbp_`+15 and must be unset (`env -u`) or the CLI errors.
`migration repair --status applied` is **metadata-only**: it creates
`supabase_migrations.schema_migrations` (which did not exist) and inserts the
version rows; it runs **no** migration SQL.

```bash
# Batch 1 — Foundation (20260613–20260615, 20 versions)
env -u SUPABASE_ACCESS_TOKEN npx supabase migration repair --status applied \
  20260613000001 20260613000002 20260613000003 20260613000004 \
  20260614000001 20260614000002 20260614000003 20260614000004 20260614000005 \
  20260615000001 20260615000002 20260615000003 20260615000004 20260615000005 20260615000006 \
  20260615000007 20260615000008 20260615000009 20260615000010 20260615000011
#   => "Repaired migration history: [...] => applied"   (verify: remote_populated=20)

# Batch 2 — Core platform (20260616–20260714, 18 versions)
env -u SUPABASE_ACCESS_TOKEN npx supabase migration repair --status applied \
  20260616000001 20260617000001 20260617000002 20260617000003 \
  20260709000001 20260710000001 20260710000002 20260711000001 \
  20260712000001 20260712100000 20260712110000 20260712120000 \
  20260713000001 20260713000002 \
  20260714000001 20260714000002 20260714000003 20260714000004
#   => applied   (verify: remote_populated=38)

# Batch 3 — Recent production work (20260715–20260723000002, 17 versions)
env -u SUPABASE_ACCESS_TOKEN npx supabase migration repair --status applied \
  20260715000001 \
  20260716000001 20260716000002 20260716000003 20260716000004 20260716000005 20260716000006 20260716000007 20260716000008 \
  20260717000001 20260718000001 20260719000001 20260720000001 20260721000001 \
  20260722000001 20260723000001 20260723000002
#   => applied   (verify: remote_populated=55)
```

## Verification

| Check | Result |
|---|---|
| `supabase migration list --linked` after Batch 1 | local=55, remote_populated=**20** |
| … after Batch 2 | local=55, remote_populated=**38** |
| … after Batch 3 (Stage 2) | local=55, remote_populated=**55**, still_blank=**0** |
| `supabase db push --dry-run --linked` (Stage 3) | **"Remote database is up to date."** — no pending migrations, no object-creation attempts, no drift |
| `git status` / `git diff HEAD -- supabase/migrations/` (Stage 4) | **0** migration files modified; working tree changes limited to this documentation |

## Rollback procedure

The reconciliation is **fully reversible** and touches only the CLI-internal
`supabase_migrations.schema_migrations` table (the application never reads it,
so rollback has no runtime effect). To revert a version's marker:

```bash
env -u SUPABASE_ACCESS_TOKEN npx supabase migration repair --status reverted <version> [<version> ...]
```

Reverting all 55 returns the ledger to its prior empty state. Note: reverting
does **not** drop any schema object — the production schema stays exactly as it
is (it was never created or altered by this reconciliation). There is no
scenario here that warrants a schema rollback.

## Operational note

Production schema is applied by an **out-of-band mechanism** (not `db push` — no
such step exists in CI; most likely a dashboard-side Supabase↔GitHub
integration). With the ledger now reconciled, `supabase db push` behaves
correctly going forward (it will apply only genuinely-new migrations rather than
attempting to recreate existing objects). Teams should either adopt `db push`
as the deploy path or document the out-of-band mechanism so the ledger stays in
sync.
