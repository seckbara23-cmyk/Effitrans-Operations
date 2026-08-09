# EMP-5G — Mailbox Runtime Readiness Enforcement

**Phase:** EMP-5G · **Mode:** audit first, then narrow enforcement
**Baseline:** EMP-5F at SHA `a9e62bf`, CI `31323750044` (#418).

> No personal or customer data appears here. The production mailbox is referred to by its
> properties, never by its address.

---

## 1. RATIFY-EMP5F-1 — answered, no model change required

**Adopted:** `capabilityMaxAgeDays = 90`, `identityMaxAgeDays = null`.

The audit question was whether the schema can represent the distinction *safely*. It can, and
without change: EMP-5C gave identity its own `corporate_identity_confirmed_at`, separate from
`outbound_verified_at` and `inbound_verified_at`. Had the three shared one timestamp, a 90-day
window would have silently expired provenance as well — and the honest answer would have been to
report that before implementing. They do not, so `EvidencePolicy`'s existing two fields carry the
ratification directly.

Activation is unaffected: it rests on **identity** evidence, which does not expire. Staleness stops
*traffic*, not the activation decision.

## 2. Audit — the entry paths

**Outbound.** `sendEmail` has five direct callers:

| Caller | Mailbox of record? |
|---|---|
| `lib/comms/dispatch.ts` | **yes** (`communication_message.mailbox_id`) |
| `lib/comms/queue.ts` (templates/system) | no |
| `lib/commercial/send.ts` (quotation) | no |
| `lib/finance/invoice-send.ts` | no |
| `lib/portal/admin-actions.ts` (portal credentials) | no |

Plus nine `queueAndSend` callers, all mailbox-less. **Exactly one path carries a mailbox**, so
exactly one is gated. Everything else is untouched.

**Inbound.** One path: `capture.ts` → `matchMailboxes` → `resolveRouting`, behind the two-layer
flag (`EFFITRANS_EC_INBOUND_ENABLED` **and** the tenant rollout row, both fail-closed).

**Findings.** No contradictory authority and no competing state machine — so no STOP. One
*duplicated* rule: `outbound-actions.ts::resolveMailbox` read `is_active` itself, a second,
independently-maintained notion of "in service" for a column the lifecycle already owns by trigger.
Folded into `isOperational(canonicalState(...))` — behaviourally identical, one definition fewer.

## 3. The one authority

`mailboxRuntimeEligibility({tenantId, mailbox, direction, now, policy})` in
`lib/ec/mailboxes/lifecycle.ts`. Pure, fail-closed, per-direction.

It is deliberately distinct from `activationGuard`: the guard asks *may this administrator put this
mailbox into service* — about a person and a decision; this asks *may a message leave through or
arrive at this mailbox right now* — about the mailbox alone, at the moment traffic touches it.
Activation is a point in time; eligibility is a running condition.

Refusals: `mailbox_not_found` · `tenant_mismatch` · `not_operational` · `legacy_unverified` ·
`ownership_unknown` · `identity_unconfirmed` · `identity_evidence_stale` · `capability_unverified` ·
`capability_evidence_stale`.

**It knows nothing about the rollout flags.** It cannot read one, so enabling a flag can never
change its answer — which is the entire point of the phase.

## 4. Outbound enforcement

The gate runs **before the compare-and-set**, for the reason RATIFY-EMP3-2 already established for
`isProviderConfigured`: an unverified mailbox persists until someone fixes it, so the message must
keep its sendable state. It returns the existing `SKIPPED` outcome and stays `QUEUED` — it sends
itself once the mailbox is verified. No new status, no state-machine change, CAS and idempotency
untouched.

One tenant-scoped read now feeds both the gate and the Reply-To, so the two cannot disagree within a
send. Reply-To is still *decided* after the acquire (EMP-5D's property: one sender owns it).

`sendComposed` asks the same authority earlier, before promoting a draft to `QUEUED`, so a doomed
send moves no state and the administrator sees the precise reason.

**Drafting is not gated.** Composing against an in-service but unverified mailbox is legitimate
preparation: it emits no event and reaches no provider.

## 5. Inbound enforcement

`resolveRouting` consults the same authority and quarantines on refusal. **A refusal is not a
loss**: the message is captured, stored and evidenced with `tenant_id NULL`, exactly as an unmatched
message always was.

`not_operational` reports as the existing `mailbox_inactive`; everything else as the new
`mailbox_not_verified`. Two different problems with two different fixes deserve two different words,
and the person reading the quarantine list is exactly who needs to know which.

## 6. Migration 98 — `20260820000001`

`quarantine_reason` carries a CHECK. Writing an unlisted value would **abort the capture INSERT**,
turning a fail-safe refusal into a lost message. So the vocabulary is widened first — a pure
widening that validates for free, changes no row, adds no column, and leaves
`ec_inbound_quarantine_shape` (quarantine stays tenant-less) alone.

**Deployment order matters here:** apply migration 98 *before* the application that writes the new
value. Inbound is disabled at both layers, so the exposure window is nil either way.

## 7. Newly blocked

* Sending through a mailbox that is not in service, legacy-active, of unknown provenance, without
  confirmed identity, or without fresh (≤90d) **outbound** proof — refused as `SKIPPED`, message
  stays `QUEUED`.
* Routing inbound mail into a mailbox failing the same tests for **inbound** — quarantined.
* Enabling either flag making an unverified mailbox operational. This is the property the phase
  exists for.

## 8. Unchanged

Byte-for-byte: all nine `queueAndSend` callers and the four mailbox-less `sendEmail` callers —
invoice notifications, portal invitations, quotation mail, welcome mail, tenant provisioning. None
mentions the gate; none carries a `mailbox_id`.

Behaviourally: the `communication_message` state machine, CAS, idempotency keys, Reply-To, tenant
isolation, audit actions, both rollout flags, EC-1's four routing refusals, quarantine's tenant-less
shape, permissions, memberships, and the production mailbox.

No provider, Resend, DNS, MX, SPF, DKIM, DMARC, forwarding, Send As, Return-Path or Vercel change.

## 9. Dependencies before real activation

1. **A verified mailbox exists.** Today none does, so with outbound enabled every mailbox-bound
   message would refuse — correctly. Verification needs migration 97 applied and a second
   `communication:mailbox:provision` holder for maker-checker.
2. Migrations **97 and 98** applied, verified, ledger repaired.
3. Effitrans IT: all 20 EMP-5B.1 questions, **Q8 (forwarding rules) still deciding the inbound
   architecture**.
4. No Resend domain verified; SPF/DKIM absent; `effitrans.sn` carries two SPF records.
5. Disposition of the legacy-active production mailbox.
