# Deposit legacy `APPROVED` write — AUDIT

**AUDIT ONLY. No implementation, no migration, no production mutation.**
TMS-7 remains CLOSED at `71c7004`; RQ-18b at `5cab533`; date/determinism at
`fdc5f38`. None is reopened. Customs-panel error placement and the
`UNIQUE (file_id)` multi-leg debt are untouched.

---

## 0. First correction: it is not a deposit status, and there are TWO writes

The debt was recorded as a single "deposit status APPROVED" write. Both halves of
that description are wrong, and the corrections matter:

**a) `invoice_deposit.status` has no `APPROVED` value.** Its CHECK is

```
PREPARATION_PENDING · READY_FOR_COURIER · ASSIGNED · IN_TRANSIT · DEPOSITED
PROOF_SUBMITTED · PROOF_ACCEPTED · PROOF_REJECTED · HANDED_TO_COLLECTIONS · CANCELLED
```

The deposit state machine is clean and uses no legacy vocabulary. What the module
writes in a legacy spelling is a **`document.status`**.

**b) There are TWO legacy writes, not one:**

| Site | Writes | Canonical equivalent |
| --- | --- | --- |
| `lib/deposit/actions.ts` ~727 — proof upload | **`status: "PENDING_REVIEW"`** | `UNDER_REVIEW` |
| `lib/deposit/actions.ts` ~843 — `acceptProof` | **`status: "APPROVED"`** | `VERIFIED` |

Both are keys of `LEGACY_STATUS_ALIAS` in `lib/documents/doctrine.ts`. The earlier
note recorded only the second.

---

## 1. Production impact: **ZERO rows. The path has never executed.**

| Read-only check | Result |
| --- | --- |
| `invoice_deposit` rows | **0** |
| `invoice_deposit_event` rows | **0** |
| `PROOF_OF_DEPOSIT` documents | **0** |
| `audit_log` entries `deposit%` | **0** |

The 8 live `APPROVED` documents are **unrelated**: all carry
`provenance = 'LEGACY_VERIFIED'`, were created 2026-07-20/26 (pre-WES-4H), and are
COMMERCIAL_INVOICE / PACKING_LIST / BILL_OF_LADING / CUSTOMS_DECLARATION /
BON_A_ENLEVER. **Not one is a `PROOF_OF_DEPOSIT`.**

**Consequence: there is nothing to backfill, and no compatibility question about
existing deposit records, because there are none.**

---

## 2. Why the legacy write is harmless TODAY

`isVerified()` accepts both spellings via `LEGACY_STATUS_ALIAS`, and `canReview()`
accepts `UPLOADED` **or** `PENDING_REVIEW`. So a deposit proof today would:

* land correctly in the staff review queue (`PENDING_REVIEW` ⇒ reviewable);
* be recognised as verified everywhere downstream (`APPROVED` ⇒ `isVerified` true);
* be counted by the analytics metric, which DEFECT-UAT15d deliberately fixed to
  include both spellings.

Nothing is broken. The debt is that it **mints legacy vocabulary in new rows**,
which keeps the alias load-bearing forever instead of letting it become history.

---

## 3. The larger finding: the accept path BYPASSES document governance

```ts
// The proof becomes an APPROVED document through the EXISTING document workflow.
await admin.from("document").update({ status: "APPROVED", reviewed_by: c.userId })
```

**The comment is inaccurate, and is probably the source of the misconception.**
This does not use the document workflow. It is a **direct admin-client UPDATE**,
so it bypasses `verifyDocument → runReview → mayVerifyDocument` and therefore:

* writes **no `document_review` row** — no governed review ledger entry;
* pins **no policy version**;
* applies **no verifier-seat check** (the WES-4H control, RQ-15b fallback).

**This is not an absence of control.** The deposit module enforces its own
two-person rule and its own ledger:

| Control | Where |
| --- | --- |
| Maker-checker | `if (d.courierUserId === c.userId) return fail("self_review_forbidden")` |
| State guard | `if (d.status !== "PROOF_SUBMITTED") return fail("invalid_state")` + CAS |
| Custody ledger | `recordCustody(...)` → `invoice_deposit_event` |
| Audit | `AuditActions.DEPOSIT_PROOF_ACCEPTED` |

So it is a **parallel governance lane**, deliberate in shape if not in wording.

---

## 4. ⚠ Blast radius: routing it through `runReview` would BREAK the flow

The obvious "clean" fix — make the accept path call `verifyDocument` — is **not
safe**, and the authority tables say why:

| Permission | Roles |
| --- | --- |
| `admin_service:manage` (gates `acceptProof`) | **ADMINISTRATIVE_OFFICER**, OPS_SUPERVISOR, SYSTEM_ADMIN |
| `document:approve` (asserted by `runReview`) | ACCOUNT_MANAGER, CHIEF_OF_TRANSIT, COMPLIANCE_HSSE, OPS_SUPERVISOR, SYSTEM_ADMIN |

**`ADMINISTRATIVE_OFFICER` holds `admin_service:manage` but NOT `document:approve`.**

Routing through `runReview` would therefore **revoke the ability of the very role
created to do this job** — Administration validating a courier's deposit proof.
It would also subject `PROOF_OF_DEPOSIT` to the verifier-seat check, which under
the RQ-15b fallback resolves to `document:approve` holders, compounding the same
refusal.

**That is a business decision (who may verify a deposit proof), not a cleanup.**

---

## 5. Recommendation — the smallest architecture-consistent correction

### RECOMMENDED: canonicalize the two spellings. Nothing else.

| | |
| --- | --- |
| Change | `"PENDING_REVIEW"` → `"UNDER_REVIEW"`; `"APPROVED"` → `"VERIFIED"` |
| Files | `lib/deposit/actions.ts` (2 lines) + the comment corrected to say what the code does |
| **Migration** | **NONE** |
| **Backfill** | **NONE — zero affected rows** |
| RBAC / RLS | **NONE** |
| Audit / events | **NONE** — `DEPOSIT_PROOF_ACCEPTED` and the custody ledger are unchanged |
| Compatibility | Total. `isVerified`/`canReview` already accept both, so readers cannot tell the difference. No existing record is touched because none exists |
| Behaviour change | **None observable** |
| Risk | **Very low** — the lowest-risk item in the debt list, precisely because the flow has never run |

### Tests required

1. The proof is created `UNDER_REVIEW` and is reviewable (`canReview` true).
2. Accept sets `VERIFIED`, and `isVerified` is true.
3. **Legacy compatibility is NOT removed** — `LEGACY_STATUS_ALIAS` still maps both
   spellings, because historic rows still carry them (8 in production today).
4. The deposit module writes **no** legacy spelling any more (bounded to its own
   file, so an unrelated legacy string elsewhere cannot satisfy the pin).
5. The parallel controls survive: self-review refusal, the PROOF_SUBMITTED guard,
   the custody event, the audit action.

### Mutations required

* the spellings reverting to `PENDING_REVIEW` / `APPROVED`;
* `LEGACY_STATUS_ALIAS` losing either key (must FAIL — historic rows depend on it);
* the self-review refusal removed;
* the custody event or audit action dropped;
* the accept path rerouted through `runReview` (must FAIL — see §4).

### One test pin needs updating

`tests/process-deposit.test.ts:329` asserts `status: "PENDING_REVIEW"` under
« The proof enters the NORMAL staff review queue. » The **intent** is that the
proof is reviewable, not that it uses that exact spelling. It should assert the
canonical value, keeping the intent.

---

## 6. NOT recommended without ratification

| Option | Why not now |
| --- | --- |
| Route the accept through `runReview` | **Breaks ADMINISTRATIVE_OFFICER** (§4). Requires a decision on who may verify a deposit proof, and probably a `document:approve` grant or a proof-specific verifier seat |
| Backfill historic `APPROVED` rows to `VERIFIED` | 8 rows, all `LEGACY_VERIFIED` provenance. They are **history**; rewriting them would erase the distinction the provenance marker exists to record. The alias is the correct mechanism |
| Remove `LEGACY_STATUS_ALIAS` | Would strand those 8 rows and break `isVerified` for them |

---

## Decision requested

> **Approve the two-line canonicalization** (`UNDER_REVIEW` / `VERIFIED` in the
> deposit module, comment corrected, one test pin updated) — no migration, no
> backfill, no RBAC change?
>
> And separately: **should a deposit proof be subject to document verifier-seat
> governance at all?** Today it is governed by the deposit module's own
> maker-checker and custody ledger. Changing that needs a decision about
> ADMINISTRATIVE_OFFICER's authority, and is out of scope for this cleanup.
