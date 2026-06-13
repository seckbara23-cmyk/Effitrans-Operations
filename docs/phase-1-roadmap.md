# Effitrans Operations Platform — Phase 1 Roadmap

**Goal (Q31/Q33):** within ~6 months, stop relying on Excel/WhatsApp/email/paper for import, export, transport & handling operations, and start producing KPIs automatically.
**Definition of Phase 1 done:** the [MVP success scenario](#5-definition-of-done) runs end-to-end on real data.

Related: [requirements.md](requirements.md) · [state-machine.md](state-machine.md) · [document-catalog.md](document-catalog.md) · [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md) · [architecture.md](architecture.md)

> Supersedes the module-numbered plan in [roadmap.md](roadmap.md) for Phase 1. That document's Phases 8–14 (Finance, Road, Warehousing, Consolidation, Handling-detail, Ship-agency, Moving) are re-scoped here as **Phase 2/3**.

---

## 1. Sprint plan (2-week sprints)

Each sprint ends shippable, demoable, and committed+pushed. Backend work wires the **existing** mock UI routes ([architecture §5](architecture.md#5-existing-codebase-reuse)) — no UI rewrites.

| Sprint | Theme | Delivers | Maps to |
|---|---|---|---|
| **S0** | Foundations & decisions | Resolve blocking questions ([§3](#3-blocking-questions-must-resolve-before-or-during-s0)); confirm architecture; Supabase project; `tenant_id`/RLS baseline; seed Effitrans org | architecture.md, [BLK-1,3,6,9](#3-blocking-questions-must-resolve-before-or-during-s0) |
| **S1** | Identity & access | Supabase Auth; `app_user`/`role`/`permission`; 13–15 roles seeded; server-side RBAC; `audit_log` (append-only) | REQ-A01–A05, rbac-matrix.md |
| **S2** | Operational File spine | `operational_file` CRUD wired to `/shipments`; file numbering; clients/contacts on `/customers`; my-queue scaffold | REQ-F01–F07 |
| **S3** | Workflow engine | Config-driven `workflow_state`/`workflow_transition`; role-gated transitions; `file_state_transition` history; import + export + transport machines | REQ-W01–W04, W08, state-machine.md |
| **S4** | Checklists & gates | `checklist_template`/`checklist_item`; checklist guards; **POD hard gate**; archive lock | REQ-W05–W07, REQ-T03–T04 |
| **S5** | Documents & capture | Supabase Storage upload; `document_type` catalog; classify/version/attach on `/documents`; kills print–scan | REQ-D01–D03, D08, document-catalog.md |
| **S6** | **Expiry engine** ⭐ | `document_validity`; scheduled scan; EXPIRING/EXPIRED states; expiry-blocks-transition; expiry watchlist on `/dashboard` | REQ-D04–D07, REQ-K02 |
| **S7** | Customs reference tracking | `customs_record` on `/customs`; DPI/GAINDE/BAE/exoneration/Orbus refs + status; Chief validation gate | REQ-C01–C04, REQ-W03 |
| **S8** | Transport, dispatch & POD | `truck`/`driver`/`transport_leg`; internal vs subcontractor; transport orders; POD capture + AM validation | REQ-T01–T05 |
| **S9** | Tasks, activity & notifications | `task` + my-queue; in-file `activity_entry` (replaces WhatsApp); email+SMS notifications; notification matrix | REQ-N01–N03, N05–N06 |
| **S10** | Tier-1 dashboards | Operational/expiry/executive dashboards on `/dashboard`,`/reports`; cycle time, bottlenecks, on-time %, throughput | REQ-K01–K04 |
| **S11** | Minimal client portal | Client login; own files only; process-stage view; document upload; status notifications; strict data boundary | REQ-P01–P04, P06 |
| **S12** | Hardening & cutover | RBAC sweep on every endpoint; audit coverage; FR i18n pass; seed/migration; e2e of success scenario; pilot training | NFR-03/04, [BLK-8](#3-blocking-questions-must-resolve-before-or-during-s0) |

**Indicative timeline:** 13 sprints × 2 weeks ≈ **6 months**, matching the Q31 horizon. S5–S7 (documents + expiry + customs) are the value core — protect their time.

---

## 2. Dependency order (critical path)

```
S0 foundations
  → S1 auth/RBAC ──────────────┐
  → S2 file spine ─────────────┤
       → S3 workflow ──────────┤
            → S4 checklists/POD gate
            → S5 documents ──→ S6 EXPIRY ENGINE ⭐ (the differentiator)
            → S7 customs (needs S3 gates + S5 docs)
            → S8 transport/POD (needs S4 gate)
       → S9 tasks/notifications (needs S6 for expiry alerts)
  → S10 dashboards (needs S2–S8 data)
  → S11 portal (needs clean internal data — deliberately LAST before hardening)
  → S12 hardening + cutover
```

**Why the portal is last:** it is externally exposed; it must not show clients incomplete/wrong data. Internal files must be trustworthy first ([risk R10](audit.md#l-risk-register)).

---

## 3. Blocking questions (must resolve before/during S0)
| ID | Question | Needed by sprint |
|---|---|---|
| **BLK-1** | GAINDE/Orbus real API availability? | S0 → shapes S7 |
| **BLK-3** | Full document-type list + validity periods + which block transitions | S0 → critical for S5/S6 |
| **BLK-6** | File-numbering scheme per type | S2 |
| **BLK-2** | Volumes (files/month, docs/file, storage growth) | S0 sizing |
| **BLK-4** | Notification matrix (event × audience × channel) | S9 |
| **BLK-5** | WhatsApp budgeted now, or email+SMS first? | S9 (defaults email+SMS) |
| **BLK-9 / BLK-AR1** | Data residency / Supabase acceptable / hosting | S0 platform |
| **BLK-10** | POD acceptance criteria | S4/S8 |
| **BLK-8** | Migrate history vs clean start + legacy archive | S12 cutover |
| **BLK-RB2** | Designated IT admin + break-glass backup | S1 |
| **BLK-7** | Field/port offline tolerance | S8 |

> Default assumptions if unanswered: reference-tracking for GAINDE/Orbus; email+SMS (no WhatsApp); clean start with legacy read-only archive; Supabase hosting in the nearest compliant region. These are documented defaults, changeable on confirmation.

---

## 4. Out of Phase 1 (parked)
Billing/Maya replacement · quotation module · WhatsApp · per-employee KPIs · Sage integration · customs disputes · CSAT/NPS · management control/BI · warehousing/consolidation/ship-agency/moving · multi-tenant SaaS control plane. See [requirements §4–5](requirements.md#4-phase-2-preview-do-not-build-now).

---

## 5. Definition of done (Phase 1 acceptance test)
> A new import file is opened **digitally** (no printing). It advances through the role-gated workflow: declarant drafts the GAINDE declaration (ref captured), the **Chief of Transit validation gate** is enforced, finance registers, agents record the BAE, transport is assigned (internal truck **or** subcontractor), goods are delivered, and the file **cannot be archived until the Account Manager validates the POD**. An exoneration title expiring in 10 days **fires an email+SMS alert** and appears on the expiry watchlist; an *expired* required document **blocks** the clearance transition. Management sees **live cycle-time, bottleneck, and on-time KPIs** with no Excel. A client logs into the portal, sees **only their own files'** real-time stage, and uploads a document. Every state change is in the **audit log**.

When that runs on real data for real files, Phase 1 is done.

---

## 6. Recommended first sprint (start here)
**Sprint S0 + S1 combined kickoff** — see the summary message for the exact first-sprint definition.
