# Effitrans — Decision Register

**Purpose:** the master, authoritative record of every architecture, business, security, hosting, workflow, and integration decision for the Effitrans Operations Platform. **All future changes go through this register** — a new dated row (or a status change to `Superseded`), never a silent edit elsewhere. The planning docs are downstream of this file.

**Status values:** `Accepted` (ratified, binding) · `Proposed` (default in force, pending confirmation) · `Open` (no decision yet) · `Superseded` (replaced — see successor).

**Categories:** Architecture · Business · Security · Hosting · Workflow · Integration · Data · Finance · Commercial.

Related: [s0-readiness-checklist.md](s0-readiness-checklist.md) · [architecture.md](architecture.md) · workshops in [docs/workshops/](workshops/).

---

## A. Architecture & product decisions (already directed / ratified)

These were directed by management across the discovery and planning prompts and are treated as **Accepted** constraints development must follow.

| Decision ID | Category | Decision | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-A01 | Architecture | Build a focused **logistics operations control tower, NOT a full ERP** | Management | 2026-06-13 | Accepted | — | audit.md, requirements.md |
| DEC-A02 | Architecture | **Operational File** is the single source of truth; everything attaches to it | Management | 2026-06-13 | Accepted | — | requirements.md, database-design.md |
| DEC-A03 | Architecture | Workflow driven by a **config-driven state machine** with role-gated transitions | Dev/Architect | 2026-06-13 | Accepted | BLK-SM* | state-machine.md |
| DEC-A04 | Workflow | **Chief-of-Transit validation gate** + **POD hard gate** are non-negotiable | Management | 2026-06-13 | Accepted | BLK-10 | state-machine.md |
| DEC-A05 | Architecture | Single **Next.js full-stack monolith** (no microservices) | Dev/Architect | 2026-06-13 | Accepted | — | architecture.md |
| DEC-A06 | Architecture | **PostgreSQL via Supabase** (DB + Auth + Storage + scheduled jobs) | Dev/Architect | 2026-06-13 | Proposed | BLK-9, BLK-AR1 | architecture.md |
| DEC-A07 | Data | Documents in **object storage**, never DB blobs | Dev/Architect | 2026-06-13 | Accepted | — | architecture.md, database-design.md |
| DEC-A08 | Architecture | **French-first** UI (FR primary, EN secondary) | Management | 2026-06-13 | Accepted | — | requirements.md |
| DEC-A09 | Business | **Tier-1 KPIs only** in Phase 1 (workflow-derived); financial/CSAT/employee KPIs deferred | Management | 2026-06-13 | Accepted | — | requirements.md, audit.md |
| DEC-A10 | Business | **Phase boundaries**: no billing, GL/accounting, BI, or financial portal in Phase 1 | Management | 2026-06-13 | Accepted | — | requirements.md, phase-1-roadmap.md |
| DEC-A11 | Business | **Minimal customer portal** = tracking + document upload + notifications only (P1) | Management | 2026-06-13 | Accepted | — | requirements.md |

---

## B. Blocker-driven decisions (pending workshop confirmation)

One row per open blocker. `Proposed` = a documented default is in force; `Open` = no default, needs an answer. These flip to `Accepted` when the relevant workshop closes them.

| Decision ID | Category | Decision (current) | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-B01 | Integration | GAINDE/Orbus handled by **manual reference-tracking** until a real API is confirmed | IT + Chief of Transit | — | Proposed | **BLK-1** | architecture.md, database-design.md |
| DEC-B02 | Data | Capacity sized for **65 internal users + moderate volume**; revisit on real numbers | Operations/Mgmt | — | Open | **BLK-2** | architecture.md |
| DEC-B03 | Workflow | Document-type catalog + validity periods + block-vs-warn **per Chief of Transit** | Chief of Transit | — | Open | **BLK-3** | document-catalog.md, state-machine.md |
| DEC-B04 | Workflow | Notification matrix default = **email+SMS to AM + next-action role, immediate** | Operations | — | Proposed | BLK-4 | requirements.md |
| DEC-B05 | Integration | **WhatsApp deferred to Phase 2**; Phase 1 = email + SMS | Management | — | Proposed | BLK-5 | requirements.md |
| DEC-B06 | Data | **File-numbering scheme** per type (e.g. `IMP-2026-00042`) — to be ratified | Operations | — | Open | **BLK-6** | database-design.md |
| DEC-B07 | Architecture | Tolerate intermittent field/port connectivity; offline depth **TBD** | Operations | — | Open | BLK-7 | requirements.md |
| DEC-B08 | Data | Migration = **clean start + legacy read-only archive** | Management | — | Proposed | BLK-8 | phase-1-roadmap.md |
| DEC-B09 | Hosting | Hosting region/model pending **client data-restriction** confirmation; default managed cloud | Management + clients | — | Open | **BLK-9** | architecture.md |
| DEC-B10 | Workflow | POD acceptance = signed consignee receipt, **AM-validated**; exact evidence TBD | Operations (CoT/AM) | — | Open | BLK-10 | state-machine.md, requirements.md |
| DEC-B11 | Security | Role list (13–15) maps to real Effitrans functions — to confirm | Operations/Mgmt | — | Open | BLK-RB1 | rbac-matrix.md |
| DEC-B12 | Security | **One named IT System Admin + one break-glass backup**; no shared admin accounts | Management/IT | — | Open | BLK-RB2 | rbac-matrix.md |
| DEC-B13 | Security | Multi-role users receive the **union** of their roles' permissions | IT/Dev | — | Proposed | BLK-RB3 | rbac-matrix.md |
| DEC-B14 | Security | Coordinator "team/zone" scope definition (geo/client/org-unit) — TBD | Operations | — | Open | BLK-RB4 | rbac-matrix.md, database-design.md |
| DEC-B15 | Security | Whether Account Managers can see peers' files — default **own + assigned clients only** | Operations/Mgmt | — | Proposed | BLK-RB5 | rbac-matrix.md |
| DEC-B16 | Security | Identity = **standalone Supabase Auth**, MFA for admins/external (vs SSO) | IT | — | Proposed | BLK-DB1, BLK-AR3 | rbac-matrix.md, architecture.md |
| DEC-B17 | Data | Client/partner entity overlap handling — default **separate entities** | Operations/Dev | — | Proposed | BLK-DB2 | database-design.md |
| DEC-B18 | Finance | Multi-currency in Phase 1 — default **XOF only**, multi-currency TBD | Finance/Mgmt | — | Open | BLK-DB3 | database-design.md |
| DEC-B19 | Data | Archived-document **retention policy** (Senegal legal minimum) — TBD | Mgmt/Compliance | — | Open | BLK-DB4 | database-design.md |

---

## C. Commercial & finance strategy decisions

| Decision ID | Category | Decision | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-C01 | Commercial | **Multi-Tenant Ready** (`tenant_id` + RLS from day one); **no SaaS control plane** built in P1 | Management | 2026-06-13 | Accepted | Q32 | architecture.md, database-design.md |
| DEC-C02 | Commercial | Full SaaS commercialization (onboarding/billing/tenant admin) = **Phase 3, only if funded** | Management | 2026-06-13 | Proposed | Q32 | architecture.md |
| DEC-C03 | Finance | **Keep Sage**; **never rebuild accounting**; integrate (export billed files) in **Phase 2** | Management | 2026-06-13 | Accepted | R1, R3 | audit.md, requirements.md |
| DEC-C04 | Finance | **Replace Maya** with native billing in **Phase 2**; untouched in Phase 1 | Management | 2026-06-13 | Accepted | — | requirements.md, phase-1-roadmap.md |

---

## D. How to use this register
1. **Every decision** (new or changed) is recorded here first, then propagated to the impacted docs listed in its row.
2. To **change** an Accepted decision: add a new row with a successor ID, set the old row's Status to `Superseded`, and note the successor.
3. When a **workshop closes a blocker**, update the matching `DEC-B*` row: fill the Date, set Status to `Accepted`, finalize the decision text, then update the impacted docs and the [readiness checklist](s0-readiness-checklist.md).
4. The **Related Blocker** column ties each decision back to the [Critical Blockers Register](s0-readiness-checklist.md#critical-blockers-register).

---

## E. Decision summary by status

| Status | Count | IDs |
|---|---|---|
| Accepted | 13 | DEC-A01–A05, A07–A11, DEC-C01, C03, C04 |
| Proposed (default in force) | 10 | DEC-A06, B01, B04, B05, B08, B13, B15, B16, B17, C02 |
| Open (no decision) | 11 | DEC-B02, B03, B06, B07, B09, B10, B11, B12, B14, B18, B19 |
| Superseded | 0 | — |

> **The 4 hard S0 gates live in this register as:** DEC-B01 (BLK-1), DEC-B03 (BLK-3), DEC-B06 (BLK-6), DEC-B09 (BLK-9). When all four reach `Accepted`, S0's blocker-dependent work is cleared to start.
