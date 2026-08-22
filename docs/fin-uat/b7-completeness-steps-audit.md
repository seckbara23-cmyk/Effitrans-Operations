# B7 / DEFECT-FIN1-B — Completeness Steps 18–19 Audit (CORRECTION)

**Audit only — nothing implemented. FIN-1-00 recorded PASS** (DB-verified: the UAT
client exists, flag true, `account_manager_id` null, 0 contacts, active).

## Verdict up front

**DEFECT-FIN1-B is WITHDRAWN as build-required. The smallest production-correct
implementation needed to make Steps 18–19 executable is: NOTHING — zero code.**
Both steps are already executable through the normal Effitrans workflow, with
existing RBAC, audit, maker-checker and dossier-state invariants. My preflight
claim (`3f7c990`) was wrong in its central assertion, for two reasons I can name
precisely:

1. **The registry's `requiredEvidence` keys are descriptive metadata, not an
   engine contract.** `evaluateStepEvidence` reads **`requiredDocuments`** only
   (`lib/process/engine/evidence.ts:173-176`); the four
   `completeness_checked_by/at`-style keys are never evaluated by anything. I
   pattern-matched "keys appear nowhere else" into "the gate can never open" —
   the registry-metadata trap this project has already documented twice, now
   caught a third time on a different field.
2. **A generic step-execution UI exists and I missed it.** The queue surfaces
   (`components/process/queue-row-actions.tsx` → `queueStartStep`,
   `queueSubmitStep`, `queueApproveStep`, `queueRejectStep`) execute ANY owned
   step. My grep looked for direct `submitStep` callers and step keys; the queue
   wrapper names neither.

## How Steps 18–19 actually work (verified in code, cell by cell)

Steps 18/19 are the registry's **third maker-checker pair**
(`MAKER_CHECKER_PAIRS`: `coordinator_completeness` → validated by
`am_completeness`), alongside customs-prep → transit-validation and
billing-draft → finance-validation.

| | Step 18 — « Coordinateur — contrôle de complétude » | Step 19 — « Account Manager — porte de facturation » |
| --- | --- | --- |
| Business action | Verify dossier completeness, attach receipts & payment proofs, SUBMIT for AM review | Independently APPROVE (or reject with mandatory reason) the coordinator's submission |
| Actor | COORDINATOR (also OPS_SUPERVISOR / SYSTEM_ADMIN — engine guard `process:manage`) | ACCOUNT_MANAGER (same guard), **identity ≠ submitter** (`evaluateMakerChecker`) |
| UI surface | **`/queues/coordination`** — generic row actions: Démarrer → Soumettre | **`/queues/account_management`** — Approuver / Rejeter (motif obligatoire) |
| Evidence (engine-enforced) | `requiredDocuments: [RECEIPT, PAYMENT_PROOF]` — both map to typeCode **`PAYMENT_RECEIPT`**, so **one VERIFIED Reçu / Preuve de paiement document satisfies the step**; refusal `evidence_missing` surfaces in the queue UI (« Preuves requises manquantes ») | none (`requiredDocuments: []`) — the approval itself is the evidence |
| State machine | prerequisite `transport_pod_handoff` COMPLETED; submit → **SUBMITTED** (independent review required) | approve → BOTH steps **COMPLETED**, `reviewed_by` / `reviewed_at` recorded, CAS « never overwrite a prior review » |
| Audit | engine step events + audit_log, as for every other step | approval / rejection audited with maker identity |

**The billing gate then opens on facts, not attestations**
(`evaluateBillingGate`): ① VERIFIED `DELIVERY_NOTE` (the signed POD — produced by
the TMS-7-proven transport chain), ② step 18 done, ③ step 19 done →
`prepareInvoiceDraft` accepts.

## What this means for FIN-1

No build, no ratification of new surfaces — **B7 is removed from the roadmap**.
What replaces it in the runbook is a **pre-chain**: the UAT dossier must genuinely
walk the governed process (intake → … → transport POD → completeness pair) before
the billing lane can produce the deposit-eligible invoice. Every segment of that
chain was production-proven in TMS-7 (UAT-15 intake/customs, UAT-20 POD); FIN-1
replays them on the FIN-UAT dossier and then exercises the never-run segments:
steps 18–19 via the queues, the governed billing lane, and the deposit chain.

Actor fit with existing accounts (no grants needed): coordinator half —
operator/SYSTEM_ADMIN or a COORDINATOR seat; AM half — `account.manager.demo`
(ACCOUNT_MANAGER since TMS-7 UAT-11b) as the distinct checker identity.
B-1 / B-2 / B-5 remain exactly as recorded.
