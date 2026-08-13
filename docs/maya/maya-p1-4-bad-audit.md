# MAYA-P1.4 — Bon à Délivrer (CEO step 11): audit

**Date:** 2026-08-13 · **Baseline:** `8b53e06` (P1.3) · **Ledger:** 105/105 · **No migration.**

**Classification: A — ALREADY IMPLEMENTED CORRECTLY.** No feature work.

P1.0 classified this **B** (« the type exists; no AM-facing action names it »).
That was wrong, and the reason it was wrong matters more than the finding.

---

## 1. What the corpus establishes

`docs/workflow/effitrans-business-workflow.md` is explicit on all three points
the audit needed:

> **Parallel duties:** Bon à Délivrer **from the carrier**; terminal Pre-Gate
> authorization. *(§ Account Manager duties)*

> | Bon à Délivrer (AM, carrier) | parallel activity | pickup readiness |

| | | Class |
|---|---|---|
| Owner | Account Manager | **FACT** |
| Source | obtained **from the carrier** — externally issued | **FACT** |
| Position | parallel activity, not one of the 26 steps | **FACT** |
| Purpose | hard prerequisite of the pickup join gate | **FACT** |
| What proves it | an **APPROVED** `BON_A_DELIVRER` document | **FACT** — `gates.ts` |
| Carrier's BAD reference as a queryable field | — | **UNKNOWN** (§5) |

So BAD is §H category **4**: *an externally issued artifact whose receipt is
recorded*. The platform models precisely that.

## 2. The chain is complete, and every link was verified from source

| Link | Where | Status |
|---|---|---|
| Document type | migration `20260713000002` (Phase 5.0B) | ✅ live — production has both types |
| Offered for upload | `listDocumentTypes()` returns every active non-generatable type | ✅ BAD is not a generatable artifact |
| Actor authority | activity declares `document:create`; ACCOUNT_MANAGER holds create/approve/read/update | ✅ verified in code **and** in production |
| Registry activity | `bon_a_delivrer` — owner ACCOUNT_MANAGER, `requiredDocuments: ["BON_A_DELIVRER"]`, `completionRule: "bon_a_delivrer_obtained"` | ✅ |
| Evidence rule | `checkEvidence` → `satisfied` on APPROVED, `pending_review` on awaiting, `missing` otherwise | ✅ |
| Gate | `evaluatePickupGate` consumes it as a hard prerequisite; enforced in the engine write path | ✅ |
| Control Tower | « Bon à Délivrer manquant » → `/queues/account_management`, computed from the gate | ✅ fact-driven |
| Approval governance | WES-4 `mayVerifyDocument`, including a maker-checker option that refuses `self_verification` | ✅ |
| Tests | `process-engine-core.test.ts`, `process-registry.test.ts` | ✅ pre-existing |

**Does uploading the document prove the step complete?** No — and this did not
have to be inferred. `gates.ts` states the rule: *« bon_a_delivrer — an APPROVED
BON_A_DELIVRER document »*. An uploaded-but-unapproved BAD resolves to
`pending_review / awaiting_approval` and the gate stays closed.

## 3. Why P1.0 said B — and why that will keep happening

The registry carries an `implementation` block per step. BAD's reads:

```ts
implementation: {
  verdict: "missing",
  existing: [],
  gaps: ["zero occurrences of Bon à Délivrer / BAD repo-wide",
         "no BON_A_DELIVRER document type"],
}
```

Both gaps are **false today**. They were true on 2026-07-13, when Phase 5.0A
audited the codebase — and Phase 5.0B closed them **the same day**, in the very
next migration. `lib/process/types.ts` says as much in its own comment: *«
`implementation` carries the Phase 5.0A audit verdict per step »*.

This is not a BAD-specific defect. **Across all 29 entries the verdicts are 16
`missing` and 13 `partial` — and zero `implemented`.** The block is a frozen
audit snapshot that has never been updated, and it is not a defect in itself:
the field is honestly named and its report lives in
`docs/phase-5.0a-workflow-traceability.md`. The defect is **reading it as
current state**, which P1.0 did, and which P1.4 nearly repeated.

It is deliberately **not** edited here. Rewriting a historical audit record to
match today would destroy the record and fix nothing. A guard test now pins the
contradiction instead, with BAD as the proven counter-example, so the next phase
meets the fact rather than the snapshot.

## 4. Legacy dossiers

Production carries **zero** `BON_A_DELIVRER` documents. One dossier is worth
naming:

**EFT-IMP-2026-00003** — `pickup` **COMPLETED** (provenance `RECONCILED`, fact
`TRANSPORT_PICKED_UP`), while `bon_a_delivrer` and `pre_gate` are both still
**PENDING** and no BAD document exists.

Two write paths reach « picked up ». The engine action evaluates the full gate;
the transport status transition enforces only customs release, and WES-5 then
reconciles the `pickup` step from `TRANSPORT_PICKED_UP`. The second path is
doing exactly what WES-5 doctrine says — recording that the pickup *happened*,
which is an observation, not a claim that the gate was respected.

Nothing is back-filled. The gate still reports « Bon à Délivrer manquant » for
that dossier, which is true. Whether the transport path should consult the full
pickup gate is a **pickup-gate question, not a BAD question**, and is outside
this phase.

## 5. The one open question

The registry declares `requiredEvidence: ["bad_reference", "bad_obtained_at"]`
for this activity. **Nothing consumes either.** The ratified rule is the
approved document, and the document subsystem already records uploader,
timestamps, versions, approval and audit.

* `bad_obtained_at` — the document carries its **upload** instant, which is not
  necessarily the instant the carrier issued the BAD.
* `bad_reference` — has no home but the free-text `title`.

This is the same shape as CEO step 9 before MAYA-P1.1, where
`registration_date` / `registered_by` were declared and unbacked. The difference
is decisive: for step 9 a *permission* named the act and nothing consumed it,
and the gate needed the milestone. Here **the gate is already satisfied** by the
approved document, so no capability is blocked.

**Question for Effitrans:** does the carrier's BAD reference need to be a
queryable field, or is the approved document sufficient? No column is added on
speculation — §I of the brief forbids duplicating document evidence to make
querying easier, and nothing is blocked today.

## 6. Recommendation

Nothing to build for CEO step 11. Remaining known gaps, unchanged:

* **CEO step 9 — rattachement**: blocked on Effitrans (see
  `maya-p1-3-rattachement-audit.md`).
* **R-19 — archive**: `archived_at` is « reserved » and the capability is
  genuinely missing. Fully defined; needs nothing from Effitrans.
