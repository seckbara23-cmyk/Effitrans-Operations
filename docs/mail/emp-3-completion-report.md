# EMP-3 — Enterprise Mail Reply, Compose and Outbound Delivery: Completion Report

**Date:** 2026-08-08 · **Implementation SHA:** `ad8da34`
**CI GREEN — run #370: `rls-tests` 80 steps / 0 skipped / 0 failed · `build` 10 / 0 / 0**
**Migration 87 `20260811000001_outbound_mail.sql` — APPLIED IN CI, UNAPPLIED IN PRODUCTION**

---

## 1–2. Repository audit and existing outbound architecture

Returned in full as `docs/mail/emp-3-audit.md` before implementation, classifying all 26
components. The headline: `communication_message` was created on 2026-06-15 and **never
altered since** — built to render a known template and mail it to one address. Free compose and
reply break every assumption in it.

## 3. Reuse versus build

**Reused unchanged:** the outbound queue itself · the provider seam and the whole Resend
implementation (including its production sender guard) · `queueAndSend` for template mail ·
send/retry/cancel actions and their gates · the `communication:*` permission family, already
granted to six role templates · SELECT-only RLS with admin-client writes ·
`enforce_communication_tenant` · branding/render · audit actions · EMP-1 mailbox administration
and the workspace shell · EMP-2 correlation · `readDecisionPlane` · `emit_business_event`.

**Built:** compose/reply/draft services · CAS dispatch · `CORRESPONDENCE_SENT` · the composer UI.

**Not built, deliberately:** SMTP (the audit proved the contract neither requires nor supports
it) · any second queue, table, timeline, journal, attachment model or navigation · DELIVERED
and READ · customer visibility · AI · autonomous retry.

## 4. Compose

Free composition writes `kind='COMPOSE'` with `template_key = NULL`. **No sentinel template key
exists** — a CHECK makes `kind='TEMPLATE'` equivalent to `template_key IS NOT NULL`, so a free
composition cannot be recorded as if it had been a template, and the fake key the brief warned
about is not merely unused but unnecessary.

## 5–6. Reply, reply-all, and header behaviour

`buildReplyHeaders` sets `In-Reply-To` from the parent's Message-ID and `References` as the
parent's chain plus the parent itself. **A parent with no usable Message-ID yields NULL for
both** and `startsNewThread: true` — a new conversation, never a forged chain. Subject gets
`Re:` exactly once, case-insensitively.

Reply addresses the original sender. Reply-all adds everyone the message **visibly** reached
and removes the sending mailbox (otherwise the tenant mails itself, EC-1 captures it, and it
re-enters triage as apparent customer mail). De-duplication is case-insensitive and
deterministic.

**Prior Bcc can never be reconstructed:** `ReplySource` has no bcc field at all, and
`loadReplySource` does not select `bcc_addresses`. It is unreachable, not merely unused.
EMP-2's correlation remains authoritative; subject text never determines recipients or threads.

## 7. Draft model

`status='DRAFT'` on the same table. A draft emits no event, never reaches the provider, is
cancellable, and is promoted to `QUEUED` by a compare-and-set of its own before dispatch.
Drafting requires `communication:read`; sending requires `communication:send`.

## 8. Sender mailbox authorization

The browser submits a mailbox **id**; the server reads the address from `ec_mailbox` under the
tenant predicate. **An arbitrary From cannot be constructed by a client.** Four conditions, all
server-side: mailbox exists, belongs to this tenant, `is_active`, and `EFFITRANS_EC_OUTBOUND_ENABLED`.
Re-validated **at send time**, because a mailbox can be deactivated while a draft waits.

## 9. Recipient validation

Server-side: syntax; **header injection refused explicitly** (CR/LF/NUL checked separately from
the regex, which `^…$` alone would not catch); cross-field de-duplication with To > Cc > Bcc so
one person cannot be both a visible and a blind recipient; the sending mailbox refused in any
field; a 50-recipient cap; non-empty To. No master-data entity is ever created — unknown
external addresses stay recipients.

## 10. Attachments

References only (`{source, id, filename}`) into the existing model — **no bytes, no storage
paths, no second attachment table**. Path separators in filenames are refused. No dossier
document is created (EMP-4) and no inbound attachment is mutated.

## 11–12. Provider send transaction and idempotency

The ratified order, in order. The mechanism is one UPDATE:

```
QUEUED | FAILED  --comm_acquire_send (CAS)-->  SENDING  -->  SENT | FAILED
```

PostgreSQL serializes the row write, so of N concurrent callers exactly one transitions it; the
rest match zero rows and must not touch the provider. **The row's own state is the lock** —
nothing to acquire and forget to release. `SENDING` is absent from the acquirable set, so an
in-flight row can never be acquired twice. The idempotency key is derived from the row id, so a
retry reuses it and a new message cannot collide; a partial unique index enforces it in the
database.

**The boundary, stated rather than glossed:** the provider call is external HTTP, so no
transaction spans it. A crash after acceptance but before recording leaves `SENDING`. That row
is **never redispatched automatically** — automatic recovery would be a duplicate-send machine,
because the platform cannot know whether the provider accepted. A human with
`communication:manage` reconciles it, and the only outcomes offered are `FAILED` and
`CANCELLED`; **"it was actually sent" is deliberately not available**, since recording an
acceptance nobody witnessed would fabricate a ledger event.

## 13. Outbound Decision Plane emitter

One event, `CORRESPONDENCE_SENT`, emitted from exactly one place: inside
`comm_record_send_accepted`, in the **same transaction** as the `SENDING → SENT` transition.
That is what makes it exactly-once — a second call finds the status is no longer `SENDING` and
emits nothing. Metadata is identifiers and codes only. `clientSafe: false`.

The inbound `CORRESPONDENCE_RECEIVED` trigger from UT-3B is untouched and **not duplicated**;
migration 87 creates no trigger on `ec_inbound_message`.

## 14. Delivery and failure states

`DRAFT · QUEUED · SENDING · SENT · FAILED · CANCELLED`. A row may only be `SENT` if it carries
the provider that accepted it. **`DELIVERED` and `READ` do not exist** — there is no bounce
webhook, so neither is provable, and the composer says so on screen. Surfaced: attempt count,
last error, provider and provider message id, retry eligibility. No provider secret or raw
response is exposed.

## 15. Security review

No new table, no new RLS policy, no new permission, no broad write policy. Tenant isolation
unchanged. `SYSTEM_ADMIN` gains nothing and holds none of the six `communication:send` grants.
The four dispatch functions are `SECURITY DEFINER`, revoked from `PUBLIC`, `anon` and
`authenticated` on their **exact identity signatures**, and granted to `service_role` alone —
asserted at migration time through both `has_function_privilege` and the ACL, and proven at the
PostgREST level by a suite that calls them as `anon`/`authenticated` and requires **42501**.

## 16. Files changed

**New:** `supabase/migrations/20260811000001_outbound_mail.sql` · `lib/comms/compose.ts` (pure) ·
`lib/comms/dispatch.ts` · `lib/comms/outbound-actions.ts` · `components/ec/composer.tsx` ·
`app/mail/compose/page.tsx` · `supabase/tests/rls_outbound_mail_test.sql` ·
`tests/emp-3-outbound.test.ts` · `docs/mail/emp-3-audit.md` ·
`docs/ops/emp-3-privilege-incident.md`.

**Modified:** `lib/comms/provider.ts` (fails closed; returns provider identity + message id) ·
`lib/comms/actions.ts` (`deliver()` delegates to the CAS dispatcher) ·
`lib/workflow/events/types.ts` · `lib/audit/events.ts` · `lib/db/types.ts` ·
`lib/platform/ops/build-info.ts` · `app/mail/layout.tsx` ·
`app/mail/inbox/[id]/page.tsx` · `.github/workflows/ci.yml` ·
`supabase/tests/rls_communication_test.sql` · six test files re-aimed.

## 17. Schema changes

Migration 87 only: 16 additive columns, `template_key` nullable, four CHECKs, one partial
unique index, three indexes, four functions, one widened source vocabulary. **No table, no RLS
policy, no permission.**

## 18. Tests

**67 TypeScript contracts** + **a new SQL suite** run last in CI. Full local gate: **210 files
/ 5313 tests, tsc 0, build compiled.**

### The three defects CI caught that local testing could not

1. **A deployment-blocking constraint.** `ADD CONSTRAINT` validates existing rows by default,
   and every historical row is `SENT` with no provider — the column did not exist. Migration 87
   would have **aborted on any database with history**. Fixed with `NOT VALID`; a back-fill was
   refused, because we do not know which provider accepted those sends and for much of that
   period the answer is "none — the stub did".
2. **Four `SECURITY DEFINER` functions exposed to every browser session.** Revoking from
   `PUBLIC` does not remove Supabase's *explicit* default-privilege grants to `anon` and
   `authenticated`. A bare local Postgres cannot reproduce this. Full analysis in
   `docs/ops/emp-3-privilege-incident.md`.
3. **My own assertion testing the wrong property.** A later attempt refused the migration over
   `INSERT/UPDATE/DELETE` grants on `communication_message`. Those grants are **inert**: the
   table has RLS enabled and no write policy — and no table in this platform has one — so
   PostgreSQL denies the write regardless of the grant. A **function** has no RLS, which is why
   the EXECUTE revoke was right; conflating the two produced a false alarm. The privileges were
   **not** revoked (that would single one table out of a uniform deployed posture for no gain);
   the assertion was replaced with a proof of **effective immutability**. Full reasoning in
   `docs/ops/emp-3-privilege-incident.md` §7.
4. **An invalid ledger source.** `business_event.source` is a closed set and `'rpc'` is not in
   it. Added `'comms_rpc'`, following the `assignment_rpc`/`document_rpc`/`reconcile_rpc`
   precedent rather than borrowing EC-2's `policy_rpc` — sending an email is not a policy act.

Also fixed: the pre-existing `deliver()` duplicate-send path, by deleting its private copy of
the logic so the template-mail callers inherited the CAS guarantee.

## 19. CI and deployment status

**CI GREEN — run #370 on `ad8da34`: `rls-tests` 80/0/0, `build` 10/0/0.** The rls step count
rose 79 → 80 because EMP-3 added exactly one suite.

**Migration 87 is NOT applied in production.** Provider integration remains dark:
`COMMUNICATIONS_EMAIL_PROVIDER` unset means every send now **fails closed** rather than
pretending to succeed.

## 20. Operator actions

1. Verify the earlier rollback with the SQL in `docs/ops/emp-3-privilege-incident.md` §1.
2. Apply migration 87 through the sanctioned path and confirm the ledger reads **87/87**.
3. Leave outbound dark until wanted; to enable, set `EFFITRANS_EC_OUTBOUND_ENABLED=true`,
   configure `COMMUNICATIONS_EMAIL_PROVIDER` + `RESEND_API_KEY` + `COMMUNICATIONS_EMAIL_FROM`,
   and ensure at least one **active** `ec_mailbox`.
4. **Note a behaviour change for existing template mail:** with no provider configured, invoice
   and quotation emails now record `FAILED` instead of a false `SENT`. That is the correction,
   not a regression — but it will be visible.

## 21. Remaining EMP roadmap

| Phase | Status |
|---|---|
| **EMP-4** — attachment → document ingestion | **untouched**; blocked on RATIFY-EMP-8 |
| EMP-5 — AI suggestions (no autonomous send) | blocked on EMP-1..3 + DPA |
| EMP-6 — customer visibility | blocked on RATIFY-EMP-10 |
| **OPS-SEC-1** (new, recommended) | no migration in this repo revokes from `anon`/`authenticated`; the pre-existing quotation, document, customs, reconciliation and policy RPCs are likely executable by authenticated sessions on hosted Supabase. Reported, not silently patched. |

Open: RATIFY-EMP-4/8/9/10/11, RATIFY-EC1-1 (until granted, the inbound workspace 404s by design).

## 22. EMP-4 readiness

Ready. Attachments already travel as references into the existing model, so ingestion is a
matter of promoting a reference to a `document` row through the existing pipeline — where
`DOCUMENT_UPLOADED` emits by trigger for free. EMP-4 needs RATIFY-EMP-8 answered first.

---

## Confirmations

* **The existing outbound queue was reused** — no second mail system was created.
* **Drafts emit no correspondence event.**
* **Failed sends emit no `CORRESPONDENCE_SENT`**, and neither does a stub "acceptance".
* **Successful provider acceptance emits exactly one event**, in the same transaction as the
  evidence.
* **No delivery claim is made without provider evidence** — `DELIVERED` and `READ` do not exist.
* **Inbound `CORRESPONDENCE_RECEIVED` remains unchanged.**
* **No customer visibility was added** · **no AI sending was added**.
* **EMP-4 has not begun.**
