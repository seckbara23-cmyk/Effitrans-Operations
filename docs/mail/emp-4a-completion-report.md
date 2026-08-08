# EMP-4A — Completion Report

**Date:** 2026-08-08 · **Commit `5fbaf5e`** · **No migration.** Migration 89 is unchanged.

Closes the two partial items in `emp-4a-deployment-report.md` §6: frozen steps **7** (new-user
onboarding integration) and **9** (existing-user and bulk workflows). Every other step was
already done and is untouched.

---

## 1. Files changed

15 files, +1467 / −5.

| File | Δ | What |
|---|---|---|
| `lib/ec/mailboxes/bulk.ts` | new, 175 | Pure classifier. Eight outcomes, no I/O. |
| `lib/ec/mailboxes/bulk-actions.ts` | new, 236 | Preview (reads only) + fingerprint-gated execute. |
| `components/ec/user-mailbox-panel.tsx` | new, 321 | Per-user memberships, proposals, capability edit. |
| `components/ec/bulk-assign-panel.tsx` | new, 174 | Preview-then-confirm surface. |
| `app/users/[id]/enterprise-mail/page.tsx` | new, 104 | Per-user surface. |
| `app/users/enterprise-mail/bulk/page.tsx` | new, 54 | Bulk surface. |
| `tests/emp-4a-onboarding-bulk.test.ts` | new, 308 | 35 tests. |
| `lib/ec/mailboxes/admin-actions.ts` | +54 | `setMembershipCapabilities`. |
| `app/users/[id]/page.tsx` | +9 | Link into the per-user surface. |
| `app/users/enterprise-mail/page.tsx` | +13 | Link into bulk. |
| `lib/audit/events.ts` | +3 | Batch audit action. |
| `lib/db/tenant-tables.ts` | +7 | **Registers all seven `ec_*` tables — see §6.** |
| `lib/ec/triage/service.ts` | +3/−1 | Tenant filter on an `ec_mailbox` read. |
| `tests/tenant-scope.test.ts` | +8 | One reviewed exception, with its reason. |
| `tests/emp-4a-mailbox-membership.test.ts` | +3/−1 | Audit-coverage list gains the new writer. |

## 2. User-detail workflow

`/users/[id]/enterprise-mail`, gated on `communication:membership:manage`.

Three regions: memberships the user **has**, mailboxes their roles **propose**, and the
capability editor for an existing membership. The proposals come from
`eligibleMailboxes(roleCodes)` — the same pure function EMP-4A already used, deterministic and
independent of role order.

**Nothing is assigned by opening the page.** There is no `useEffect` in the panel; every grant
is behind an `onClick`. This is asserted in the suite rather than left to review, because the
requirement was that recommendations are suggestions and not authorization decisions. The page
states the same thing in its own copy, so an administrator reading it learns the rule without
reading this document.

Revocation never deletes. It stamps `revoked_at`/`revoked_by`/`revoke_reason` and clears
`is_default_sender`, so a revoked member cannot remain the default sender of a mailbox they can
no longer read.

## 3. Bulk preview workflow

`/users/enterprise-mail/bulk`, same gate, shared mailboxes only.

The classifier returns exactly one decision per candidate across eight outcomes: `GRANT_NEW`,
`REACTIVATE`, `UPDATE`, `UNCHANGED`, `SKIPPED_NO_DEPARTMENT`, `SKIPPED_NOT_ELIGIBLE`,
`REJECTED_CROSS_TENANT`, `CONFLICT_DEFAULT_SENDER`. All eight render, including the ones nothing
happens to — a user who silently vanished from the list is a user whose fate the administrator
did not actually approve.

`CONFLICT_DEFAULT_SENDER` exists so a second default sender surfaces as a previewed conflict
rather than a unique-index error at write time.

## 4. Transaction boundaries

There is no multi-row transaction, and that is deliberate.

Execution is a **loop of independent upserts** keyed on the `(mailbox_id, user_id)` unique index.
A failure on one membership leaves the others applied; the batch audit row records `previewed`,
`writable`, and `applied` separately, so a partial batch is visible as a partial batch rather
than reported as a success. Wrapping the loop in one transaction would trade that visibility for
an all-or-nothing outcome that no requirement asked for, and would hold a write transaction open
across an unbounded user count.

Idempotency comes from the upsert, not from a transaction: re-running a batch re-decides every
user, finds them all `UNCHANGED`, and writes nothing.

**Preview writes nothing at all** — no row, no audit, no revalidation.

## 5. Security review

**The preview cannot be skipped.** `executeBulkAssignment` recomputes the preview server-side and
compares fingerprints; on mismatch it returns `preview_stale` and writes nothing. The client's
decisions are never trusted — only its claim about *which* preview it saw, verified against one
we just recomputed. A caller that never renders the page still cannot execute an unpreviewed
batch, so this is a property of the action rather than a convention of the UI.

**No new permission, no new role, no migration.** Both surfaces reuse
`communication:membership:manage`. SYSTEM_ADMIN holds neither correspondence nor membership
authority and gained nothing here.

**No `can_send_as`.** Absent from the schema, the capability set, and both surfaces, per §0.2 of
the governance freeze.

**Cross-tenant.** Candidate loading is tenant-filtered; `REJECTED_CROSS_TENANT` remains in the
classifier as defence in depth. See §6 — this was changed during close-out.

## 6. The tenant-scope finding

The platform's tenant-scope guard failed on my own code: the bulk loader read `user_role` without
a tenant filter. That was deliberate in an earlier draft — an explicit id list was loaded unscoped
so a cross-tenant selection would surface as `REJECTED` instead of vanishing.

**The guard was right and the draft was wrong.** An unscoped service-role read is a worse risk
than a less informative preview, and the UI offers no cross-tenant picker that would make the
trade worthwhile. All three candidate reads are now tenant-filtered.

Chasing it surfaced the larger finding. **None of the seven `ec_*` tables were in
`TENANT_SCOPED_TABLES`**, so service-role reads across the entire Enterprise Mail context had
never been guarded. This is a sync omission dating to EC-1, not a defect introduced by this
phase — the registry's own header asks to be kept in sync when a tenant-scoped table lands, and
seven were missed.

Registering all seven found exactly **two** unscoped reads out of 59:

| Site | Verdict |
|---|---|
| `lib/ec/triage/service.ts` — `ec_mailbox` | Safe by derivation (id came from an already tenant-verified message). Now filtered, so it is safe **on its face**. |
| `lib/ec/inbound/capture.ts` — `ec_webhook_event` | **Cannot** be scoped. It runs before routing resolves a tenant, which is the point of EC-1: captured first, attributed second. Key is provider-global; result used only as a boolean. Recorded as a reviewed exception with that reason. |

Net effect: the mail context is now under the same guard as the rest of the platform.

## 7. Audit behaviour

Every write is audited; the coverage assertion in
`tests/emp-4a-mailbox-membership.test.ts` now names seven writers, including
`setMembershipCapabilities`.

Bulk execution audits **twice**: one row per changed membership carrying the `batch_id`, and one
row for the batch itself carrying counts and the capability set. Either can be reconciled against
the other — "what happened to this person" and "what happened on Tuesday" both have a row to find.

Preview emits nothing. An aperçu is not an event.

## 8. Test results

**35 new tests**; suite total **5423 passing across 213 files**, `tsc --noEmit` clean,
`next build` clean with all three new routes emitted.

The classifier is pure, so bulk semantics are tested **behaviourally** rather than by reading
source: one decision per candidate, reactivation on the same row, idempotency, the default-sender
conflict, fingerprint stability. Source-level assertions are reserved for the properties only
source can hold — that no effect assigns on load, that execute requires a fingerprint, that
`can_send_as` appears nowhere.

Two failures during close-out were **my own test-authoring bugs**, not code defects: an
`expect(...) || expect(...)` that cannot express a disjunction, and an assertion searching for a
comment through a comment-stripping reader. Both were replaced with behavioural checks.

## 9. CI

Run and conclusion for `5fbaf5e` recorded in §11 below on completion of the verification poll.

## 10. Deployment implications

**None requiring an operator.** No migration, no new permission, no role change, no seed change,
no environment variable, no feature flag. Migration 89 is untouched and stays applied.

The only production-visible change is three new routes, all gated on an existing permission that
only MAIL_ADMIN holds today. An administrator without it sees `notFound()`.

## 11. Closure

Frozen steps 7 and 9 are complete; steps 1–6, 8, 10–12 were already done. **EMP-4A is closed.**

EMP-4B and EMP-5 are not begun.
