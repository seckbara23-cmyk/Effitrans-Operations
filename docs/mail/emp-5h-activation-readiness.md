# EMP-5H — Enterprise Mail Activation Readiness & Administration

**Baseline:** EMP-5G at `e8011c1`, CI #419 (87/0/0, 10/0/0); ledger reconciled through
`20260820000001` at 98/98. **Outbound and inbound remain disabled.**

> No personal or customer data appears here. The existing production mailbox is referred to by its
> properties, never by its address.

---

## 1. Architecture discovered

| Concern | Owner | Status |
|---|---|---|
| Mailbox registry | `ec_mailbox` | one table, one registry |
| Lifecycle vocabulary + guard | `lib/ec/mailboxes/lifecycle.ts` | EMP-5F |
| Runtime eligibility | `mailboxRuntimeEligibility` | EMP-5G |
| Evidence model | EMP-5C columns, ratified policy EMP-5G | 90 d capability / no identity expiry |
| Eligibility key | `department_eligibility` | EMP-5D/5E |
| Membership | `ec_mailbox_member` | EMP-4A |
| Permission | `communication:mailbox:provision` (MAIL_ADMIN only) | EMP-4A |
| Administration surface | `/admin/enterprise-mail/mailboxes` | EMP-5F |
| Rollout | env flag ANDed with tenant row (inbound); env only (outbound) | EC-1 / EMP-3 |

**Nothing was competing and nothing needed replacing.** Every requirement of this brief was met by
extending what exists.

## 2. Second-administrator readiness — **already satisfied**

Read-only production query:

| Fact | Value |
|---|---|
| Roles granting `communication:mailbox:provision` | **MAIL_ADMIN only** (SYSTEM_ADMIN correctly excluded) |
| MAIL_ADMIN holders | **2** |
| Both active? | **yes** |
| Both in the tenant? | **yes**, same tenant |

**This corrects EMP-5F and EMP-5G**, which both reported that a second holder was still needed.
It is not: maker-checker is satisfiable today.

* **Which role:** MAIL_ADMIN. It already carries `communication:mailbox:provision` and
  `communication:membership:manage`, and deliberately **not** `communication:inbound:read` —
  administering access is not having it.
* **Schema/code change required:** **none.** The guard already refuses self-approval; the count of
  holders is now displayed so the condition is visible rather than discovered on refusal.
* **Safest procedure for a future delegated Effitrans administrator:** grant MAIL_ADMIN through the
  existing user administration surface to an existing active staff account — no new role, no new
  permission, no direct SQL. Nothing in this phase performs it.

## 3–4. What was built

Everything reuses EMP-5F/5G server predicates; **no rule is re-derived in React.**

* **`MailboxReadinessTable`** — a server component rendering eleven readiness dimensions for every
  mailbox at once: state, provenance, identity, department, outbound, inbound, freshness, access,
  separation of duties, blockers. Read-only: no client state, no action, no clock.
* **`evidenceFreshness`** — age per evidence type; **absent evidence is `null`, never `0`**, because
  `0` reads as "checked today".
* **`makerCheckerStatus`** — whether a maker is recorded, whether the viewer is that maker, and
  whether a second administrator exists. **Fail-closed:** an unknown count means no checker.
* **`countProvisioningAdministrators`** — counts DISTINCT active holders. One person holding the
  permission through two roles is one person.
* **Honesty copy** — the table and the ACTIVE detail both state that « Active » is a lifecycle state
  and **not** a DNS, provider, sending or receiving attestation.

## 5. Proposed departmental mailbox matrix

**Proposals only. No address is created, reserved or verified by this phase.** Addresses assume the
`effitrans.com` domain and are unconfirmed until Effitrans IT states which domain is authoritative
for staff correspondence.

| Department | Proposed address | `department_eligibility` | Ownership | Expected members | Outbound | Inbound |
|---|---|---|---|---|---|---|
| Opérations | `operations@` | `OPERATIONS` | `CORPORATE_EXISTING` | Coordinators, ops agents | required | required |
| Transit | `transit@` | `TRANSIT` | `CORPORATE_EXISTING` | Transit team | required | required |
| Douane | `douane@` | `CUSTOMS` | `CORPORATE_EXISTING` | Transit + customs declarants | required | required |
| Finance | `finance@` | `FINANCE` | `CORPORATE_EXISTING` | Finance officers, cashier | required | optional at first |
| Commercial | `commercial@` | `COMMERCIAL` | `CORPORATE_EXISTING` | Commercial team | required | required |
| Support | `support@` | `SUPPORT` | `CORPORATE_EXISTING` | Every department (SUPPORT is in all lists) | required | required |

Notes that are not negotiable:

* `department_eligibility` **proposes** members; it grants nothing. Membership stays an explicit,
  audited administrator decision.
* Ownership is proposed as `CORPORATE_EXISTING` because coexistence means Effitrans keeps
  authority over its addresses. It must still be **confirmed per mailbox**, not assumed.
* **Inbound "required" is conditional on Q8.** If the provider cannot copy mail to an integration
  address, inbound stays out of reach and these mailboxes are outbound-only. That is a provider
  fact, not a platform decision.

## 6. The existing legacy mailbox

Untouched. Verified read-only: `updated_at` still `2026-08-09 11:10:49.527101+00`, unchanged by
migrations 97 and 98 and by this phase.

State: `ACTIVE`, ownership `UNKNOWN`, no verification evidence, no recorded activator, 0 members,
0 messages, 0 aliases. It is surfaced as **legacy-unverified** in the badge, the list, the detail
panel and now the readiness table, and it is **runtime-ineligible in both directions**.

**Facts required before any disposition** (unchanged since EMP-5E):

1. Does a mailbox with this address exist at the corporate provider?
2. Does the named person personally own it?
3. Is it intended for several users?
4. Is it already carrying real company email?
5. Can it be modified safely, and by whom?

Until (1)–(5) are answered the platform must not retype, reclassify, deactivate or delete it.

## 7. Provider questionnaire — triaged

The EMP-5B.1 questions, split by who can actually answer them.

**Answerable by the platform administrator from the existing Effitrans mail admin console** — these
are observations of a system you already have access to:

* Which domain is authoritative for staff correspondence, and which is in day-to-day use.
* Which addresses exist today, and which are personal versus shared or functional.
* Who administers the mail tenant, and whether you hold that administrative access.
* Whether distribution lists or aliases already exist, and what they resolve to.
* Whether the console exposes a copy/journaling or auto-forward feature at all.

**Require Effitrans IT or the provider** — these are facts about contracts, delegation and provider
capability, not about the console:

* Who is contractually responsible for the mail service, and who may authorise a change.
* Whether SPF may be amended, and by whom (`effitrans.sn` currently carries **two SPF records**,
  an RFC violation that must be resolved by whoever owns that zone).
* Whether DKIM signing can be added for a third-party sender.
* Whether a sub-domain may be delegated for platform sending.
* **Q8 — whether provider-side forwarding/copy rules are available and permitted. UNRESOLVED, and
  it must not be guessed: it decides whether inbound capture is reachable at all.**

## 8. Remaining ratifications

* **RATIFY-EMP5H-1** — the departmental address list and the domain they live on.
* **Q8** — provider forwarding capability, which gates the entire inbound architecture.
* Disposition of the legacy mailbox, pending the five external facts.

## 9. Production impact

**None to production data or configuration.** No migration. No mailbox, membership, role,
permission, policy, flag, provider, DNS or routing change. The administration page performs one
additional read (the administrator count).

## 10. Proposed EMP-5I

The first controlled pilot, executed against the runbook in
`docs/mail/emp-5h-activation-runbook.md` — but only once Q8 is answered and RATIFY-EMP5H-1 settles
the address list. Until then, a pilot would be verifying a mailbox whose architecture is not yet
decided.
