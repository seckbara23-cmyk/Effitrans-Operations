# Dossier Journey Integrity Audit — Phase 1 (READ ONLY)

**2026-08-23. Nothing modified**: no production data, no EFT-IMP-2026-00007, no
roles, permissions, migrations, registry semantics or workflow state. Deployed
`abc9d40`; migration ledger head `20260913000001` (121), applied in production.

**Verdict up front: RED.** Not because of a symptom, but because one invariant is
architecturally absent. It is fixable, and the fix is smaller than the symptom
count suggests.

---

## 1. The one finding that explains the rest

**Dossier read visibility is derived from IDENTITY, never from RESPONSIBILITY.**

Every ground in `user_readable_file_ids` answers *"is this dossier attached to
you personally?"* — you are its account manager, coordinator, creator, its
process owner, you hold an assigned task or step, you appear in its assignment
history — or else short-circuits on the blunt `file:read:all`. Only one ground
was ever workflow-derived: the handoff clause added in migration 121. And that
one **expires at the exact moment responsibility begins**.

EFT-IMP-2026-00007 demonstrates it in three rows:

| Fact (read live) | Value |
| --- | --- |
| handoff `coordinator_reception` | **RECEIVED** 19:01:37 by chef.transit.demo |
| execution `coordinator_reception` | **AVAILABLE**, `assigned_user_id` **null** |
| `user_readable_file_ids(chef.transit.demo)` ∋ 00007 | **false** |

The Chef de Transit received the dossier and *thereby lost the ability to open
it*. The step is now his department's live responsibility; the handoff that made
it readable is closed; no identity ground applies; `customs_record` count is
**0**, so the customs-department clause cannot help either. This is not a bug in
reception. It is the invariant the platform never had.

## 2. Canonical workflow matrix — generated from the registry, not assumed

`n | step_key | dept | process role | tenant role | queue | read basis when the step is UNASSIGNED`

```
 1 cotation                     cotation             COTATION_OFFICER        QUOTATION_MANAGER       cotation             NONE
 2 operations_intake            operations           OPERATIONS_MANAGER      OPS_SUPERVISOR          cotation             read:all
 3 am_dossier_opening           account_management   ACCOUNT_MANAGER         ACCOUNT_MANAGER         account_management   read:all
 4 coordinator_reception        transit              CHIEF_TRANSIT           CHIEF_OF_TRANSIT        transit              customs-dept*
 5 transit_declarant_assignment transit              CHIEF_TRANSIT           CHIEF_OF_TRANSIT        transit              customs-dept*
 6 customs_preparation          customs_declaration  CUSTOMS_DECLARANT       CUSTOMS_DECLARANT       customs_declaration  customs-dept*
 7 transit_validation           transit              CHIEF_TRANSIT           CHIEF_OF_TRANSIT        transit              customs-dept*
 8 coordinator_to_finance       coordination         COORDINATOR             COORDINATOR             coordination         NONE
 9 gainde_registration          finance_customs      CUSTOMS_FINANCE_OFFICER CUSTOMS_FINANCE_OFFICER finance_customs      NONE
10 coordinator_to_declarant     coordination         COORDINATOR             COORDINATOR             coordination         NONE
11 gainde_document_submission   customs_declaration  CUSTOMS_DECLARANT       CUSTOMS_DECLARANT       customs_declaration  customs-dept*
12 customs_followup             coordination         COORDINATOR             COORDINATOR             coordination         NONE
13 customs_field_clearance      customs_field        CUSTOMS_FIELD_AGENT     CUSTOMS_FIELD_AGENT     customs_field        customs-dept*
14 transport_assignment         transport            TRANSPORT_OFFICER       TRANSPORT_OFFICER       transport            NONE
15 pickup                       pickup               PICKUP_AGENT            PICKUP_AGENT            pickup               NONE
16 am_delivery_followup         account_management   ACCOUNT_MANAGER         ACCOUNT_MANAGER         account_management   read:all
17 transport_pod_handoff        coordination         COORDINATOR             COORDINATOR             coordination         NONE
18 coordinator_completeness     coordination         COORDINATOR             COORDINATOR             coordination         NONE
19 am_completeness              account_management   ACCOUNT_MANAGER         ACCOUNT_MANAGER         account_management   read:all
20 billing_draft                billing              BILLING_OFFICER         BILLING_OFFICER         billing              read:all
21 finance_invoice_validation   finance              FINANCE_OFFICER         FINANCE_OFFICER         finance              read:all
22 billing_dispatch             billing              BILLING_OFFICER         BILLING_OFFICER         billing              read:all
23 administration_deposit_prep  administration       ADMINISTRATIVE_OFFICER  ADMINISTRATIVE_OFFICER  administration       read:all
24 courier_deposit              courier              COURIER                 COURIER                 courier              NONE
25 administration_proof_handoff administration       ADMINISTRATIVE_OFFICER  ADMINISTRATIVE_OFFICER  administration       read:all
26 collections                  collections          COLLECTIONS_OFFICER     COLLECTIONS_OFFICER     collections          read:all
```

**16 of 26 steps cannot be opened by the role responsible for them** when the
step is unassigned — the normal state immediately after a handoff:

* **10 with NO ground at all:** 1 cotation · 8, 10, 12, 17, 18 COORDINATOR ·
  9 CUSTOMS_FINANCE_OFFICER · 14 TRANSPORT_OFFICER · 15 PICKUP_AGENT ·
  24 COURIER.
* **6 conditional** on a `customs_record` row already existing: the entire
  Transit/customs spine (4, 5, 6, 7, 11, 13). Step 4 is exactly 00007 today.

The 10 that work do so **only because their tenant role happens to hold
`file:read:all`** — a blunt grant, not workflow-derived. The registry's own
role vocabulary maps cleanly (`unmapped process roles: none`), so this is not a
mapping defect: it is a missing ground.

## 3. Root-cause groups (not symptoms)

### RC-1 — No responsibility-derived read ground *(causes the majority)*
Covered above. Every visibility gap between two legitimate workflow states,
including 00007's post-reception state and every "Dossier introuvable" reported
in FIN-UAT, reduces to this one absence.

### RC-2 — Two work-discovery subsystems with different truths
`/departments/queue` uses `lib/workflow/access/queue.ts`; `/queues/*` and
`/my-work` use `lib/process/queues/service.ts`. They read different facts and
answer differently for the same dossier. `abc9d40` reconciled one case (open
handoffs) but the duplication itself remains — the next divergence is a matter
of time. **Additionally: the department queue reads with the ADMIN client and
applies no file scope at all** (`resolveFileScope` / `isFileVisible` appear zero
times in that module), so it can list a dossier's number and client name to
someone who cannot open it. That is precisely the "advertises more authority
than its destination admits" pattern, and it is what made the contradiction
visible to the operator.

### RC-3 — Registry metadata is not an engine contract
`requiredEvidence` is descriptive only (the engine enforces `requiredDocuments`);
`implementation.verdict` is a frozen 5.0A snapshot. Both have misdirected
analysis — three times now, including my own withdrawn B7 claim. Nothing is
broken at runtime; the hazard is that the registry *reads* like a specification
and is not one.

### RC-4 — Reception activates but never assigns
`receiveHandoff` moves the target step to `AVAILABLE` and leaves
`assigned_user_id` null. That is deliberate (a department received it; no
individual owns it yet) and correct — but combined with RC-1 it produces the
dead zone. Fixing RC-1 makes RC-4 harmless.

## 4. Surface-by-surface consistency (current state)

| Surface | Population rule | Applies file scope? | Agrees? |
| --- | --- | --- | --- |
| `/departments/queue` | all non-closed tenant dossiers → canonical department from roles | **No** | over-reports |
| `/queues/<dept>` | executions in OPEN_STATES ∪ open-handoff targets, ∩ queue steps | Yes | since `abc9d40` |
| `/my-work` | same service, partitioned by `classifyItem` | Yes | since `abc9d40` |
| Notifications | direct `/files/{id}` link, no visibility pre-check | n/a | can 404 |
| Dossier page | RLS via `getFile` (server client) | Yes (RLS) | authoritative |

The dossier page is the only *authoritative* surface; the others advertise.
After RC-1 is closed, all five converge because they will share one definition of
"this dossier is your department's responsibility right now".

## 5. Proposed smallest architectural fixes

**F-1 (closes RC-1) — one migration: responsibility-derived read ground.**
Extend the existing bridge (`process_step_receiving_role`, migration 121) from
*receiving* roles to *owning* roles for every official step — it is already a
registry projection with the vocabulary bridge — and add one disjunct to
`user_readable_file_ids`:

> the dossier has a step execution in an OPEN state (`AVAILABLE`, `ACTIVE`,
> `BLOCKED`, `SUBMITTED`) whose owning role the user holds in this tenant.

This is *responsibility*, not membership: a specific dossier has live work owned
by a role you hold. It grants **read only** — reception, transitions,
assignment, document writes and ownership keep their own server checks. It ends
naturally when the step completes. Tenant-pinned on every join. Rebuilt on the
**live** function body (the lesson from 121), with exhaustive per-ground
assertions.

**F-2 (closes RC-2) — make `/departments/queue` derive from the same service**,
or at minimum apply `resolveFileScope` so it can never advertise an unopenable
dossier. Smaller variant for Tuesday: apply the scope filter; full convergence
after.

**F-3 (closes RC-4's residue) — next-action continuity.** With F-1 in place the
dossier page already renders the correct panel; add the one-line "what do I do
next" affordance on the queue row so the employee never needs a step key.
UX-only, no authority change.

**F-4 (RC-3) — documentation-only:** mark `requiredEvidence` and
`implementation` as descriptive in the registry header. Zero runtime effect.

## 5bis. FINANCE JOURNEY - in scope for Tuesday (added 2026-08-23)

Treated as an Effitrans platform capability that must be operationally reliable,
**not** as MAYA parity. Steps 18-26 plus the deposit chain, audited under the same
invariant.

### The good news, established by evidence

**Finance-domain RLS is PERMISSION-based, not dossier-derived.** Read policies:

| Table | SELECT predicate |
| --- | --- |
| `invoice` | `tenant AND has_permission('finance:read')` |
| `payment` | `tenant AND has_permission('finance:read')` |
| `invoice_deposit` | `admin_service:manage` OR `collections:manage` OR (`courier:deposit` AND `courier_user_id = auth.uid()`) |
| `collection_follow_up` | `tenant AND has_permission('collections:manage')` |

=> **The dossier-visibility gap (RC-1) does NOT propagate to invoices, payments,
deposits or follow-ups.** A Finance actor can always open their financial object.
This materially narrows Finance exposure: there is no Finance dead zone *on
financial objects*.

### The two Finance dead zones that DO exist - same class as Operations->Transit

| # | Where | Why |
| --- | --- | --- |
| **FD-1** | **Step 18 `coordinator_completeness` (COORDINATOR)** | No read ground (matrix row 18). The Coordinator cannot open the dossier to perform the completeness control - and this is the **first half of the billing-readiness gate**, so it blocks the governed billing lane, which is the only deposit-eligible path. **This is on the critical path for Tuesday.** |
| **FD-2** | **Step 24 `courier_deposit` (COURIER)** | No read ground. The courier CAN see the deposit row (RLS narrows to their own), but `components/deposit/deposit-row.tsx:43` links to `/files/{fileId}` - clicking it yields « Dossier introuvable ». A surface telling someone to act, linking to a page that denies them: the exact Operations->Transit pattern. |

**F-1 closes both**, because both are "an open step owned by a role I hold".

**Refinement worth ratifying with F-1:** where an open step already has an
`assigned_user_id`, restrict the new ground to that assignee plus the step's
managerial roles, rather than every holder of the owning role. Responsibility is
then individual once individualised, and role-wide only while unclaimed. This
keeps courier visibility as narrow as the deposit RLS already is.

### Finance transitions against the invariant

| Transition | Responsible | Work appears | Can open | Server authority | Verdict |
| --- | --- | --- | --- | --- | --- |
| POD prerequisite -> step 18 | COORDINATOR | queue OK | **NO - FD-1** | `process:manage` | **RED** |
| 18 -> 19 AM completeness | ACCOUNT_MANAGER | OK | OK (read:all) | maker != checker on identity | OK |
| Billing-readiness gate | - | - | - | `evaluateBillingGate`: POD + 18 + 19 | OK (once FD-1 clears) |
| 20 `billing_draft` | BILLING_OFFICER | OK | OK | `finance:create` + `billingReady` | OK |
| Submit | BILLING/FINANCE | OK | OK | `finance:create` | OK |
| 21 Validation | FINANCE_OFFICER | OK | OK | `finance:validate` + **`self_approval_forbidden`** | OK - needs 2 identities (**B-5**) |
| 22 Dispatch -> ISSUED | BILLING_OFFICER | OK | OK | `finance:issue`; **ISSUED only on successful email** | OK |
| ISSUED + `validated_at` | - | - | - | governed lane sets both; simple `/finance` path sets neither | OK |
| Client deposit config | - | - | - | shipped `32e1319`, prod-validated FIN-1-00 | OK |
| 23 -> courier -> proof | ADMIN_OFFICER / COURIER | OK | OK / **NO - FD-2** | `admin_service:manage`, `courier:deposit`, maker-checker on proof | **AMBER** |
| Payment / reconciliation | FINANCE/COLLECTIONS | OK | OK | `finance:payment`, WES-5 idempotent | OK |
| Aging / receivables | FINANCE/DAF | OK | OK | `finance:aging:*` | OK read; **finalize blocked - DAF/DGA/TREASURER 0 holders (B-1)** |
| 26 Collections | COLLECTIONS_OFFICER | OK | OK | `collections:manage` | OK |
| Final closure | - | - | - | `closure-input.ts`: balance from lines-payments, `invoice.validated_at`, and deposit proof accepted **only when the client requires it** | Coherent |

### Finance staffing for Tuesday (no new roles needed)

* **Invoice validation needs two identities** - `finance.demo` (FINANCE_OFFICER)
  holds both `finance:create` and `finance:validate`, so it cannot approve its
  own submission. Second identity: the operator (SYSTEM_ADMIN) or another
  FINANCE_OFFICER. Satisfiable today.
* **BILLING_OFFICER has no demo account** (6 real holders). Either use
  `finance.demo` (holds `finance:create`) for the draft, or grant BILLING_OFFICER
  to a demo account via `/users`. Operator's call.
* **B-1 unchanged**: DAF / DGA / TREASURER have **0 holders**, so aging
  *finalize* and the full expense visa chain remain out of Tuesday's scope
  unless staffed. Aging **read** is unaffected.
* **Outward email**: only the controlled UAT mailbox
  (`seckbara23@gmail.com`, already bound to the FIN-UAT client with **no
  contacts**, so the recipient resolves unambiguously). No real client is
  contacted.

### Rehearsal constraint, recorded

The deposit journey **must** run the governed lane (draft -> submit -> validate ->
send). The simple `/finance` issue path produces `validated_at = null` and is
therefore **deposit-INELIGIBLE** by construction - using it would silently
invalidate the rehearsal.

## 6. Automated end-to-end journey proof (plan)

A single deterministic SQL suite — `workflow_journey_test.sql`, in the CI
`rls-tests` job beside the existing suites — walking one dossier through the
representative Effitrans journey (intake → opening → transmission → Transit
reception → declarant assignment → customs preparation/validation → transport →
POD → completeness pair), asserting **after every transition**: execution state,
handoff state, ownership, `user_readable_file_ids` for the outgoing actor, the
incoming actor, and an unrelated role; plus cross-tenant negatives. Fixtures
created in `BEGIN/ROLLBACK`, never in production.

Paired TS suite for the projection layer: queue presence/absence and
`classifyItem` category at each state, using the same fixture shapes.

**Finance continuation (same suite, same fixture dossier):** completeness pair ->
billing-readiness gate -> draft -> submit -> validate *(distinct identity)* -> send
*(controlled mailbox)* -> assert `status = ISSUED` **and** `validated_at not null`
together -> client deposit flag -> `handInvoiceToAdministration` -> prepare ->
assign courier -> decline/accept -> deposit -> proof upload -> **maker-checker
refusal of self-review** -> reject -> re-upload -> accept -> hand to collections ->
payment recording -> reconciliation idempotency (second run changes nothing) ->
closure prerequisites. After each: financial-object readability for the
responsible role, dossier readability, queue presence, My Work category, and the
next actor.

Negative cases: unauthorized actor rejected; a role holder with no live step
gets nothing; visibility disappears when the step completes; tenant B sees
nothing throughout. Mutation coverage on each new invariant.

## 7. Tuesday readiness

**Current: RED** — a live dossier stops being openable by the department that
owns it, at 16 of 26 steps, without manual intervention. **With Finance in scope
the verdict is unchanged and the critical path is now explicit: FD-1 (step 18,
COORDINATOR) sits directly on the governed billing lane**, so the deposit-eligible
invoice — and therefore the whole FIN-1 chain — cannot be reached on Tuesday
until F-1 ships.

**Projected after F-1 + F-2(scope filter) + the journey proof: GREEN**, on the
evidence that F-1 is one disjunct over an existing bridge and one migration, and
that the projection layer is already reconciled as of `abc9d40`.

**Implementation order (each shipped and CI-green before the next):**
1. **F-1** migration + exhaustive assertions + SQL/TS regressions + mutations.
2. **F-2** scope filter on `/departments/queue`.
3. **Journey proof** suite wired into CI.
4. **F-3** next-action affordance (AMBER-level polish; droppable if time is short).
5. **F-4** registry header note.

Then re-run the FIN-UAT pre-chain on a fresh dossier end-to-end, with no
operator repair of database state, to convert the verdict to GREEN on evidence
rather than projection.

**Stopped for review. Nothing implemented.**
