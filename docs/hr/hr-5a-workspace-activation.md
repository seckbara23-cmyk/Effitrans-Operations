# HR-5A — HR Workspace Activation

**Status:** PLAN ONLY — nothing executes without ratification and an explicit go.
**Type:** an **activation** phase, not a build. HR-1 through HR-5 are deployed; migration
77 is live; the ledger reads 77/77. Everything the HR platform does is already in
production and **dark**. HR-5A is the governed act of turning it on.

## The honest state today

Five phases shipped, and a tenant sees almost nothing — by design. Three things hold the
platform dark, and only the first is a permission problem:

| # | What is dark | Why | Unblocked by |
|---|---|---|---|
| 1 | Configuration centre, sensitive documents, leave approval | `hr:config:manage`, `hr:sensitive:read`, `hr:leave:approve` exist in the catalogue and are **granted to nobody** | one ratification, one grant migration |
| 2 | Organisation tree, checklists, equipment types, leave categories | tables are **empty** — no unit, position, location, checklist template or entitlement has been entered | the tenant's own answers (B2) |
| 3 | Import **application**, `employee_identifier` | HRQ-A4 purge window; DEC-B63 legal answers | legal input |

A tenant with `hr:read`/`hr:manage` can already use the registry, the employee workspace,
onboarding, equipment and leave *requests*. What they cannot do is configure the
organisation, approve leave, or read C3 documents.

## Scope of HR-5A

**One migration and no application code.** Specifically:

1. **The grant migration** — a single additive migration inserting `role_permission` rows
   for the three ratified permissions. Which roles receive which code is the ratification's
   output, not this document's assumption. Constraints already settled and not reopened:
   **SYSTEM_ADMIN receives none of them** (DEC-B25, the D-11 precedent), and
   `hr:leave:approve` **must not** collapse into `hr:manage`.
2. **A seeding session, not a seed migration** — the tenant's structure (units, positions,
   locations, checklist templates, equipment, leave categories and entitlements) is entered
   **through the configuration centre and the workspaces**, by a person, audited. It is
   never a migration: seeding one tenant's real organisation into schema would make it
   everyone's, and would bypass the audit trail the whole platform is built on.
3. **An activation smoke pass** — the same shape as R1.0's §A/§B: each newly-granted
   surface opened once by a real holder, each refusal that *should* still refuse confirmed
   to refuse, recorded with names and dates.
4. **A close-out** recording what was activated, for whom, and what remains dark.

## Explicitly NOT in HR-5A

No new tables, no new permissions, no new features · no import **application** (HRQ-A4) ·
no `employee_identifier` (DEC-B63) · no statutory leave values (counsel) · no HR-6 work ·
no change to any ratified decision from HR-0F through HR-5.

## Prerequisites — all outside my hands

| # | Prerequisite | Owner | State |
|---|---|---|---|
| P1 | **HRQ-D2** ratified: who holds `hr:config:manage` and `hr:sensitive:read` | management | open |
| P2 | **`hr:leave:approve` holder** decided (`hr-5-permission-ratification.md`, options A/B/C) | management | open |
| P3 | **B2 structure answers**: units, positions, locations, numbering, wizard operator, approval seats | management | open |
| P4 | A named person per newly-granted role, to run the smoke pass | operator | open |

**P1 and P2 should be ratified together** — they are the same kind of decision, and
bundling them turns three grant migrations into one.

## Sequence, once P1–P4 close

1. Write the grant migration from the ratified matrix (additive, idempotent, no DDL).
2. CI green on a clean 1→78 chain — the standing gate; operator SQL waits for it.
3. Operator applies it; ledger repaired to 78/78; I re-verify independently.
4. Seeding session through the UI: configuration centre first (it gates the rest), then
   checklist templates, equipment, leave categories and entitlements.
5. Activation smoke pass; record results.
6. Close-out; STATUS.md updated; the HR platform is live for its holders.

## Risk to name now

**Activation is when a dark platform meets real people.** Everything until this point has
been provable in CI; from here the failures are human — a permission granted too widely, a
structure entered wrongly, a leave approved by someone who should not have that authority.
The mitigations are already in place (least-privilege grants, maker-checker CHECKs, audit
on every write, an immutable ledger), but the phase should be run deliberately and with a
named person per role rather than in one sitting.

**Nothing in HR-5A is technical work. It is a decision, a grant, a data-entry session and a
sign-off.**
