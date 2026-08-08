# EMP-3 — Migration 87 privilege defects: rollback verification and correction

> **Addendum (2026-08-08) — the second failure was the ASSERTION, not the privileges.**
> A third attempt failed on `table write granted: anon/INSERT, authenticated/INSERT, …`.
> That check was wrong and has been replaced. See §7.

**Date:** 2026-08-07 · **Status: migration 87 remains UNAPPLIED. EMP-3 remains open.**
Migration 87's own privilege assertion refused the migration and it rolled back. Nothing was
patched manually and nothing was applied.

---

## 1. Rollback verification

**Why the rollback is total, structurally.** The Supabase CLI applies each migration inside a
single transaction. Migration 87's assertion is a `raise exception` in a `DO` block, so the
whole file — columns, constraints, indexes, all four functions and every grant — was undone by
the same `ROLLBACK`. There is no partial-application path: the failure happened in §5, after
every DDL statement in the file, and all of it shared one transaction.

**Boundary I must state:** this environment has no Docker, no `psql` and no authorized Supabase
MCP, so **I cannot query the target database directly.** The verification below is the exact
SQL an operator should run; I am not reporting its output as if I had.

```sql
-- 1. All four EMP-3 functions absent (expect 0)
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('comm_acquire_send','comm_record_send_accepted',
                     'comm_record_send_failed','comm_reconcile_stuck_send');

-- 2. Migration 87 columns absent (expect 0)
select count(*) from information_schema.columns
 where table_schema = 'public' and table_name = 'communication_message'
   and column_name in ('kind','mailbox_id','to_addresses','cc_addresses','bcc_addresses',
                       'message_id_header','in_reply_to','references_header',
                       'reply_to_message_id','attachments','provider','provider_message_id',
                       'idempotency_key','dispatched_at','thread_id','created_by_draft_at');

-- 3. Migration 87 constraints absent (expect 0)
select count(*) from pg_constraint
 where conname in ('communication_message_kind_check',
                   'communication_message_template_coupling',
                   'communication_message_reply_shape',
                   'communication_message_sent_evidence');

-- 4. Migration 87 indexes absent (expect 0)
select count(*) from pg_indexes where schemaname = 'public'
   and indexname in ('uq_comm_idempotency','idx_comm_mailbox','idx_comm_in_flight','idx_comm_thread');

-- 5. Pre-87 schema intact: template_key still NOT NULL, status still the original four
select is_nullable from information_schema.columns
 where table_schema='public' and table_name='communication_message' and column_name='template_key';
   -- expect: NO
select pg_get_constraintdef(oid) from pg_constraint
 where conname = 'communication_message_status_check';
   -- expect: CHECK (status = ANY (ARRAY['QUEUED','SENT','FAILED','CANCELLED']))

-- 6. Ledger chain still 86
select count(*), max(version) from supabase_migrations.schema_migrations;
```

If (1)–(4) return non-zero, the rollback was **not** clean and must be reported before anything
else is attempted — do not proceed to re-apply.

---

## 2. Exact root cause

**Two independent grant paths existed. The first attempt closed only one.**

1. **PUBLIC by default.** PostgreSQL grants `EXECUTE` on every newly created function to
   `PUBLIC`. Every role inherits from `PUBLIC`, so `anon` and `authenticated` could call all
   four functions without any grant naming them.
2. **Supabase's default privileges.** A Supabase project carries
   `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated`.
   That writes **explicit** grant rows for those two roles at creation time. **Revoking from
   `PUBLIC` does not remove an explicit grant.**

The first attempt ran only `revoke all on function ... from public`. It closed path 1 and left
path 2 fully intact — which is precisely what the assertion observed.

**Why CI did not catch it and the target database did.** A bare local Postgres has no Supabase
default-privilege configuration, so only path 1 exists there and revoking `PUBLIC` genuinely is
sufficient. The defect is only reachable on a real Supabase project. This is also why the
earlier CI run reached the `rls_communication_test` failure at all — migration 87 applied
cleanly in that environment.

**The assertion did its job.** It was written to prove the matrix rather than assume it, and it
refused a migration that would otherwise have exposed four `SECURITY DEFINER` functions to
every browser session.

### The wider finding — reported, not fixed here

**No migration in this repository revokes from `anon` or `authenticated`.** The established
pattern is `revoke execute ... from public` (+ sometimes `grant ... to service_role`), used by
the quotation, document, customs, reconciliation and policy RPCs. By the same two-path
reasoning, **those functions are likely executable by `authenticated` sessions via PostgREST on
a hosted Supabase project.** Migration 87's assertion is the first in this codebase to check.

This is out of EMP-3's scope and is **not** touched here: it affects many pre-existing
functions, several of which take an actor/tenant parameter, so the exposure has to be assessed
per function rather than blanket-revoked. **Recommend a dedicated phase** (`OPS-SEC-1`) to
audit and close it. Raised as a finding, not silently patched.

---

## 3. Corrected privilege matrix

| Grantee | EXECUTE on the four `comm_*` functions | How enforced |
|---|---|---|
| `PUBLIC` | **denied** | `revoke all ... from public` + ACL assertion (`aclexplode`, grantee 0) |
| `anon` | **denied** | explicit revoke + `information_schema` + `has_function_privilege` |
| `authenticated` | **denied** | explicit revoke + `information_schema` + `has_function_privilege` |
| `service_role` | **granted** | explicit `grant execute`, asserted present |

Every `REVOKE` and `GRANT` names the function's **exact identity signature**, so a future
overload can neither inherit nor escape the matrix. The functions remain `SECURITY DEFINER` —
**what changed is who may invoke them, not what they may do.** Weakening them to satisfy the
test was never an option and is pinned against.

---

## 4. Assertions

Migration 87 now asserts through **both** required mechanisms, because they answer different
questions:

* `has_function_privilege(role, exact_signature, 'EXECUTE')` — **effective** privilege,
  inheritance included. The ground truth for `anon` and `authenticated`.
* `pg_proc.proacl` via `aclexplode` (grantee `0`) and `information_schema.routine_privileges` —
  the **grants that exist**. Only these can see `PUBLIC`, which is not a role and cannot be
  passed to `has_function_privilege` at all. **`PUBLIC` is the grantee the first attempt
  missed**, so an assertion that could not see it would have passed the broken migration.

ALLOWED / DENIED / BROKEN are classified separately, and `service_role`'s access is asserted
**present** — a matrix that denied everyone would "pass" while breaking sending entirely.

## 5. Tests

**New SQL suite** `supabase/tests/rls_outbound_mail_test.sql`, wired into CI as the last step:

* PUBLIC holds no EXECUTE (ACL); no grant rows for `anon`/`authenticated`/`PUBLIC`;
  neither role has effective EXECUTE; `service_role` does.
* **The 42501 itself** — the suite does `set local role anon` / `authenticated` and calls the
  RPCs, requiring `insufficient_privilege`. A PostgREST call from a browser runs as exactly
  these roles, so a refusal here is a refusal there.
* Dispatch invariants against a real database: CAS admits one winner; a stub provider is
  refused; a real acceptance emits **exactly one** `CORRESPONDENCE_SENT`; a **second**
  acceptance emits nothing more; a failed send emits nothing and lands on `FAILED`.

**Six new TypeScript contracts** pin the revoke triple with exact signatures, the
`service_role`-only grant, both assertion mechanisms, that the functions stay
`SECURITY DEFINER`, and that the SQL suite is registered in CI.

---

## 6. Status

* Migration 87 is **corrected but UNAPPLIED**.
* **EMP-3 remains open** and is not to be treated as complete until CI is green on the exact
  SHA with zero skipped and zero failed, and the operator has applied and verified 87.
* **EMP-4 has not begun.**
* Nothing was patched manually in any database.


---

## 7. The table-write assertion was testing the wrong property

**A third attempt at migration 87 refused itself over `INSERT/UPDATE/DELETE` grants on
`communication_message` for `anon` and `authenticated`. Those grants are inert, and revoking
them was declined.**

### What the audit established

| Question | Answer |
|---|---|
| Does this repo grant DML to browser roles anywhere? | **No.** `20260613000004_grant_table_privileges.sql` says so explicitly: *"READS ONLY: no INSERT/UPDATE/DELETE granted to `authenticated`… writes run via the service role."* A search across all 87 migrations finds no such grant. |
| Where do the grants come from, then? | A **Supabase project's default privileges** (`ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO anon, authenticated`) — the same mechanism behind the function-EXECUTE defect in §2, and why a bare local stack does not show them. |
| Are there write RLS policies on `communication_message`? | **No.** It has RLS enabled and exactly one policy, `communication_message_select`. |
| Are there write policies anywhere in the platform? | **None.** All 37 `for update` occurrences in the migrations are SQL row locks (`SELECT … FOR UPDATE`), not policies. `create policy … for insert/update/delete` appears **zero** times. |
| Can `anon`/`authenticated` actually mutate rows? | **No.** With RLS enabled and no policy for a command, PostgreSQL denies that command to every non-owner role **regardless of the GRANT**. |
| Does the service-role architecture depend on these grants? | **No.** Writes use the service role, which has its own privileges and bypasses RLS. |

### The distinction that matters — and why §2's revoke was still right

The two cases look alike and are not:

* **A function has no RLS.** An `EXECUTE` grant on a `SECURITY DEFINER` function **is** the
  entire control: if `authenticated` may call it, it runs with the definer's rights and nothing
  else intervenes. The §2 revoke was correct and necessary.
* **A table under RLS is protected by policy, not by grant.** With no write policy, the grant
  can never be exercised. It is inert.

Conflating them is what produced the failed assertion.

### Decision: fix the assertion, not the privileges

Revoking table DML on `communication_message` would not improve security — RLS already denies
the write — and would single this table out from every other table in a platform-wide, deployed
posture. Per the governing instruction (*"only revoke if truly unnecessary and doing so does not
change the deployed security model"*), the privileges stand.

The assertion now proves **effective immutability**:

1. RLS is **enabled** on the table (without it, the grants would be live);
2. **no policy** exists for `ALL`/`INSERT`/`UPDATE`/`DELETE`;
3. behaviourally, in `rls_outbound_mail_test.sql`: as `authenticated`, an `INSERT` is refused
   and `UPDATE`/`DELETE` change nothing — with the sent row asserted **unchanged and still
   present** afterwards.

Point 3 accepts **either** denial mechanism, because the two environments differ: on a hosted
project (grant present, no policy) `UPDATE`/`DELETE` match **0 rows**; on a bare local stack (no
grant) they raise **42501**. The test asserts the outcome — the evidence is untouched — rather
than the mechanism, which is the only formulation true in both.
