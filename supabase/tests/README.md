# Supabase Tests

## RLS driver, tracking, assignment & portal temp-password (Phase 3.2–3.4)
The following SQL RLS tests are wired into the `rls-tests` CI job (Phase 4.0A):
- [`rls_file_assignment_test.sql`](rls_file_assignment_test.sql) — file assignment scoping (Phase 3.2A).
- [`rls_portal_temp_password_test.sql`](rls_portal_temp_password_test.sql) — temp-password portal flow isolation (Phase 3.2B).
- [`rls_tracking_test.sql`](rls_tracking_test.sql) — `tracking_event`/`tracking_position` staff/driver/portal audiences + tenant isolation (Phase 3.4).
- [`rls_driver_test.sql`](rls_driver_test.sql) — driver sees only their assigned transport (Phase 3.4C).
- [`rls_driver_ops_privacy_test.sql`](rls_driver_ops_privacy_test.sql) — driver operational-privacy boundaries (Phase 3.4C).

## RLS communications module (Phase 1.14)
[`rls_communication_test.sql`](rls_communication_test.sql) proves the email
outbox is **staff-role gated** (`communication:read`) and **tenant-isolated**: a
user with the permission sees tenant-A messages but not tenant B; a staff user
without it sees none. Expected: `1 / 0 / 0`. Runs in the `rls-tests` CI job.

## RLS portal documents & invoices (Phase 1.12B)
[`rls_portal_documents_test.sql`](rls_portal_documents_test.sql) proves a portal
user sees a document only when **APPROVED + `shared_with_client` + own client**
(approved-not-shared, shared-not-approved, and other-client all → 0; staff
unaffected). Expected `1 / 0 / 0 / 0 / 1`.
[`rls_portal_invoice_test.sql`](rls_portal_invoice_test.sql) proves a portal user
sees only **ISSUED/PARTIALLY_PAID/PAID** invoices of their client (DRAFT/VOID/
other-client → 0), with `invoice_line`/`payment` inheriting invoice visibility,
and staff (`finance:read`) still seeing drafts. Expected `1 / 1 / 0 / 0 / 0 / 1 /
0 / 1 / 1`. Both run in the `rls-tests` CI job.

## RLS customer portal (Phase 1.12A)
[`rls_portal_test.sql`](rls_portal_test.sql) proves the second identity class
(`client_user`) is strictly client-scoped via the **additive** portal RLS: an
ACTIVE portal user sees **only their own client's** dossiers — not another
client's, not another tenant's, and **never** tasks or audit. A DISABLED portal
user sees nothing, and **staff RLS is unaffected** (SYSTEM_ADMIN still sees the
dossier). Expected: `1 / 0 / 0 / 0 / 0 / 0 / 1`. Runs in the `rls-tests` CI job.

## RLS finance module (Phase 1.11)
[`rls_finance_test.sql`](rls_finance_test.sql) proves finance visibility is
**finance-role based, NOT inherited from `can_read_file`**: a `FINANCE_OFFICER`
(`finance:read`) sees tenant-A invoices/charges but not tenant B; a COORDINATOR
who **coordinates** the dossier (so can read it) but lacks `finance:read` sees
**none** of its finance rows. Also checks `next_invoice_number` is per-tenant
sequential (`EFT-INV-YYYY-00001`). Expected: `1 / 0 / 1 / 0 / 0`. Runs in the
`rls-tests` CI job.

## RLS transport module (Phase 1.10)
[`rls_transport_test.sql`](rls_transport_test.sql) proves `transport_record` reads
**inherit dossier visibility** (Phase 1.7 `can_read_file`) **and** require
`transport:read`: a manager sees records on any tenant-A dossier but not tenant B;
a COORDINATOR sees only their dossier's record; a user without `transport:read`
sees none. Expected: `1 / 1 / 0 / 1 / 0 / 0`. Runs in the `rls-tests` CI job.

## RLS customs module (Phase 1.9)
[`rls_customs_test.sql`](rls_customs_test.sql) proves `customs_record` reads
**inherit dossier visibility** (Phase 1.7 `can_read_file`) **and** require
`customs:read`: a manager sees records on any tenant-A dossier but not tenant B;
a COORDINATOR sees only their dossier's record; a user without `customs:read`
sees none. Expected: `1 / 1 / 0 / 1 / 0 / 0`. Runs in the `rls-tests` CI job.

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
> **Executed in CI.** The `rls-tests` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
> boots a local Supabase, applies migrations + seed, and runs every RLS test in
> this directory via `psql -v ON_ERROR_STOP=1` (a raised exception fails the job).
> As of Phase 4.0A all authored RLS tests — including the driver/tracking/
> assignment/temp-password suites above — are wired into that job.

> Note: if your local `auth.users` schema rejects the minimal insert, create the
> two test users via the service role (Supabase Auth admin API) and substitute
> their UUIDs in the script.
