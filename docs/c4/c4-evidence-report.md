# C-4 — evidence report

**Verdict: C-4 COMPLETE.**

**Establishing commit:** `320b16c`
**Establishing CI run:** [33013111131](https://github.com/seckbara23-cmyk/Effitrans-Operations/actions/runs/33013111131) — both jobs `success`

| job | result |
|---|---|
| `build` | 318 test files, **7574 passed**, 1 skipped; `Compiled successfully` |
| `rls-tests` | 53 SQL suites, then 6 journey files, **124 passed** |

No accepted exceptions in CI. One local-only failure exists and is environmental:
`tests/expense-approval-chain.test.ts` pins a source slice containing a newline
and fails on Windows checkouts where git rewrites LF to CRLF. It passes on Linux
and therefore in CI. It is unrelated to C-4.

---

## 1. What C-4 set out to prove

That a completely fresh dossier can traverse the canonical 26-step workflow from
Creation to Closure **without repair, bypass, hidden operator intervention, or
architectural disagreement** — executed against a real Postgres with real server
actions, with only session identity stubbed.

---

## 2. Defects discovered and fixed during C-4

Every one of these was found by the harness, not by inspection. Each was stopped
on, reported, and corrected only after ratification.

| # | defect | correction |
|---|---|---|
| 1 | **Evidence completeness computed from the observer.** A step reported complete on an empty `missing` when the actor could not read the evidence at all — closing having verified nothing. | `evidence_unauthorized` as a distinct refusal, checked before completeness; `QUOTATION_MANAGER` document read (migration 124) |
| 2 | **Step execution gated on a blunt permission.** Step 16 was reachable by anyone holding a broad capability. | narrow dedicated capability (migration 125), plus a generated ownership invariant binding all 26 steps to `process_step_owning_role` |
| 3 | **Promotion derived from the wrong source.** Successors were promoted from `nextSteps` rather than from actual prerequisite satisfaction; reconciliation could complete a step without evidence. | `dependentsOf()` + `promoteSuccessors` as the single promotion authority; evidence enforced in reconciliation |
| 4 | **Gate verdicts read from the caller's filtered snapshot.** The pickup gate consulted customs, documents and transport through the caller's permissions, so a requirement read false for the very role that owns the step. | `authoritativePickupGate` — verdicts computed from platform state, never from an observer-filtered view |
| 5 | **Irreversible send with no provider branch.** Invoice issuance claimed success without a real send path. | real SMTP provider branch + a CI mail sink; two-part correction at the irreversible-send boundary |
| 6 | **Discarded consequences.** Six sites called a consequential action and threw the result away, so a failure left the workflow silently stalled. | all six corrected; a generated invariant now pins them |
| 7 | **Step 25→26 handoff regression.** Custody was recorded before the handoff existed. | reordered to complete → send → record with the real handoff id, without weakening C-2 |
| 8 | **Reception authority from permission alone.** Any `process:handoff:receive` holder could receive any handoff, including another department's. | routed-receiver eligibility derived from the registry (migration 126); `not_eligible_receiver` |
| 9 | **Step 24 completed by the wrong hand.** `submitProof` attempted a completion that could never succeed, and the first correction would have had Administration complete the courier's step. | **Option B**: courier deposits and returns the proof, Administration independently verifies it, the **courier** completes its own step |
| 10 | **Reception was not enforced at all.** C-1's promotion became a second writer of `AVAILABLE` and dissolved the guarantee that a handoff target could not be started before acceptance — for **23 of the 26 steps**. | **Option 1**: promotion opens the step; an outstanding handoff addressed to it blocks execution with `handoff_reception_required` at both `activateStep` and `submitStep` |

**One root pattern accounts for six of the ten**: *authority or routing derived
from the wrong source* — completeness from the observer, gate verdicts from the
observer, execution from a blunt permission, promotion from `nextSteps`,
reception from permission alone, and finally reception from the shape of the
ladder rather than from a check. Each is now a permanent generated invariant.

**Migrations shipped by C-4:** 124 `quotation_manager_document_read`,
125 `delivery_followup_capability`, 126 `collections_handoff_reception`.

---

## 3. Journey coverage achieved

All against a real database, all in CI.

| journey | tests | what it establishes |
|---|---|---|
| `delivery-completeness` | 54 | the **deposit-required Creation → Closure** path, steps 1–26 plus closure: transit, customs, GAINDE, BAE, transport, pickup, delivery follow-up, completeness, billing, issuance, deposit custody ladder, collections, payment, reconciliation, closure |
| `transit-customs` | 23 | slice 2 — reception, customs preparation, maker/checker 6→7, GAINDE, BAE |
| `no-deposit` | 9 | the **control fixture**: a client owed no paper deposit; steps 23–25 reach `SKIPPED`, the closure gate marks the deposit requirements `notApplicable`, and no deposit or proof record exists at closure |
| `negative-battery` | 20 | every ratified refusal, walked on one dossier, in the order it meets them |
| `lifecycle` | 14 | dossier lifecycle transitions |
| `issuance-consequence` | 4 | the irreversible-send boundary end to end |
| **total** | **124** | |

The deposit-required journey ends with the dossier `CLOSED`, the process
instance `CLOSED`, closure audited and attributed, and every fact behind it
unchanged — money, invoice number, accepted proof and custody all preserved.

---

## 4. Negative controls proved

The battery asserts **protected state**, not just refusal codes: step state,
assignment, reviewer fields, handoff status and receiver, invoice status,
validator and number, the payment ledger, custody, dossier status, process
terminal state, and the presence or absence of audit rows.

Out of sequence · wrong actor · signed out · missing evidence · invalid
« sans objet » (non-declarable type, blank motif, invented key) · claimed-step
hijack · permission without eligibility · **skipped reception, at both doors** ·
maker = checker 6→7 · pickup before convergence · pickup before readiness ·
invoice without lines · self-validation · unauthorized validation · partial
payment · unverified settlement · overpayment · deposit-required closure without
an accepted proof · closure before payment.

It closes by proving the dossier is **still advanceable** — it met every refusal
above and still reached settlement. A guard that refuses everything is not a
guard.

---

## 5. Mutations proved

126 structural invariant assertions across 11 suites run without a database:

`c4-step-ownership-invariant` (16) · `c4-handoff-reception-required` (15) ·
`c4-reconciliation-authority` (15) · `c4-issuance-consequence` (15) ·
`c4-gate-authority` (13) · `c4-evidence-authority` (10) ·
`c4-proof-verification-sequence` (9) · `c4-step27-representation` (9) ·
`c4-discarded-consequence` (8) · `c4-deposit-routing` (8) ·
`c4-smtp-provider` (8).

**Bounded lethality sweep on the newest invariant** — six targeted mutations,
each applied to the real source, each reddening the suite, each reverted:

| mutation | caught |
|---|---|
| M1 drop the guard from `activateStep` | ✓ 2 failed |
| M2 drop the guard from `submitStep` | ✓ 1 failed |
| M3 match the **sender's** step instead of the target | ✓ 1 failed |
| M4 drop the `SENT` condition (a received handoff would block forever) | ✓ 1 failed |
| M5 make the guard blind — always return null | ✓ 2 failed |
| M6 move handoffs behind a permission flag in the snapshot | ✓ 1 failed |

M6 is the one that matters most: it is the exact failure that produced defects 1
and 4, and the pin exists so the guard cannot quietly go blind for precisely the
callers it is meant to stop.

---

## 6. Business decisions ratified during C-4

| decision | outcome |
|---|---|
| Step 16 authority | narrow dedicated capability, not a broad grant |
| Invoice issuance | real SMTP provider branch plus a CI mail sink |
| Step 24 ownership | **Option B** — human ownership preserved; the courier completes its own step on independently verified evidence; Administration is not granted `courier:deposit` and no system principal bridges the sequence |
| Final closure | **Operations** performs it; MAYA-P1.5 and P1.6 preserved; « Step 27 » is CEO numbering, not a registry node; the two-door architecture is **frozen** and `operational_file = CLOSED` with a non-terminal process instance on the manual door is **not** a defect |
| Reception | **Option 1** — promotion opens, reception starts; no new handoffs created, no mandatory reception imposed on transitions that have no sender |

---

## 7. Residual items deferred

Recorded in [c4-residual-findings.md](c4-residual-findings.md). None blocks C-4.

- **R-1** — whether every cross-department transition should require an explicit
  send and receive. Four have a sender today; seventeen do not. A workflow
  question for UAT, not an engine question.
- **R-2** — invoice numbering gaps burned by failed sends. Open business ruling;
  depends on the accounting requirement and Sage 100 import tolerance.
- **R-3** — the two-door closure asymmetry. Ratified as correct and frozen;
  recorded so it is not rediscovered as a defect.
- **R-4** — the courier's round trip to close step 24 after verification. Correct
  by design; a UAT observability note.

---

## 8. What C-4 does **not** claim

That no defect can exist in the platform. C-4 proves that the canonical 26-step
workflow, its no-deposit variant, its refusals, its authority boundaries and its
closure all behave correctly under a real database, and that the invariants
established along the way are pinned against regression.

Manual UAT resumes from here.
