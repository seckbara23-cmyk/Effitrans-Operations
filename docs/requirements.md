# Effitrans Operations Platform — Requirements (Phase 1)

**Product type:** Logistics **operations control tower** — NOT a full ERP.
**Phase 1 mandate (Q31, Q33):** stop relying on manual tools (Excel/WhatsApp/email/paper) for import, export, transport & handling operations; start producing KPIs automatically.
**Governing principle:** the **Operational File** is the single source of truth, driven by workflow state machines, checklists, documents, expiry alerts, task ownership, and audit logs.

Related docs: [state-machine.md](state-machine.md) · [document-catalog.md](document-catalog.md) · [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md) · [architecture.md](architecture.md) · [phase-1-roadmap.md](phase-1-roadmap.md)

---

## 1. Scope boundaries

### 1.1 In scope — Phase 1
Operational File (import/export/transport/handling) · workflow state machine + role gates · per-stage checklists · document management with native digital capture · **document-expiry alert engine** · customs **reference** tracking (GAINDE/Orbus refs + status) · transport & dispatch (internal fleet vs subcontractor) + POD · task ownership & assignment · notifications (email + SMS) · in-file activity feed · RBAC + audit trail · operational/expiry/executive **Tier-1** dashboards · **minimal** customer portal (tracking + document upload + notifications only).

### 1.2 Explicitly OUT of Phase 1
| Excluded | Phase | Reason |
|---|---|---|
| General ledger, statutory accounting, financial statements | Never (use Sage) | Sage already does this; do not rebuild |
| Billing / invoicing (replace Maya) | Phase 2 | Needs trustworthy file data first; Maya keeps running |
| Full BI / management control / budgeting / forecasting | Phase 3 | Heavy; depends on financial data |
| Customer portal — financial archive, invoices, debours, CSAT/NPS | Phase 2/3 | MVP portal stays tracking + upload + notifications only |
| Live GAINDE / Orbus / Sage API integration | Phase 2+ (if confirmed) | Reference-tracked in Phase 1 (see [BLK-1](#7-blocking-questions)) |
| Per-employee KPI scorecards | Phase 2 | Adoption risk; tool must earn trust first |
| Quotation/CRM, customs disputes/litigation, HSSE/ISO module | Phase 2/3 | Not the core Phase 1 pain |
| Multi-tenant SaaS control plane (onboarding, tenant admin, subscription) | Phase 3 | Schema is tenant-ready now; no SaaS machinery built |
| Warehousing/WMS, consolidation, ship-agency, moving modules | Phase 3+ | Distinct business lines; out of the import/export/transport core |

---

## 2. Functional requirements

MoSCoW: **M**ust / **S**hould / **C**ould (all rows below are Phase 1 unless tagged). Each maps to questionnaire source.

### 2.1 Operational File (core spine)
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-F01 | Create an Operational File of type IMPORT, EXPORT, TRANSPORT, or HANDLING with a unique human-readable file number | M | Q6, Q9 |
| REQ-F02 | File carries: client, account manager (owner), coordinator, transport mode, incoterm, origin, destination, cargo type, priority | M | Q9 |
| REQ-F03 | File holds planned vs actual dates (pickup, ETD/ATD, ETA/ATA, delivery) | M | Q9 |
| REQ-F04 | Every document, task, customs record, transport leg, message and status change attaches to exactly one file | M | Q9, Q10 |
| REQ-F05 | File is owned end-to-end by the Account Manager until POD validation (ownership cannot be silently lost) | M | Q6 |
| REQ-F06 | Files searchable/filterable by number, client, state, owner, mode, dates | M | Q14 |
| REQ-F07 | File can be created from a quotation reference (quotation module itself is Phase 2) | C | Q6 |

### 2.2 Workflow state machine & checklists
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-W01 | File advances through a defined state machine per file type (see [state-machine.md](state-machine.md)) | M | Q6 |
| REQ-W02 | Each transition is gated by an allowed role; unauthorized transitions are rejected and logged | M | Q6, Q13 |
| REQ-W03 | **Chief-of-Transit validation gate**: a customs declaration cannot pass to finance/clearance without Chief validation | M | Q6 |
| REQ-W04 | **POD hard gate**: a file cannot reach BILLED or ARCHIVED without an Account-Manager-validated POD | M | Q6 |
| REQ-W05 | Each stage defines mandatory checklist items; the file cannot advance until required items are complete | M | Q14.11 |
| REQ-W06 | Checklist items may require an attached document to be marked complete | M | Q14.11 |
| REQ-W07 | Archived files become read-only; writes are rejected except via a logged override | M | Q6 |
| REQ-W08 | State-machine definitions are config-driven (states/transitions/gates editable without code change) | S | — |

### 2.3 Document management & expiry engine
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-D01 | Upload documents natively (digital-first) and attach to a file — no print/re-scan required | M | Q12, Q15 |
| REQ-D02 | Classify each document against a document-type catalog (see [document-catalog.md](document-catalog.md)) | M | Q10 |
| REQ-D03 | Version documents; a new version supersedes the prior, both retained | M | Q13 |
| REQ-D04 | Record issue date and expiry date for document types that have validity | M | Q11.3 |
| REQ-D05 | **Expiry engine**: scan validity dates daily and raise alerts at configurable lead times before expiry | M | Q11.3, Q14.10 |
| REQ-D06 | Flag documents that are expired-but-required and block/escalate dependent transitions | M | Q11.3 |
| REQ-D07 | Detect missing required documents per file type before cargo arrival | M | Q14.10 |
| REQ-D08 | Full-text/metadata document search across a file's dossier | S | Q11.5 |

### 2.4 Customs reference tracking (NOT auto-submission)
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-C01 | Capture customs data per file: DPI ref, note de détail, GAINDE declaration ref, HS codes, regime, BAE ref + date | M | Q6, Q9 |
| REQ-C02 | Capture exoneration / exemption title references and link to their validity documents | M | Q6, Q10 |
| REQ-C03 | Capture Orbus Infinity disbursement references and payment status | M | Q6, Q9 |
| REQ-C04 | Track customs status (declaration drafted/validated/registered/cleared) within the state machine | M | Q6 |
| REQ-C05 | If/when a real GAINDE or Orbus API is confirmed, replace manual entry with sync (Phase 2+) | C | [BLK-1](#7-blocking-questions) |

### 2.5 Transport, dispatch & POD
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-T01 | Create transport legs and choose INTERNAL fleet or EXTERNAL subcontractor | M | Q6 |
| REQ-T02 | Internal: assign truck + driver. External: select partner + issue transport order ref | M | Q6 |
| REQ-T03 | Capture POD: signed consignee receipt document + signed-at timestamp | M | Q6 |
| REQ-T04 | Account Manager validates POD authenticity; validation unlocks billing/archive (REQ-W04) | M | Q6 |
| REQ-T05 | Track transport SLA target vs actual delivery | S | Q26 |

### 2.6 Tasks, notifications & communication
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-N01 | Assign tasks to users with owner, due date, status; tasks belong to a file | M | Q15, Q17 |
| REQ-N02 | Each user has a "my queue" of assigned files/tasks/pending validations | M | Q18 |
| REQ-N03 | Notifications on milestone events and expiry alerts via email + SMS | M | Q24, Q25 |
| REQ-N04 | WhatsApp notification channel | C (Phase 2) | Q25, [BLK-5](#7-blocking-questions) |
| REQ-N05 | In-file activity feed (comments + system events) replacing WhatsApp/email coordination | M | Q11, Q13 |
| REQ-N06 | Notification matrix defines event × audience × channel (see [BLK-4](#7-blocking-questions)) | M | Q24 |

### 2.7 Identity, access & audit
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-A01 | Authenticate users; assign one or more roles (see [rbac-matrix.md](rbac-matrix.md)) | M | Q17 |
| REQ-A02 | Enforce role-based file visibility server-side (own / team / client / all scopes) | M | Q18 |
| REQ-A03 | Exactly one full IT System Admin; no shared admin accounts; CEO has full visibility but not daily admin | M | Q19 |
| REQ-A04 | Expanded/override access is time-bound and logged | M | Q18.8 |
| REQ-A05 | Audit log records every state change and privileged action (actor, before/after, timestamp) | M | Q17, Q30 |

### 2.8 Dashboards (Tier-1 only — derived from workflow data)
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-K01 | Operational dashboard: active files by state, bottlenecks, my-queue, cycle time | M | Q20, Q28 |
| REQ-K02 | Expiry watchlist: documents expiring in 7/14/30 days, expired-but-needed | M | Q14.10 |
| REQ-K03 | Executive dashboard: throughput, on-time %, avg cycle time, expiry-risk count | M | Q28 |
| REQ-K04 | Drill-down from any KPI to the underlying files (where authorized) | S | Q20 |
| REQ-K05 | Financial / per-employee / CSAT KPIs (Tier-2) | (Phase 2/3) | Q26 |

### 2.9 Minimal customer portal (kept deliberately small)
| ID | Requirement | MoSCoW | Source |
|---|---|---|---|
| REQ-P01 | Client logs in and sees ONLY their own files | M | Q22.4 |
| REQ-P02 | Client sees real-time process stage of each of their files | M | Q22 |
| REQ-P03 | Client uploads documents to their files | M | Q23 |
| REQ-P04 | Client receives status-change + milestone notifications | M | Q24 |
| REQ-P05 | Client sees invoices, debours, receipts, financial archive, CSAT/NPS | (Phase 2/3) | Q22 |
| REQ-P06 | Portal exposes NO internal costs, margins, employee data, audit logs, or other clients' data | M | Q22.4 |

> **Portal Phase-1 boundary:** tracking + document upload + notifications. Nothing financial. The portal must not be exposed until internal file data is clean (see [phase-1-roadmap.md](phase-1-roadmap.md), late sprint).

---

## 3. Non-functional requirements
| ID | Requirement |
|---|---|
| NFR-01 | **Tenant-ready**: every business table carries `tenant_id`; isolation enforced by Postgres RLS. No SaaS control plane built yet. |
| NFR-02 | **French-first** UI (FR primary operating language), EN secondary; reuse existing i18n. |
| NFR-03 | RBAC enforced server-side on every query, not UI-only. |
| NFR-04 | All state changes and privileged actions are auditable and immutable. |
| NFR-05 | Documents stored in object storage (not DB blobs); storage region configurable for data residency. |
| NFR-06 | Tolerant of intermittent connectivity for field/port use (see [BLK-7](#7-blocking-questions)). |
| NFR-07 | The expiry scan + notification dispatch run as scheduled background jobs. |
| NFR-08 | Target scale: 65 internal users + client portal users; sizing pending volume data ([BLK-2](#7-blocking-questions)). |

---

## 4. Phase 2 preview (do NOT build now)
Billing/invoicing replacing Maya · quotation→file conversion · WhatsApp channel · per-employee/department KPIs · Sage integration (export billed files) · portal financial archive · live GAINDE/Orbus sync (if APIs confirmed).

## 5. Phase 3 preview
Customs non-conformity & disputes/litigation · CSAT/NPS feedback loop · management control (budget/forecast, profitability) · BI layer · HSSE/ISO/MASE · warehousing/consolidation/ship-agency/moving modules · multi-tenant SaaS commercialization.

## 6. Traceability note
Every Phase-1 requirement traces to a questionnaire question (Q1–Q33). Requirements with no questionnaire basis are marked `—` and are engineering necessities (e.g. REQ-W08, config-driven workflow).

## 7. Blocking questions (need Effitrans confirmation before/at build)
| ID | Question | Blocks | Owner |
|---|---|---|---|
| **BLK-1** | Do GAINDE and Orbus Infinity expose any third-party API for declaration/payment data, or is all interaction inside their own UIs? | Customs/disbursement design (REQ-C01–C05) | IT + Chief of Transit |
| **BLK-2** | Approximate volumes: files/month, documents/file, expected storage growth? | Sizing, storage costs (NFR-05/08) | Operations |
| **BLK-3** | The exact document-type catalog and per-type validity periods (APE, DPI, exoneration titles, sommiers, etc.) | Expiry engine (REQ-D04–D07), [document-catalog.md](document-catalog.md) | Chief of Transit |
| **BLK-4** | Full notification matrix: which events notify whom, on which channel? | REQ-N03/N06 | Operations |
| **BLK-5** | Is WhatsApp Business API (paid, BSP + approved templates) budgeted, or start with email+SMS? | REQ-N04 | Management |
| **BLK-6** | File-numbering scheme per type (e.g. `IMP-2026-00042`) including branch/year logic | REQ-F01, schema | Operations |
| **BLK-7** | Do field/transit agents need offline tolerance at port? Connectivity reality? | NFR-06 | Operations |
| **BLK-8** | Data migration: start clean with legacy read-only archive, or migrate historical files? | Cutover plan | Management |
| **BLK-9** | Data residency/hosting constraints for oil & gas client documents? | NFR-05, hosting | Management + clients |
| **BLK-10** | Exact POD acceptance criteria — what makes a POD valid/authentic? | REQ-T03/T04 | Operations |
