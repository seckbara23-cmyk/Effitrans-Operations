# Supabase Tests

## RLS documents module (Phase 1.8)
[`rls_document_test.sql`](rls_document_test.sql) proves `document` reads **inherit
dossier visibility** (Phase 1.7 `can_read_file`) **and** require `document:read`:
a manager sees documents on any tenant-A dossier but not tenant B; a COORDINATOR
sees only their dossier's document; a user without `document:read` sees none.
Expected: `1 / 1 / 0 / 1 / 0 / 0`. Runs in the `rls-tests` CI job.

## RLS visibility scoping (Phase 1.7)
[`rls_visibility_test.sql`](rls_visibility_test.sql) proves the own/assigned read
model on `operational_file` + `task`: a manager (`*:read:all`) sees every tenant-A
file/task but not tenant B; a COORDINATOR sees only the dossier they coordinate
(and its tasks); a CHIEF_OF_TRANSIT sees the task assigned to them **and** its
dossier, but nothing unrelated. Guards the `can_read_file` / `can_read_task`
helpers + scoped SELECT policies. Runs in the `rls-tests` CI job.

## RLS notifications module (Phase 1.6)
[`rls_notification_test.sql`](rls_notification_test.sql) proves the `notification`
feed is **self-scoped**: user A reads their own notification (`1`) but not a
same-tenant peer's (`0`) nor a tenant-B one (`0`); user B reads their own (`1`).
Confirms the `user_id = auth.uid()` policy (which assumes `app_user.id ==
auth.users.id`). Expected: `1 / 0 / 0 / 1`. Runs in the `rls-tests` CI job.

## RLS tasks module (Phase 1.3)
[`rls_task_test.sql`](rls_task_test.sql) proves the `task` RLS: a tenant-A user
**with** `task:read` reads only tenant A's tasks (`1`), cannot read tenant B's
(`0`), and a user **without** `task:read` reads nothing (`0`) — tasks follow the
`operational_file` tenant boundary. Expected: `1 / 0 / 0`. Runs in the
`rls-tests` CI job.

## RLS operational-file module (Phase 1.2)
[`rls_operational_file_test.sql`](rls_operational_file_test.sql) proves the
`operational_file` / `shipment` / `file_state_transition` RLS: a tenant-A user
**with** `file:read` reads only tenant A's file/shipment/history (`1`), cannot
read tenant B's (`0`), and a user **without** `file:read` reads nothing (`0`).
Expected: `1 / 0 / 0 / 1 / 0 / 1`.

[`numbering_test.sql`](numbering_test.sql) proves `next_file_number` produces
`EFT-{TYPE}-{YEAR}-{SEQUENCE}` with a 5-digit sequence incrementing per
tenant × type × year (separate sequences per type and tenant). **CI / fresh-DB
only** — do not run against a production tenant that already has files.

Both run in the `rls-tests` CI job.

## RLS client module (Phase 1.1)
[`rls_client_test.sql`](rls_client_test.sql) proves the `client` / `client_contact`
RLS: a tenant-A user **with** `client:read` reads only tenant A's clients/contacts
(`1`), cannot read tenant B's (`0`), and a user **without** `client:read` reads
nothing (`0`). Non-destructive; expected row: `1 / 0 / 0` for clients and `1 / 0 / 0`
for contacts. Run like the others (psql / SQL Editor); CI runs it in the
`rls-tests` job.

## RLS role-scope (RLS-2)
[`rls_role_scope_test.sql`](rls_role_scope_test.sql) proves `audit_log` reads are
gated by the `audit:read:all` permission: a `SYSTEM_ADMIN` sees the tenant's audit
rows; a `CUSTOMS_DECLARANT` (no audit permission) sees none. Non-destructive
(`BEGIN … ROLLBACK`). Run the same way as the isolation test (psql / SQL Editor);
expected result: `admin_sees_audit = 1`, `plain_sees_audit = 0`.

## RLS tenant-isolation (RLS-1)
[`rls_tenant_isolation_test.sql`](rls_tenant_isolation_test.sql) proves the
foundation RLS policies isolate tenants:

- a user in **tenant A** **cannot** read tenant B's `organization` / `app_user` rows;
- the same user **can** read its own organization and profile.

The test is **non-destructive** (wrapped in `BEGIN … ROLLBACK`) and simulates an
authenticated user with the Supabase RLS test pattern (`set role authenticated` +
`request.jwt.claims`).

### How to run

**Prerequisites:** `psql` installed, and `DATABASE_URL` exported in your shell
(it lives in your untracked `.env` — never committed). On Windows, run these in
**Git Bash** (the `$DATABASE_URL` form needs a POSIX shell).

**Option A — local Supabase stack (recommended):**
```
npm run db:start          # boots local Supabase (Docker)
npm run db:reset          # applies both migrations + seed.sql
export DATABASE_URL="$(supabase status --output env | grep '^DB_URL=' | cut -d= -f2-)"
npm run test:rls          # runs the isolation test via psql
```

**Option B — linked remote project:**
```
supabase link --project-ref <your-project-ref>
supabase db push          # applies migrations to the remote DB
export DATABASE_URL="postgresql://...":   # from Project Settings > Database
npm run test:rls
```

A successful run prints `RLS tenant isolation: PASS`; any leak/regression raises
an exception and aborts (the transaction rolls back either way).

> `npm run test:rls` contains **no secret** — it reads `DATABASE_URL` from your
> environment, which comes from the untracked `.env`.

### Execution status
> **Not yet executed in this environment** — no local Supabase/Docker/psql is
> available here. The test is authored and ready; run it once the project is
> linked (or in a CI job that boots a local Supabase). Until then, RLS isolation
> is **implemented + scripted, pending execution**.

> Note: if your local `auth.users` schema rejects the minimal insert, create the
> two test users via the service role (Supabase Auth admin API) and substitute
> their UUIDs in the script.
