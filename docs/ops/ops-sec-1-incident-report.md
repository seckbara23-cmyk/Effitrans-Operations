# OPS-SEC-1 — Incident and Remediation Report

**Date:** 2026-08-08 · **Migrations 90, 91, 92** · Privilege-only throughout.

Records the OPS-SEC-1 P0 remediation and, in equal detail, the five process failures that
occurred during it. Four of the five were mine.

---

## 1. The finding

A class of privileged RPCs was executable by unauthenticated callers and enforced no caller
authorization. The shape was uniform: `SECURITY DEFINER`, owned by `postgres`, writing tables
without `FORCE ROW LEVEL SECURITY` (so RLS-bypassing), accepting the acting user and the tenant
as ordinary parameters, resolving no identity from session context, and checking no permission.
The only checks present were business-rule checks — status gates, maker≠checker — which are
integrity, not authorization.

**The caller declared who they were and the function believed them.**

Reachability was proven rather than assumed: a zero-effect probe using only the public anon key
reached the body of `quotation_validate` and returned `QT604`, the function's own first-line
guard. Two aggravating factors: forged `business_event` rows cannot be deleted (`prevent_mutation`
is append-only, correctly), and the only obstacle was UUID secrecy — not a control, since the
platform prints those UUIDs in portal URLs, PDFs and e-mail.

## 2. What was done

| Migration | Scope | State |
|---|---|---|
| **90** `20260814000001` | Revoke `EXECUTE` from `PUBLIC`, `anon`, `authenticated` on 43 SECURITY DEFINER functions; grant `service_role` | Applied |
| **91** `20260814000002` | The same for `next_quotation_number(uuid)` and `supersede_document(uuid,uuid,uuid,uuid)` | Applied |
| **92** `20260814000003` | Restore `authenticated` EXECUTE on `user_readable_file_ids(uuid,uuid)` — a transitive policy dependency 90 wrongly revoked | Applied |

No function body, table, RLS policy, trigger, index or row was changed by any of the three.

Preserved deliberately and asserted in SQL: the 13 functions named in RLS policy expressions keep
`authenticated` EXECUTE (`auth_tenant_id` alone backs 135 policies across 130 tables), and
`get_user_permissions` keeps it because the browser calls it.

## 3. Failure 1 — the repository was public when the target list was pushed

Commit `01ac1bc` put migration 90, and therefore all 43 exact signatures, into a **public**
repository while the vulnerability was still open. RATIFY-OPSSEC-2 stated the repository *would
be* made private; I proceeded as though that had already happened and verified only afterwards,
by reading the pushed file over unauthenticated HTTPS.

**The repository was still public at the time of writing this report.**

Mitigating, but not excusing: the function *bodies* were already public in `supabase/migrations/`
and already showed these functions taking `p_actor`/`p_tenant` with no caller check. The
increment was the list, and the implication that the grants were open.

Rewriting history was considered and rejected. A force-push leaves dangling commits reachable by
SHA, plus caches, forks and any clone taken in the interval; treating it as a retraction would be
self-deception. The window was closed by **applying the fix**, which is what actually removes the
value of the disclosure.

**Change:** verify the state a precondition describes before acting on it. "Will be done" is not
"is done."

## 4. Failure 2 — migration 90 was applied before its CI conclusion was checked

CI run **#397** on `01ac1bc` — migration 90 alone — **failed**. Nobody saw it. I had started a
poller for that SHA, then stopped it when a newer SHA superseded it, and never returned to read
its conclusion. The migration went to production unverified.

This violates a rule already recorded in my own notes: verify the CI conclusion after every push.
Stopping a poller is not the same as checking a result.

Compounding it: an aborting SQL step skips every later suite, so run #397 showed **1 failed and
70 skipped**. That shape is also already in my notes as the signature of exactly this problem.

**Change:** an abandoned CI run still needs its conclusion read before anything built on that
commit is deployed. Superseding a SHA does not retire its result.

## 5. Failure 3 — a transitive policy dependency was missed

The audit enumerated functions named **directly** in RLS policy expressions and preserved those
13. It never followed the call graph one level deeper, into functions those helpers themselves
call.

`can_read_file(uuid)` is referenced by **21 policies across 21 tables** and is **SECURITY
INVOKER** — so its inner calls execute as the *original caller*. It calls
`user_readable_file_ids(uuid,uuid)`, which migration 90 revoked from `authenticated`. Every
policy calling it then raised, in production:

```
ERROR: 42501: permission denied for function user_readable_file_ids
CONTEXT: SQL function "can_read_file" statement 1
```

`can_read_task` calls the same function but is SECURITY DEFINER, so its inner call runs as the
owner and was unaffected. A live catalog sweep confirmed `can_read_file` was the only broken
caller, so the fix was a single grant.

**Every metadata assertion I wrote passed, and passed correctly** — the 13 named helpers really
were fine. The break was one level underneath, where nothing was looking. This is the important
lesson: `has_function_privilege` checks cannot detect a transitive dependency failure. Only a
behavioural probe that actually calls the helper as `authenticated` can.

**Change, encoded in migration 92 rather than left as a note:** assertion 3 fails if *any*
SECURITY INVOKER function callable by `authenticated` calls a function `authenticated` cannot
execute. That generalises the mistake instead of patching its one instance.

## 6. Failure 4 — ledger repair preceded verification of 91/92's physical effects

`migration repair` was run before the physical privilege state produced by migrations 91 and 92
had been verified. The ledger is a record of what is applied; marking entries applied before
confirming their effect inverts the order — the record was updated ahead of the evidence.

No harm resulted: the subsequent read-only verification confirmed the intended end state. But the
sequence should be apply → verify physically → repair the ledger, never repair → verify.

**Change:** ledger repair is the *last* step, after physical verification, not part of applying.

## 7. Failure 5 — a probe was described as zero-effect on inherited reasoning

The post-90 probe of `next_quotation_number` was run using the pattern established for
`quotation_validate`, which is inert by construction because it raises on an unknown decision
before touching anything. `next_quotation_number` has no such guard — **it writes**. It returned
`23503`, a foreign-key violation, because the sentinel tenant does not exist.

No production data was modified, and the outcome was deterministic rather than lucky. But the
inertness came from a different mechanism than the one claimed, and I had not re-derived it
before running the probe.

**Change, encoded in migration 91's comments:** state *which* guarantee makes a probe inert. For
a write path, inertness rests on the sentinel failing its foreign key **and** on the migration
raising, which aborts the transaction and rolls back anything written.

## 8. Restoration

Production was restored with the narrowest possible grant:

```sql
grant execute on function public.user_readable_file_ids(uuid, uuid) to authenticated;
```

`anon` and `PUBLIC` remain revoked. No RLS policy targets `anon` (0 of 172), so `anon` never
needed this function, and the anonymous execution path OPS-SEC-1 exists to close stayed closed
throughout the restoration.

**Confirmed final physical state:**

```
next_quotation_number(uuid)                     anon=false  authenticated=false
supersede_document(uuid,uuid,uuid,uuid)         anon=false  authenticated=false
user_readable_file_ids(uuid,uuid)                           authenticated=true
```

## 8b. Closure verification

**CI run `31280066280` (#399) on `7f3f566`** — the SHA containing migrations 90, 91 and 92:

```
job rls-tests   success   steps ok=82  skipped=0  failed=0
job build       success   steps ok=10  skipped=0  failed=0
```

All 82 suites executed. This matters specifically here: runs #397 and #398 showed 1 failed and
70 skipped, because an aborting SQL step skips every later suite. Zero skipped is what proves the
suites ran rather than merely not reporting red.

**Read-only production verification, 12 checks:**

| Check | Expected | Actual |
|---|---|---|
| A. remediation targets | — | 49 |
| B. targets `anon` can execute | 0 | **0** |
| C. targets `authenticated` can execute | 0 | **0** |
| D. targets `PUBLIC` holds | 0 | **0** |
| E. targets retaining `service_role` | = A | **49** |
| F. the two migration 91 targets | denied | **anon=false auth=false pub=false svc=true** (both) |
| G. `user_readable_file_ids` | auth only | **anon=false auth=true pub=false svc=true** |
| H. RLS helpers retaining `authenticated` | 13 | **13** |
| I. RLS helpers that lost it | 0 | **0** |
| J. `get_user_permissions` callable | true | **true** |
| K. invoker fns calling a denied fn | 0 | **0** |
| L. anon-executable SECURITY DEFINER left | — | **7, all explained below** |

Check K is the one that did not exist before the outage. It now runs as a standing check.

**External anon probe** — the same path that originally reached `quotation_validate`'s body:

```
quotation_validate      HTTP 401  42501 permission denied  (denied before body)
next_quotation_number   HTTP 401  42501 permission denied  (denied before body)
emit_business_event     HTTP 401  42501 permission denied  (denied before body)
```

`emit_business_event` is included deliberately: it was the ledger-forgery path, and forged
append-only events could never have been deleted.

**The residual 7.** Check L is not zero, and closing without explaining it would be dishonest.
All seven are members of the 13 preserved policy helpers, all non-mutating boolean predicates,
none within the ratified scope: `can_read_task`, `is_assigned_driver`, `portal_can_read_file`,
`portal_can_read_invoice`, `portal_can_read_shipment`,
`messaging_staff_can_access_conversation`, `messaging_portal_can_access_conversation`.

Probed as `anon`, **all seven return `false`** — with no JWT there is no identity to resolve, so
they are inert rather than an oracle. They retain `anon` EXECUTE only because the P0 preserved
the helper set wholesale in order not to break RLS.

**Tightening available, not taken here:** `anon` needs none of them — 0 of 172 policies target
`anon` — so `anon` EXECUTE could be revoked while `authenticated` is preserved. That is a
privilege change outside the ratified scope and belongs to a later phase. Recorded, not actioned.

## 9. What worked

Worth recording, because the failures above are not the whole picture.

- **Live verification against the hosted database, not migration text.** Hosted Supabase creates
  explicit `anon`/`authenticated` grants that a local PostgreSQL does not reproduce. A
  source-only audit would have found nothing.
- **`aclexplode` alongside `has_function_privilege`.** Neither alone is sufficient: `PUBLIC` is
  not a login role, so only ACL inspection sees it.
- **Refusing to skip.** An early draft used `pg_get_function_identity_arguments`, which on
  PostgreSQL 17 includes parameter names; `to_regprocedure` rejects that form and returns NULL.
  The migration would have revoked nothing while all four assertions passed vacuously. Caught by
  testing the signature form against the live catalog before shipping. The migration now aborts
  on an unresolvable signature and asserts processed count equals expected.
- **CI caught the regression** that review did not, at the first RLS suite, on both affected SHAs.

## 10. Residual and follow-on

**Still open, unchanged by this release:**

- **P1 — caller-declared authority.** Revoking the grant closed the door; the design is untouched.
  These functions still accept `p_actor`/`p_tenant` from the caller. → **OPS-SEC-2**.
- **P2 — `get_user_permissions`** trusts its argument, but is SECURITY INVOKER and constrained by
  RLS on `user_role` to the caller's own tenant. Same-tenant colleague disclosure remains.
- **P2 — the expense digest** binds content but not tenant or document identity.
- **Registry gap** — 140 live tables carry `tenant_id`; the registry lists 83. → **OPS-TENANT-1**.
- **Repository visibility** — public at the time of writing.

**Recommended for OPS-SEC-2:** make `can_read_file` SECURITY DEFINER so the inner call runs as
owner and the grant in migration 92 becomes unnecessary. That is a function-body change and was
correctly out of scope for a privilege-only release.
