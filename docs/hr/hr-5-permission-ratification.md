# HR-5 — Ratification request: `hr:leave:approve`

**Raised:** 2026-08-02, by HR-5 implementation · **Type:** the smallest decision that
unblocks leave approval. Nothing else in HR-5 depends on it.

## The question, in one line

**Who may approve or refuse a leave request?**

## Why this needs a decision rather than a default

`hr:manage` already lets its holder create and submit a leave request. If approval also
rode `hr:manage`, the same person could request and approve — and the maker-checker rule
would be reduced to a database CHECK that only stops the *literal* same-actor case while
leaving the *authority* undivided. Separation of duties has to exist in the permission
model, not only in a constraint.

So HR-5 ships `hr:leave:approve` as a **catalogue row granted to no role**. The approval
action denies everyone today. That is the honest state of an unratified authority: the
feature is visible and requestable, and the workspace says plainly why nothing can be
decided yet.

## What is already true (no decision needed)

- The requester can never decide their own request — enforced twice: a CHECK
  (`approved_by <> requested_by`) and an explicit refusal inside the RPC.
- A decided request is immutable; a correction is a new request.
- Approval, the entitlement movement and the ledger event commit in one transaction.
- Approval writes an audit row naming actor, request and decision.

## The decision to take

Grant `hr:leave:approve` to the roles management chooses. Options, from narrowest:

| Option | Holders | Consequence |
|---|---|---|
| **A** | `HR_OFFICER` only | HR decides all leave. Simple; concentrates authority in one function. |
| **B** | `HR_OFFICER` + a manager role | Line managers decide their people's leave; HR arbitrates. Needs a manager role that exists today — currently there is none in the HR family. |
| **C** | A new dedicated role (e.g. `HR_APPROVER`) | Cleanest separation; costs a 30th role and its provisioning parity work. |

**No recommendation is made on who should hold it** — that is an organisational choice
about who carries the authority, not a technical one. What is technical, and settled: it
must not be `hr:manage`, and it must not be `SYSTEM_ADMIN` (DEC-B25 — administering the
platform is not employment authority, the same rule applied to `finance:aging:*` under
D-11).

## Activation, once ratified

One additive migration inserting the `role_permission` rows for the chosen role(s). No
schema change, no code change, no redeploy of HR-5. The workspace's explanatory notice
disappears on its own the moment a holder exists.

## Related open item

This should be ratified **alongside HRQ-D2** (the ceiling 9 → 11 for `hr:config:manage`
and `hr:sensitive:read`), since all three are the same kind of decision — a permission
that exists, is enforced, and awaits an owner. Ratifying them together avoids three
separate grant migrations.

**Decision:** ☐ A ☐ B ☐ C ☐ other — Decided by: ____________ · Date: ________
