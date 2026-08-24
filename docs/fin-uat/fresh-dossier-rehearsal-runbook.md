# Fresh-Dossier Pre-Rehearsal Runbook (prepared 2026-08-24)

**Preparation only — I created and mutated nothing.** Subject: a brand-new dossier
created entirely through the UI. **EFT-IMP-2026-00007 is contaminated evidence and
is not the subject.** Deployed baseline `b1cd6b2` (A-1 + A-2 + control gate);
migrations 121 and 122 applied in production.

## Hard rules (restated, binding for the whole rehearsal)

UI only for business operations · no SQL correction · no Supabase manual repair ·
no forcing states · no manually created handoffs/assignments · **no SYSTEM_ADMIN
to bypass a failed operational actor** · no skipping a failure because CI says it
should work · **stop at the first unexplained discrepancy**. Read-only DB queries
are allowed to verify state and audit after actions (I run them on request).

## 0. Identity matrix — resolve BEFORE starting

Live census of active demo identities (verified today):

| Actor boundary | Identity | Status |
| --- | --- | --- |
| Operations intake / oversight / Coordinator half | `ops.supervisor.demo` (OPS_SUPERVISOR) | ✔ exists — covers COORDINATOR queue duties (coordination queue admits OPS_SUPERVISOR; holds `process:manage`, `process:completeness:review`) |
| Account Manager | `account.manager.demo` | ✔ |
| Chef de Transit | `chef.transit.demo` | ✔ |
| Déclarant en douane | `douane.demo` (CUSTOMS_DECLARANT) | ✔ |
| Finance douane (GAINDE) + Finance | `finance.demo` (CUSTOMS_FINANCE_OFFICER + FINANCE_OFFICER; holds `finance:create/issue/validate`) | ✔ — also covers the BILLING half (no BILLING_OFFICER demo exists; `finance:create`/`finance:issue` suffice under A-1) |
| Independent invoice validator | `ops.supervisor.demo` (holds `finance:validate`) | ✔ — maker≠checker satisfied vs `finance.demo` |
| Transport + pickup | `transport.demo` (TRANSPORT_OFFICER; `transport:assign/update`) | ✔ |
| Driver / POD | `chauffeur.demo` (DRIVER) | ✔ |
| Document verification (POD, customs docs) | `documentation.demo` (DOCUMENTATION_OFFICER — verifier seat per RQ-15b) | ✔ |
| Terrain douane (step 13 BAE/release) | **no CUSTOMS_FIELD_AGENT demo** | ⚠ acceptable: `chef.transit.demo` holds `customs:release`, and the gate passes when step 13 is open — record WHO acted; provision `terrain.douane.demo` only if you want strict actor fidelity |
| **Administration (deposit prep / proof review)** | **MISSING — no ADMINISTRATIVE_OFFICER demo** | ⛔ **provision `administration.demo` via `/users` before step 23** |
| **Courier** | **MISSING — no COURIER demo** | ⛔ **provision `courier.demo` via `/users` before step 24** |
| Cashier / collections | `caisse.demo`, `recouvrement.demo` | ✔ |

**Pre-step P0 (operator, via `/users` — the ratified UAT-11b pattern, existing
roles only, no permission edits):** create `administration.demo@effitrans.sn`
(ADMINISTRATIVE_OFFICER) and `courier.demo@effitrans.sn` (COURIER). Nothing else.

## 1. Joint objective checks woven into the walk

* **A-1 proof** at step 4: after « Démarrer », I verify read-only that the
  execution row shows `state=ACTIVE`, `started_at` set, `assigned_user_id` =
  chef.transit.demo, and audit `PROCESS_STEP_ACTIVATED` exists. *(Last time the
  claim was navigation; this time the row is the evidence.)*
* **Control-gate proof** at two moments: **(G1)** while step 4 is current, as
  `chef.transit.demo` attempt « Créer le dossier douane » on the FRESH dossier —
  expected: refusal « Cette action n'est pas encore ouverte dans le processus
  officiel du dossier. » **(G2)** as `finance.demo`, attempt invoice creation on
  the dossier's Finance panel before step 20 — same refusal family. Both refusals
  are PASS results.

## 2. The journey — every transition

Format: *current step → identity → where → action → expected mutation → next owner/queue*.
Verification after each: I read the execution/handoff/audit rows.

| # | Official step | Identity | Where | Action | Expected mutation | Next owner → queue |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | (create) | **account.manager.demo** *(CORRECTED — `file:create` is held by ACCOUNT_MANAGER + SYSTEM_ADMIN only; the registry’s step 3 confirms the AM initiates the dossier, while step 2 is Operations’ SUPERVISION act. The UI correctly hid the button from ops.supervisor.demo — honest surface, not a defect)* | `/files` → Nouveau dossier | Type IMP · **Client = UAT FIN-UAT (deposit-flagged, controlled email)** · Mode SEA · BL `REH-UAT-BL-001` | `operational_file` + `shipment`; no instance yet | — |
| T2 | 2 `operations_intake` | ops.supervisor.demo *(unchanged — `openDossierWorkflow` guards `process:manage`, which OPS_SUPERVISOR holds)* | dossier → Processus | « Ouvrir le dossier » with owner + **« Sans devis »** (cotation → SKIPPED) | instance created; step 2 COMPLETED; step 3 AVAILABLE | AM → account_management |
| T3 | 3 `am_dossier_opening` | account.manager.demo | `/my-work` or `/queues/account_management` | Démarrer → Soumettre | step 3 COMPLETED | — |
| T4 | (handoff) | account.manager.demo *(or ops.supervisor)* | dossier page | « Transmettre au Transit » | handoff SENT → `coordinator_reception`; depts audited | Chef de Transit → transit |
| T5 | 4 reception | chef.transit.demo | `/my-work` « À réceptionner » | « Réceptionner le dossier » | handoff RECEIVED; step 4 PENDING→AVAILABLE | — |
| **T6** | **4** | chef.transit.demo | `/queues/transit` | **Démarrer** *(A-1 proof)* then **Soumettre** | AVAILABLE→ACTIVE (started_at, assignee, audit) → COMPLETED | step 5 AVAILABLE |
| **G1** | gate probe | chef.transit.demo | dossier → Dédouanement | attempt « Créer le dossier douane » | **REFUSED (step 6 not open)** | — |
| T7 | 5 declarant assignment | chef.transit.demo | `/queues/transit` + transit panel | Démarrer → assign `douane.demo` as Déclarant → Soumettre | step 5 COMPLETED; declarant recorded | Déclarant → customs_declaration |
| T8 | 6 `customs_preparation` | **douane.demo** | `/queues/customs_declaration` + Dédouanement | Démarrer → « Créer le dossier douane » (**now allowed** — gate + `customs:create`) → fill → Recevabilité → upload required customs docs | customs_record created BY THE DECLARANT; step 6 → SUBMITTED (maker half of pair 6→7) | Chef de Transit validates |
| T8v | (docs) | documentation.demo | dossier → Documents | verify the uploaded required docs (verifier seat) | docs VERIFIED | — |
| T9 | 7 `transit_validation` | chef.transit.demo | `/queues/transit` | **Valider** (checker half; engine refuses if same identity as maker) | steps 6+7 COMPLETED | Coordinator → coordination |
| T10 | 8 `coordinator_to_finance` | ops.supervisor.demo | `/queues/coordination` | Démarrer → Soumettre (transmission to Finance douane) | step 8 COMPLETED | finance_customs |
| T11 | 9 `gainde_registration` | finance.demo | `/queues/finance_customs` + Dédouanement | Enregistrement GAINDE (reference) | registration recorded; step 9 COMPLETED | coordination |
| T12 | 10 → 11 | ops.supervisor.demo then douane.demo | coordination / customs_declaration | transmit → GAINDE/ORBUS attachment | steps 10, 11 COMPLETED | — |
| T13 | 12 `customs_followup` | ops.supervisor.demo | coordination | Démarrer → Soumettre | step 12 COMPLETED | customs_field |
| T14 | 13 field clearance | chef.transit.demo *(holds `customs:release`)* or `terrain.douane.demo` if provisioned | Dédouanement | BAE reference + release | BAE recorded; step 13 COMPLETED; customs branch landed | transport |
| T15 | 14 `transport_assignment` | transport.demo | `/queues/transport` + Transport panel | request/assign vehicle + `chauffeur.demo` (internal branch) | step 14 COMPLETED; transport record | pickup |
| T16 | 15 `pickup` | transport.demo | `/queues/pickup` | Démarrer → Soumettre (**pickup gate**: both branches must have landed) | step 15 COMPLETED | — |
| T17 | (delivery) | chauffeur.demo → documentation.demo | driver flow / Documents | signed **Bordereau de Livraison** uploaded → VERIFIED | DELIVERY_NOTE verified (podReceived TRUE) | — |
| T18 | 16 + 17 | account.manager.demo; ops.supervisor.demo | respective queues | delivery follow-up → POD handoff | steps 16, 17 COMPLETED | coordination |
| T19 | 18 completeness (maker) | **ops.supervisor.demo** | `/queues/coordination` | Démarrer → attach Reçu/Preuve de paiement (PAYMENT_RECEIPT verified) → **Soumettre** | step 18 SUBMITTED | AM (checker) |
| T20 | 19 completeness (checker) | **account.manager.demo** (distinct identity) | `/queues/account_management` | **Valider** | steps 18+19 COMPLETED; **billing gate OPEN** | Finance |
| **G2′** | gate re-probe | finance.demo | dossier Finance panel | invoice creation NOW allowed (step 20 open) | draft created | — |
| T21 | 20 `billing_draft` | finance.demo | governed billing surface | draft + lines → **Soumettre à la validation** | invoice DRAFT, submitted_by=finance.demo; step 20 SUBMITTED | validator |
| T22 | 21 validation | **ops.supervisor.demo** (≠ maker; holds `finance:validate`) | `/queues/finance` / billing surface | **Valider la facture** | invoice VALIDATED + `validated_at` | billing dispatch |
| T23 | 22 `billing_dispatch` | finance.demo | billing surface | **Envoyer au client** → email to the controlled mailbox ONLY | on delivery: invoice **ISSUED** + number; step 22 advanced | Administration |
| T24 | (deposit entry) | finance.demo | dossier Finance | « Remettre à l'Administration » (client is deposit-flagged) | `invoice_deposit` PREPARATION_PENDING | administration.demo |
| T25 | 23 prep | **administration.demo** | `/deposits` (+ Mon travail panel) | Préparer le pli → assign `courier.demo` | READY_FOR_COURIER → ASSIGNED | courier.demo |
| T26 | 24 courier | **courier.demo** | `/courier` (landing) | decline (reason) → re-assign → accept → départ → dépôt → upload `REH-UAT-PREUVE.pdf` → submit | custody chain rows; PROOF_SUBMITTED; **self-review refused** | administration |
| T27 | 25 proof review | administration.demo | `/deposits` | reject (motif) → courier re-upload → **accept** | PROOF_ACCEPTED; doc VERIFIED | collections |
| T28 | (hand to collections) | administration.demo | `/deposits` | « Remettre au recouvrement » | HANDED_TO_COLLECTIONS | recouvrement.demo |
| T29 | payment | finance.demo | Finance panel | record payment (full) | payment row; balance 0 | — |
| T30 | reconciliation | ops.supervisor.demo | `/finance/reconciliation` | run reconcile ×2 | idempotent (2nd run changes nothing) | — |
| T31 | 26 + closure | recouvrement.demo | `/collections` | follow-up → clôture (closure gate: paid + validated + deposit proof accepted) | step 26 COMPLETED; dossier closed | — |

## 3. Known blockers & observe-points (identified NOW, not mid-walk)

| # | Point | Status |
| --- | --- | --- |
| K1 | **administration.demo / courier.demo do not exist** | ⛔ resolved by P0 before T24 |
| K2 | **Transit/Finance EXECUTION env flags unverified** (`EFFITRANS_TRANSIT_EXECUTION_ENABLED`, `EFFITRANS_FINANCE_EXECUTION_ENABLED`) — if any queue action refuses with « Moteur de processus désactivé », the flag is off in Vercel; enabling it is an operator env change (TRACKING_ENABLED pattern), then resume | ⚠ resolved empirically at T6/T21 |
| K3 | Step-5/8/10/12 UI reach: the queue offers Démarrer/Soumettre generically; the DOMAIN act (declarant assignment, transmissions) may live on the transit panel/process page. If a step's completion isn't reachable from its queue, STOP and report — that is a reachability finding, not a workaround invitation | ⚠ observe |
| K4 | No CUSTOMS_FIELD_AGENT demo — chef.transit acting at step 13 is permission-legal and gate-legal; recorded as actor-fidelity deviation unless `terrain.douane.demo` is provisioned | ⚠ choice |
| K5 | Required customs documents for IMP (the UAT-15 set) must be uploaded and VERIFIED before the interlock/BAE — same as UAT-15; documentation.demo is the verifier | note |
| K6 | The deposit needs the **UAT client** (flag already TRUE, controlled email, 0 contacts) — T1 binds it; no real client is touched, and T23's email goes only to the controlled mailbox | note |
| K7 | Expense-visa chain and aging FINALIZE remain out of scope (DAF/DGA/TREASURER unstaffed — B-1) | out of scope |
| K8 | A-2/gate refusals during the walk are DATA: if a button is absent where this runbook expects it, or present where the server refuses, stop and report verbatim | rule |

## 4. What this rehearsal proves if it completes

A-1 (real activation), A-2 (honest buttons), F-1 (responsibility visibility at
every boundary), migration 121 (reception visibility), the ratified control gate
(G1/G2 refusals + later allowance), the completeness pair, the governed billing
lane producing `ISSUED + validated_at`, the full deposit custody chain with
maker-checker, payment/reconciliation idempotency, and closure — **end-to-end
with zero SQL repair**. That is the substance of the journey proof; the automated
version (F-2 + SQL journey suite) remains separate work.

**Not claiming Tuesday GREEN from this preparation.** GREEN requires this walk to
actually complete, plus F-2 and the automated journey proof.

---

**First operator action when you begin: P0** (provision `administration.demo` +
`courier.demo` via `/users`), then **T1**. Report each step's outcome; I verify
read-only after every transition and stop the walk at the first unexplained
discrepancy.
