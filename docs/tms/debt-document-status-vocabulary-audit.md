# Phase 1.8 document-status vocabulary — AUDIT

**AUDIT ONLY. Nothing implemented, no production mutation.** TMS-7 (`71c7004`),
RQ-18b (`5cab533`) and date/determinism (`fdc5f38`) stay closed. `LEGACY_STATUS_ALIAS`
untouched, no backfill, no RBAC/RLS change, no verifier-seat change, and the blocked
deposit upload write is NOT completed here. Customs-panel placement, `UNIQUE (file_id)`
and deposit Decision 2 are untouched.

---

## 0. Headline: the module is a fossil with ONE live call site

`lib/documents/status.ts` is imported by exactly **two** files, and only one line of
it still executes.

| Export | Live callers in `lib/` `app/` `components/` |
| --- | --- |
| `canReview` | **1** — `components/documents/document-row.tsx:74` |
| `canSubmit` | **0** — imported by `lib/documents/actions.ts` and **never called** |
| `canTransition` | **0** |
| `isDocumentStatus` | **0** |
| `DOCUMENT_STATUSES` (legacy) | **0** |

`lib/documents/actions.ts` imports `{ canReview, canSubmit }` and calls **neither**.
The real state machine lives in the `review_document` RPC and in `doctrine.ts`
(`canTransitionDocument`). The Phase 1.8 module is essentially dead code whose one
surviving line gates a button.

---

## 1. The two vocabularies

| | Statuses |
| --- | --- |
| **Legacy** `lib/documents/types.ts` | `UPLOADED · PENDING_REVIEW · APPROVED · REJECTED · EXPIRED` |
| **Canonical** `lib/documents/doctrine.ts` | `UPLOADED · UNDER_REVIEW · VERIFIED · CONSUMED_AS_EVIDENCE · REJECTED · SUPERSEDED · EXPIRED` + `PENDING_REVIEW`/`APPROVED` as read-only aliases |

**Canonical statuses MISSING from the legacy type:** `UNDER_REVIEW`, `VERIFIED`,
`CONSUMED_AS_EVIDENCE`, `SUPERSEDED`.

**⚠ The legacy type is already unsound against production.** 11 of the 20 live
documents carry a status the legacy type cannot represent (7 `VERIFIED`, 2
`CONSUMED_AS_EVIDENCE`, 2 `SUPERSEDED`). Anything typed `DocumentStatus` from
`types.ts` and fed a real row is lying to the compiler today — independently of
anything the deposit module does.

**⚠ And the doctrine's own comment is false.** It states the legacy aliases are
"accepted on read … **nothing writes them any more**". Until `7c3852c` the deposit
module wrote both; it still writes `PENDING_REVIEW` on upload.

---

## 2. Production rows by raw and canonical status

| Raw | Canonical | Rows |
| --- | --- | --- |
| `APPROVED` | **VERIFIED** | **8** |
| `VERIFIED` | VERIFIED | 7 |
| `CONSUMED_AS_EVIDENCE` | CONSUMED_AS_EVIDENCE | 2 |
| `SUPERSEDED` | SUPERSEDED | 2 |
| `UPLOADED` | UPLOADED | 1 |
| | **Total** | **20** |

**Zero `PENDING_REVIEW` and zero `UNDER_REVIEW` rows exist.** So every change below
is evaluated against real data where the affected states are currently empty — the
remediation cannot alter the behaviour of any existing row.

---

## 3. Raw comparisons that bypass `canonicalStatus`

| Site | Comparison | Effect |
| --- | --- | --- |
| `lib/documents/status.ts:42` `canReview` | `=== "UPLOADED" \|\| === "PENDING_REVIEW"` | **The blocker.** Misses canonical `UNDER_REVIEW` |
| `lib/documents/status.ts:37` `canSubmit` | `=== "UPLOADED"` | Dead code (0 callers) |
| `lib/copilot/context.ts:351` | `"UPLOADED" \|\| "PENDING_REVIEW"` | "documents pending" count misses `UNDER_REVIEW` |
| `lib/departments/classify.ts:24` | same | same |
| `lib/files/lifecycle.ts:129` | same | same |
| `lib/ai/eval/harness.ts:58-59` | `"APPROVED"`, `"PENDING_REVIEW"` | Synthetic fixtures only — no production effect |

**Corrected from a first reading:** `lib/analytics/calc.ts` compares `UNDER_REVIEW`
but that is **`customs_record.status`**, a different vocabulary entirely. Not a
document-status drift.

The three "pending documents" counters are **latent, not live**: with zero
`UNDER_REVIEW` rows they miscount nothing today, and they would begin to miscount the
moment anything writes the canonical value.

---

## 4. ⚠ The decisive finding: the SERVER already accepts `UNDER_REVIEW`

The `review_document` RPC guards by **BLOCKLIST, not allowlist**:

```
if v_status = v_new                                  -> 'document is already %'
if v_status in ('SUPERSEDED','CONSUMED_AS_EVIDENCE') -> 'a % document cannot be reviewed'
if action = 'VERIFIED' and v_status = 'REJECTED'     -> 'replaced, not verified in place'
```

It never requires `UPLOADED` or `PENDING_REVIEW`. **An `UNDER_REVIEW` document can
already be verified server-side today**, and so can a legacy `PENDING_REVIEW` one.

**The ONLY thing that blocks the canonical status is the UI predicate.** That is why
the remediation is one line rather than a state-machine migration.

---

## 5. Does widening change AUTHORIZATION? **No — recognition only.**

`canReview` decides *whether the « Vérifier » control renders*. Authority is
enforced by three independent mechanisms it does not touch:

| Layer | Control |
| --- | --- |
| Permission | `canApprove` = `hasPermission("document:approve")` (UI) and `assertPermission("document:approve")` in `runReview` |
| Governance | `mayVerifyDocument` — verifier seat from the pinned policy + maker-checker |
| State | the `review_document` RPC blocklist |

Widening `canReview` grants nobody anything. It stops hiding a button on a status
the server would already have accepted.

---

## 6. Is boundary normalization sufficient? **Yes for the unblock; no for the fossil.**

Two separable problems:

**(a) The blocker — one predicate.** Normalizing `canReview` via `canonicalStatus`
is sufficient to unblock every canonicalization, including the deposit upload. It is
**strictly widening**: `UPLOADED` and `PENDING_REVIEW` keep working (the alias maps
`PENDING_REVIEW → UNDER_REVIEW`), and `UNDER_REVIEW` starts working. No status that
is reviewable today becomes unreviewable.

**(b) The fossil — the type and the dead machine.** The legacy `DocumentStatus`
type, `DOCUMENT_STATUSES`, `ALLOWED`, `canTransition`, `isDocumentStatus` and
`canSubmit` are unsound and unused. Removing them is a bigger, separable cleanup
with no functional urgency, and **is not required to unblock anything**.

---

## 7. Smallest architecture-consistent remediation

### Step 1 — normalize `canReview` (the whole unblock)

```ts
export function canReview(status: string): boolean {
  const s = canonicalStatus(status);
  return s === "UPLOADED" || s === "UNDER_REVIEW";
}
```

Widen the parameter to `string` so callers holding a real row's status typecheck
honestly rather than casting.

* Migration / backfill / RBAC / RLS / verifier seats: **NONE**
* Rows affected: **zero** — no `UNDER_REVIEW` or `PENDING_REVIEW` rows exist
* Behaviour change on existing data: **none**

### Step 2 — the three latent "pending" counters (optional, same commit or later)

`copilot/context.ts`, `departments/classify.ts`, `files/lifecycle.ts`: route through
`canonicalStatus` so they count `UNDER_REVIEW` too. Latent today; wrong the day
anything writes the canonical value.

### NOT in scope

Removing the legacy type/machine (§6b) · touching `LEGACY_STATUS_ALIAS` · backfilling
the 8 historic rows · anything about verifier seats.

---

## 8. Compatibility for the 8 historical `LEGACY_VERIFIED` documents

**Unaffected by the whole plan.** They are `APPROVED` → canonical `VERIFIED`, i.e.
already decided, so `canReview` returns **false** for them before and after. The
alias stays; their `provenance = 'LEGACY_VERIFIED'` marker stays; nothing rewrites
history.

## 9. Impact on document workflows

| Workflow | Impact |
| --- | --- |
| Ordinary upload → verify | None. `UPLOADED` still reviewable |
| **Deposit proofs** | **Unblocked** — see §11 |
| Generated artifacts | None. Created `VERIFIED`; never reviewed |
| Portal / analytics / sharing | None. Already normalize via `isVerified` / `VERIFIED_STORED_STATUSES` |

---

## 10. Tests and mutations required before changing shared behaviour

**Regression:**

1. `canReview("UPLOADED")` true — unchanged.
2. `canReview("PENDING_REVIEW")` true — the 8-row-era spelling still works.
3. `canReview("UNDER_REVIEW")` **true** — the new capability.
4. `canReview` false for `VERIFIED`, `APPROVED`, `REJECTED`, `SUPERSEDED`,
   `CONSUMED_AS_EVIDENCE`, `EXPIRED` — **the widening must not become "review anything"**.
5. `LEGACY_STATUS_ALIAS` still maps both keys.
6. Authority untouched: `document-row` still requires `canApprove`; `runReview` still
   asserts `document:approve` and calls `mayVerifyDocument`.
7. The RPC blocklist still refuses `SUPERSEDED` / `CONSUMED_AS_EVIDENCE`.

**Mutations:**

* `canReview` reverting to the raw comparison (the blocker returns);
* `canReview` returning `true` unconditionally (widening becomes a hole);
* dropping `UPLOADED` from the accepted set;
* dropping either `LEGACY_STATUS_ALIAS` key;
* removing `canApprove` from the row's `reviewable` expression (**must fail** — that
  would be an authorization change disguised as a recognition change).

⚠ Pin the row's predicate **bounded to `document-row.tsx`**: this session hit the
satisfied-by-neighbouring-text trap three times, most recently on an identical guard
line shared by `acceptProof`/`rejectProof`.

---

## 11. Is the deposit upload safe to canonicalize afterward? **YES — after Step 1, and only after.**

| Question | Answer |
| --- | --- |
| Would the proof still be reviewable? | **Yes** — `canReview("UNDER_REVIEW")` becomes true |
| Would the server accept the review? | **Yes, already today** — the RPC blocklist never required the legacy status (§4) |
| Any migration/backfill? | **No** — zero `PROOF_OF_DEPOSIT` rows exist; the flow has never run |
| Any authority change? | **No** — `admin_service:manage` still gates acceptance; verifier seats untouched |
| Does the pinned blocker test flip? | **Yes, by design** — `tests/debt-deposit-canonical-status.test.ts` asserts `canReview("UNDER_REVIEW") === false` and that the upload writes `PENDING_REVIEW`. Both must be updated **in the same commit** that lands Step 1, or the suite goes red |

**Sequencing: Step 1 and the deposit upload canonicalization must land together**,
because the blocker test is deliberately written to fail the moment the blocker is
removed — that is what makes it a reminder rather than a comment.

---

## Decision requested

> **Approve Step 1** — normalize `canReview` via `canonicalStatus` (one predicate,
> no migration, no backfill, no authorization change) — **and, in the same commit,
> complete the deposit upload canonicalization** it unblocks?
>
> **Step 2** (the three latent "pending" counters): same commit, later, or not at all?
>
> The §6b fossil cleanup (legacy type + dead machine) is **not** proposed here and
> should be its own decision.
