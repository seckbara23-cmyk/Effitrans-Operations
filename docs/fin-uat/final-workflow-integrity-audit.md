# FINAL 26-Step Workflow Integrity Audit (read-only)

**2026-08-24. Nothing implemented, nothing mutated.** 00008 untouched (its step 3
stays BLOCKED as found); 00007 remains contaminated and unused. Authority: the
approved Effitrans Dossier Workflow — Creation → Closure. Where implementation
disagrees, the implementation is reported defective unless a ratified decision
supersedes.

Matrices below are **generated from the registry source**, not hand-copied; every
runtime claim is either verified this session (marked ✔) or listed as a defect.

---

## A. Canonical executable contract — the 26-step matrix

`n · key · owner (tenant role) · guard perm (A-1) · prerequisites → successors · completion evidence · maker/checker · notes`

```
 1 cotation                     QUOTATION_MANAGER  quotation:create   [] -> [2]        docs: QUOTATION, QUOTATION_APPROVAL      entry; skippable « Sans devis » (QO-1, derived reason)
 2 operations_intake            OPS_SUPERVISOR     file:assign        [1] -> [3]       docs: -                                  ENTRY; « Ouvrir » ACTIVATEs it; supervisor submits
 3 am_dossier_opening           ACCOUNT_MANAGER    file:create        [2] -> [4]       docs: TRANSPORT_REQUEST, BORDEREAU_LIVRAISON, VENDOR_INVOICE, SPENDING_AUTHORIZATION   § C below
 4 coordinator_reception        CHIEF_OF_TRANSIT   process:handoff:receive [3] -> [5]  docs: -                                  handoff target; D-2 guards the send
 5 transit_declarant_assignment CHIEF_OF_TRANSIT   customs:assign     [4] -> [6]       docs: -
 6 customs_preparation          CUSTOMS_DECLARANT  customs:create     [5] -> [7]       docs: CUSTOMS_DOSSIER (structured)       MAKER of pair 6->7
 7 transit_validation           CHIEF_OF_TRANSIT   customs:validate   [6] -> [8]       docs: CUSTOMS_DOSSIER                    CHECKER (identity ≠ maker) ✔
 8 coordinator_to_finance       COORDINATOR        process:handoff:send [7] -> [9]     docs: -
 9 gainde_registration          CUSTOMS_FINANCE_OFFICER customs:register [8] -> [10]   docs: - (GAINDE ref = structured)
10 coordinator_to_declarant     COORDINATOR        process:handoff:send [9] -> [11]    docs: -                                  handoff target
11 gainde_document_submission   CUSTOMS_DECLARANT  customs:update     [10,9] -> [12]   docs: GAINDE_SUBMISSION_EVIDENCE
12 customs_followup             COORDINATOR        customs:update     [11] -> [13]     docs: -
13 customs_field_clearance      CUSTOMS_FIELD_AGENT customs:release   [12] -> [15]     docs: BON_A_ENLEVER                      customs branch lands
14 transport_assignment         TRANSPORT_OFFICER  transport:assign   [3] -> [15]      docs: -                                  PARALLEL branch — see DEFECT R-1
15 pickup                       PICKUP_AGENT       transport:update   [13,14] -> [16]  docs: -                                  CONVERGENCE + pickup gate ✔
16 am_delivery_followup         ACCOUNT_MANAGER    transport:complete [15] -> [17]     docs: SIGNED_DELIVERY_NOTE (=DELIVERY_NOTE)
17 transport_pod_handoff        COORDINATOR        document:create    [16] -> [18]     docs: SIGNED_DELIVERY_NOTE
18 coordinator_completeness     COORDINATOR        process:completeness:review [17] -> [19]  docs: RECEIPT+PAYMENT_PROOF (one verified PAYMENT_RECEIPT) — MAKER of 18->19 ✔
19 am_completeness              ACCOUNT_MANAGER    process:completeness:review [18] -> [20]  docs: -                            CHECKER ✔; opens billing gate ✔
20 billing_draft                BILLING_OFFICER    finance:create     [19] -> [21]     docs: -                                  MAKER of 20->21; billingReady gate ✔
21 finance_invoice_validation   FINANCE_OFFICER    finance:validate   [20] -> [22]     docs: -                                  CHECKER, self_approval_forbidden ✔
22 billing_dispatch             BILLING_OFFICER    finance:issue      [21] -> [23]     docs: FINAL_INVOICE (structured)         ISSUED only on delivered email ✔; number immutable ✔
23 administration_deposit_prep  ADMINISTRATIVE_OFFICER admin_service:manage [22] -> [24] docs: FINAL_INVOICE                    handoff target; CONDITIONAL on client deposit flag ✔
24 courier_deposit              COURIER            courier:deposit    [23] -> [25]     docs: PROOF_OF_DEPOSIT                   courier maker-checker (self_review_forbidden) ✔
25 administration_proof_handoff ADMINISTRATIVE_OFFICER admin_service:manage [24] -> [26] docs: PROOF_OF_DEPOSIT
26 collections                  COLLECTIONS_OFFICER collections:manage [25] -> []      docs: -                                  closure gate: paid + validated_at + deposit proof (only if required) ✔
```

Cross-cutting invariants and their verified enforcement points: permission AND
open step (control gate ✔ b1cd6b2) · out-of-sequence hard-blocked ✔ · visibility
follows responsibility, read ≠ mutation (F-1 ✔ 9cce0e6, RLS suites) · maker ≠
checker on identity for 6→7 / 18→19 / 20→21 ✔ · explicit reception ✔ · audited
transitions ✔ (with the F-α/β attribution + compensation shipped 4d183f6).

## B. Layer trace — what is verified vs. defective

Verified end-to-end this session (registry → rows → action → permission →
visibility → queue → gates → audit): steps 2, 3-visibility, 4, and the F-1/A-1/
A-2/control-gate/D-1/D-2/F-αβγ mechanisms, each with CI-green regression and
mutation coverage; finance-domain RLS; deposit custody; billing lane. Everything
NOT verified is captured as a defect below — nothing is assumed working because a
neighbouring layer works.

## C. Document/evidence matrix — and the Step-3 answer

`doc key → typeCode → provider → verifier → required AT (completion, per engine) → downstream gate`

```
QUOTATION(+APPROVAL)      QUOTATION            Commercial     verifier seat   step 1 completion   step 2 prerequisite (or SKIPPED)
TRANSPORT_REQUEST         TRANSPORT_REQUEST    Account Mgr    verifier seat   step 3 completion   transport branch
BORDEREAU_LIVRAISON       BORDEREAU_LIVRAISON  Account Mgr    verifier seat   step 3 completion   transport docs (UNSIGNED BL — correctly distinct from DELIVERY_NOTE)
VENDOR_INVOICE            VENDOR_INVOICE       Account Mgr    verifier seat   step 3 completion   payables
SPENDING_AUTHORIZATION    SPENDING_AUTHORIZATION Account Mgr  verifier seat   step 3 completion   expense chain
CUSTOMS_DOSSIER           (structured record)  Déclarant      Chef de Transit step 6/7            GAINDE chain
GAINDE refs / submission  (structured/mapped)  Fin. douane / Déclarant  —     steps 9/11          field clearance
BON_A_ENLEVER             BON_A_ENLEVER        Terrain douane —              step 13             pickup gate (customs leg)
SIGNED_DELIVERY_NOTE      DELIVERY_NOTE        Chauffeur      verifier seat   steps 16/17         billing gate leg 1 ✔
RECEIPT / PAYMENT_PROOF   PAYMENT_RECEIPT (both) Coordinator  verifier seat   step 18             billing gate (one verified doc satisfies both keys ✔)
FINAL_INVOICE             (structured: issued invoice) —      —               steps 22/23         deposit + closure
PROOF_OF_DEPOSIT          PROOF_OF_DEPOSIT     Courier        Administration  steps 24/25         collections + closure ✔
```

**Timing verdicts:** no document is enforced at START anywhere — `activateStep`
never checks evidence; `submitStep` does. So every requirement is **completion
evidence**, which matches the canon. None is enforced too early or at the wrong
step. **One structural gap exists instead:**

**Why 00008's step 3 demands the four documents:** because the registry — the
ratified contract — declares them as step 3's completion evidence, and the
engine enforces `requiredDocuments` at submit. The step being BLOCKED in the
queue with those four named is therefore **canonical behaviour, not a defect**…
with one exception: **the evidence model has no conditionality.** « Facture
tierce payable pour le client » and « Autorisation de dépense » exist only when
the dossier HAS third-party payables / advance expenses; TRANSPORT_REQUEST only
when Effitrans performs the transport. A legitimate dossier without them can
NEVER complete step 3 — a hard business gate that is wrong for a subset of real
dossiers (defect R-2). The house already owns the correct idiom: QO-1's
« Sans devis » — a **declared, audited absence**, never a silent skip.

## D. Successor reachability — one break found

The promotion trace (generated, not assumed): every step's opener is
ENTRY / promoted-by / handoff-target — **except one**:

```
14 transport_assignment: *** NO OPENER ***
```

Step 14's prerequisite is step 3, but **no step lists 14 in `nextSteps`**
(step 3's successors = [4] only), it is not an entry step, and no handoff
targets it. D-1's promotion iterates the completed step's `nextSteps` — so
step 14 stays PENDING forever, and since step 15 `pickup` requires **13 AND 14**,
**the convergence can never be satisfied and steps 15–26 are unreachable.**
This is the next 00008-class deadlock, found statically before any operator hit
it (defect R-1). Everything else: 26/26 reachable once R-1 is fixed.

## E. Queue/action consistency

Verified ✔: `/my-work`+`/queues` list OPEN_STATES ∪ open-handoff targets;
`classifyItem` partitions honestly; A-2 hides what the server refuses (with the
reception-authority carve-out); blocked-with-reasons steps appear in « Bloqués »
(00008's step 3 does — visible AND explained, which is correct). Remaining
issues: R-1 makes step 14 *invisible work* (its own class of ghost); and the
department queue's missing file-scope (F-2, already registered) remains the one
surface that can advertise what it cannot open.

## F. Handoffs — four, one guarded

| from → to | sender guard on from-step done? |
| --- | --- |
| 3 → 4 (Transit) | **YES — D-2** ✔ |
| 9 → 10 (gainde → coordinator) | **NO** — `request-actions.ts:552` sends unguarded (R-3) |
| 22 → 23 (billing → administration) | **NO explicit guard** — mitigated: sent inside the issue flow after ISSUED, but not enforced (R-3) |
| 25 → 26 (proof → collections) | **NO explicit guard** — mitigated by deposit state machine (PROOF_ACCEPTED), but the step itself is not checked (R-3) |

Reception is explicit everywhere ✔; target activation enforces prerequisites ✔.

## G. Finance → Closure

Verified ✔ this session: completeness pair with identity maker-checker; billing
gate on facts (POD+18+19); draft→validate (`self_approval_forbidden`)→ISSUED only
on delivered email with immutable numbering; deposit conditionality on the client
flag (never implicit); courier self-review refusal; payment→balance; WES-5
reconcile idempotency; closure gate = paid-in-full + `validated_at` + deposit
proof only-if-required. Open finance items already registered: B-1 staffing
(expense visa chain, aging finalize) — out of journey scope.

## H. Security/audit invariants

All verified ✔ across the session's fixes and suites: creator ≠ Responsable
client; designation ≠ completion (mutation-tested); owner ≠ assignee; read ≠
mutation (F-1 limits + control gate); maker/checker on identity ×3; attribution
mandatory with ONE documented unrecoverable condition
(`PromotionAuditUnrecoverableError`, F-β); tenant isolation pinned in every new
clause and suite. Known permanent scar: 00008's single unaudited promotion
(recorded, not repaired).

## I. Defect register (remaining — everything previously found is fixed & CI-covered)

| ID | Sev | Canonical requirement | Actual | Root cause | Steps | Fix | Regression |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **R-1** | **P0** | every step reachable when prerequisites satisfied | step 14 has NO opener → 15–26 unreachable | **promotion iterates `nextSteps` instead of prerequisite-DEPENDENTS**; registry omits the parallel fork from step 3's successors | 14, then 15–26 | promote by dependents: on completion, scan steps whose prerequisites INCLUDE the completed step (inverse index from the registry); `nextSteps` stays documentation | the reachability trace becomes a TEST: every non-entry, non-handoff step must have ≥1 promoting dependent path; plus a runtime case: completing 3 promotes BOTH 4-side and 14 |
| **R-2** | **P1** | step-3 evidence matches dossier reality | unconditional VENDOR_INVOICE / SPENDING_AUTHORIZATION / TRANSPORT_REQUEST block legitimate dossiers | evidence model has **no conditionality**; the QO-1 declared-absence idiom exists but only for cotation | 3 (potentially 18) | per-document **declared absence**: an audited « Sans objet — <motif> » declaration by the owning actor satisfies the key (mirrors « Sans devis »); which docs may be declared absent = **one ratification question to Effitrans** | evidence with declaration passes; silent absence still blocks; declaration is audited and attributed; mutation: declaration satisfying a NON-declarable doc must fail |
| **R-3** | P2 | a handoff's from-step is complete before send | 3 of 4 senders unguarded (9→10, 22→23, 25→26) | D-2 fixed one call site, not the pattern | 10, 23, 26 | enforce in `sendHandoff` itself: refuse unless from-step `isDone` (one guard, four sites covered) | per-handoff early-send refusal; mutation: guard removed |
| **R-4** | P2 | completion semantics enforced | `completionRule` strings are prose the engine never reads (e.g. step 2 `account_manager_assigned` not checked at submit) | RC-3: registry fields that read like contracts but aren't (3rd occurrence class) | several | mark `completionRule`/`requiredEvidence`/`implementation` as DESCRIPTIVE in the registry header (F-4); enforcing them is business-by-business ratification, not a blanket change | header note + the existing memory |
| **R-5** | P3 | promotion+audit atomic | compensation path (F-β) instead of a transaction | post-commit side-effect not transactional | all | the recorded follow-up: one RPC doing CAS+audit atomically (migration) | RPC self-assertions + suite |
| **R-6** | P2 | dept queue never advertises unopenable dossiers | `/departments/queue` admin-client, no file scope | RC-2 (already registered as F-2) | all | apply `resolveFileScope` (F-2) | scope test |

**Shared root causes:** **SR-1** — routing/authority derived from the wrong
source (visibility→identity, guards→blunt permission, buttons→queue definition,
promotion→`nextSteps`): four expressions of ONE drift; R-1 is its last standing
instance and the dependents-index is the same correction shape as F-1/A-1/A-2.
**SR-2** — descriptive registry fields mistaken for contracts (R-4).
**SR-3** — no declared-absence mechanism outside cotation (R-2).
**SR-4** — non-atomic post-commit side-effects (R-5, compensated today).

## J. Definitive automated journey — design

**Harness:** a dedicated `journey` vitest project run inside the existing
`rls-tests` CI job (real Postgres, all migrations, seed). An **identity harness**
stubs exactly ONE boundary — session resolution (`requireUser` /
`assertPermission`'s user lookup) — to impersonate seeded demo identities
(AM, OPS_SUP, CHIEF_OF_TRANSIT, DECLARANT, CUSTOMS_FINANCE, FIELD_AGENT,
TRANSPORT, PICKUP, DRIVER→doc upload, DOCUMENTATION, BILLING/FINANCE ×2 distinct,
ADMIN_OFFICER, COURIER, COLLECTIONS; plus tenant-B actors). Everything else —
server actions, engine, gates, RLS-mirroring visibility, audit validator,
document doctrine — runs REAL. Zero SQL repair, zero direct state mutation, zero
special-casing: fixtures are created by calling `createClient`, `createFile`,
`openDossierWorkflow`… exactly as the UI would.

**Spine (assertions after EVERY transition):** previous actor's act committed +
audited + attributed → successor row AVAILABLE → visible via
`user_readable_file_ids` AND queue population for the right role → WRONG role
denied (read where applicable, mutation always) → right actor starts (ACTIVE,
started_at, assignee) → evidence uploaded/verified at the canonical point →
submit/approve with maker≠checker asserted by attempting self-approval first →
handoffs: early send refused, explicit receive required → parallel branches:
step 14 promoted at step 3, pickup refuses until BOTH 13 and 14 → Finance: gate
closed before 18/19, open after; draft; self-validation refused; distinct
validator; issue → ISSUED + validated_at + number; deposit path taken ONLY
because the fixture client requires it (and a control fixture WITHOUT the flag
skips 23–25); courier decline/accept/proof/self-review-refusal/reject/re-accept;
payment; reconcile ×2 idempotent; **closure refused early at every earlier
attempt point; closure succeeds at the end**.

**Negative/mutation battery (CI-fatal each):** remove dependents-promotion;
un-guard `sendHandoff`; drop a maker-checker identity check; null the promotion
audit actor; let declared-absence satisfy a non-declarable doc; drop the deposit
conditionality; allow closure with balance > 0; cross-tenant actor attempts at
three chokepoints.

## K. Release gate (single, binding)

GREEN only when ALL hold: canonical matrix reconciled (this doc) · **P0 = 0,
P1 = 0** (R-1, R-2 fixed; R-2 needs its ratification answer) · 26/26 reachable
(trace-as-test green) · document matrix reconciled incl. declared-absence rules ·
queue/action consistency suites green · handoff guards proven (R-3) · maker/
checker proven ×3 · audit attribution proven · **full fresh-dossier automated
journey GREEN** · negative/mutation battery GREEN · full CI GREEN. THEN one
manual Creation→Closure rehearsal on a fresh dossier, zero repair.

## Consolidated implementation plan (order, each CI-green before the next)

1. **C-1 (R-1, P0):** dependents-driven promotion + reachability-trace-as-test.
2. **C-2 (R-3):** from-step guard inside `sendHandoff` (covers all four sites).
3. **C-3 (R-2, P1):** declared-absence evidence mechanism — **after Effitrans
   answers ONE question: which of step 3's four documents may be declared
   « sans objet », and may step 18's receipts ever be?** (Recommendation:
   VENDOR_INVOICE, SPENDING_AUTHORIZATION, TRANSPORT_REQUEST declarable with
   motif; BORDEREAU_LIVRAISON not declarable; receipts not declarable.)
4. **C-4:** journey harness + spine + negative battery (J).
5. **C-5 (R-5):** atomic promote+audit RPC (migration).
6. **C-6 (R-4/R-6):** registry header note + F-2 scope filter.
7. Then the K-gate evaluation, then ONE manual rehearsal.

**STOP — awaiting approval of the plan and the C-3 ratification answer.**
