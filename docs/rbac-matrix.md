# Effitrans Operations Platform — RBAC Matrix (Phase 1)

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md).
>
> The Decision Register is the **authoritative source** for all business, architecture, security, workflow, hosting, integration, and platform decisions.
>
> Contributors must **not** change assumptions or requirements directly in this document without first updating the corresponding decision entry in the Decision Register.
>
> If a decision changes: (1) update or supersede the decision in the Decision Register, (2) record the date and owner, (3) update all affected downstream documents.
>
> **In case of conflict between documents, the Decision Register takes precedence.**

Roles distilled from Q17 (13 roles) with governance from Q18 (hybrid role-based visibility) and Q19 (structured admin, separation of powers). Enforced **server-side** via Postgres RLS + permission checks — never UI-only.

Related: [requirements.md](requirements.md) · [database-design.md](database-design.md) · [state-machine.md](state-machine.md)

---

## 1. Permission model

`permission = (module × action × data_scope)`

**Actions:** `C` create · `R` read · `U` update · `D` delete/archive · `V` validate (pass a workflow gate) · `A` admin/configure.
**Data scopes:** `OWN` (files where user is AM/assignee) · `TEAM` (coordinator's team/zone) · `CLIENT` (assigned clients) · `ALL` · `FIN` (financial fields only) · `—` none.

---

## 2. Roles (Phase 1)
| Role code | Label (FR) | Workflow position |
|---|---|---|
| `SYSTEM_ADMIN` | Administrateur système (IT) | Governance — technical only |
| `CEO` | Direction générale | Governance — full visibility |
| `QUOTATION_MANAGER` | Responsable des cotations | Pricing (Phase 2 module; role exists now) |
| `ACCOUNT_MANAGER` | Account Manager / Responsable de dossier | **File owner, end-to-end** |
| `COORDINATOR` | Coordinateur des opérations | Control tower |
| `CHIEF_OF_TRANSIT` | Chef de transit | Customs authority (validation gate) |
| `CUSTOMS_DECLARANT` | Déclarant en douane | Customs execution |
| `DOCUMENTATION_OFFICER` | Agent de documentation | Document control |
| `TRANSPORT_OFFICER` | Responsable transport / dispatch | Transport + POD |
| `WAREHOUSE_COORDINATOR` | Coordinateur entrepôt / site | Handling (light in P1) |
| `FINANCE_OFFICER` | Agent financier / comptable | Cost/billing (billing = P2) |
| `OPS_SUPERVISOR` | Superviseur / Manager opérations | Supervision, milestone validation |
| `COMPLIANCE_HSSE` | Responsable conformité / HSSE | Audit/compliance read |
| `CLIENT_USER` | Client (portail) | External — own files only |
| `PARTNER_AGENT` | Partenaire / agent / transporteur | External — assigned executions |

> `FINANCE_CONTROLLER` and `MANAGEMENT_CONTROLLER` roles exist in the design but their financial/BI permissions activate in **Phase 2/3**; in Phase 1 they behave as scoped finance readers.

---

## 3. Module × Role permission matrix (Phase 1)

Modules: **Files** · **Workflow** (trigger transitions) · **Customs** · **Documents** · **Transport/POD** · **Tasks** · **Dashboards** · **Admin/Config**

| Role | Files | Workflow | Customs | Documents | Transport/POD | Tasks | Dashboards | Admin |
|---|---|---|---|---|---|---|---|---|
| SYSTEM_ADMIN | R/ALL | — | R | R | R | R | R | **CRUDA** |
| CEO | R/ALL | — | R | R | R | R | R/ALL | override-only (logged) |
| QUOTATION_MANAGER | C,R/OWN | — | — | R | — | R/OWN | R/OWN | — |
| **ACCOUNT_MANAGER** | **CRU/OWN+CLIENT** | **trigger + V(POD)** | R | CRU/OWN | R,V(POD)/OWN | CRU/OWN | R/OWN+CLIENT | — |
| COORDINATOR | RU/TEAM | trigger(dispatch/release) | R | RU/TEAM | RU/TEAM | CRU/TEAM | R/TEAM | — |
| CHIEF_OF_TRANSIT | R/transit | **trigger + V(declaration)** | **RU/transit** | RU/transit | — | R | R/transit | workflow templates (scoped) |
| CUSTOMS_DECLARANT | R/ASSIGNED | trigger(submit) | **CRU/ASSIGNED** | CRU/ASSIGNED | — | RU/OWN | R/OWN | — |
| DOCUMENTATION_OFFICER | R/ASSIGNED | — | R | **CRU/ASSIGNED** | — | RU/OWN | R/OWN | — |
| TRANSPORT_OFFICER | R/ASSIGNED | trigger(transport) | — | RU(POD)/ASSIGNED | **CRU/ASSIGNED** | RU/OWN | R/OWN | — |
| WAREHOUSE_COORDINATOR | R/ASSIGNED | trigger(handling) | — | RU/ASSIGNED | RU/ASSIGNED | RU/OWN | R/OWN | — |
| FINANCE_OFFICER | R/ALL(FIN) | trigger(register) | R | R | R | R | R/FIN | period config (P2) |
| OPS_SUPERVISOR | R/TEAM | V(milestones) | R | R | R | RU/TEAM | R/TEAM | workflow admin (scoped) |
| COMPLIANCE_HSSE | R/ALL | — | R | R | R | R | R/compliance | audit config |
| **CLIENT_USER** | R/OWN-CLIENT-ONLY | — | R(status only) | **C,R/own files** | R(POD status) | — | R(own status) | — |
| PARTNER_AGENT | R/ASSIGNED | trigger(status update) | — | **CRU(POD/docs)/ASSIGNED** | RU/ASSIGNED | R/ASSIGNED | — | — |

---

## 4. Visibility model (Q18 — hybrid, default-restricted)

| Tier | Roles | Sees |
|---|---|---|
| Execution (restricted) | Declarant, Documentation, Transport, Warehouse, Partner | Only **assigned** files / active queue |
| Coordination | Coordinator, Chief of Transit | All files in their **team/zone/transit** scope |
| Relationship | Account Manager, Quotation Mgr, (Customer Service) | All files for their **assigned clients** + own |
| Financial | Finance Officer/Controller | All files with **financial relevance** |
| Oversight | CEO, Ops Supervisor, Compliance | **All** (supervisor = team; CEO/compliance = company) |
| External | Client User | **Own files only**; never internal cost/margin/employee/audit data |

**Override (Q18.8):** temporary expanded access for investigation/escalation/audit must be **time-bound, logged, and traceable** (`audit_log.override_reason`).

---

## 5. Governance rules (Q19 — enforced)
| Rule | Implementation |
|---|---|
| Exactly **one** full IT System Admin for daily admin | `app_user.is_system_admin` single-holder; flagged if >1 |
| **No shared admin accounts** | per-user auth; no generic logins |
| CEO has full visibility but **not** daily admin | CEO role: R/ALL + override-only, no config CRUD |
| Functional admins are **domain-scoped** | Chief of Transit → workflow templates; Finance → periods (P2); Ops Supervisor → workflow admin; Compliance → audit config |
| All admin/override actions **logged** | `audit_log` append-only |
| No mixing of execution and system governance | operational roles get no `A` permission |

---

## 6. Client portal access (Q22.4 — hard boundary)
**MUST see:** own files, real-time process stage, own document dossier (Phase-1 portal = tracking + upload + notifications).
**MUST NOT see (Phase 1):** internal costs/margins, employee performance, task assignments, other clients' data, compliance investigations, audit logs. Financial archive/invoices/CSAT are **Phase 2/3**.

---

## 7. Blocking questions
| ID | Question | Blocks |
|---|---|---|
| BLK-RB1 | Confirm the 13–15 role list maps to real Effitrans job functions (names/grouping)? | Role seed data |
| BLK-RB2 | Who is the single designated IT System Admin, and who is the break-glass backup? | Admin governance, [risk R14](audit.md#l-risk-register) |
| BLK-RB3 | Should a user holding multiple roles get the **union** of permissions (assumed yes)? | Permission resolution |
| BLK-RB4 | "Team/zone" for Coordinator — is it geographic, client-based, or org-unit? | TEAM scope definition |
| BLK-RB5 | Can Account Managers see each other's files (peer visibility) or strictly own+clients? | Visibility tightness |
