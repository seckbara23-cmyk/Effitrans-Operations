# Effitrans Logistics Operations Platform — Pre-Build Audit

**Auditor role:** Senior ERP/SaaS architect, logistics operations consultant, product auditor
**Source:** SaaS Discovery Questionnaire v1.0 (Q1–Q33), prepared by Bara Seck for Abdul Lahad / Effitrans, 2026-06-03
**Codebase reviewed:** Next.js 14 + React 18 + Tailwind mock UI (modules: dashboard, shipments, customs, customers, documents, finance, tasks, reports, users, settings). No backend or database yet.
**Date:** 2026-06-13

---

## A. Executive Audit Summary

**The single most important finding of this audit: the questionnaire describes a 4-year, multi-system enterprise program, but Effitrans's own answers describe a 6-month operational digitalization. Build to the answers, not to the questionnaire.**

Read Q31 and Q33 — the two questions Effitrans answered in their *own* short words rather than in elaborated prose:

- **Q31 (success in 6 months):** *"Not relying any more on manual tools to handle our operations. Start analyzing KPIs provided by the platform."*
- **Q33 (Phase 1 priorities):** *"Digitalizing our operations import, export, transport, handling etc."*

That is the real mandate. It is achievable.

By contrast, Q16, Q17, Q26, Q30 describe: a full ERP, a CRM, statutory financial statements (balance sheet, income statement, cash flow), a general ledger, management-control budgeting/forecasting, business intelligence, customs litigation management, a multi-level per-employee KPI accountability system, a customer self-service portal with financial archive and CSAT/NPS feedback loops, and a commercializable multi-tenant SaaS. Several of these answers still contain the AI assistant's sign-off text in French and English (Q17: *"Si tu veux, prochaine étape logique…"*; Q18, Q19, Q26: *"If you want, I can next…"*). **These answers are AI-elaborated aspiration, not validated requirements.** Treating them as a build spec is the fastest way to kill this project.

**The real business problem (one sentence):** Effitrans's operational state lives in people's heads, WhatsApp threads, email, Excel, and physical files — so there is no single source of truth, no real-time visibility, and no automated detection of the two things that actually cost them money: expiring regulatory documents and late customs declarations.

**The highest-value, most-buildable, most-differentiated win** is not "an ERP." It is:

1. The **operational file** as the single source of truth (one file number; every actor, document, status, cost, and message attached to it), driven by a
2. **role-gated workflow state machine** with mandatory checklists, feeding
3. a **document lifecycle engine** that tracks validity/expiry of APE, DPI, exoneration titles, and customs supporting docs and raises alerts *before* cargo arrives — plus
4. **real-time visibility** that replaces the WhatsApp/email/phone follow-up tax.

Everything else (accounting, statutory financials, customer portal, multi-tenant SaaS, per-employee scorecards) is secondary, deferrable, or — in the case of accounting — should **never be built** because Sage already exists.

**Recommended verdict (full detail in Section N):** Build a **single-tenant internal operations platform, architected multi-tenant-ready** (tenant scoping in the schema from day one, Postgres row-level security, no hardcoded "Effitrans" assumptions), but **do not build the SaaS commercialization machinery now**. Do not rebuild accounting — integrate Sage. Do not assume clean APIs to GAINDE/Orbus/Maya — they are manual reference-capture touchpoints, and assuming otherwise is the #1 technical risk to the program.

---

## B. Business Process Audit

### B.1 What Effitrans actually is

Senegal-based licensed customs broker + freight forwarder + transport operator, 65 employees (all 65 will use the system), operating from Senegal with a global agent network (WCA). Strategic clients are oil & gas and mining majors (Woodside, BP, Kosmos, Petrosen). This client profile matters: **these clients demand structured reporting, audit trails, and document compliance** — which validates the document-lifecycle and KPI themes far more than the generic CRM themes.

### B.2 The operating model (from Q6, Q7)

Effitrans runs a **centralized coordination model**. The spine of every operation:

```
Quotation Mgr (pricing only, if applicable)
   → Account Manager (FILE OWNER, end-to-end, until POD)
      → Coordinator (operational control tower, N+1 of declarants/field agents)
         → Chief of Transit (customs authority — validates HS codes, regimes, exemption titles)
            → Customs Declarant (DPI, note de détail, GAINDE entry, exoneration titles)
               → Chief of Transit (validation gate)
                  → Finance (declaration registration / cost allocation)
                     → Coordinator (release)
                        → Transit Agents (customs circuit, BAE, disbursements via Orbus)
                           → Transport (internal fleet OR external subcontractor)
                              → Delivery → POD collection & validation (Account Manager)
                                 → Billing (Finance issues, AM validates)
                                    → Archive (LOCKED, read-only — only after validated POD)
```

**Two hard governance rules stated explicitly and repeatedly:**
1. **No file is archived before POD is obtained and validated by the Account Manager.** (Q6 export model)
2. **The Account Manager owns the file from creation to POD** — extended responsibility through destination delivery.

These two rules are the most important workflow constraints in the entire document. They are non-negotiable and must be enforced by the state machine, not by convention.

### B.3 Current tool landscape (Q8)

| Tool | Use today | Implication for the platform |
|---|---|---|
| Excel | Shipment tracking, KPI building | **Replace** — this is the core target |
| Email / WhatsApp / phone | Coordination, status, approvals | **Replace** with in-file activity + notifications |
| GAINDE (Gaïndé 2000) | Customs declarations | **Integrate by reference, NOT by API** (see L) |
| Orbus Infinity | Duty/disbursement payments | **Integrate by reference, NOT by API** |
| Maya | Invoicing — "offline, obsolete, non-connected" | Replace *eventually*; **out of MVP** |
| Sage | Accounting | **Keep. Integrate. Do not rebuild.** |

### B.4 The print–scan–re-upload cycle (Q12, Q13, Q15)

The single most-cited time sink: documents arrive digitally → are **printed** → reviewed physically → **scanned again** → re-uploaded into GAINDE → archived both physically and digitally. This is pure waste and is the clearest, easiest efficiency win in the whole document. **Native digital document capture + structured attachment to the file eliminates an entire category of manual labor on day one.** This should be a headline MVP feature, not a footnote.

---

## C. Functional Gap Analysis

What's missing or underspecified in the questionnaire that *will* block development if not resolved before coding:

| # | Gap | Why it matters | Action before build |
|---|---|---|---|
| C1 | **No GAINDE/Orbus/Maya/Sage integration feasibility confirmed** | Whole "customs-integrated ERP" vision assumes APIs that likely don't exist for third parties | Confirm in writing what each system exposes. Assume manual until proven. |
| C2 | **No data volumes** | Files/month, documents/file, concurrent users, storage growth | Get rough numbers (files/month, avg docs/file) — sizes storage & DB |
| C3 | **Document taxonomy not defined** | "APE, DPI, exoneration titles, sommiers" each have different validity rules | Build the document-type catalog WITH the Chief of Transit |
| C4 | **Expiry rules undefined** | The flagship feature needs: which docs expire, validity periods, alert lead times | Workshop with transit team to define per-doc-type rules |
| C5 | **No file-numbering scheme** | "EXP-XXXX" mentioned but no import scheme, no year/branch logic | Define numbering (e.g. `IMP-2026-00042`) before schema |
| C6 | **State machine states not enumerated** | Q22 lists ~8 customer-visible stages; internal stages are richer | Enumerate every state + allowed transitions + role gate |
| C7 | **POD validation criteria undefined** | "Validate POD authenticity" — by what rule? | Define: what makes a POD valid/acceptable |
| C8 | **Notification triggers undefined** | "Automated notifications at each milestone" — which milestones, to whom | Define notification matrix (event × audience × channel) |
| C9 | **WhatsApp notification = paid API** | Q25 wants WhatsApp; that's WhatsApp Business API (Meta), needs templates + approval | Budget for WhatsApp BSP, or start email+SMS, add WhatsApp later |
| C10 | **No SLA definitions** | "SLA compliance" KPI requires defined SLAs per stage/client | Define SLA targets per stage before KPI work |
| C11 | **Data migration scope absent** | 65 people have years of files in Excel/folders | Decide: migrate history or start clean + archive legacy read-only |
| C12 | **Permissions stated as principle, not matrix** | Q18/Q19 give philosophy; developers need a table | RBAC matrix (Section J) must be confirmed |
| C13 | **Offline/connectivity assumptions** | Field agents at port — connectivity? | Confirm whether mobile/field use needs offline tolerance |
| C14 | **Language requirement** | Questionnaire is bilingual FR/EN; UI already has i18n | Confirm FR is primary operating language (it is) |

**Gaps C1, C3, C4, C6 are blocking.** Do not start the backend until they are resolved — they define the schema and the engine.

---

## D. Module-by-Module Requirement Map

Priority key: **[MVP]** = Phase 1 core · **[P2]** = Phase 2 · **[P3]** = Phase 3 · **[NEVER]** = do not build, integrate instead

| Module | Source Qs | Priority | Notes |
|---|---|---|---|
| **Operational File (core spine)** | Q6, Q9, Q10 | **[MVP]** | The central entity. Import + Export + Transport file types. Everything attaches here. |
| **Workflow / State Machine + Checklists** | Q6, Q14, Q15 | **[MVP]** | Role-gated transitions, mandatory checklists, "can't advance until requirements met." |
| **Document Management + native capture** | Q10, Q12, Q15 | **[MVP]** | Kills the print–scan cycle. Versioning, classification, attach-to-file. |
| **Document Lifecycle / Expiry Engine** | Q11, Q14 | **[MVP]** | **The flagship differentiator.** Validity tracking + pre-arrival alerts. |
| **Customs tracking (GAINDE reference)** | Q6, Q9, Q16 | **[MVP]** | Capture GAINDE refs, DPI, BAE, exoneration titles + status. NOT auto-submission. |
| **Transport / Dispatch (internal + external)** | Q6 (road module) | **[MVP]** | Fleet vs subcontractor assignment, transport order, POD capture. |
| **Notifications (email/SMS)** | Q24, Q25 | **[MVP]** | Milestone + expiry alerts. WhatsApp = P2 (paid API). |
| **Real-time Operational Dashboard** | Q20, Q28 | **[MVP]** | Live file board, bottlenecks, my-queue. |
| **RBAC + Audit Trail** | Q17, Q18, Q19 | **[MVP]** | Role-based visibility, full action log, override logging. |
| **Activity / in-file communication** | Q11, Q13 | **[MVP]** | Replace WhatsApp coordination per-file. |
| **Quotation management** | Q6 (step 1) | **[P2]** | File can start from a quote; quoting itself can wait. |
| **Customer Portal** | Q21–Q24 | **[P2]** | High value but externally exposed; needs clean internal data first. |
| **Billing / Invoicing (replace Maya)** | Q6, Q15 | **[P2]** | Generate invoice from file once data is trustworthy. |
| **Per-employee / per-dept KPIs** | Q26, Q29 | **[P2/P3]** | Culturally sensitive — sequence carefully (see K, L). |
| **Customs Non-Conformity & Disputes** | Q17 (10.x) | **[P3]** | Litigation/penalty tracking. Real but not urgent. |
| **CSAT / NPS / Client feedback loop** | Q17, Q22 | **[P3]** | Nice-to-have; depends on portal. |
| **Management Control (budget/forecast/BI)** | Q16 (10) | **[P3]** | Heavy. Depends on trustworthy financial data. |
| **CRM (opportunities, tenders)** | Q16 (1) | **[P3]** | Not the core pain. |
| **Accounting / General Ledger / Statutory FS** | Q16 (9) | **[NEVER]** | **Sage exists. Integrate. Rebuilding statutory accounting is out of scope for years.** |
| **HSSE / ISO/MASE compliance module** | Q16 (8) | **[P3]** | Audit trail (MVP) covers most early needs. |
| **Multi-tenant SaaS control plane** | Q32 | **[P3 / deferred]** | Architect-ready now; build the machinery only if commercialization is funded. |

---

## E. Workflow Audit (state machines)

The platform is fundamentally a **workflow engine**. Below are the core flows as state machines. Each transition is gated by a role and (where noted) by a checklist that blocks progression.

### E.1 Import file lifecycle

```
DRAFT ──(AM opens file)──────────────► OPENED
OPENED ──(Coordinator dispatches)─────► COORDINATION
COORDINATION ──(Chief assigns declarant)► TRANSIT_PREP
TRANSIT_PREP ──(Declarant prepares DPI/note de détail/GAINDE)► DECLARATION_DRAFT
DECLARATION_DRAFT ──(Chief of Transit validates) ⛔gate► DECLARATION_VALIDATED
DECLARATION_VALIDATED ──(Finance registers)──► FINANCE_REGISTERED
FINANCE_REGISTERED ──(Coordinator releases)──► CLEARANCE_IN_PROGRESS
CLEARANCE_IN_PROGRESS ──(Transit agent obtains BAE) ⛔gate► CLEARED
CLEARED ──(handling/pickup)──────────► IN_TRANSPORT
IN_TRANSPORT ──(delivery executed)───► DELIVERED
DELIVERED ──(POD collected + AM validates) ⛔HARD gate► POD_VALIDATED
POD_VALIDATED ──(Finance issues, AM validates invoice)► BILLED
BILLED ──(file locked)───────────────► ARCHIVED (read-only)
```

### E.2 Export file lifecycle (per Q6 consolidated model)

```
QUOTATION (if applicable) → APPROVED
  → AM_FILE_CREATED (Incoterms, mode, priority defined)
  → BOOKING (sea: vessel/SI/ETD · air: space/AWB) + TRANSPORT_STRATEGY (internal fleet vs external)
  → COORDINATOR_READINESS (booking confirmed, transport assigned, docs initiated)
  → CHIEF_TRANSIT (HS codes, export regime, feasibility)
  → DECLARANT (note de détail, GAINDE export declaration, missing-doc requests)
  → CHIEF_TRANSIT_VALIDATION ⛔gate
  → FINANCE_REGISTRATION (cost allocation, billing linkage)
  → COORDINATOR_RELEASE → TRANSIT_AGENTS (customs circuit, BAE/equivalent)
  → MULTIMODAL_EXECUTION (road → port/airport handling → carrier loading)
  → DEPARTED
  → DESTINATION_DELIVERY (AM extended responsibility)
  → POD_VALIDATED ⛔HARD gate (signed consignee receipt, uploaded, AM-validated)
  → BILLED (AM validates invoice before release)
  → ARCHIVED (only after validated POD; full dossier locked)
```

### E.3 Critical control points (must be enforced in code, not by trust)

| Gate | Rule | Enforcement |
|---|---|---|
| **Chief of Transit validation** | Declaration cannot reach Finance without Chief approval | Block transition; log approver + timestamp |
| **POD hard gate** | No BILLED, no ARCHIVED without AM-validated POD | Block transition; POD doc + AM signature required |
| **Checklist gates** | Cannot advance a stage with incomplete mandatory checklist | Per-stage required-item list; block on incomplete |
| **Document expiry block** | Cannot proceed to clearance if a required doc is expired | Engine flags; transition blocked or warned per rule |
| **Archive lock** | ARCHIVED files become read-only | DB-level + UI immutability; overrides logged |

### E.4 Transport sub-flow (internal vs external)

```
TRANSPORT_NEEDED → decide:
  OPTION A (Internal fleet): assign truck + driver → tracking → POD
  OPTION B (External): select subcontractor → issue transport order → SLA monitor → POD
Both converge → DELIVERED → POD_VALIDATED
```

### E.5 Billing & closure flow

```
POD_VALIDATED → Finance compiles charges (freight, customs, handling, transport, debours)
  → AM validates invoice ⛔gate (AM must approve before release)
  → Invoice issued to client
  → (P2: pushed to portal) → Collections follow-up → Settled
  → File ARCHIVED (read-only, full dossier retained, client portal access kept)
```

### E.6 Document lifecycle flow (the differentiator)

```
Document attached → classified (type) → validity rule applied
  → if expiring: ALERT(lead-time) to AM + declarant + (P2: client)
  → if expired before use: BLOCK dependent transition + escalate
  → on renewal: new version supersedes, old retained in audit trail
```

This flow is what directly answers the most painful and most-repeated complaint in the questionnaire (Q11.3, Q14.10): expiry discovered too late, after cargo has already arrived.

---

## F. Recommended MVP Scope (Phase 1)

**MVP thesis: digitize the operational file end-to-end for import, export, and transport, with the document-expiry engine and real-time visibility. Nothing else.** This directly satisfies Q31 and Q33.

### In scope (MVP)
1. **Auth, users, RBAC, audit trail** — the 13 roles, role-based visibility, full action log.
2. **Operational File** — Import / Export / Transport types; unique file numbering; the data tracked in Q9 attached to the file.
3. **Workflow state machine** — the E.1/E.2/E.4 flows with role-gated transitions and the hard POD gate.
4. **Per-stage checklists** — block progression until mandatory items complete (Q14.11 explicit request).
5. **Document management** — native digital upload, classification, versioning, attach-to-file, search. Kills print–scan.
6. **Document lifecycle / expiry engine** — validity tracking + configurable pre-arrival alerts.
7. **Customs tracking** — capture DPI / note de détail / GAINDE reference / BAE / exoneration titles + statuses (manual entry, reference-linked).
8. **Transport / dispatch** — internal fleet vs external subcontractor; transport orders; POD capture & validation.
9. **Notifications** — email + SMS on milestones and expiry alerts.
10. **In-file activity feed** — comments/coordination per file (replaces WhatsApp for operational coordination).
11. **Operational dashboards** — live file board, my-queue, bottlenecks, expiry watchlist. KPIs that come *for free* from workflow data (cycle time, files by stage, on-time %).

### Explicitly OUT of MVP (and why)
- **Accounting / GL / statutory financials** — Sage exists; never rebuild.
- **Billing/invoicing** — P2; needs trustworthy file data first; Maya keeps running meanwhile.
- **Customer portal** — P2; external exposure demands clean internal data + hardening first.
- **Quotation/CRM** — P2/P3; not the core pain.
- **Per-employee KPI scorecards** — P2; adoption-risk if introduced before the tool has earned trust (see L-R9).
- **Customs disputes/litigation, CSAT/NPS, management control/BI** — P3.
- **Multi-tenant control plane** — deferred; schema is tenant-ready but no SaaS machinery.
- **Live GAINDE/Orbus/Maya/Sage API integration** — reference-capture only at MVP.

### MVP success test (maps to Q31)
> A new import file is opened digitally, no document is printed, the team advances it through customs and delivery entirely in the system, the POD gate is enforced, an expiring exoneration title fires an alert 10 days before arrival, and management sees live cycle-time and bottleneck KPIs without anyone touching Excel.

---

## G. Phase 1 / Phase 2 / Phase 3 Roadmap

### Phase 1 — Operational Digitalization (MVP) — *target: the 6-month goal*
Operational File · Workflow engine + checklists · Document mgmt (native capture) · **Expiry engine** · Customs reference tracking · Transport/dispatch + POD · RBAC + audit · Notifications (email/SMS) · In-file activity · Operational dashboards.
**Outcome:** Excel/WhatsApp/print eliminated for core ops. KPIs start flowing.

### Phase 2 — Transparency & Cash (after MVP is adopted and stable)
Customer Portal (own files, status, document archive, notifications, doc upload) · Billing/invoicing (replace Maya) + AM-validated invoice gate · WhatsApp notifications (Business API) · Quotation management → file conversion · Per-employee/department KPI dashboards (introduced *after* trust is established) · Sage integration (export billed files to accounting).
**Outcome:** Clients self-serve; order-to-cash accelerates; performance measurement begins.

### Phase 3 — Intelligence, Compliance & Commercialization
Customs non-conformity & disputes/litigation tracking · CSAT/NPS feedback loop · Management control (budget/forecast, profitability per file/client, variance) · BI layer · HSSE/ISO/MASE module · **Multi-tenant SaaS** commercialization (onboarding, tenant admin, subscription billing) *if and only if* commercialization is funded and validated.
**Outcome:** Data-driven management; optional path to product company.

**Sequencing principle:** each phase must be *adopted* before the next starts. The biggest risk to this program is not technical — it is shipping Phase 1 and 2 and 3 features simultaneously, half-finished, and losing the 65 users' trust.

---

## H. Technical Architecture Recommendation

**Continue with the existing stack and add a real backend. Do not over-engineer.**

### Recommended stack
- **Frontend:** Next.js 14 App Router + React 18 + Tailwind (already in place — keep it). Bilingual FR/EN via existing i18n.
- **Backend:** Next.js server (Route Handlers / Server Actions) **or** a separate NestJS API. For a 65-user internal tool with a small dev team, **a single Next.js full-stack app is the right call** — one deploy, one language, fastest path. Split out an API later only if commercialization (Phase 3) demands it.
- **Database:** **PostgreSQL** — non-negotiable. Reasons: relational integrity for files/documents/customs/finance; **row-level security (RLS)** gives you multi-tenant readiness *and* the role-based visibility model essentially for free; mature, cheap, portable.
- **ORM:** Prisma (typed, fast to build with) — acceptable; or Drizzle if the team prefers SQL-first.
- **Object storage:** S3-compatible (AWS S3, or a local/regional provider for data-residency — see below) for documents. **Never store documents as DB blobs.**
- **Background jobs:** a queue/scheduler (e.g. a worker process + cron, or a managed queue) for the **expiry scan** and notification dispatch. This is essential infrastructure, not optional — the flagship feature depends on it.
- **Auth:** session-based with a vetted library; enforce RBAC server-side on every query, not just in the UI.
- **Notifications:** email (transactional provider) + SMS (regional gateway) at MVP; WhatsApp Business API via a BSP at P2.

### Multi-tenancy decision (answers Q32 architecturally)
**Single-tenant deployment, multi-tenant-ready schema.** Every tenant-scoped table carries a `tenant_id` (= `org_id`) from day one. Enforce isolation with Postgres RLS. Do **not** build tenant onboarding, tenant admin, or subscription billing now. This buys commercialization optionality for a few percent of extra schema discipline, with none of the cost or complexity of a real SaaS control plane. If commercialization never happens, you've lost almost nothing. If it does, you're not rewriting.

### Data residency / sovereignty (important for Senegal + oil & gas clients)
Customs and client financial documents may carry residency/confidentiality expectations. Confirm hosting requirements early. Architect so storage region is a config choice, not a code assumption.

### What NOT to do
- ❌ Microservices. A 65-user internal tool does not need them. Monolith.
- ❌ Event-sourcing/CQRS for the whole system. Overkill; a plain audit-log table covers traceability.
- ❌ Building your own auth. Use a library.
- ❌ Assuming GAINDE/Orbus/Maya APIs exist (see L-R1).
- ❌ NoSQL for the core. This is relational, compliance-sensitive data.

---

## I. Database Entities & Relationships

Core schema sketch (tenant-scoped; `tenant_id` on every business table, omitted below for brevity except where structural). This is a starting model, not final — finalize after gaps C3–C6 are resolved.

### Core entities

```
Organization (tenant)         -- tenant_id root; "Effitrans" is row 1
User                          -- belongs to Organization; has Role(s)
Role                          -- system + functional roles (see J)
Permission                    -- role × module × action × data-scope
Client                        -- Effitrans's customers; segment (oil&gas/mining/...)
Partner                       -- carriers, agents (WCA), subcontractors, shipping lines
Contact                       -- people at Client/Partner

OperationalFile               -- THE SPINE
  id, file_number (IMP-2026-00042), type {IMPORT|EXPORT|TRANSPORT}
  client_id, account_manager_id (owner), coordinator_id
  incoterm, transport_mode {SEA|AIR|ROAD|MULTIMODAL}
  origin, destination, cargo_type, priority
  current_state, opened_at, archived_at, archive_locked (bool)
  -- dates: pickup/ETD/ATD/ETA/ATA/delivery (planned vs actual)

FileStateTransition           -- audit of every state change
  file_id, from_state, to_state, by_user, at, note, gate_passed

ChecklistItem                 -- per file, per stage
  file_id, stage, label, required (bool), done (bool), done_by, done_at
  document_id (optional link)

Document
  id, file_id, type_id, file_number_ref
  storage_key (S3), filename, version, supersedes_id
  uploaded_by, uploaded_at, source {CLIENT|INTERNAL|PARTNER}

DocumentType                  -- catalog: invoice, packing list, BL/AWB, DPI,
  id, name, category                -- note de détail, BAE, exoneration title,
  has_validity (bool), default_validity_days, alert_lead_days   -- APE, sommier...

DocumentValidity              -- per document instance with an expiry
  document_id, issued_at, expires_at, status {VALID|EXPIRING|EXPIRED|RENEWED}

CustomsRecord                 -- per file
  file_id, dpi_ref, declaration_ref (GAINDE), regime, hs_codes[]
  bae_ref, bae_obtained_at, exoneration_title_refs[]
  declarant_id, validated_by_chief_id, validated_at, status

CustomsNonConformity          -- (P3) errors/disputes
  file_id, type, severity {MINOR|MAJOR|CRITICAL}, responsible_user_id
  financial_exposure, resolution_status, root_cause

TransportLeg
  file_id, mode, internal (bool)
  truck_id / driver_id (internal) OR subcontractor_partner_id (external)
  transport_order_ref, pickup_at, delivered_at, sla_target, sla_met

ProofOfDelivery
  file_id, document_id, consignee_signed_at
  validated_by_am (bool), validated_at, authenticity_note

Invoice                       -- (P2)
  file_id, client_id, line_items[], debours[], total
  am_validated (bool), issued_at, status {DRAFT|ISSUED|PAID|OVERDUE}

ActivityEntry                 -- in-file comms + system events (replaces WhatsApp)
  file_id, user_id, type {COMMENT|EVENT|MENTION}, body, at

Notification
  recipient (user/client/partner), channel {EMAIL|SMS|WHATSAPP}
  event, file_id, sent_at, status

AuditLog                      -- every privileged/state-changing action
  actor_id, action, entity, entity_id, before, after, at, override_reason

Fleet: Truck, Driver          -- internal transport resources
Feedback (P3): CSAT/NPS per file
KPISnapshot (P2/P3): materialized metrics per period/role/client
```

### Key relationships & integrity rules
- `OperationalFile` 1—* `Document`, `ChecklistItem`, `FileStateTransition`, `TransportLeg`, `ActivityEntry`; 1—1 `CustomsRecord`, `ProofOfDelivery`.
- `Document` *—1 `DocumentType`; `Document` 1—0..1 `DocumentValidity`.
- **Constraint:** `OperationalFile.state = BILLED|ARCHIVED` requires a `ProofOfDelivery` with `validated_by_am = true`. Enforce in a transition guard.
- **Constraint:** `archive_locked = true` → all child writes rejected except via logged override.
- **RLS:** every query filtered by `tenant_id`; visibility further scoped by role (see J).

---

## J. RBAC Permission Matrix

Roles distilled from Q17 (13 roles) + governance from Q18/Q19. Actions: **C**reate, **R**ead, **U**pdate, **D**elete/archive, **V**alidate (gate), **A**dmin. Data scope: **Own** (assigned files) · **Team/Zone** · **Client** (assigned clients) · **All** · **Fin** (financial fields) · **—** (none).

| Role | Files | Customs | Documents | Transport | Billing/Finance | KPIs/Dash | Users/Config | Visibility scope |
|---|---|---|---|---|---|---|---|---|
| **System Admin (IT)** | R | R | R | R | R | R | **CRUDA** | All (config), no business approval |
| **CEO / Owner** | R | R | R | R | R(Fin) | R(All) | — (override only, logged) | **All** |
| **Quotation Manager** | C,R(own quotes) | — | R | — | R(price) | R(own) | — | Own quotes |
| **Account Manager** | **CRU + V(POD/invoice)** | R | CRU | R/U | R(Fin own) | R(own/client) | — | **Own files + assigned clients** |
| **Coordinator** | RU (dispatch) | R | RU | RU | R | R(team) | — | **Team/zone files** |
| **Chief of Transit** | R | **RU + V(declaration)** | RU | — | R | R(transit) | partial (workflow templates) | Transit-scope files |
| **Customs Declarant** | R(assigned) | **CRU** | CRU | — | — | R(own) | — | **Assigned files only** |
| **Documentation Officer** | R(assigned) | R | **CRU** | — | — | R(own) | — | Assigned/queue |
| **Transport/Dispatch Officer** | R(assigned) | — | RU(POD) | **CRU** | — | R(own) | — | Assigned transport |
| **Warehouse/Site Coord.** | R(assigned) | — | RU | RU | — | R(own) | — | Assigned/site |
| **Finance Officer** | R | R | R | R | **CRU** | R(Fin) | partial (periods) | **All files w/ financial relevance** |
| **Finance Controller** | R | R | R | R | **CRU + V** | R(Fin All) | Fin-domain admin | All financial |
| **Management Controller** | R | R | R | R | R(Fin) | **R(All) + budgets** | — | All (read) |
| **Ops Supervisor/Manager** | R + V(milestones) | R | R | R | R | R(team) | Workflow admin (scoped) | Team/dept |
| **Compliance/HSSE** | R | R | R | R | R | R(compliance) | Audit config | **All (audit/incident scope)** |
| **Client User (portal)** | R(own only) | R(own clearance status) | R(own dossier) | R(own POD) | R(own invoices/receipts) | R(own CSAT/status) | — | **Own files only — never internal costs/margins** |
| **Partner/Agent/Carrier** | R(assigned) | — | CRU(POD/docs) | RU(assigned) | — | — | — | **Assigned executions only** |

**Governance rules baked in (Q19):**
- Exactly **one** full System Admin (IT) for daily admin; **no shared admin accounts**.
- CEO has full *visibility* but is **not** the day-to-day admin; emergency override only, **always logged**.
- Functional admins (Finance, Compliance, Ops) get **scoped** admin within their domain only.
- **Override / expanded access (Q18.8)** is always time-bound, logged, and traceable.
- Clients **never** see internal costs, margins, employee KPIs, other clients' data, or audit logs (Q22.4).

---

## K. Dashboard / KPI Structure

KPIs split into two honest tiers. **Tier 1 is free** — it falls out of workflow/timestamp data the moment the file lives in the system. **Tier 2 needs financial integration or extra inputs** and belongs in P2/P3. Don't promise Tier 2 in MVP.

### Tier 1 — available in MVP (from workflow data alone)
| Dashboard | KPIs / widgets |
|---|---|
| **Operational (Coordinator/Supervisor)** | Active files by state · my-queue · bottlenecks (files stuck > threshold) · avg cycle time (open→archive) · customs clearance lead time · on-time delivery % · SLA breaches · rework/reopened-file count |
| **Expiry Watchlist (Transit/AM)** | Documents expiring in 7/14/30 days · expired-but-needed · renewals pending · files blocked by expiry |
| **Executive (CEO/Directors)** | Active files total · throughput trend · on-time % · avg cycle time · bottleneck heatmap · expiry-risk exposure (count) |
| **My Work (every operational role)** | Assigned files · pending checklist items · pending validations · overdue actions |

### Tier 2 — P2/P3 (need finance integration / feedback / extra config)
| Dashboard | KPIs |
|---|---|
| **Financial (Finance)** | Revenue/file/client · gross margin/file · DSO · invoices issued/paid/overdue · AR aging · debours outstanding · margin leakage |
| **Customs & Compliance (P3)** | Non-conformities by severity · dispute/penalty totals · resolution time · recurrence rate · audit-finding closure |
| **Customer Experience (P3)** | CSAT/NPS per file · complaint rate · response time · retention |
| **Workforce KPIs (P2, sensitive)** | Files/employee · task time/role · error rate/role · escalation rate — *introduce only after trust established (see L-R9)* |
| **Management Control (P3)** | Budget vs actual · profitability per segment · revenue concentration · variance |

### Design rules (from Q20, Q28)
Role-based (no full raw-data exposure) · near-real-time · drill-down per file/client where authorized · **action-oriented alerts**, not static tables · aggregated KPIs, not editable records.

---

## L. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **R1** | **GAINDE/Orbus/Maya/Sage have no usable third-party API** — "customs-integrated ERP" vision collapses | **High** | **High** | Treat as manual reference-capture + status tracking at MVP. Confirm each system's actual interface in writing before promising integration. Design so refs link out, data is entered once. |
| **R2** | **Scope explosion** — building to the full questionnaire (ERP+CRM+accounting+portal+BI+SaaS) | **High** | **Critical** | This audit. Lock MVP to Section F. Defer everything else. Re-confirm each phase before starting it. |
| **R3** | **Rebuilding accounting** — wasting months on GL/statutory FS that Sage already does | Medium | High | **Never build accounting.** Integrate Sage. Make it a written non-goal. |
| **R4** | **Adoption failure** — 65 people revert to WhatsApp/Excel if the tool is slower or feels like surveillance | **High** | **Critical** | Make MVP *save work* first (kill print–scan, replace follow-up calls). Train. Recruit champions per dept. Defer employee KPIs. |
| **R5** | **Expiry engine wrong rules** — false alerts or missed expiries destroy trust in the flagship feature | Medium | High | Define per-doc-type validity rules WITH the Chief of Transit (gap C4). Start conservative; tune. |
| **R6** | **Document storage volume/cost** unplanned (years of scans × 65 users) | Medium | Medium | S3-compatible storage, lifecycle policies, get volume estimates (C2). |
| **R7** | **POD gate bypassed in practice** — users archive without real POD | Medium | High | Hard DB-level guard, not UI-only. Overrides logged + require supervisor. |
| **R8** | **WhatsApp notifications assumed free/simple** | Medium | Medium | WhatsApp Business API needs BSP + approved templates + cost. Start email/SMS; add WhatsApp P2. |
| **R9** | **Per-employee KPI surveillance backlash** — the "accountability system" (Q17, Q30.8) breeds resistance/gaming | **High** | High | Sequence to P2, *after* the tool has earned trust. Frame as team improvement, not individual policing. Involve staff in metric design. |
| **R10** | **Customer portal exposed on immature data** — clients see wrong/incomplete info, trust damaged | Medium | High | Portal is P2, only after internal data is clean and complete. Strict own-data-only isolation. |
| **R11** | **Premature multi-tenant build** — complexity with no paying customer | Medium | Medium | Schema tenant-ready (cheap); defer the SaaS control plane until commercialization is funded (R/N). |
| **R12** | **Data migration underestimated** — years of legacy files | Medium | Medium | Decide early: clean start + legacy read-only archive vs full migration (C11). Recommend clean start. |
| **R13** | **Connectivity at field/port** for transit agents | Low/Med | Medium | Confirm (C13). Tolerate flaky networks; consider mobile-friendly + retry. |
| **R14** | **Single IT admin = bus factor / key-person risk** | Medium | Medium | Documented runbooks, break-glass procedure, backups, second trained admin. |
| **R15** | **Data residency/compliance** for oil&gas client docs | Medium | High | Confirm hosting/residency requirements; make storage region configurable (H). |
| **R16** | **Bilingual debt** — FR is the operating language; EN-only UI fails adoption | Medium | Medium | FR-first i18n (already scaffolded). Native-speaker review of FR labels. |

---

## M. Development Sequence for Claude Opus 4.8

The repo is a **mock UI with no backend**. The sequence below turns it into a working MVP. Each step is a self-contained unit Claude Opus 4.8 can execute, verify, and (per your standing preference) commit+push. **Resolve blocking gaps C3, C4, C6 with the Effitrans transit team before Step 3.**

**Phase 0 — Foundations**
1. **Decide & document architecture** in `docs/architecture.md` (stack, multi-tenant-ready, integration-by-reference stance). Lock the non-goals (no accounting, no live customs API at MVP).
2. **Stand up Postgres + ORM + migrations** scaffold. Add `tenant_id` discipline + RLS baseline. Seed Organization = Effitrans.
3. **Auth + RBAC core** — users, the 13 roles, permission checks enforced server-side. Audit-log table + middleware. (Reuse existing `app/users`, `app/settings` shells.)

**Phase 1 — The spine**
4. **OperationalFile entity + numbering** — model, migrations, CRUD wired to the existing `app/shipments` UI. Import/Export/Transport types.
5. **State machine engine** — states + role-gated transitions (E.1/E.2), `FileStateTransition` audit. Generic, config-driven so states can be tuned.
6. **Checklist engine** — per-stage required items that block transitions (Q14.11).
7. **POD hard gate** — `ProofOfDelivery` + the constraint that blocks BILLED/ARCHIVED without AM-validated POD. Archive-lock immutability.

**Phase 1 — Documents & the differentiator**
8. **Document management** — S3-compatible upload, `DocumentType` catalog, classification, versioning, attach-to-file, search. Wire to existing `app/documents`. (Kills print–scan.)
9. **Document lifecycle / expiry engine** — `DocumentValidity`, background scan job, alert thresholds. This is the flagship — give it real attention.
10. **Customs reference tracking** — `CustomsRecord` (DPI/GAINDE ref/BAE/exoneration titles) wired to `app/customs`. Manual entry, reference-linked.
11. **Transport/dispatch** — internal fleet vs external subcontractor, transport orders, POD capture. Wire to a transport view.

**Phase 1 — Visibility & comms**
12. **Notifications** — email + SMS providers; milestone + expiry triggers; notification matrix (C8).
13. **In-file activity feed** — comments/events per file (replace WhatsApp coordination).
14. **Operational + expiry + executive dashboards (Tier 1 KPIs only)** — wire to `app/dashboard`, `app/reports`. Cycle time, bottlenecks, expiry watchlist, my-queue.
15. **Hardening** — RBAC review on every endpoint, audit-log coverage, FR i18n pass, seed/demo data, end-to-end test of the MVP success scenario (F).

**Then stop. Get it adopted. Validate. Only then start Phase 2.**

For each step: implement → run/verify behavior → commit+push (your standing approval). Keep PRs scoped to one step. Do not let Phase 2/3 features leak into Phase 1.

---

## N. Final Recommendation: Internal ERP or Scalable Multi-Tenant SaaS?

**Build a single-tenant internal operations platform, architected multi-tenant-ready. Not an ERP. Not (yet) a SaaS.**

Three precise positions:

1. **Not an "ERP."** The questionnaire's ERP framing — general ledger, statutory financial statements, management-control BI, CRM — is a trap. Effitrans already has Sage for accounting and Maya for billing. What they are missing, and what hurts every day, is **operational control**: a digital file, a workflow engine, document lifecycle management, and visibility. Build *that*. The word "ERP" should not appear in the MVP scope.

2. **Single-tenant now, multi-tenant-ready in the schema.** Q32 says "mainly for Effitrans but could be commercialized." That is a *maybe*, not a funded product strategy. Building a real multi-tenant SaaS (onboarding, tenant admin, subscription billing, per-tenant config, support tooling) now would multiply cost and complexity for a customer that doesn't exist. But *retrofitting* tenancy later is expensive. The disciplined middle path: **`tenant_id` on every table + Postgres RLS from day one** — a few percent of extra effort that preserves the option. Build the SaaS control plane only in Phase 3, only if commercialization is actually funded and a second customer is real.

3. **Integrate, don't rebuild; defer, don't pile on.** Keep Sage. Keep Maya running until Phase 2 billing replaces it. Treat GAINDE/Orbus as manual reference touchpoints until proven otherwise. Ship the MVP in Section F, get 65 people to actually use it, and let the KPIs Effitrans asked for in Q31 start flowing. Then — and only then — earn the right to build Phase 2 and 3.

**The one-line answer:** Build a focused, single-tenant **logistics operations control tower** — operational file + workflow + document-expiry engine + visibility — multi-tenant-ready underneath, integrating (not replacing) the financial systems that already work. That is what should be built first, and it is exactly what Effitrans said they need in their own words.
