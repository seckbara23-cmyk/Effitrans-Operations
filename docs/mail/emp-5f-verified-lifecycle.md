# EMP-5F — Verified Mailbox Lifecycle Enforcement

**Phase:** EMP-5F · **Mode:** audit first, then narrow implementation
**Baseline:** EMP-5E at SHA `d7baba5`, CI `31320597685` (#417); production migrations aligned
through `20260818000001`.

> No personal or customer data appears here. The single production mailbox is referred to by its
> properties, never by its address.

---

## 1. Audit — the lifecycle as found

### Everything that could change mailbox state

| # | Writer | Gate | Wrote |
|---|---|---|---|
| 1 | `provisionMailbox` | `communication:mailbox:provision` | INSERT at `PENDING_EXTERNAL_SETUP` |
| 2 | `recordSetupOutcome` | provision | `ACTIVE` \| `SETUP_FAILED`, note, `provisioned_at/by` |
| 3 | `retryProvisioning` | provision | → `PENDING_EXTERNAL_SETUP`, attempts + 1 |
| 4 | `setMailboxEnabled` | provision | `ACTIVE` ↔ `DISABLED` |
| 5 | `setDepartmentEligibility` | provision | eligibility only (EMP-5E) |
| 6 | **`setMailboxActive`** | **`communication:manage`** | **`is_active` — INERT** |

Database side: `trg_ec_mailbox_sync_active` (BEFORE INSERT OR UPDATE) derives `is_active` from
`provisioning_status`; `trg_ec_mailbox_address_unique`; `trg_ec_mailbox_updated_at`. **No RLS write
policy exists on `ec_mailbox` at all**, so every write is service-role behind an application gate —
the app gate *is* the boundary. No RPC and no other trigger touches lifecycle state.

### Four findings

**F1 — a second lifecycle that could not work, and lied about it.** `setMailboxActive` wrote
`is_active` directly. EMP-4A's trigger sets `new.is_active := (new.provisioning_status = 'ACTIVE')`
on **every** update, so an UPDATE touching only `is_active` was reverted in the same statement. The
action changed nothing, returned `{ok: true}`, and wrote an `ec.mailbox.activated` /
`ec.mailbox.deactivated` audit row — **under the same action codes the real lifecycle uses** — for a
change that never happened. Verified against the live catalog: the trigger and its body are present
in production exactly as described.

**F2 — the EMP-5C evidence contract was unreachable.** Nothing in the codebase ever wrote
`ownership`, `external_provider`, `external_mailbox_id`, `integration_address`, or any
`*_verified_*` column. The evidence columns could be read and displayed but never satisfied.

**F3 — `provisioning_status` defaulted to `'ACTIVE'`.** Any insert omitting the column — future
code, a seed, an operator's SQL — created an operational, evidence-free mailbox through no gate at
all.

**F4 — two ungated routes to ACTIVE.** `recordSetupOutcome` accepted `ACTIVE` with an empty note
(the nineteen-second path), and `setMailboxEnabled(true)` re-activated from `DISABLED` without
examining any evidence.

### On the STOP condition

The brief says to stop if more than one competing lifecycle exists. There is **one authoritative
lifecycle** — `provisioning_status`, with routing derived from it by trigger — and **one impotent
shadow control** that cannot change it. That is not an ambiguity enforcement would be built over;
it is a defect, and the database settles which one wins. I proceeded, and retiring the shadow
control is part of this phase. Repairing it was rejected: it would have pointed a
`communication:manage` gate at the lifecycle, which requires `communication:mailbox:provision` — a
privilege widening dressed as a bug fix.

## 2. Final state model

`RESERVED → CONFIGURATION_REQUIRED → CONFIGURED → PENDING_VERIFICATION → VERIFIED → ACTIVE`,
plus `FAILED` and `DISABLED`, with the meanings the brief froze. **`ACTIVE` means verified and
explicitly enabled — never "an operator clicked success".**

The three EMP-4A spellings remain legal because rows hold them, and are mapped in exactly one place
(`lib/ec/mailboxes/lifecycle.ts`), never written again:

`DRAFT → RESERVED` · `PENDING_EXTERNAL_SETUP → CONFIGURATION_REQUIRED` · `SETUP_FAILED → FAILED`

An unrecognised stored value resolves **downward** to `RESERVED`. Guessing upward from something we
do not understand is how an unknown becomes an ACTIVE mailbox.

## 3. Activation guard

One authority, `activationGuard`, pure and taking `now`. It returns **every** blocker, not the
first — an administrator who fixes one problem only to meet the next turns verification into a
guessing game.

`NO_ACTOR` · `FORBIDDEN` · `CROSS_TENANT` · `UNRESOLVED_FAILURE` · `WRONG_STATE` ·
`TYPE_INCOMPATIBLE` · `OWNERSHIP_UNKNOWN` · `EXTERNAL_REFERENCE_MISSING` ·
`CORPORATE_IDENTITY_UNCONFIRMED` · `EVIDENCE_STALE` · `NO_VERIFIER_RECORDED` ·
`MAKER_CHECKER_SAME_ACTOR`

### Capability-specific readiness — Option B, as preferred

`ACTIVE` depends on **identity** evidence. Outbound and inbound readiness are independent facts
gated by their own evidence. Requiring inbound proof before permitting outbound use would block a
legitimate outbound-only arrangement — and Effitrans's coexistence may well be exactly that, with
inbound fed by a provider-side copy rule that does not exist yet.

### Freshness

The mechanism exists and is tested; **no window is imposed by default**. "Evidence older than N days
is stale" is a policy Effitrans must choose, and picking a number here would be inventing one and
then enforcing it on a live system. → **RATIFY-EMP5F-1**.

## 4. Maker-checker

Enforced, and it needed **no new workflow**: both acts already require
`communication:mailbox:provision`, so separation needs two holders of an existing permission. The
guard refuses when the activator is the person who recorded the identity verification
(`MAKER_CHECKER_SAME_ACTOR`), and equally when **no** verifier was recorded — without a maker there
is nobody for the checker to differ from, and separation would be satisfied vacuously.

Consequence, and it is an operator decision: **a tenant with one mailbox administrator cannot
activate a mailbox.** That is the correct answer, not a bug.

Anonymous and SYSTEM activation are refused (`NO_ACTOR`), consistent with RATIFY-OPSSEC2-2A.

## 5. Migration 97 — `20260819000001_verified_mailbox_lifecycle.sql`

Additive; **changes no row**.

1. **Widens** the status CHECK to the eight canonical states plus the three legacy spellings. A
   widening validates for free and outlaws nothing rows already hold.
2. **`set default 'RESERVED'`** — closes F3. Future inserts only.
3. Adds six nullable accountability columns: `activated_at/by`, `verification_submitted_at/by`,
   `outbound_verified_by`, `inbound_verified_by`, each FK'd to `app_user`.
4. Data-independent assertions, including that the routing trigger still exists and that **no
   legacy marker column** was added.

**No legacy marker is stored.** Legacy-active is derived with zero inference —
`provisioning_status = 'ACTIVE' AND activated_by IS NULL` — and a derived fact that becomes a stored
one starts drifting the day it is written.

Migrations 95 and 96 are untouched.

## 6. UI

The four steps are rendered as a stepper, and each mailbox shows state, ownership, corporate
identity status, outbound and inbound readiness, last verification date, whether a verifier is
recorded, the evidence reference, blocking reasons and the next permitted action.

**Every judgement is made on the server** and arrives as a `MailboxLifecycleView`. The panel
evaluates no rule of its own: a second copy of the rules goes stale, and a client component reading
its own clock would disagree with the server that runs the action.

**« Activer » is absent whenever activation would fail**, with the blockers listed in its place.

Readiness checks are labelled **automated** (derived from platform data: address shape, tenant
match, type/owner coherence) or **manual** (a person asserted it: ownership, external reference,
identity, outbound, inbound). No check pretends to contact a provider or DNS, because no such
integration exists.

## 7. Legacy-active handling

Detected at read time; surfaced as a blocking warning in the list, the detail panel, the mail
workspace badge and a dedicated counter. Capability readiness returns false, so nothing requiring
evidence becomes available.

Remediation is a **recorded decision that changes nothing**: `recordLegacyActiveDecision` writes an
audit row carrying the chosen option (A–E) and a mandatory reason, and contains no mailbox write of
any kind. Recording an intention is not carrying it out, and a decision that quietly retyped or
disabled a live corporate address would be exactly the disruption this programme forbids.

## 8. Audit

New actions: `ec.mailbox.configured`, `ec.mailbox.verification_submitted`,
`ec.mailbox.verification_passed`, `ec.mailbox.verification_failed`, `ec.mailbox.legacy_decision`.
Every lifecycle entry now carries mailbox, tenant, actor, **prior state, next state**, reason and
evidence reference. A retry carries the failure reason into the audit **before** clearing the
column. No secret appears in any payload.

## 9. Production impact

**Blocked after deployment:**

* Reaching `ACTIVE` without identity evidence, a recorded verifier, known provenance and an external
  reference — the only door is `activateMailbox`, and it is guarded.
* Activating the mailbox you yourself verified.
* Re-activating a `DISABLED` mailbox without re-passing the guard.
* Creating an operational mailbox by omitting the status column.
* The `is_active` write path, and the false audit entries it produced.

**Unchanged:** no DNS, provider, Resend, MX/SPF/DKIM/DMARC or forwarding change; outbound and
inbound stay disabled; no Send As; no mailbox created; no membership created; no role or permission
change; **no automatic change to the existing production mailbox**, which stays ACTIVE and is now
surfaced as legacy-unverified.

## 10. Deployment — two gates, in this order

**Gate 1 — migration.** Apply `20260819000001` in production, verify physically, repair the ledger.

**Gate 2 — application.** Deploy the app.

The application does **not** depend on the migration having been applied: the new columns are read
in a **separate, fail-open query** (the established rule from the user-admin phase), so before Gate 1
every mailbox simply reads as "activator unknown" — which makes ACTIVE rows look legacy-unverified,
the safe direction. Activation is refused either way until evidence exists. The order still matters
for writes: recording capability verification touches new columns and will error until the migration
lands.

## 11. Operator decisions still required

1. **RATIFY-EMP5F-1** — the evidence freshness window (or a standing decision that none applies).
2. **A second `communication:mailbox:provision` holder**, without which maker-checker cannot be
   satisfied and no mailbox can be activated.
3. **Disposition of the legacy-active production mailbox** (options A–E), which still needs the five
   external facts from EMP-5E §8.
4. Unchanged from EMP-5B.1: all 20 IT questions, **Q8 (forwarding rules) still deciding the inbound
   architecture**; no domain verified at Resend; `effitrans.sn` still carries two SPF records.

## 12. Proposed EMP-5G

Wire the readiness predicates into the send and capture paths, so an unverified mailbox cannot be
used once outbound or inbound is enabled. This phase deliberately provides the predicates without
connecting them — connecting them changes what happens to a message, which deserves its own gate.
