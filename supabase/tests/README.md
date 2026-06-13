# Supabase Tests

## RLS tenant-isolation (RLS-1)
[`rls_tenant_isolation_test.sql`](rls_tenant_isolation_test.sql) proves the
foundation RLS policies isolate tenants:

- a user in **tenant A** **cannot** read tenant B's `organization` / `app_user` rows;
- the same user **can** read its own organization and profile.

The test is **non-destructive** (wrapped in `BEGIN … ROLLBACK`) and simulates an
authenticated user with the Supabase RLS test pattern (`set role authenticated` +
`request.jwt.claims`).

### How to run
Requires the foundation migrations applied to a linked/local Supabase DB:
```
psql "$DATABASE_URL" -f supabase/tests/rls_tenant_isolation_test.sql
# or, with the CLI + local stack:
supabase db reset           # apply migrations + seed
psql "$(supabase status --output env | grep DB_URL | cut -d= -f2)" \
  -f supabase/tests/rls_tenant_isolation_test.sql
```
A successful run prints `RLS tenant isolation: PASS`; any leak/regression raises
an exception and aborts.

### Execution status
> **Not yet executed in this environment** — no local Supabase/Docker/psql is
> available here. The test is authored and ready; run it once the project is
> linked (or in a CI job that boots a local Supabase). Until then, RLS isolation
> is **implemented + scripted, pending execution**.

> Note: if your local `auth.users` schema rejects the minimal insert, create the
> two test users via the service role (Supabase Auth admin API) and substitute
> their UUIDs in the script.
