# Phase 5.0A — Effitrans Official Workflow Traceability Audit

**Status:** Audit only. No code, schema, or production behaviour was modified.
**Date:** 2026-07-13
**Authoritative source:** "PROCESSUS OPÉRATIONNEL – EFFITRANS" (26 steps + parallel customs/transport branch), as transcribed in the Phase 5.0 brief.

> **Source-document caveat.** The workflow document and organisational diagram were *not* attached to the
> session and are not in the repository (the only document present is
> `Effitrand SaaS Discovery Questionnaire.docx`). This audit is built against the 26-step specification as
> written in the Phase 5.0 brief. Before Phase 5.0B begins, the original document should be committed to
> `docs/` so the registry can be diffed against the authoritative text.

---

## 0. Executive summary

The platform has strong **module** coverage (dossiers, documents, customs, transport, driver, finance,
portal, copilot, RBAC/RLS, multi-tenancy) but essentially **no process coverage**. The official workflow is a
26-step, multi-department, parallel-branch, maker-checker process. What exists today is a **5-status
forward-only dossier lifecycle** plus a **read-only 15-step derived display**.

Headline numbers against the 26 official steps:

| Verdict | Count | Steps |
|---|---|---|
| **Implemented** (usable as-is) | **0** | — |
| **Partial** (some primitives exist, process semantics absent) | **13** | 2, 3, 6, 9, 12, 13, 14, 15, 16, 17, 20, 22, 26 |
| **Missing** (no representation at all) | **13** | 1, 4, 5, 7, 8, 10, 11, 18, 19, 21, 23, 24, 25 |
| Parallel branch (BAD / Pre-Gate / BL) | **Missing** | — |

These counts are enforced by `tests/process-registry.test.ts`, so this table cannot drift from the registry.

Cross-cutting gaps:

- **7 of 15 official roles do not exist**, and 1 more (`QUOTATION_MANAGER`) exists with zero business permissions.
- **8 of 17 official documents have no document type**, and 4 more are only partially served — 10 new types in total.
- **Zero maker-checker separation exists anywhere in the codebase** — no code path anywhere checks that an
  approver differs from the preparer.
- **No parallel-branch primitive exists.** Everything — the lifecycle view, the handoff chain, the department
  model — is strictly linear.
- **Closure is not gated on payment.** `DELIVERED` and `CLOSED` are already distinct statuses (good), but
  `canCloseFile()` only checks customs release. An unbilled, unpaid dossier can be closed today.

---

## 1. BLOCKERS — must be resolved before Phase 5.0B

### BLOCKER-1 — CI database tests are unavailable (your own stop-condition)

The Phase 5.0 brief states: *"Do not proceed if CI database tests remain unavailable."* They are.

The `rls-tests` job in [.github/workflows/ci.yml](.github/workflows/ci.yml) fails at the **"Start local
Supabase"** step and has done so since before Phase 4.0. The 27 pgTAP RLS suites in
[supabase/tests/](supabase/tests/) therefore **never actually execute in CI** — they are dead weight. The last
commit (`6b81ce8`, "restore Supabase CI") added diagnostics but the job is still red.

Phase 5.0A is safe to land (registry + tests are pure TypeScript, no schema). **Phase 5.0B onward adds tables
and RLS policies and must not proceed until this job is green** — otherwise every new RLS policy ships
unverified.

### BLOCKER-2 — Cannot produce the Deliverable-15 migration report

`supabase/seed.sql` contains **zero `operational_file` rows**. The only dossier rows in the repo are ephemeral
pgTAP fixtures. The Supabase MCP connection is **unauthorized** (`SUPABASE_ACCESS_TOKEN` not set), so I cannot
count the live Effitrans tenant's dossiers.

Deliverable 15 ("map existing dossiers to the closest official step") cannot be planned without knowing whether
the live tenant holds 0, 50, or 5,000 dossiers and which statuses they occupy. **Needed from you:** either a
Supabase access token for the MCP server, or a dump of
`select status, count(*) from operational_file group by status`.

### BLOCKER-3 — Legacy mock modules are still wired to live routes

Five prototype modules with static in-memory data still exist **and are still reachable**:

| Mock module | Still rendered by |
|---|---|
| [lib/customs.ts](lib/customs.ts) | [app/customs/[customsId]/page.tsx](app/customs/[customsId]/page.tsx) — the customs **detail** page |
| [lib/tasks.ts](lib/tasks.ts) | [app/tasks/[taskId]/page.tsx](app/tasks/[taskId]/page.tsx) — the task **detail** page |
| [lib/status.ts](lib/status.ts) | shared by the above (a *different*, French, unrelated status vocabulary) |
| [lib/shipments.ts](lib/shipments.ts) | `components/shipments/*` (10 fake dossiers) |
| [lib/documents.ts](lib/documents.ts) | `components/documents/document-panels.tsx` (unrouted) |

The customs **list** page reads the real DB; the customs **detail** page reads fake data. Same for tasks. Any
Phase 5.0 work touching customs or task detail will land on mock data. These must be deleted or rewired before
5.0C. (This is pre-existing, not introduced by Phase 5.0.)

---

## 2. Incorrect assumptions in the Phase 5.0 brief

These are places where the brief's premise does not match the repository. Each changes the plan.

**2.1 — "Do not create a second workflow engine." There is no first one.**
The brief assumes a workflow engine exists to be reused. It does not. What exists:
- [lib/files/status.ts:23-30](lib/files/status.ts#L23-L30) — a 6-state forward-only machine
  (`DRAFT→OPENED→IN_PROGRESS→DELIVERED→CLOSED`, plus `CANCELLED`).
- [lib/files/lifecycle.ts](lib/files/lifecycle.ts) — a **read-only, derived, non-mutating** 15-step *display*.
  Its own docstring: *"Read-only visualization… no new status table, no mutation."*
- [docs/state-machine.md](docs/state-machine.md) — a designed-but-never-built config-driven engine (14 import
  states, guards, side-effects). None of `workflow_state` / `workflow_transition` / `checklist_*` exists in any
  migration.

Phase 5.0B will therefore be **building the first process engine**, not extending one. The constraint that
actually matters is *"do not create a duplicate status truth"* — which is achievable by deriving the official
step from existing records, as `lifecycle.ts` already proves is possible.

**2.2 — "Reuse the existing handoff architecture." It cannot carry this process.**
Handoffs today are not a table. They are a nullable `handoff_type` column on `task`
([supabase/migrations/20260617000001_task_handoff_type.sql:14-16](supabase/migrations/20260617000001_task_handoff_type.sql#L14-L16))
with exactly **4 hardcoded values**: `CUSTOMS_HANDOFF`, `TRANSPORT_HANDOFF`, `FINANCE_HANDOFF`,
`ARCHIVE_HANDOFF`. The from/to departments are **not persisted** — they are re-derived at read time from a
static map in [lib/handoffs/rules.ts:14-29](lib/handoffs/rules.ts#L14-L29).

There is **no reception confirmation** (a handoff task goes `TODO → DONE`; nothing distinguishes "received" from
"completed"), **no rejection/bounce-back path**, and **no reason field**. The official process needs ~12 named
handoffs, most with an explicit accept step and several with reject-with-reason. This is a rewrite of
`lib/handoffs`, not a reuse of it.

**2.3 — Deliverable 13 says "do not invent business SLA values." They are already invented and already live.**
[lib/sla/config.ts:1-20](lib/sla/config.ts#L1-L20) hardcodes thresholds that no one confirmed:
`documentation 48h/96h`, `customs 72h/144h`, `transport 24h/72h`, `finance 168h/720h`. These already drive
"delayed" flags in the Control Tower and risk scores in the Copilot. Deliverable 13's rule ("show *SLA non
configuré*, do not fabricate overdue status") **contradicts shipped behaviour**. You must decide: ratify these
four values with management, or make them unconfigured and accept that the Control Tower's delay signals go
dark until values are supplied.

**2.4 — Step 9 requires Finance to act on customs. RBAC currently forbids it.**
`FINANCE_OFFICER` holds `analytics:read, communication:*, file:read, file:read:all, finance:*, profile:*,
report:read` — and **no `customs:*` permission at all**
([lib/platform/role-templates.ts:200-204](lib/platform/role-templates.ts#L200-L204)). A Finance user cannot
read, let alone write, a `customs_record` today. Step 9 (Finance registers the declaration in GAINDE) is not
merely unimplemented — it is actively prohibited by the current permission model.

**2.5 — Step 14 "communicate tracking link." No tracking link exists.**
There is no public tracking token or anonymous tracking URL anywhere in the repo. Customer tracking is
**authenticated-portal-only** (`app/portal/(app)/files/[id]`), and every tracking feature flag
([lib/tracking/flags.ts:10-43](lib/tracking/flags.ts#L10-L43)) is **dark by default**. Driver GPS is
hardcoded `customer_visible: false` ([app/api/driver/positions/route.ts:83](app/api/driver/positions/route.ts#L83)).
"Communicate a tracking link to the client" is a new feature with a real privacy surface, not a reuse.

**2.6 — "DELIVERED must not equal CLOSED."** Already true as *statuses* — but functionally, closure is
premature-able. `canCloseFile()` ([lib/customs/gates.ts:40-47](lib/customs/gates.ts#L40-L47)) only requires
customs `RELEASED`. There is **no invoice or payment check** in `transitionFile()`
([lib/files/actions.ts:378-388](lib/files/actions.ts#L378-L388)). A dossier with a DRAFT invoice and zero
payments can be CLOSED today.

---

## 3. The 26-step traceability matrix

Legend: **E** = exists and usable · **P** = partial (primitive exists, process semantics absent) · **M** = missing.

### Phase A — Commercial intake (steps 1–3)

| # | Official step | Role (official → existing) | Current platform artefact | Required input / document | Approval rule | Next recipient | Verdict |
|---|---|---|---|---|---|---|---|
| **1** | **Service Cotation** — prepare quotation, send to client, record validation, transmit to Ops Manager. *Contract clients bypass.* | `COTATION_OFFICER` → `QUOTATION_MANAGER` **(exists but holds only `profile:read:self`/`profile:update:self` — zero business permissions)** | **Nothing.** No `quotation` table. `operational_file.quotation_ref` is reserved in [docs/database-design.md:92](docs/database-design.md#L92) but **absent from the schema**. `lifecycle.ts` step `quote_approved` is cosmetic — it is literally `file.status !== "DRAFT"` ([lib/files/lifecycle.ts:142](lib/files/lifecycle.ts#L142)). | `QUOTATION` doc, `QUOTATION_APPROVAL` doc — **neither type exists** | Client acceptance recorded before dossier activation | Ops Manager | **M** |
| — | *Contract-client bypass* | — | **`client` has no contract flag.** Columns are `name, ninea, segment, email, phone, address, account_manager_id, status` ([20260614000001:12-27](supabase/migrations/20260614000001_create_client_management.sql#L12-L27)). Nothing distinguishes contract from non-contract. | — | — | — | **M** |
| **2** | **Responsable des Opérations** — receive dossier, assign to Account Manager | `OPERATIONS_MANAGER` → `OPS_SUPERVISOR` ✅ *(semantically equivalent)* | **Two competing ownership columns.** `account_manager_id` is auto-set to the *creator* at `createFile` ([lib/files/actions.ts:71](lib/files/actions.ts#L71)) and **no action ever changes it**. `assignFile()` sets a *different* column, `assigned_to_user_id`, gated by `file:assign`, with audit + notification ([lib/files/actions.ts:284-352](lib/files/actions.ts#L284-L352)). No **intake queue** exists. Assignment history lives only in `audit_log` (`file.assigned`/`file.unassigned`) — no history table. | dossier | — | Account Manager | **P** |
| **3** | **Account Manager** — open dossier, generate ID, acknowledge to client, complete info, register in tracking board; prepare transport request, Bordereau de Livraison, request + verify vendor invoices, prepare spending authorisations; send to Coordinator | `ACCOUNT_MANAGER` ✅ | **Dossier opening: E.** `createFile` + `next_file_number()` → `EFT-IMP-2026-00001` ([20260614000002:27-50](supabase/migrations/20260614000002_create_operational_file.sql#L27-L50)).<br>**Acknowledgment: M.** The 7 customer-notify events ([lib/customer-notify/events.ts:26-34](lib/customer-notify/events.ts#L26-L34)) contain no "dossier opened" event.<br>**Completeness checklist: P.** `getMissingRequiredDocuments()` exists but is **warn-only** ([lib/documents/service.ts:98-126](lib/documents/service.ts#L98-L126)).<br>**Transport request: M.** `TRANSPORT_ORDER` exists but is a subcontractor *order*, not a *request*.<br>**Bordereau de Livraison: P.** `DELIVERY_NOTE` conflates the prepared BL with the signed POD (see §5).<br>**Vendor invoices: M.** Finance is explicitly *"no supplier bills"* ([20260615000004:6](supabase/migrations/20260615000004_create_finance.sql#L6)).<br>**Spending authorisation: M.** Zero occurrences repo-wide.<br>**Handoff to Coordinator: M.** No such `handoff_type`. | transport request, BL, vendor invoices, spending auth | AM verifies vendor invoices | Coordinator | **P** |

### Phase B — Customs chain (steps 4–13)

| # | Official step | Role | Current platform artefact | Gate / approval | Next | Verdict |
|---|---|---|---|---|---|---|
| **4** | **Coordinator** — confirm reception, transmit to Chief Transit | `COORDINATOR` ✅ | Role exists. **No reception-confirmation concept anywhere** — a handoff task has only `TODO → DONE`. No `COORDINATOR` handoff type. "No silent status change" cannot be enforced today because there is no receive step to enforce. | explicit reception | Chief Transit | **M** |
| **5** | **Chief Transit** — receive, assign Declarant | `CHIEF_TRANSIT` → `CHIEF_OF_TRANSIT` ✅ *(requires `customsBroker` capability)* | Role exists. **`customs_record` has no `declarant_id` column** ([20260615000002:28-52](supabase/migrations/20260615000002_create_customs.sql#L28-L52)). There is no declarant-assignment action, no transit queue, no assignment history. | — | Declarant | **M** |
| **6** | **Declarant** — prepare customs-clearance dossier, send to Chief Transit for validation | `CUSTOMS_DECLARANT` ✅ | **Preparation: P.** Status `DECLARATION_PREPARED` exists; `canDeclare()` blocks `DECLARED` until every `gates_customs` document is present ([lib/customs/gates.ts:26-28](lib/customs/gates.ts#L26-L28)).<br>**Submission for validation: M.** No "submitted" state, no preparer identity recorded, no route to Chief Transit. | required customs docs | Chief Transit | **P** |
| **7** | **Chief Transit** — verify + validate customs dossier, return to Coordinator | `CHIEF_OF_TRANSIT` ✅ | **Missing — and this is the single most important gap.** `customs_record.reviewed_by` exists but is written by `releaseCustoms` (the BAE step), *not* by a validation step. **No maker-checker separation exists anywhere in the codebase** — a repo-wide search finds zero checks that an approver differs from the preparer. Same user can prepare and declare. No rejection/correction loop, no reason, no resubmission tracking. | **preparer ≠ validator; reject with reason → back to step 6** | Coordinator | **M** |
| **8** | **Coordinator** — send dossier to Finance | `COORDINATOR` ✅ | No handoff type; no Finance customs-registration queue. | — | Finance | **M** |
| **9** | **Finance (customs function)** — register declaration in GAINDE, return to Coordinator | `CUSTOMS_FINANCE_OFFICER` → **MISSING**. `FINANCE_OFFICER` holds **no `customs:*` permission** — RBAC actively forbids this step. | **P (fields only).** `customs_record.declaration_number` ([:37](supabase/migrations/20260615000002_create_customs.sql#L37)) and `external_ref` — commented *"reserved for GAINDE/Orbus number (manual)"* ([:45](supabase/migrations/20260615000002_create_customs.sql#L45)) — exist, plus `declaration_date`. There is **no registration milestone** (no actor, no evidence, no receipt). Confirmed: **no GAINDE API code anywhere** (DEC-B01 = manual reference tracking). | milestone: ref + date + user + receipt | Coordinator | **P** |
| **10** | **Coordinator** — send dossier to Declarant | `COORDINATOR` ✅ | No post-registration handoff. | — | Declarant | **M** |
| **11** | **Declarant** — introduce documents into GAINDE, return to Coordinator | `CUSTOMS_DECLARANT` ✅ | **Missing.** No submission milestone, no submitted-document list, no evidence/reference. Ordering constraint (step 9 **before** step 11) is unenforceable today. | milestone + doc list | Coordinator | **M** |
| **12** | **Coordinator** — submit/follow in customs system, send to Field Agent | `COORDINATOR` ✅ | **P.** Statuses `UNDER_REVIEW` / `INSPECTION` exist. `CUSTOMS_FIELD_AGENT` role **does not exist**; no field-agent assignment. | — | Field Agent | **P** |
| **13** | **Field Agent** — follow with Customs, obtain Bon à Enlever, complete exit formalities | `CUSTOMS_FIELD_AGENT` → **MISSING** | **P.** `customs_record.bae_reference` exists ([:41](supabase/migrations/20260615000002_create_customs.sql#L41)); `canRelease()` requires it ([lib/customs/gates.ts:31-33](lib/customs/gates.ts#L31-L33)); `customs:release` is correctly withheld from the Declarant. **But:** BAE is a *text field*, not an uploadable document; there is **no customs circuit** (rouge/orange/vert) as a typed field — it exists only as free text in the dead mock; and there is **no port-exit formality model** (zero hits for *sortie de port* / gate pass). | BAE required for release | (converge with transport branch) | **P** |

### Parallel branch — Account Manager commercial/transport readiness

| Activity | Current artefact | Verdict |
|---|---|---|
| Obtain **Bon à Délivrer** from carrier | **Zero occurrences repo-wide.** | **M** |
| Obtain **Pre-Gate** terminal authorisation | **Zero occurrences repo-wide.** | **M** |
| Send Pre-Gate + BL to Coordinator and Transport | No document-recipient/routing concept exists. | **M** |
| **Parallelism itself** | **No branch/join primitive exists anywhere.** `lifecycle.ts` is a linear 15-element array; `HANDOFFS` is a linear chain (`documentation → customs → transport → finance → archive`); departments are 5 flat UI keys. | **M** |
| **Readiness / join gate before pickup** | The only gate is `canPickup()` ([lib/transport/gates.ts:15-24](lib/transport/gates.ts#L15-L24)) — a **single-criterion** check (customs `RELEASED`, with a `customs_override` escape hatch). There is no multi-criteria readiness object, no `readiness_check` / `dispatch_checklist` table or type. | **P** |

### Phase C — Transport & delivery (steps 14–17)

| # | Official step | Role | Current platform artefact | Verdict |
|---|---|---|---|---|
| **14** | **Service Transport** — assign vehicle, communicate tracking link, driver name, vehicle number, driver phone | `TRANSPORT_OFFICER` ✅ *(requires `roadTransport`)* | **Strongest existing coverage.** `transport_record` carries `driver_name, driver_phone, vehicle_plate, trailer_or_container` (free text) plus `driver_user_id` FK to a real `DRIVER` app_user. Two assignment paths: `assignTransport()` (free text, `transport:assign`) and `assignDriverUser()` (validated active same-tenant DRIVER, [lib/transport/driver-actions.ts:53-129](lib/transport/driver-actions.ts#L53-L129)).<br>**Gaps:** no vehicle master table (plate is a string — no availability/status model); **no tracking link exists at all** (see §2.5); customer-safe driver-contact policy is undefined (driver phone is stored but never exposed). | **P** |
| **15** | **Pickup Agent** — pick up merchandise, complete port-exit formalities, coordinate with Transport + Coordinator | `PICKUP_AGENT` → **MISSING** (`DRIVER` is a narrow mobile identity: `tracking:read/write` + own profile only; no dossier access) | **P.** `PICKED_UP` status + `canPickup()` gate exist. Driver can record `PICKUP_CONFIRMED` and upload `PICKUP_PHOTO`. **No port-exit formality evidence**, no pickup-agent role or queue, no coordination-visibility surface. | **P** |
| **16** | **Account Manager** — communicate delivery info, follow through customer receipt, obtain signed BL | `ACCOUNT_MANAGER` ✅ | **P.** `delivered` customer-notify event exists. Driver `confirmDelivery()` requires `recipientName` and accepts a `DRIVER_SIGNATURE` document ([lib/driver/delivery.ts:45-141](lib/driver/delivery.ts#L45-L141)). POD = an **APPROVED `DELIVERY_NOTE`**. **No AM delivery-follow-up workspace**; signed BL is conflated with POD. | **P** |
| **17** | **Service Transport** — send signed BL to Coordinator | `TRANSPORT_OFFICER` ✅ | **P — and mis-routed.** `POD_RECEIVED` requires an APPROVED `DELIVERY_NOTE` (`canReceivePod`, [lib/transport/gates.ts:26-28](lib/transport/gates.ts#L26-L28)) — good. **But it then fires `FINANCE_HANDOFF` directly** ([lib/transport/actions.ts:272-274](lib/transport/actions.ts#L272-L274)), **skipping the Coordinator (18) and Account Manager (19) completeness checkpoints entirely.** Today, POD → Finance. Officially, POD → Coordinator → AM → Billing. | **P** |

### Phase D — Completeness, billing, deposit, collections (steps 18–26)

| # | Official step | Role (official → existing) | Current platform artefact | Verdict |
|---|---|---|---|---|
| **18** | **Coordinator** — verify dossier completeness, add receipts + payment proofs, send to AM | `COORDINATOR` ✅ | **Missing entirely.** No post-delivery completeness review, no receipts/payment-proof checklist, no correction loop. (`PAYMENT_RECEIPT` doc type exists but nothing requires it.) | **M** |
| **19** | **Account Manager** — verify completeness, send to Billing | `ACCOUNT_MANAGER` ✅ | **Missing entirely.** **There is no billing-readiness gate.** An invoice can be created and issued at any time, on any dossier, with no evidence present. | **M** |
| **20** | **Billing Service** — create invoice, send to Finance for validation | `BILLING_OFFICER` → **MISSING** *(no tenant billing role; `PLATFORM_BILLING` is a different namespace and cannot be assigned to tenant staff)* | **P.** Invoice `DRAFT` state + `billing_charge` → `invoice_line` derivation exist ([lib/finance/actions.ts](lib/finance/actions.ts)). **No billing→finance approval workflow.** | **P** |
| **21** | **Finance Service** — review, validate, return to Billing | `FINANCE_OFFICER` ✅ | **Missing.** Invoice status is `DRAFT → ISSUED → PARTIALLY_PAID → PAID / VOID` ([lib/finance/status.ts:10-16](lib/finance/status.ts#L10-L16)) — **there is no `VALIDATED` state.** `canIssue()` only checks `status === "DRAFT"`. **The same `FINANCE_OFFICER` can create and issue the same invoice** — no separate approver. [docs/state-machine.md:70](docs/state-machine.md#L70) admits the AM-validation gate was an *"auto-pass placeholder."* | **M** |
| **22** | **Billing** — email invoice; send to Administration for physical deposit; send dossier for archiving | `BILLING_OFFICER` **MISSING** | **P.** `invoice_issued` email fires on issue ([lib/finance/actions.ts:293](lib/finance/actions.ts#L293)). **No invoice-delivery status split** (emailed / prepared for deposit / deposited). `ARCHIVE_HANDOFF` exists as a type, but `AuditActions.FILE_ARCHIVED` is **dead code** and there is **no `ARCHIVED` status** — `operational_file.archived_at` is never written. | **P** |
| **23** | **Administrative Service** — prepare invoice for deposit, assign Courier, archive dossier | `ADMINISTRATIVE_OFFICER` → **MISSING** *(`SYSTEM_ADMIN` is the IT/config admin, not an administrative service)* | **Missing entirely.** No courier assignment, no deposit package, no archive action. | **M** |
| **24** | **Courier** — deposit invoice with client, return proof of deposit | `COURIER` → **MISSING** *(zero occurrences of "courier" repo-wide)* | **Missing entirely.** No courier workspace, no deposit confirmation, no proof-of-deposit document type. | **M** |
| **25** | **Administrative Service** — send proof of deposit to Collections | `ADMINISTRATIVE_OFFICER` **MISSING** | **Missing entirely.** | **M** |
| **26** | **Collections Service** — monitor due dates, recover receivables, close dossier after full payment | `COLLECTIONS_OFFICER` → **MISSING** | **P.** `invoice.due_date` (defaults to issue + 30d, [lib/finance/actions.ts:282](lib/finance/actions.ts#L282)), derived `isOverdue()` boolean, `overdueCount` KPI, `collectionRate` analytics, and a manual reconciliation queue all exist. **Partial payments are fully supported** (`PARTIALLY_PAID`, Σ non-reversed payments).<br>**Missing:** collections role/queue, aging buckets, reminders/dunning (the only "recovery" is a *suggested text string* in the risk engine, [lib/copilot/risk-engine.ts:79](lib/copilot/risk-engine.ts#L79)), and — critically — **closure is not gated on payment** (see §2.6). | **P** |

---

## 4. Role-gap matrix (Deliverable 4)

16 tenant roles exist ([lib/platform/role-templates.ts:52-265](lib/platform/role-templates.ts#L52-L265), mirrored
in [supabase/seed.sql:55-75](supabase/seed.sql#L55-L75), parity enforced by `tests/role-templates.test.ts`).

| Official role | Existing role | Verdict | Action |
|---|---|---|---|
| `COTATION_OFFICER` | `QUOTATION_MANAGER` | **Exists, inert** — holds only `profile:read:self`, `profile:update:self` | Grant quotation permissions in 5.0D; **do not rename** |
| `OPERATIONS_MANAGER` | `OPS_SUPERVISOR` | ✅ Equivalent ("Superviseur opérations", genericName `MANAGER`) | Reuse as-is |
| `ACCOUNT_MANAGER` | `ACCOUNT_MANAGER` | ✅ Exact | Reuse |
| `COORDINATOR` | `COORDINATOR` | ✅ Exact ("Control tower") | Reuse |
| `CHIEF_TRANSIT` | `CHIEF_OF_TRANSIT` | ✅ Equivalent (gated on `customsBroker`) | Reuse |
| `CUSTOMS_DECLARANT` | `CUSTOMS_DECLARANT` | ✅ Exact | Reuse |
| `CUSTOMS_FINANCE_OFFICER` | — | **MISSING** | **New role** — or grant `FINANCE_OFFICER` a narrow `customs:register` permission. See §2.4. |
| `CUSTOMS_FIELD_AGENT` | — | **MISSING** | **New role** |
| `TRANSPORT_OFFICER` | `TRANSPORT_OFFICER` | ✅ Exact (gated on `roadTransport`) | Reuse |
| `PICKUP_AGENT` | — | **MISSING** (`DRIVER` ≠ pickup agent: no dossier access) | **New role** |
| `BILLING_OFFICER` | — | **MISSING** — `FINANCE_OFFICER` currently conflates billing + finance | **New role. This split is mandatory** — steps 20/21 are a maker-checker pair and cannot be separated while one role does both. |
| `FINANCE_OFFICER` | `FINANCE_OFFICER` | ✅ Exists — but must **lose** invoice-*creation* rights to become a clean validator | Narrow permissions |
| `ADMINISTRATIVE_OFFICER` | — | **MISSING** (`SYSTEM_ADMIN` is IT/config) | **New role** |
| `COURIER` | — | **MISSING** | **New role** (narrow, like `DRIVER`) |
| `COLLECTIONS_OFFICER` | — | **MISSING** | **New role** |

**Summary: 7 new roles (`CUSTOMS_FINANCE_OFFICER`, `CUSTOMS_FIELD_AGENT`, `PICKUP_AGENT`, `BILLING_OFFICER`,
`ADMINISTRATIVE_OFFICER`, `COURIER`, `COLLECTIONS_OFFICER`), 1 role to activate (`QUOTATION_MANAGER`), 1 role to
narrow (`FINANCE_OFFICER`), 7 to reuse unchanged.** Enforced by `tests/process-registry.test.ts`.

Existing roles **not** in the official process — keep them, they serve other purposes: `SYSTEM_ADMIN`, `CEO`,
`DOCUMENTATION_OFFICER`, `WAREHOUSE_COORDINATOR`, `COMPLIANCE_HSSE`, `CLIENT_USER`, `PARTNER_AGENT`, `DRIVER`.

---

## 5. Document-gap matrix (Deliverable 9)

16 document types exist today ([20260615000001:35-44](supabase/migrations/20260615000001_create_documents.sql#L35-L44)
+ [20260712000001:14-20](supabase/migrations/20260712000001_driver_evidence_types.sql#L14-L20)).

| Official document | Existing type | Verdict |
|---|---|---|
| Quotation | — | **MISSING** (`QUOTATION` is listed in [docs/document-catalog.md:47](docs/document-catalog.md#L47) but never migrated) |
| Customer quotation approval | — | **MISSING** |
| Transport request (*demande de transport*) | `TRANSPORT_ORDER` | **PARTIAL** — an *order* to a subcontractor, not a *request*. Semantically different; needs a new type. |
| **Bordereau de Livraison** | `DELIVERY_NOTE` ("Bon de livraison / POD") | **PARTIAL — and conflated.** One type serves *both* the BL prepared at step 3 *and* the signed POD at step 16/17. The official process treats these as **two distinct artefacts at two distinct steps**. This conflation must be split. |
| Vendor / third-party invoice | — | **MISSING** — finance is explicitly *"no supplier bills"* |
| Spending authorisation | — | **MISSING** (zero occurrences repo-wide) |
| Customs dossier | `customs_record` table | ✅ Modelled as a table, not a document (correct) |
| GAINDE declaration reference | `customs_record.external_ref` (text) | **PARTIAL** — a bare text field; no milestone, actor, date, or receipt |
| GAINDE submission evidence | — | **MISSING** |
| **Bon à Enlever (BAE)** | `customs_record.bae_reference` (text) | **PARTIAL** — reference only; **not an uploadable document** |
| **Bon à Délivrer (BAD)** | — | **MISSING** (zero occurrences) |
| **Pre-Gate authorisation** | — | **MISSING** (zero occurrences) |
| Signed BL / POD | `DELIVERY_NOTE` (APPROVED) + `DRIVER_SIGNATURE` | ✅ Works, but see the BL conflation above |
| Receipts | `PAYMENT_RECEIPT` | ✅ |
| Payment proofs | `PAYMENT_RECEIPT` (reused) | ✅ |
| Final invoice | `invoice` entity | ✅ Structured record, not a document (correct) |
| Proof of physical deposit | — | **MISSING** |

**10 new document types required** (`MISSING_DOCUMENT_TYPES` in [lib/process/documents.ts](lib/process/documents.ts)):
`QUOTATION`, `QUOTATION_APPROVAL`, `TRANSPORT_REQUEST`, `VENDOR_INVOICE`, `SPENDING_AUTHORIZATION`,
`GAINDE_SUBMISSION_EVIDENCE`, `BON_A_ENLEVER`, `BON_A_DELIVRER`, `PRE_GATE_AUTHORIZATION`, `PROOF_OF_DEPOSIT`.
That count folds in **1 promotion** (BAE becomes an uploadable document, not just a reference string). Plus
**1 split**, which is not a new type but a separation: the prepared `BORDEREAU_LIVRAISON` must stop sharing
`DELIVERY_NOTE` with the signed POD.

The existing catalog is well-designed for this: `document_type` already has `required_for text[]`,
`conditional`, `gates_customs`, `has_validity`. New types slot in as data rows, not schema changes.

---

## 6. Status-and-closure gap (Deliverable 10)

Today: `DRAFT | OPENED | IN_PROGRESS | DELIVERED | CLOSED | CANCELLED` — 6 coarse states on
`operational_file.status`.

Deliverable 10 asks for 11 distinguishable states. **Recommendation: do not widen
`operational_file.status`.** That column is load-bearing across RLS policies, filters, aggregates, the Control
Tower, the portal progress map, and the Copilot. Widening it is a high-blast-radius change that would create
exactly the "duplicate status truth" the brief forbids.

Instead, **derive** the 11 states from a process engine over existing records + three narrow additions:

| Required state | Derive from |
|---|---|
| Operationally delivered | `transport_record.status = DELIVERED` |
| POD received | `transport_record.status = POD_RECEIVED` (already gated on an APPROVED `DELIVERY_NOTE`) |
| Operational dossier complete | **NEW** — Coordinator (18) + AM (19) completeness checkpoints |
| Billing ready | **NEW** — output of step 19 |
| Invoice drafted | `invoice.status = DRAFT` |
| Invoice validated | **NEW** — `invoice.status = VALIDATED` (insert between `DRAFT` and `ISSUED`) |
| Invoice emailed | **NEW** — `invoice_delivery.emailed_at` |
| Invoice physically deposited | **NEW** — `invoice_delivery.deposited_at` + proof document |
| Under collection | derived: issued + past due + balance > 0 |
| Fully paid | `invoice.status = PAID` (already: Σ non-reversed payments ≥ total) |
| Closed | `operational_file.status = CLOSED` — **extend `canCloseFile()` to require full payment + POD** |

The one change to the existing status model that *is* required: **`canCloseFile()` must gain a payment gate.**

---

## 7. Recommended database changes (for 5.0B–5.0D — none in 5.0A)

Every new table must follow the repo's established pattern: `tenant_id` FK, RLS **SELECT-only** (writes go
through service-role server actions behind `assertPermission()`), a `tenant_id`-match trigger, and a pgTAP RLS
test in `supabase/tests/`.

| Phase | Change | Rationale |
|---|---|---|
| 5.0B | `process_handoff` table — `file_id, step_key, from_role, from_user, to_role, to_user, sent_at, received_at, rejected_at, reason` | Steps 4/7/etc. need reception confirmation + reject-with-reason. The current `task.handoff_type` cannot carry this. |
| 5.0B | `customs_record.declarant_id`, `prepared_by`, `prepared_at`, `validated_by`, `validated_at`, `rejected_reason` | Steps 5–7 maker-checker |
| 5.0B | `customs_milestone` table — `file_id, kind (GAINDE_REGISTERED \| GAINDE_DOCS_SUBMITTED \| BAE_OBTAINED), reference, occurred_at, actor_id, evidence_document_id` | Steps 9/11/13. Manual milestones with a clean future connector seam. Ordering (9 before 11) enforceable here. |
| 5.0B | `file_readiness` — derived, **no table** (compute the join gate in code) | Deliverable 3. Avoids duplicate truth. |
| 5.0C | 6 new roles + permissions (`customs:register`, `billing:*`, `collections:*`, `courier:*`, `admin_service:*`) | Deliverable 4 |
| 5.0D | 9 new `document_type` rows (data-only insert) | Deliverable 9 |
| 5.0D | `invoice.status` += `VALIDATED`; `invoice.validated_by`, `validated_at`, `rejected_reason` | Steps 20–21 maker-checker |
| 5.0D | `invoice_delivery` table — `invoice_id, emailed_at, prepared_at, courier_user_id, deposited_at, proof_document_id, recipient_name` | Steps 22–25 |
| 5.0D | `client.has_contract boolean` (+ optional `contract_ref`) | Step 1 bypass rule |
| 5.0D | `quotation` + `quotation_line` tables | Step 1 |
| 5.0D | Extend `canCloseFile()` — require full payment + POD | Step 26 / Deliverable 10 |

---

## 8. Phase 5.0A scope (what I propose to build next)

Registry and mapping only. **No schema, no UI, no behaviour change.**

| File | Purpose |
|---|---|
| `lib/process/types.ts` **(new)** | `ProcessStep`, `ProcessPhase`, `ParallelGroup`, `JoinGate`, `StepVerdict` types |
| `lib/process/effitrans-process.ts` **(new)** | The canonical 26-step registry (Deliverable 1) — step number, stable key, French label, phase, department, role, prerequisites, required documents, required evidence, completion rule, rejection target, next steps, parallel group, customer-visible label, internal label, SLA policy key, permissions |
| `lib/process/roles.ts` **(new)** | Official-role → existing-role map + the 6 gaps, as data |
| `lib/process/documents.ts` **(new)** | Official-document → existing-`document_type` map + the 9 gaps, as data |
| `lib/process/compatibility.ts` **(new)** | Pure function: existing dossier state → closest official step, with an explicit `unverified` marker for historical dossiers |
| `tests/process-registry.test.ts` **(new)** | Exactly 26 steps; step numbers 1–26 contiguous and unique; every step has a role that exists or is flagged as a gap; every required document maps to a real type or is flagged; parallel groups are well-formed; join gates reference only declared steps |
| `tests/process-compatibility.test.ts` **(new)** | Every existing `FileStatus` maps to a step; nothing is fabricated as complete |
| `docs/phase-5.0a-workflow-traceability.md` | **This document** |

Nothing under `lib/files/`, `lib/customs/`, `lib/transport/`, `lib/finance/`, `lib/handoffs/`, `supabase/`, or
`app/` is touched in 5.0A.

---

## 9. Open questions for Effitrans management

These block later sub-phases and cannot be answered from the code.

1. **SLA values.** Ratify the four existing hardcoded thresholds, or supply real ones, or accept that SLA
   signals go dark? (See §2.3 — this is a live contradiction in the brief.)
2. **Live dossier volume + statuses.** Needed for Deliverable 15. (See BLOCKER-2.)
3. **Contract vs non-contract clients.** How is this determined today — is there a list?
4. **Does the Coordinator's reception confirmation need to be explicit for every handoff**, or only for the
   customs chain (steps 4, 8, 10, 12)? This drives how heavy `process_handoff` needs to be.
5. **Tracking link (step 14).** Public/anonymous link, or authenticated portal only? This is a privacy decision,
   not an engineering one.
6. **Driver phone to customer (step 14).** The official process says to communicate the driver's telephone. Is
   the driver's personal number shared with the client, or a masked/company number?
7. **Can a Chief Transit validate a customs dossier they prepared themselves** (single-person offices), and if
   so, does that require an explicit override + reason?
