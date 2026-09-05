# Production migration policy and operator runbook

**Status:** implemented, awaiting first use. Migration #139 must not be deployed
to production without separate approval.

## Why this exists

Between 2026-09-15 and 2026-09-30, sixteen migrations (123–138) were applied to
production and **none** was recorded in `supabase_migrations.schema_migrations`.
Nothing failed and nothing alerted. The gap was found only because somebody read
the ledger by hand, and a subsequent audit proved all sixteen were genuinely
equivalent to their source — but that was luck, not a control.

The cause was not a bad command. It was **two** commands: `supabase db query -f`
applies SQL and writes no ledger row; `supabase migration repair` writes the row
and applies nothing. Run by hand, informally, only the first happened.

So the rule this policy enforces is: **applying and recording are one operation,
or the run is an incident with a name.**

## The path

```
developer            CI (protected)                     production
─────────            ──────────────                     ──────────
author migration  →  lint (verifier + executor)
author verifier      integrity guard (read-only)
commit, PR, merge    ─── manual dispatch + approval ───→ apply
                                                         verify
                                                         record
                                                         re-verify
```

Nothing is applied by pushing code. A human dispatches `Migrate production`,
names one version, gives a reason, and approves the `production-db` environment.

## Components

| file | role |
|---|---|
| `scripts/migration/exec.mjs` | the only door to a database; three verbs, no ledger write |
| `scripts/migration/ledger.mjs` | repository↔ledger model and the invariants |
| `scripts/migration-integrity.mjs` | **read-only guard**; detects, never repairs |
| `scripts/migrate-production.mjs` | the six-step runner |
| `scripts/lint-migrations.mjs` | verifier + executor conventions, no database |
| `scripts/migration-rehearsal.mjs` | failure injection; refuses non-local targets |
| `.github/workflows/migrate-production.yml` | dispatch-only, environment-gated |

## Authoring a migration (from #139)

1. `npm run migration:new <name>` — creates `supabase/migrations/<version>_<name>.sql`.
2. Write the SQL. Keep the internal `do $$ … raise exception` assertions: they
   protect the moment of application.
3. **Write the companion verifier** at
   `supabase/verifiers/<version>_<name>.verify.sql`.
4. `npm run lint:migrations` must pass.

### The verifier contract

Read-only · deterministic · idempotent · safe to run repeatedly against
production · mutates nothing (no schema, data, permission, session role or
configuration) · returns **exactly one row** of `(ok boolean, detail text)`.

It must verify **meaning, not names**. `supabase/verifiers/20260930000001_customs_release_approval.verify.sql`
is the worked example: it checks nullability, the closed CHECK vocabulary,
`SECURITY DEFINER`, that `anon`/`authenticated` cannot execute the RPCs, and that
the maker/checker comparison is actually present — every one a property the
slice would be broken without, and none satisfied by a name alone.

> **Verifiers live in `supabase/verifiers/`, never in `supabase/migrations/`.**
> The Supabase CLI reads every `<14-digit>_<name>.sql` under `supabase/migrations`
> as a migration, so a verifier parked there parses as a *second* migration with
> a duplicate version, shows up as pending, and `db push` would try to apply it.
> This was found by this toolchain's own guard on its first run.

### Declaring an executor

Default is `db-query`: the whole body goes through the Management API, as one
implicit transaction, under a **2-minute statement timeout**.

Add a header when that will not do:

```sql
-- migrate:executor psql-no-transaction
```

Required for `CREATE INDEX CONCURRENTLY`, `VACUUM`, `ALTER TYPE … ADD VALUE` and
similar — the lint fails the build if such SQL is left on the default executor.
The runner refuses to apply a non-default executor automatically; those are run
by an operator per the escalation below, then recorded through the runner.

### The two executors are not interchangeable — measured, not assumed

| | `--linked` (production) | `--db-url` (local/CI) |
|---|---|---|
| transport | Management API | extended query protocol |
| multi-statement body | **accepted** | **rejected** — "cannot insert multiple commands into a prepared statement" |
| atomicity on late failure | **ATOMIC** (measured on staging, 2026-09-05, with a positive control) | n/a |

Consequences:

* The CI rehearsal, which targets a local database, uses **one command per call**
  and cannot test multi-statement behaviour at all. It validates the
  orchestration — invariants, verifier gating, the failure states — not the
  executor's transactional semantics.
* Atomicity is therefore measured separately, against a real Supabase project
  over the same Management API production uses:
  `node scripts/measure-atomicity.mjs --project-ref <staging-ref>`. It refuses
  the production ref, works in a scratch schema, and drops it afterwards.
* **Result: a failed apply most likely leaves nothing behind.** The design still
  does not depend on it — `VERIFY_FAILED` remains "state indeterminate, diagnose
  by hand" — because one measurement of a hosted platform is evidence, not a
  guarantee.

**Long operations:** anything likely to exceed two minutes (a large backfill, an
index build on a grown table) must be timed against staging first. A timeout
mid-apply lands in `VERIFY_FAILED`, the worst state.

## Deploying

1. Merge the migration and its verifier to `main`. Confirm CI is green.
2. Actions → **Migrate production** → Run workflow.
3. `version` = the 14-digit id; `reason` = why now; **leave `dry_run` checked**.
4. Approve the `production-db` environment. The dry run validates every
   precondition and applies nothing.
5. Re-run with `dry_run` unchecked. Approve again.
6. Read the summary. Success reads:
   `APPLIED_AND_RECORDED — <version> applied, verified, recorded, re-verified.`

## Failure states

| state | exit | ledger | what it means | what to do |
|---|---|---|---|---|
| `NOT_APPLIED` | 10 | not written | SQL rejected | Production should be unchanged. Confirm with the verifier, fix the SQL, redeploy. |
| `VERIFY_FAILED` | 20 | not written | SQL ran, postconditions false | **Production is indeterminate.** No automatic rollback — DDL cannot be safely undone by guessing. Diagnose by hand. |
| `SCHEMA_AHEAD_OF_LEDGER` | 30 | not written | applied + verified, recording failed | **Do not re-apply the SQL.** Fix the cause, then record alone: `supabase migration repair --linked --status applied <version>`. |
| `POST_RECORD_MISMATCH` | 40 | written | recorded, post-check disagrees | Stop. Report. Do not improvise. Preserve state. |
| `PREFLIGHT_REFUSED` | 2 | not written | invariants failed | Nothing was attempted. Read the named reason. |

**HELD is structural.** While any discrepancy exists the guard fails; the guard
is step 1 of every deployment; so every later migration is blocked. Clearing the
hold means resolving the discrepancy, not overriding a flag. There is no override.

## Break-glass

**Procedural only. There is no flag, and none will be added.**

An emergency may temporarily change *who* may approve the `production-db`
environment. It never changes *what runs*: repository/ledger validation,
verification, recording, post-record verification and HELD apply identically.

Record in the change ticket: who was authorised, by whom, why, the incident
reference, the version deployed, and when the authorisation was revoked.

Developer machines hold no production credentials and are not a migration path.

## Escalation: non-default executor

For a migration declaring `psql-no-transaction`:

1. An authorised operator runs the SQL against production with `psql`, outside a
   transaction, one statement at a time.
2. They run the verifier and confirm `ok = true`.
3. They record it through the sanctioned mechanism:
   `supabase migration repair --linked --status applied <version>`.
4. They run `npm run migration:guard -- --linked` and confirm it is clean.

Steps 2–4 are not optional. Skipping 3 recreates the exact gap this policy exists
to end.

## Security and credentials

- `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` live **only** in the
  `production-db` GitHub Environment, reachable only by the `migrate` job, which
  requires reviewer approval.
- The `preflight` job needs no secrets — format checking and lint are repo-only.
- The CI integrity guard against production is read-only by construction: it
  never imports `applyFile` or `repair`, and a test asserts that.
- Connection strings are redacted whenever printed.
- SQL is never passed as a command-line argument; it travels as a file.
- The rehearsal refuses any target that is not a local/disposable host.
- Concurrency is serialised and never cancelled: interrupting between apply and
  record produces the exact state this design exists to prevent.

## Retired

**`supabase db query --linked -f <migration>` is no longer a production
migration path.** It remains fine for read-only queries. **`supabase db push` is
not used on this project** — the ledger and schema have diverged once already,
and `db push` is precisely the command that converts such a divergence into an
unintended replay.

## Not covered

Migrations 1–122 have a clean version↔name mapping but have not had their
equivalence audited. That is a separate, risk-ranked backlog item and is
explicitly **not** a gate on this policy.
