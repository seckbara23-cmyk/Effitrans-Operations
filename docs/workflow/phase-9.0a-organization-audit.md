# Phase 9.0A — Organization & Dossier Workflow Architecture Audit

Read-only findings first; the implemented foundation (last section) follows from them.
Business sources: [`docs/business-processes/`](../business-processes/) —
`Workflow_Complet_Effitrans_FR.pdf` (the consolidated end-to-end reference),
`Guide_Processus_Transit.pdf`, `Tableau_Coordination_Transit.pdf`.

---

## 1. Department representation inventory

The single most important finding: **the platform has never stored a department anywhere on a
user.** `app_user` has no department column; department was never a data field, only a set of
display/routing vocabularies. Every "department-looking" thing in the codebase is one of the
following, and each keeps its classification:

| # | Representation | Where | Vocabulary | Classification |
|---|---|---|---|---|
| 1 | `ProcessDepartment` | `lib/process/types.ts:35-50` | 15 codes (`cotation … collections`) | **Workflow queues** (engine routing). The file's own comment: "no `department` table exists in the schema; departments are a routing concept." |
| 2 | `LEGACY_DEPT` | `lib/process/effitrans-process.ts:1139-1155` | 15 → 6 coarse codes (`opening/documentation/customs/transport/finance/archive`) | **Reporting-label bridge** for older UI surfaces |
| 3 | `t.files.departments` | `lib/i18n.ts:49-56` | labels for the 6 coarse codes; UI word is « Service », not « Département » | **Reporting labels** (dossier "Service responsable") |
| 4 | `CONTACT_DEPARTMENTS` | `lib/portal/self-service.ts` | 5 codes (`documentation/customs/transport/finance/general`) | **Customer service-routing categories** (portal « Contacter Effitrans » + Messaging Center). Also a **DB contract**: CHECK constraints on `conversation.department_code` / `conversation_participant.department_code` (migration `20260722000001`) |
| 5 | Sidebar « Départements » section | `lib/nav.ts:84-107` | Documentation / Douane / **Transport & Logistique** / Finance (+ Direction under « Management ») | **Navigation category** over operational module pages. Part of the frozen 5-section contract (Phase 5.0E); labels pinned verbatim by `tests/journeys.test.ts:88` |
| 6 | `DeptCardKey` dashboard cards | `lib/departments/dashboard-map.ts:12` | `documentation/customs/transport/finance/management` («Activité par département») | **Dashboard reporting labels** |
| 7 | `/departments/*` pages | `app/departments/{documentation,customs,transport,finance,management}` | — | **Operational module pages** (Phase 2.0 filtered views; `/departments/transport` is the Phase 7.3C Logistics Command Center) |
| 8 | Role codes that *sound* departmental | `role` table / `lib/platform/role-templates.ts` | `CUSTOMS_*`, `TRANSPORT_OFFICER`, `DOCUMENTATION_OFFICER`… | **Roles** |
| 9 | `roleDepartmentCode` | `lib/messaging/access.ts` (Phase 8.6A) | role → contact category | **Display/routing alias** (messaging) |
| 10 | `invoice_deposit_event.from_department/to_department` | migration `20260714000002:82-83` | free text | **Legacy database values** (unconstrained; only written by the deposit chain, which is engine-gated and dark in production) |
| 11 | Queue registry | `lib/process/queues/registry.ts` | 15 `QueueDef`s | **Workflow queues** |

Where the audited concepts actually live:

| Concept | Current representation | Verdict |
|---|---|---|
| **Operations** | Role labels only (`COORDINATOR` « Coordinateur des opérations », `OPS_SUPERVISOR`), queue codes `operations`/`coordination`, nav « Centre d'opérations » | No department entity existed → now `OPERATIONS` in the canonical registry |
| **Transport & Logistique** | Nav label for `/departments/transport` | **Module label**, not a department. As a *user-facing department* description it must read « Transit » — resolved via legacy-label alias |
| **Transit** | `CHIEF_OF_TRANSIT` role, `transit` queue | Real department → `TRANSIT` (parent `OPERATIONS`) |
| **Douane** | Nav label, customs module, `CUSTOMS_*` roles, `customs` contact category | A **function of Transit** (déclarant, terrain) + a Finance task (enregistrement), never a department |
| **Documentation** | Nav label, module page, `DOCUMENTATION_OFFICER`, contact category | **Operations function** (confirmed business decision 4) |
| **Finance** | Nav label, module, 4+ roles, contact category, 4 queue codes | Real department → `FINANCE` |
| **Direction / Management** | Nav entry, dashboard card, `/departments/management`, `CEO` role | **Governance**, not a department (maps to `null`) |
| **Human Resources** | **Zero representation anywhere** in code, schema, seed or docs | New in registry: `HUMAN_RESOURCES`, `processesDossiers: false`, zero roles mapped |
| **Maritime / AIBD** | Only as transport-mode modules (`ocean_*` tables, air module, `shipment.transport_mode`) | **Teams under Transit** in the registry (`TRANSIT_TEAMS`); never departments |

## 2. Role architecture audit

23 role codes exist (seed + `lib/platform/role-templates.ts`, parity test-enforced). Department
association before 9.0A: **none stored** — only the Phase 8.6A messaging display alias.
Authorization is exclusively `role_permission`; department metadata affects **no** access
decision anywhere (verified: no RLS policy, no `assertPermission` path, no reader consults a
department value for authorization). That invariant is preserved: the new registry is
organizational metadata only, test-pinned to contain no permission strings.

Business-name → code resolution (gaps in **bold**):

| Business role (prompt) | Platform code | Canonical dept |
|---|---|---|
| Coordinateur Operations | `COORDINATOR` | OPERATIONS |
| Superviseur Operations | `OPS_SUPERVISOR` | OPERATIONS |
| Chef de Transit | `CHIEF_OF_TRANSIT` | TRANSIT |
| **Coordinateur Transit** | **no dedicated code** — covered by `CHIEF_OF_TRANSIT` today (the Tableau lists « Coordinateur Transit — 1 responsable ») | TRANSIT (open: dedicated role?) |
| Déclarant en douane | `CUSTOMS_DECLARANT` | TRANSIT |
| Agent terrain douane | `CUSTOMS_FIELD_AGENT` | TRANSIT |
| **Agent Maritime** | **no code** — team membership, not a role (see teams gap) | TRANSIT / team MARITIME |
| **Agent AIBD** | **no code** — same | TRANSIT / team AIBD |
| Coordinateur Transport | `TRANSPORT_OFFICER` (genericName DISPATCHER) | TRANSIT |
| Agent de documentation | `DOCUMENTATION_OFFICER` | OPERATIONS |
| Account Manager | `ACCOUNT_MANAGER` | OPERATIONS |
| Finance | `FINANCE_OFFICER` | FINANCE |
| Facturation | `BILLING_OFFICER` | FINANCE |
| Recouvrement | `COLLECTIONS_OFFICER` | FINANCE |
| **Human Resources roles** | **none exist** | HUMAN_RESOURCES (empty today) |
| System Administrator | `SYSTEM_ADMIN` | null (cross-cutting) |

Remaining codes: `QUOTATION_MANAGER` → TRANSIT (provisional — the Guide assigns cotation to the
Chef de Transit, étape 1), `CUSTOMS_FINANCE_OFFICER` → FINANCE (Guide étape 5 « Enregistrement —
Finance »), `WAREHOUSE_COORDINATOR` → OPERATIONS (provisional), `PICKUP_AGENT`/`DRIVER` → TRANSIT,
`ADMINISTRATIVE_OFFICER`/`COURIER` → FINANCE (provisional — invoice-deposit chain),
`CEO`/`COMPLIANCE_HSSE`/`CLIENT_USER`/`PARTNER_AGENT` → null (governance/external).

## 3. Dossier model audit (summary)

- `operational_file`: legacy lifecycle `status` (`DRAFT/OPENED/IN_PROGRESS/DELIVERED/CLOSED/CANCELLED`),
  **three competing ownership columns** (`account_manager_id` — auto-set to creator, never changed;
  `coordinator_id`; `assigned_to_user_id` added Phase 3.2A). The registry's own audit already flags
  this (`lib/process/effitrans-process.ts:96-99`). No assignment-history table (audit_log only).
- Tasks: legacy `public.task` (deliberately NOT used by the engine — `process_handoff` replaced
  `task.handoff_type` for controlled transmissions).
- **No blocker table, no milestone table, no decision table** — blockers are derived
  (`BLOCKED` step state + computed missing prerequisites/evidence), milestones are a pure grouping
  over step keys (`lib/process/journeys/milestones.ts`), approvals live inside
  `process_step_execution` (maker/checker/override columns).
- Closure: legacy `canCloseFile()` gates on **customs release only** (a dossier with a DRAFT
  invoice can be CLOSED — known defect, documented in the registry). The ENGINE closure
  (`lib/process/engine/closure.ts`) is the correct model: `process:close` permission, ~12
  requirements including full payment, "no payment webhook can ever close a dossier".
- Invoice ↔ dossier: `invoice.file_id`. Payments → invoice (not file). Balance always derived.
- Customer progress: **two disconnected systems** — portal `progress-map.ts` (10 stages over the
  LEGACY lifecycle; what production customers see today) and engine `clientStage`/`CLIENT_JOURNEY`
  (10 stages over the 26 steps; dark). Phase 9 must converge them (architecture doc §14).

## 4. Process-engine capability analysis (the ten questions)

| # | Question | Verdict | Evidence |
|---|---|---|---|
| 1 | Parallel tasks? | **YES** | `ParallelGroup` (`main/customs/transport_readiness`), independent branch evaluation (`engine/state.ts:208-228`), multi-active steps (`uq_pse_live_step` is per-step, not per-instance), convergence via `PICKUP_READINESS` join gate |
| 2 | One dossier owner + several task owners? | **PARTIAL** | Per-step `assigned_user_id/assigned_role_code` yes; **no instance-level owner column**; read-model `currentOwner` collapses to null when >1 step active. Gap #4 |
| 3 | Backward returns with reasons? | **YES** | `rejectStep()` freezes the attempt, inserts a correction row (`correction_of_id`), mandatory reason, audited; `rejectsTo`/`MAKER_CHECKER_PAIRS`; handoff rejection with `returned_to_step_key` |
| 4 | Conditional payment decisions? | **NO** | Only the maker-checker self-validation override exists (`override_used/override_reason`, permission granted to no role). No generic decision record; closure treats full payment as a hard requirement with no escape hatch. Gap #3 |
| 5 | Operational vs financial closure? | **YES — headline feature** | Steps 17-26; `completeCollections()` audits `PROCESS_OPERATIONALLY_COMPLETED` with `dossier_closed: false`; closure is a separate `process:close` act; « Livré ne vaut pas clôturé ». Intermediate instance statuses (`COMPLETED_OPERATIONALLY/UNDER_BILLING/UNDER_COLLECTION`) declared but unused — a ready seam |
| 6 | Many internal states → one customer status? | **YES (twice)** | Engine `clientStage` many-to-one (+ null = never shown); portal `toPortalTimeline()` collapses legacy lifecycle. The duplication itself is gap #8 |
| 7 | Mode-specific activities without duplicating the lifecycle? | **PARTIAL** | Gate requirements filter by file TYPE (`appliesToFileTypes`, e.g. customs exempted for TRP/HND at the pickup gate); customs doc requirements vary by MODE only in the legacy gate. **`SKIPPED` state exists but is never assigned** — `buildInitialExecutions()` materializes all 29 nodes for every type, so a TRP/HND dossier can never satisfy closure readiness. Gap #6 |
| 8 | Contracts to reuse | Step-registry shape · pure state core (`engine/state.ts`) · the one transition service (`engine/actions.ts`, 8-step guard pattern, CAS concurrency) · snapshot/read-model · queue registry+service · `process_handoff` (idempotent, explicit reception) · rollout (`env AND tenant_row`, engine never writes `operational_file`) · closure evaluator · `CLIENT_JOURNEY`/milestones · `PROCESS_*` audit vocabulary | |
| 9 | Additive gaps | (1) no blocker entity (2) no waiting-on-client state (3) no decision record — incl. « continuer avant paiement » (4) no instance-level owner/department-visibility (5) no team dimension (AIBD/Maritime) (6) per-type `SKIPPED` unimplemented (7) three-headed dossier ownership (8) two customer-progress systems (9) unused intermediate instance statuses (10) ~10 evidence document types uncataloged (each step's `implementation.gaps` enumerates them) | |
| 10 | What breaks on wholesale replacement | Step keys/numbers are a **wide contract**: maker-checker pairs, gates (hardcoded keys), 15 queues (derived from step `department`), journeys milestones (**throws at module load** on partition mismatch), compatibility mapper (numbers 1-26), closure inputs (completeness keys), my-work/workbench, SLA policies, and the process test suites (`PROCESS_STEP_COUNT = 26`). → **Additive extension only; never replace** | |

## 5. Production data assessment

No live DB access from this environment (Supabase MCP unauthorized — long-standing); conclusions
from schema, seed and rollout state:

- **No user row stores a department.** Nothing to migrate or rename. Department is now *derived*
  from roles — by construction there is no second source of truth.
- The process engine is **dark in production** (`EFFITRANS_PROCESS_*` env flags default false;
  `tenant_process_rollout` rows required per tenant). Dossier state in production =
  `operational_file.status` legacy lifecycle only.
- « Transport & Logistique » exists **only as a UI label** (nav + page title) — never stored.
- `invoice_deposit_event.from/to_department` free-text columns are only written by the
  deposit chain (engine-gated, dark) — no production values to reconcile.
- Messaging `conversation.department_code` values use the 5 contact codes — preserved as-is
  (they are a service-routing contract, not an org chart).
- **Conclusion: this phase performs zero data migration and zero renames. Nothing destructive
  is possible from a pure registry.**

## 6. Legacy compatibility matrix

| Occurrence | What it actually is | Action |
|---|---|---|
| Route `/departments/transport` + title « Transport & Logistique » | Logistics Command Center **module** (road/ocean/air/customs composition, Phase 7.3C) | **Keep** route + module label. It names a capability, not a department. Alias `« Transport & Logistique » → TRANSIT` exists for any *user-department* display context |
| Route `/transport`, `/shipping/*`, `/air/*` | Transport execution / shipping tracking / air cargo modules | **Keep** — operational modules |
| Permission `transport:manage`, `transport:*`, `customs:*`, `document:*` | Capability permissions | **Keep** — permissions never encode departments; renaming them for an org-chart reason is explicitly rejected |
| Nav section « Départements » (frozen 5-section contract, Phase 5.0E) | Navigation category of module pages | **Keep this phase** — relabeling the frozen contract is an open decision (§23 of the architecture doc), not a 9.0A change |
| Dashboard card titles (« Dédouanement », « Direction ») | Reporting labels over modules | **Keep** — module reporting, not org chart |
| Messaging/contact codes `documentation/customs/transport/finance/general` | Customer service-routing categories + DB CHECK contract | **Keep** vocabulary; canonical rollup via `CONTACT_DEPARTMENT_TO_CANONICAL` |
| Engine queue codes (15 `ProcessDepartment`) | Workflow queues | **Keep**; canonical rollup via `QUEUE_DEPARTMENT_TO_CANONICAL` |
| `LEGACY_DEPT` 6-code bridge + `t.files.departments` labels | Older reporting vocabulary | **Keep**; `resolveLegacyDepartmentLabel()` maps its labels to canonical for any future display migration |
| Staff-directory department display (was contact-category labels, e.g. « Douane ») | **User-facing department display — the one thing that genuinely misrepresented the org** | **Corrected**: now shows canonical labels (« Transit », « Opérations », « Finance ») via `departmentDisplayLabelFr` |

## 7. What Phase 9.0A implemented

- **`lib/organization/departments.ts`** — the canonical registry (pure, no I/O, never
  authorization): 4 departments with TRANSIT→OPERATIONS hierarchy and `processesDossiers`
  metadata; `TRANSIT_TEAMS` (AIBD, MARITIME); `ROLE_CANONICAL_DEPARTMENT` total over the 23
  role codes (parity-tested; governance/external roles map to null, never a guess);
  `CONTACT_DEPARTMENT_TO_CANONICAL`, `QUEUE_DEPARTMENT_TO_CANONICAL`,
  `resolveLegacyDepartmentLabel` aliases.
- **Staff directory** (`lib/messaging/staff-directory.ts`) now displays canonical department
  labels.
- **`tests/organization.test.ts`** — 30 tests covering the Phase 7 required list.
- **No migration, no schema change, no permission change, no route change, no nav change,
  no rename.** Everything else in this audit is documented for Phases 9.0B+ in
  [`phase-9-dossier-workflow-architecture.md`](phase-9-dossier-workflow-architecture.md).
