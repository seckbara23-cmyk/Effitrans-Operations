# UAT-PARALLEL-OWNERSHIP-01 — the parallel activities had no owner, and the verifier that proved the fix was wrong

**Surface:** production (`effitrans-operations.vercel.app`, tenant Effitrans) ·
**Severity:** authorization (a role could claim work that was not its own; no
data loss, no dossier rewritten) · **Status:** **CLOSED / PASS** — fix live,
ledger reconciled, integrity CLEAN.

| | |
|---|---|
| Authorization fix | PR #9 → `6dcf1b5e9a9e4dba7f04cbc81d0fbfc7ef9586f5` |
| Verifier correction | PR #10 → `69753194e043e4b7c2488c5cb376919264907698` |
| Migration | `20261006000001_parallel_activity_owning_roles` |
| Ledger | 143 → **144**, highest `20261006000001`, pending **0** |
| Integrity guard | **CLEAN**, exit 0 |

## Symptom

On EFT-IMP-2026-00011 the dossier showed « Account Manager — obtenir le Bon à
Délivrer » with « En cours : **Omar Gadiaga** », who holds Coordinateur des
opérations, Agent de terrain douane, Agent d'enlèvement and Coursier — and **no
Account Manager role**. He had not been assigned: the audit records
`process.step.activated` by his own account at 2026-09-09 13:47:33.93, the same
instant as the row's `started_at`, with zero `process.step.assigned` rows and
zero STEP `assignment_event` rows tenant-wide. He pressed Démarrer and the
platform agreed.

It had happened twice. EFT-IMP-2026-00012's `bon_a_delivrer` was claimed by a
SYSTEM_ADMIN.

## Root cause — the control was never armed, not bypassed

`activateStep` asks `owningRoleRefusal` → `evaluateControlOwnership`, passing the
role from `process_step_owning_role`. That table had been seeded « one row per
official step »: the **26 numbered steps**, and nothing else. The three parallel
activities are deliberately *unnumbered* — `process_step_execution.step_number`
is `NULL` for them, and the schema comment says so — therefore they had **no
row**.

With `owningRole === null` the rule returns `unowned_step`, which is **allowed**,
and defers to the activity's own permission. For these three that is
`document:create` — a permission **fourteen roles hold**, because each needs it
for its own work.

| | Coordinator (holds `document:create`) | Account Manager |
|---|---|---|
| Before | `unowned_step` → **allowed** | allowed |
| After | `not_owning_role` → **refused** | `owning_role` → allowed |

## The fix — three rows, not a rule

The registry already declared `ACCOUNT_MANAGER` on all three. Its `role` field is
**documentary** (DEC-C35) and names three roles that exist in no tenant
(`CHIEF_TRANSIT`, `COTATION_OFFICER`, `OPERATIONS_MANAGER`), so it cannot become
the gate. `process_step_owning_role` is what the engine enforces against, so the
owner was added there — one source of truth, extended. No special case for the
Bon à Délivrer, no new permission, no new role.

**Already-claimed activities were not re-judged.** `owningRoleRefusal` opens with
`if (assignedUserId !== null) return null;`, so the gate asks about ownership
only for an UNASSIGNED step. 00011 and 00012 keep their claimants, states and
timestamps. Reassignment remains unbuilt and out of scope.

**One consequence beyond the gate**, stated rather than discovered later:
`user_readable_file_ids` clause F-1 reads the same table, so an Account Manager
can now *see* a dossier whose parallel activity is open and unclaimed — the rule
its three numbered steps already grant, applied to the three activities the same
role already owns. Measured before shipping: **2 dossiers of 13**, narrowing
again the moment the activity is claimed.

**The guards that should have caught this, repaired.** Both ownership suites read
only the *first* seeding migration, and the journey guard additionally matched
only notes beginning « step N » — the activities were invisible twice over, and a
journey activating one was *skipped* rather than checked. Once they read every
seeding migration they immediately found a second instance of the same defect:
three journeys had a Coordinator activating `transport_docs_transmission`.

## The production incident — VERIFY_FAILED that indicted the verifier

Production Run #8 (mode APPLY) ran the SQL successfully, then **failed its own
companion verifier**, so the ledger was never written:

```
step 2 — apply SQL: applied
step 3 — verify postconditions: VERIFY FAILED
detail: UAT-PARALLEL-OWNERSHIP-01 FAILED: the map is readable but not writable
        by authenticated or anon
```

The failing assertion asked the **GRANT** layer:

```sql
not has_table_privilege('authenticated'|'anon', …, 'INSERT'|'UPDATE'|'DELETE')
```

This project carries `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
TABLES TO anon, authenticated, service_role`, from **both** `postgres` and
`supabase_admin`. Measured against production: **all 170** tables in `public`
hand anon and authenticated `arwdDxtm`, and **all 170** enable RLS. Broad grants
are the platform's design; **RLS is the enforcement**. The assertion was false on
every table in the database, including 169 with nothing to do with this slice.

Production was correct the whole time: RLS enabled, exactly one policy
(`process_step_owning_role_select`, `SELECT`, `{authenticated}`, qual `true`), no
write policy, and neither role holding `rolbypassrls`. The verifier's *label* was
true; its *implementation* asked a layer that does not answer the question.

**Worse, it masked the incident.** `migration-integrity.mjs` distinguishes
"applied but unrecorded" from "not yet applied" by running the companion
verifier. Ours returned `ok=false` for an unrelated reason, so the guard reported
`CLEAN_WITH_PENDING` over a real `SCHEMA_AHEAD_OF_LEDGER` — a false negative in
the platform's most important migration safety net.

**Why CI missed it:** the verifier passed a green CI run. The local stack carries
no such default privileges — same SQL, same migrations, different environment.

## The correction (PR #10)

The security assertion now asks the layer that answers, at catalog level:

1. RLS is enabled
2. **no PERMISSIVE policy** with `polcmd in ('*','a','w','d')` reaches anon or authenticated
3. a SELECT policy **still reaches** authenticated
4. neither role has `rolbypassrls`

Roles resolve through `pg_policy.polroles` **OIDs + `pg_has_role`**, not the text
of `pg_policies`, so a policy granted to PUBLIC (`0 = any(polroles)`) or to any
inherited role is caught exactly like one that names them. RESTRICTIVE policies
only narrow, so they are correctly not read as grants. Both halves are asserted
deliberately: a check that only forbade writes would pass just as happily on a
table nobody can read, breaking clause F-1 instead of protecting it.

Validated where it had failed — run read-only against production, the corrected
verifier returns **ok=true, 16/16**. `migration-integrity.mjs` then reported
`SCHEMA_AHEAD_OF_LEDGER` and HELD (exit 1), **with no change to the guard**: it
keys on `verdict.ok === true` and had been asking correctly all along.

### The adversarial CI probe

`scripts/verifier-security-probe.mjs` exists because the regression that matters
is not "does the verifier pass" — it did — but **"does it still pass when the
database looks like production"**. The probe GRANTS those broad privileges first,
then removes the protection one way at a time and requires the **real verifier
file** to answer correctly each time:

| case | expected |
|---|---|
| broad GRANTs + RLS + SELECT-only + 29 correct rows | PASS |
| the **old** assertion on that same correct state | FALSE — the incident, reproduced |
| RLS disabled | FAIL |
| authenticated INSERT / UPDATE / DELETE policy | FAIL |
| write policy via PUBLIC · `FOR ALL` policy | FAIL |
| RESTRICTIVE write policy (grants nothing) | PASS |
| SELECT policy dropped | FAIL |
| ownership row deleted · wrong owner | FAIL |
| ledger row withdrawn | `SCHEMA_AHEAD_OF_LEDGER`, exit 1 |

Nothing re-implements the verifier — a copy would drift from the thing it guards,
invisibly, for exactly as long as it mattered. Every injected state is reverted in
a `finally`, the script refuses any non-local host, and it re-asserts a clean
verdict at the end so it cannot contaminate later CI steps.

### The probe harness correction

PR #10's first CI run died before a single adversarial case executed:

```
Error: [probe] could not apply 20261006000001:
       cannot insert multiple commands into a prepared statement
```

The probe applied the migration with `applyFile`, which runs
`supabase db query --db-url … -f` — the **extended** query protocol, one command
per message. The migration is two statements: an `insert …;` and the `do $$ … $$;`
guard block. The script's own helper already carried the comment "one statement
per call"; the migration apply walked straight past it. **A comment is not a
guard.** It is now applied with `psql -X -v ON_ERROR_STOP=1 -f` (the **simple**
protocol, which carries several commands per message, and the same transport the
production runner gets through the pooler), and `exec()` refuses multi-statement
SQL outright, naming the reason and the alternative.

## Ledger reconciliation

One production write, from a clean checkout of main `6975319`, governed CLI
**2.106.0**:

```
npx supabase@2.106.0 migration repair --linked --status applied 20261006000001
→ exit 0 · "Repaired migration history: [20261006000001] => applied"
```

Verified read-only afterwards: ledger **144** · `20261006000001` recorded exactly
once as `parallel_activity_owning_roles` · highest version `20261006000001` ·
`migration-integrity` **CLEAN, pending 0, exit 0** · verifier **ok=true 16/16** ·
`process_step_owning_role` **29 rows** with all three activities
`ACCOUNT_MANAGER` and **byte-identical to the migration's literals, note text
included** · dossiers 00011 and 00012 unchanged · **0** execution rows and **0**
assignment events modified (newest `updated_at` anywhere in
`process_step_execution` was three days older than the repair).

## Lessons

1. **A GRANT is not an effective write ability when RLS is enforcing.** On this
   platform every table in `public` grants `arwdDxtm` to anon and authenticated
   by default privileges and gates with RLS. Never assert security with
   `has_table_privilege`; assert the **policy set** — and resolve policy roles
   through `pg_policy` OIDs and `pg_has_role`, so PUBLIC and inherited roles are
   caught. See also EMP-4A, where GRANT ≠ ability under RLS first bit.
2. **A verifier asserts the postconditions ITS migration establishes.** This
   migration contains no grant, no policy and no RLS statement; demanding a shape
   of the security layer it never touched is how a correct database failed a
   correct migration. Observe the environment; do not require it.
3. **CI must reproduce security assumptions that differ from hosted production.**
   The check passed CI and failed production because the local stack has no
   `ALTER DEFAULT PRIVILEGES`. Where an assumption is environment-dependent, make
   CI *construct* the production shape before asserting against it.
4. **Schema-ahead-of-ledger is repaired, not re-applied.** The SQL had run and
   committed. Re-running would have been a no-op here only because the insert is
   `on conflict do nothing`; in general it is how a schema and a ledger diverge
   further. Record alone:
   `supabase migration repair --linked --status applied <version>`.
5. **`migration repair` resolves the migration NAME from the local migrations
   directory.** Run it from a checkout that has the file, or the ledger records
   the wrong name.
6. **Pin the governed CLI for production operations.** `npx supabase` resolves
   the newest release (2.118.0 at the time), whose `--linked` routes via the
   Management API rather than the pooler; the production workflow pins
   **2.106.0**, and so should an operator acting outside it.

A seventh, earned twice in this slice: **a guard that reads one seeding migration
goes blind.** Any test parsing seeded catalog data must read *every* migration
that seeds it, and assert coverage of the whole registry set rather than a row
count. Related trap: the third owning-role note contains a semicolon, so slicing
the INSERT block at the first `;` silently loses a tuple.

## Tests

`tests/uat-parallel-ownership-01.test.ts` (35): sections A–E cover the ownership
gap, the claim decision over the real `evaluateControlOwnership` (including the
defect reproduced with `owningRole: null` → `unowned_step`), engine wiring with
no special cases, the migration's own guards, and OPS-LENIENCY-02 and the
convergence gate left untouched. F pins the RLS layer the security check may ask
and the root-cause rule; G pins the probe's coverage, its CI wiring and ordering,
that the integrity guard was *not* changed, and the multi-statement regression —
test 35 exercises the single-statement guard behaviourally rather than by string
match, which is the mistake it exists to prevent.

`tests/journey/negative-battery.journey.ts` adds the end-to-end refusal: a
Coordinator holding `document:create` is refused with
`step_gate_not_owning_role`, the refusal **writes nothing**, and the Account
Manager then claims it. CI-only, and green on both the PR and the merge commit
(130 + 11 steps, zero non-success, zero skipped).
