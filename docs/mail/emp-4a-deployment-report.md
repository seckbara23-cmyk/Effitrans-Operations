# EMP-4A — Deployment Report

**Date:** 2026-08-08 · **CI GREEN — run #387 on `3af379a`: `rls-tests` 82/0/0, `build` 10/0/0**
**Migration 89 `20260813000001_mailbox_membership.sql` — APPLIED IN PRODUCTION** (SQL Editor)
**Status: NOT COMPLETE.** Steps 7 and 9 of the frozen order are partial — see §6.

---

## 1. What is deployed

| Frozen step | State |
|---|---|
| 1. Migration 89 | **done** — applied in production, CI-verified |
| 2. Membership resolver | **done** |
| 3. RLS rewrites + behavioural assertions | **done** — four policies, six personas |
| 4. MAIL_ADMIN + conservative seed | **done** — three sources agree |
| 5. Membership service | **done** |
| 6. Operator-assisted provisioning lifecycle | **done** |
| 7. New-user onboarding integration | **PARTIAL** — §6 |
| 8. Administration → Users → Enterprise Mail | **done** |
| 9. Existing-user and bulk workflows | **PARTIAL** — §6 |
| 10. Tests | **done** — 39 TS contracts + a new SQL suite |
| 11. CI | **done** — run #387 green |
| 12. Deployment report | this document |

## 2. The security boundary that changed

Migration 89 rewrote **four deployed RLS policies**. Effective access to mailbox-attributable
evidence is now:

```
tenant match  AND  communication:inbound:read  AND  membership with can_read
```

Membership **narrows**. Every rewritten policy keeps the correspondence-authority term, so
membership can never substitute for it — verified in CI by the migration's own six-persona probe
and by `rls_mailbox_membership_test.sql`, and verifiable in production by the mechanical query in
`docs/ops/emp-4a-production-verification.md` §1.5.

`ec_webhook_event` is **not** membership-scoped (it carries no mailbox attribution) and is instead
narrowed to `communication:diagnostics:read`.

**Live blast radius today: zero.** `communication:inbound:read` is granted to no role, so nobody
could read correspondence before or after. The narrowing lands the moment RATIFY-EC1-1 does —
which is why memberships should be granted **before** that permission, not after.

## 3. What is deliberately absent

* **`can_send_as`** — ratified out. The provider envelope always uses
  `COMMUNICATIONS_EMAIL_FROM` and ignores the selected mailbox, so a capability by that name would
  claim an identity the recipient never sees. It returns in **EMP-4B**.
* **`can_reply_as`** — proven to have no meaning distinct from `can_send_as`: `saveDraft` resolves
  the sender once for compose and reply alike.
* **Any provider, domain, IMAP, POP3 or Exchange integration.** "Provision" reserves an internal
  identity; a retry re-asks the operator and calls nothing.
* **Any write policy.** None exists on any table in this schema, and 89 adds none.

## 4. Four defects found and fixed during this phase

1. **Column shadowing.** `ec_inbound_message` has its own `message_id` (the RFC 5322 header,
   `text`), so an unqualified reference inside two subquery policies bound to the inner table and
   compared `uuid = text`. Postgres rejected it at `CREATE POLICY`.
2. **A ratification violation I introduced.** `MAIL_ADMIN` initially carried
   `communication:inbound:read`, un-darkening the module. EC-1's suite pinned `perm_grants = 0`
   and caught it. Removed from all three sources — and the result is the better shape:
   **administering who may read correspondence is not the same authority as reading it.**
3. **Illegal cleanup of append-only evidence.** The migration probe created an
   `ec_inbound_message` fixture and deleted it. That table refuses UPDATE *and DELETE*, so the
   migration aborted **in production** — CI could not reproduce it, because CI's `organization`
   table is empty at migration time and the probe returns early there. Redesigned to persist
   nothing: a subtransaction that always rolls back, with measurements kept in variables and
   judged afterwards. **Migration 89 now contains no `DELETE` at all.**
4. **A privileged write inside a role switch.** The new SQL suite recorded results into a temp
   table while switched to `authenticated`, which holds no privilege on it. Measurements now
   collect into variables and are recorded after the reset.

Two fixture assumptions were also legitimately invalidated by the governance change: EC-1's and
EC-2's readers held the permission but no membership, so the new policies correctly denied them.
Both fixtures now grant membership to exactly the persona expected to read — the ones asserted to
see nothing were left alone, since granting them membership would destroy what they prove.

## 5. Operator actions

1. **Ledger reconciliation.** The SQL Editor executes DDL without writing `schema_migrations`:
   ```bash
   supabase migration repair --status applied 20260813000001
   supabase migration repair --status applied 20260812000001
   supabase migration list          # expect 89/89
   ```
   **Not `db push`; do not re-run 89.**
2. **Read-only verification** — `docs/ops/emp-4a-production-verification.md` §1, eleven checks.
3. **Bootstrap the first MAIL_ADMIN** — a SYSTEM_ADMIN assigns the role from
   Administration → Utilisateurs; the user re-signs-in. SYSTEM_ADMIN will not see the Enterprise
   Mail entry itself, which is correct and test-asserted.
4. **Nothing else.** No flag, no environment variable, no permission to grant for EMP-4A.

## 6. What remains — steps 7 and 9

Reported rather than claimed complete.

**Step 7 — new-user onboarding integration: partial.** The pieces exist and are tested —
`eligibleMailboxes()` derives suggestions from the role-derived department, `createUser` is
deliberately unmodified so a mail failure can never orphan an account, and membership can be
granted from the administration panel. **What is missing is the surface**: an Enterprise Mail
section on `/users/[id]` that shows a newly created user's suggested mailboxes and grants them in
place. Today an administrator must open the mailbox-centric panel and add the user per mailbox,
which works but is not "through the standard onboarding process".

**Step 9 — existing-user and bulk workflows: partial.** Per-user grant and revoke are complete,
audited and reversible. **Previewed bulk provisioning is not built** — assigning a department's
suggested mailboxes to many users in one reviewed action.

Neither gap affects correctness or security: everything shipped is gated, audited and CI-verified.
They are ergonomics, and building them half-way would be worse than naming them.

**Recommended next:** finish 7 and 9 as a small EMP-4A follow-up, before EMP-4B or EMP-5.

## 7. Remaining EMP roadmap

| Phase | Status |
|---|---|
| **EMP-4A steps 7 + 9** | **partial — the only outstanding EMP-4A work** |
| **EMP-4B** — provider sender identity and verified domains | not begun; owns `can_send_as` |
| **EMP-5** — AI suggestions | **untouched**, as required |
| EMP-6 — customer visibility | blocked on RATIFY-EMP-10 |
| **OPS-SEC-1** (recommended) | pre-existing RPCs likely executable by `authenticated` on hosted Supabase — reported at EMP-3, not patched |

Open: **RATIFY-EC1-1** — until it grants `communication:inbound:read` to a role, the Enterprise
Mail workspace remains dark and `/mail/inbox` 404s for every user.

---

## Confirmations

* **Membership is an RLS gate**, ANDed with the correspondence authority, never an alternative.
* **`prevent_mutation` was never weakened, disabled or exempted**, and migration 89 deletes nothing.
* **No inbound evidence was mutated and no correspondence history was rewritten.**
* **`communication:inbound:read` is still granted to no role**; SYSTEM_ADMIN holds no mailbox
  administration.
* **No Send As exists or is displayed anywhere.**
* **EMP-4B and EMP-5 have not begun.**
