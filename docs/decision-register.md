# Effitrans — Decision Register

**Purpose:** the master, authoritative record of every architecture, business, security, hosting, workflow, and integration decision for the Effitrans Operations Platform. **All future changes go through this register** — a new dated row (or a status change to `Superseded`), never a silent edit elsewhere. The planning docs are downstream of this file.

**Status values** (full definitions in [§G Decision Status Standard](#g-decision-status-standard)): `Proposed` · `Approved` · `Implemented` · `Superseded` · `Rejected`. Intake items not yet formulated as a decision are tracked as `Open` in the [Blocker Register](s0-readiness-checklist.md#critical-blockers-register) until they enter the lifecycle.

**Change control:** every change follows [§F Change Control Process](#f-change-control-process). **Document impact** by decision category is mapped in [§H Document Dependency Matrix](#h-document-dependency-matrix).

**Categories:** Architecture · Business · Security · Hosting · Workflow · Integration · Data · Finance · Commercial.

Related: [s0-readiness-checklist.md](s0-readiness-checklist.md) · [architecture.md](architecture.md) · workshops in [docs/workshops/](workshops/).

---

## A. Architecture & product decisions (already directed / ratified)

These were directed by management across the discovery and planning prompts and are treated as **Approved** constraints development must follow.

| Decision ID | Category | Decision | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-A01 | Architecture | Build a focused **logistics operations control tower, NOT a full ERP** | Management | 2026-06-13 | Approved | — | audit.md, requirements.md |
| DEC-A02 | Architecture | **Operational File** is the single source of truth; everything attaches to it | Management | 2026-06-13 | Approved | — | requirements.md, database-design.md |
| DEC-A03 | Architecture | Workflow driven by a **config-driven state machine** with role-gated transitions | Dev/Architect | 2026-06-13 | Approved | BLK-SM* | state-machine.md |
| DEC-A04 | Workflow | **Chief-of-Transit validation gate** + **POD hard gate** are non-negotiable | Management | 2026-06-13 | Approved | BLK-10 | state-machine.md |
| DEC-A05 | Architecture | Single **Next.js full-stack monolith** (no microservices) | Dev/Architect | 2026-06-13 | Approved | — | architecture.md |
| DEC-A06 | Architecture | **PostgreSQL via Supabase** (DB + Auth + Storage + scheduled jobs) — **platform APPROVED for Phase 1 foundation**. Rationale: *"Effitrans approved Supabase for Phase 1 foundation work."* Hosting **region** remains provisional pending BLK-9 (tracked by DEC-B09). | Dev/Architect + Management | 2026-06-13 (approved) | Approved | BLK-AR1 ✅ closed · BLK-9 (region) open → DEC-B09 | architecture.md |
| DEC-A07 | Data | Documents in **object storage**, never DB blobs | Dev/Architect | 2026-06-13 | Approved | — | architecture.md, database-design.md |
| DEC-A08 | Architecture | **French-first** UI (FR primary, EN secondary) | Management | 2026-06-13 | Approved | — | requirements.md |
| DEC-A09 | Business | **Tier-1 KPIs only** in Phase 1 (workflow-derived); financial/CSAT/employee KPIs deferred | Management | 2026-06-13 | Approved | — | requirements.md, audit.md |
| DEC-A10 | Business | **Phase boundaries**: no billing, GL/accounting, BI, or financial portal in Phase 1 | Management | 2026-06-13 | Approved | — | requirements.md, phase-1-roadmap.md |
| DEC-A11 | Business | **Minimal customer portal** = tracking + document upload + notifications only (P1) | Management | 2026-06-13 | Approved | — | requirements.md |
| DEC-A12 | Architecture | **Migration mechanism = Supabase CLI SQL migrations** (forward-only, plain SQL under `supabase/migrations/`), not an ORM migration tool. The typed query/ORM layer (supabase-js typed / Prisma / Drizzle) is a **separate, deferred** decision. | Dev/Architect | 2026-06-13 | Approved | — | database-design.md, s0-backlog.md, SETUP.md |

---

## B. Blocker-driven decisions (pending workshop confirmation)

One row per open blocker. `Proposed` = a documented default is in force; `Open` = no default, needs an answer. These flip to `Approved` when the relevant workshop closes them.

| Decision ID | Category | Decision (current) | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-B01 | Integration | GAINDE/Orbus handled by **manual reference-tracking** until a real API is confirmed | IT + Chief of Transit | — | Proposed | **BLK-1** | architecture.md, database-design.md |
| DEC-B25 | Security/Auth | **Google OAuth Sign-In (Phase 1.16) APPROVED — staff-first.** Adds "Continue with Google" to the internal `/login` via Supabase Auth Google provider (PKCE), with **NO open self-registration**. **Locked:** no hard Workspace-domain restriction for now; **`app_user`/`client_user` id-based profile gating stays the authority** (gate keys on `auth.users.id`, never an email lookup; email match is an *additional* assertion against the **verified** Google email); **Google enabled for BOTH staff and portal** (Q3, updated from staff-first); rejected unknown/orphan users are **signed out AND their orphan `auth.users` row deleted** (admin); **no auto-creation** of profiles; **email stays invite/admin-managed** (no self-service change). Flow: `/auth/callback` route handler → `exchangeCodeForSession` → gate (active `app_user` for this id + email match) → `/dashboard`, else signOut + orphan-delete → `/login?error`. Audit `auth.login.google` (attributed) + `auth.login.rejected` (machine event, null actor, reason only — no plaintext email). Supabase config: Google provider on, **signups OFF**, verified-email linking ON, redirect-URL allowlist. **Preserves** RLS + audit; no schema/migration. **Also in 1.16 — staff password recovery:** "Mot de passe oublié" on `/login` triggers Supabase `resetPasswordForEmail` (PKCE, browser-initiated so the verifier is local) → `/auth/update-password` exchanges the code, **gates the recovery session to an ACTIVE `app_user` by id** (`assertStaffRecovery` — portal/inactive/orphan refused, signed out), then `updateUser({password})` → signOut → `/login?reset=success`. **Unknown emails get a generic success message (anti-enumeration)**; the request audit (`auth.password_reset.requested`) is internal and **only emitted for an active staff email** (no leak); completion audited `auth.password_reset.completed`. No auto-profile creation; **no self-service email change**. **Portal parity (Q3):** portal users get the **same** Google sign-in (`/portal/auth/callback` → `client_user`-by-id gate, INVITED→ACTIVE on first Google login, DISABLED/non-portal/orphan refused + orphan `auth.users` deleted) and password reset (`/portal/auth/update-password`); audit `portal.login.google` / `portal.login.rejected` / `portal.password_reset.requested|completed`. A staff account reaching the portal callback (has `app_user`, no `client_user`) is rejected but **never deleted** (and vice versa). **Deferred:** Workspace `hd` hard restriction, self-service email change. | Management/IT + Dev | 2026-06-15 | Approved | — | phase-1.16-google-oauth-plan.md, architecture.md |
| DEC-B24 | Finance/Integration | **Real Payment Provider Integration (Phase 1.15B) APPROVED — scaffold only, no live money.** Adds a **`payment_intent`** table (orchestration; NOT a money row) + append-only **`provider_webhook_event`** table, a server-only **provider abstraction** (`MockProvider` full; **Wave / Orange Money placeholders** returning `not_configured`), and a webhook **Route Handler scaffold**. Behind master flag **`PAYMENTS_ENABLED=false`**. **Locked decisions:** (Q1) **Architecture + Mock first; Wave first when credentials land; Orange Money after Wave.** (Q2) **Staff-generated payment links first**; portal **Pay button ships behind the flag, disabled**. (Q3) **No partial online payments** — intent amount = full invoice balance. (Q4) **Provider success auto-verifies** — when signature + idempotency + non-replay + tenant/invoice match + amount-equals-balance + invoice-payable ALL pass, **auto-create a `payment` born `VERIFIED`** (`payment.auto_recorded`). (Q5) **TTL expiry** → EXPIRED; **failed/expired intents stay visible in reconciliation**. (Q6) Webhook **records directly ONLY** after all §4.5 guards pass; otherwise log the event, mark intent **FAILED/UNMATCHED**, route to manual reconciliation. **Preserves** the 1.11 paid/balance formula (Σ non-reversed) — only a SUCCEEDED intent spawns a normal `payment`; RLS finance-gated like `payment` + additive portal read; append-only audit. **Deferred (no code):** real credentials, live API calls, bank-transfer API, refunds/disputes/chargebacks, payouts, recurring, partial online payments. | Management/IT + Dev | 2026-06-15 | Approved | — | phase-1.15b-payment-provider-plan.md, rbac-matrix.md, database-design.md |
| DEC-B23 | Finance | **Payment Recording Integrations (Phase 1.15A) APPROVED — manual only.** Extends the 1.11 `payment` table (additive) with manual provider metadata (`provider_name`, `provider_reference`, `received_by`) and a one-shot reconciliation workflow `verification_status` PENDING→VERIFIED/REJECTED (`verified_by`/`verified_at`/`verification_note`). **No new permission** — VERIFY/REJECT reuse **`finance:void`**; reference edits reuse `finance:update`. **Reject = reverse + mark REJECTED**: rejecting also sets `reversed_at`, so the row leaves the paid total and the **1.11 paid/balance formula (Σ non-reversed) and all invoice calculations are unchanged**. New `/finance/reconciliation` view (gated `finance:read`) surfaces unverified payments, missing-reference flags, recently resolved, and outstanding balances. Audit `payment.verified`/`payment.rejected` added. Portal stays **read-only** (no payment buttons/collection). **Deferred (no code):** Wave API, Orange Money API, webhooks, online gateways, payment collection — the schema is shaped to accept them later. Realizes DEC-B01-style manual tracking for payments. | Management/IT + Dev | 2026-06-15 | Approved | — | phase-1.15a, rbac-matrix.md, database-design.md |
| DEC-B02 | Data | Capacity sized for **65 internal users + moderate volume**; revisit on real numbers | Operations/Mgmt | — | Open | **BLK-2** | architecture.md |
| DEC-B03 | Workflow | Document-type catalog + validity periods + block-vs-warn **per Chief of Transit**. **MVP slice Approved via DEC-B21**; the full customs expiry-bearing catalog (APE/DPI/exonération/sommiers) + per-type validity *values* remain pending Chief of Transit, deferred to the Customs module. | Chief of Transit | 2026-06-14 (MVP) | Approved (MVP) | **BLK-3** | document-catalog.md, blk-3-documents-governance.md, state-machine.md |
| DEC-B04 | Workflow | Notification matrix default = **email+SMS to AM + next-action role, immediate** | Operations | — | Proposed | BLK-4 | requirements.md |
| DEC-B05 | Integration | **WhatsApp deferred to Phase 2**; Phase 1 = email + SMS | Management | — | Proposed | BLK-5 | requirements.md |
| DEC-B06 | Data | **File-numbering scheme APPROVED:** `EFT-{TYPE}-{YEAR}-{SEQUENCE}` — prefix `EFT`; TYPE ∈ IMP/EXP/TRP/HND; 4-digit year; **5-digit zero-padded** sequence scoped **per tenant × type × year**; numbers never reused; assigned on file creation; branch code deferred; concurrency-safe generation required. e.g. `EFT-IMP-2026-00001`. | Operations | 2026-06-14 (approved) | Approved | BLK-6 ✅ closed | database-design.md, phase-1.2 |
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
| DEC-B22 | Security | **Customer Portal security model (Phase 1.12) APPROVED.** A SECOND identity class on the **same Supabase Auth project**: staff via `app_user`, external clients via **`client_user`** (a given `auth.users` id is in exactly one). Portal access is **strictly client-scoped** via **additive** RLS policies keyed on `client_user.client_id` (OR'd with staff policies — staff RLS unchanged); internal policies deny portal users automatically (no `app_user` → no permission/tenant). Portal reads use the **user-context client** with **safe column projections**; service-role only for the gated **invite/manage** and (1.12B) **document-download** actions. Portal sees **only its own client's** dossiers/shipment/customs+transport **summary**; **never** tasks, audit, internal notes, charges, drafts. Staff invite/manage portal users (`portal:manage`); `client_user.status` INVITED/ACTIVE/DISABLED, `role` CLIENT_ADMIN/CLIENT_USER (portal-local, **not** RBAC). Audit attributed via nullable `audit_log.client_user_id`. Docs default **not shared** (`shared_with_client`, 1.12B). Separate `/portal/login`. Deferred: client uploads, online payments, messaging, multi-client users, branding. | Management/IT + Dev | 2026-06-15 | Approved | — | phase-1.12, rbac-matrix.md, architecture.md |
| DEC-B21 | Workflow | **Documents MVP governance (BLK-3 slice) APPROVED** (recommended defaults D1–D8): (D1) editable 10-type catalog — BL, AWB, Commercial Invoice, Packing List, Certificate of Origin, Customs Declaration, Delivery Note/POD, Transport Order, Payment Receipt, Other; (D2) only Certificate of Origin expires in MVP, **warn-only** (no transition block); (D3) "required" documents **flag/warn**, do not block dossier progression; (D4) `document:approve` = SYSTEM_ADMIN, OPS_SUPERVISOR, ACCOUNT_MANAGER, CHIEF_OF_TRANSIT, COMPLIANCE_HSSE; (D5) re-upload = **new version row** (history kept); (D6) **soft-delete only** (hard-delete pending retention DEC-B19); (D7) ≤ 25 MB, MIME pdf/jpg/png/docx/xlsx; (D8) **private bucket + server-mediated short-TTL signed URLs, no public URLs**. Documents inherit Phase-1.7 dossier visibility (no `document:read:all`). EXPIRED is derived (no scheduler); `document.expired` audit + reminders deferred. | Chief of Transit + Management/IT | 2026-06-14 | Approved | BLK-3 (MVP) | blk-3-documents-governance.md, document-catalog.md, rbac-matrix.md |
| DEC-B20 | Workflow | **Phase 1.6 in-app notifications:** durable **self-scoped** `notification` table (RLS `user_id = auth.uid()` + tenant; **no new RBAC permission** — visibility is the recipient identity). `TASK_ASSIGNED` generated on task assignment (change-only, never self); overdue / due-today are **derived** (not stored). **Scheduled reminders (`TASK_DUE_SOON`/`TASK_OVERDUE`) and the email/SMS provider are DEFERRED** — dispatch hook is a no-op stub behind `NOTIFICATIONS_EMAIL_ENABLED`. Incrementally realizes DEC-B04/DEC-B05. **No new audit events** (reuses `TASK_ASSIGNED`). | Dev/Architect | 2026-06-14 | Approved | BLK-4 (partial) | requirements.md, phase-1.6, rbac-matrix.md |

---

## C. Commercial & finance strategy decisions

| Decision ID | Category | Decision | Owner | Date | Status | Related Blocker | Documents Impacted |
|---|---|---|---|---|---|---|---|
| DEC-C01 | Commercial | **Multi-Tenant Ready** (`tenant_id` + RLS from day one); **no SaaS control plane** built in P1 | Management | 2026-06-13 | Approved | Q32 | architecture.md, database-design.md |
| DEC-C02 | Commercial | Full SaaS commercialization (onboarding/billing/tenant admin) = **Phase 3, only if funded** | Management | 2026-06-13 | Proposed | Q32 | architecture.md |
| DEC-C03 | Finance | **Keep Sage**; **never rebuild accounting**; integrate (export billed files) in **Phase 2** | Management | 2026-06-13 | Approved | R1, R3 | audit.md, requirements.md |
| DEC-C04 | Finance | **Replace Maya** with native billing in **Phase 2**; untouched in Phase 1 | Management | 2026-06-13 | Approved | — | requirements.md, phase-1-roadmap.md |

---

## D. How to use this register
1. **Every decision** (new or changed) is recorded here first, then propagated to the impacted docs listed in its row.
2. To **change** an Approved decision: add a new row with a successor ID, set the old row's Status to `Superseded`, and note the successor.
3. When a **workshop closes a blocker**, update the matching `DEC-B*` row: fill the Date, set Status to `Approved`, finalize the decision text, then update the impacted docs and the [readiness checklist](s0-readiness-checklist.md).
4. The **Related Blocker** column ties each decision back to the [Critical Blockers Register](s0-readiness-checklist.md#critical-blockers-register).

---

## E. Decision summary by status

| Status | Count | IDs |
|---|---|---|
| Approved | 16 | DEC-A01–A12, DEC-B06, DEC-C01, C03, C04 |
| Proposed (default in force) | 9 | DEC-B01, B04, B05, B08, B13, B15, B16, B17, C02 |
| Implemented | 0 | — (no code built yet) |
| Superseded | 0 | — |
| Rejected | 0 | — |
| `Open` (intake — pre-lifecycle) | 10 | DEC-B02, B03, B07, B09, B10, B11, B12, B14, B18, B19 |

**Total decisions tracked: 35** (+ 11 intake items awaiting formulation).

> **The 4 hard S0 gates live in this register as:** DEC-B01 (BLK-1), DEC-B03 (BLK-3), DEC-B06 (BLK-6), DEC-B09 (BLK-9). When all four reach `Approved`, S0's blocker-dependent work is cleared to start.

---

## F. Change Control Process

Every change to a decision follows one of four paths. **No assumption, requirement, or design in any downstream document may change until the corresponding decision here is updated first.**

### F.1 New Decision
1. Allocate the next ID in the appropriate series (`DEC-A##` architecture/product · `DEC-B##` blocker-driven · `DEC-C##` commercial/finance).
2. Record: Category, Decision text, Owner, Date, Status = `Proposed`, Related Blocker, Documents Impacted (use [§H](#h-document-dependency-matrix)).
3. On ratification, move Status → `Approved` and propagate to every impacted document.

### F.2 Modified Decision (same intent, refined detail)
1. Edit the decision text **in place**, append `(rev N, YYYY-MM-DD)` to the Date cell.
2. Keep the same ID and Status (unless ratification level changes).
3. Update impacted documents and note the revision in the [readiness checklist](s0-readiness-checklist.md) if a gate is affected.

### F.3 Superseded Decision (intent changes)
1. Create a **new** decision row with a new ID capturing the new intent.
2. Set the old row's Status → `Superseded` and add `→ superseded by DEC-XXX` to its Decision cell.
3. Record date + owner on the new row; propagate to all impacted documents.
4. Never delete the old row — supersession preserves the audit trail.

### F.4 Emergency Decision (time-critical, made outside a workshop)
1. May be recorded directly with Status = `Approved` **only** by the Project Sponsor or IT Lead.
2. Must include `EMERGENCY` in the Notes/Decision cell and the deciding person's name.
3. Must be **ratified retroactively** at the next workshop; if not ratified, it is set to `Rejected` and reversed.
4. Log it in the readiness checklist's accepted-risk section until ratified.

| Change type | New ID? | Old row status | Who approves | Audit trail |
|---|---|---|---|---|
| New | Yes | — | Workshop owner | New row |
| Modified | No | unchanged | Decision owner | Revision tag on Date |
| Superseded | Yes (successor) | `Superseded` | Workshop owner | Old + new rows linked |
| Emergency | Yes | — | Sponsor / IT Lead | `EMERGENCY` tag + retro-ratify |

---

## G. Decision Status Standard

The canonical lifecycle for every decision ID. Status flows **Proposed → Approved → Implemented**, with **Superseded** and **Rejected** as terminal off-ramps. `Open` is a pre-lifecycle intake marker used only in the [Blocker Register](s0-readiness-checklist.md#critical-blockers-register).

| Status | Meaning | Entry condition | Who sets it |
|---|---|---|---|
| **Proposed** | A decision (often a documented default) is on the table, **not yet ratified**. Downstream docs may reference it but flag it as provisional. | Recorded in the register | Author / facilitator |
| **Approved** | Ratified and **binding**. Downstream documents must conform. Not yet built. | Workshop sign-off / sponsor approval | Decision owner |
| **Implemented** | The approved decision is **realized in code/config** and verified. | Merged + verified in the platform | Dev/IT lead |
| **Superseded** | Replaced by a newer decision. **Retained** for audit; points to its successor. | A successor decision is Approved | Workshop owner |
| **Rejected** | Considered and **declined** (incl. un-ratified emergency decisions). Retained for the record. | Explicit rejection | Decision owner / sponsor |

> `Open` (intake): a blocker exists but no decision has been formulated yet — not part of the formal lifecycle. It becomes `Proposed` the moment a candidate decision (even a default) is written into the register.

---

## H. Document Dependency Matrix

Which planning/governance documents must be updated when a decision of each **category** changes. Use this to fill the "Documents Impacted" column and to know what to propagate after a change. ✅ = primary impact (must review/update) · ▫ = secondary (check for consistency).

| Decision category | requirements | state-machine | document-catalog | database-design | rbac-matrix | architecture | phase-1-roadmap | s0-readiness | workshops |
|---|---|---|---|---|---|---|---|---|---|
| **Architecture** | ▫ | ▫ | | ✅ | ▫ | ✅ | ▫ | ▫ | |
| **Security** | ▫ | | | ✅ | ✅ | ✅ | | ▫ | ▫ |
| **Workflow** | ✅ | ✅ | ▫ | ✅ | ▫ | | ▫ | ▫ | ✅ |
| **Documents** | ✅ | ▫ | ✅ | ✅ | | | | ▫ | ✅ |
| **Hosting** | | | | ▫ | | ✅ | ▫ | ✅ | ✅ |
| **Integrations** | ✅ | ▫ | | ✅ | | ✅ | ▫ | ▫ | ✅ |
| **Notifications** | ✅ | ▫ | | ✅ | | ▫ | ▫ | | ✅ |
| **Portal** | ✅ | | ▫ | ✅ | ✅ | ▫ | ▫ | | |
| **RBAC** | ▫ | ▫ | | ✅ | ✅ | ▫ | | ▫ | ▫ |

**Category → decision-series hint:** Architecture/Hosting/Integrations/Portal → `DEC-A*`/`DEC-B*` · Security/RBAC → `DEC-B*` (RB/DB series) · Workflow/Documents/Notifications → `DEC-A*`/`DEC-B*` · Commercial/Finance → `DEC-C*`.

> **Rule:** after any decision changes status, open every ✅ document in its category row, apply the change, and confirm the ▫ documents remain consistent. Record completion in the change's row (Date cell).
