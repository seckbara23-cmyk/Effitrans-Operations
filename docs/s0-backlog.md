# Effitrans — Sprint S0 Backlog (Foundations)

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

**Sources:** [phase-1-roadmap.md](phase-1-roadmap.md) · [s0-readiness-checklist.md](s0-readiness-checklist.md) · [decision-register.md](decision-register.md) · [architecture.md](architecture.md) · [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md)

---

## Scope guardrail (read first)

This backlog covers **only blocker-independent foundation work** — the slice the [readiness checklist](s0-readiness-checklist.md#recommendation) authorized to start under CONDITIONAL GO while the workshops close the four 🔴 blockers. It merges the roadmap's **S0 (foundations)** and **S1 (identity & access)** into one execution sprint.

**Explicitly NOT in this sprint (gated on the 🔴 blockers):**
| Excluded | Blocked by | Belongs to |
|---|---|---|
| Business schema (operational_file, document, customs_record, transport, task…) | BLK-3, BLK-6 | S2+ |
| Workflow / state-machine engine | BLK-SM* | S3 |
| Document-type catalog implementation | BLK-3 | S5 |
| Customs reference tracking | BLK-1 | S7 |
| Final hosting **region** commitment | BLK-9 | confirmed at workshop |
| Live GAINDE/Orbus/Sage/Maya integration | BLK-1 | P2+ |

> The Supabase project **is** created this sprint, but on the **documented default region** (DEC-A06 / accepted risk AR-1), explicitly **provisional** until BLK-9 closes. Nothing in this sprint hardcodes a catalog, a file-numbering scheme, or a business table — so no 🔴 blocker is touched.

---

## Sprint Goal

> Stand up a **secured, multi-tenant-ready, auditable foundation** for the Effitrans platform: a Supabase project with CI/CD and local dev, a versioned migration pipeline, the non-business foundation tables (`organization`, identity, RBAC, `audit_log`), Supabase Auth with user profiles and sessions, a seeded role/permission model, an RLS tenant-isolation baseline, and append-only audit logging — plus a documented assessment of which existing mock-UI pages to keep vs replace.
>
> **Outcome:** a developer can log in, be assigned a role, act within an enforced tenant boundary, and have every privileged action audited — with **zero business domain code written**. Everything S2+ builds on exists and is proven.

**Estimate (whole sprint):** ~18–24 ideal dev-days (≈ one 2-week sprint for 2 engineers, with buffer).

---

## Task Breakdown

Estimates are ideal dev-days (points in parentheses, 1pt ≈ ½ day). Dependencies reference task IDs in this sprint or external blockers.

### 1. Infrastructure Setup

#### S0-INF-1 — Provision Supabase project (provisional region)
- **Description:** Create the Supabase project (Postgres + Auth + Storage + scheduled functions enabled) on the **default managed-cloud region** per DEC-A06/AR-1. Capture project keys; document that region is provisional pending BLK-9.
- **Dependency:** none (uses accepted-risk default; does **not** wait on BLK-9).
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Project exists; Postgres reachable; Auth + Storage enabled.
  - Service/anon keys stored as secrets (not in repo).
  - A note in [decision-register.md](decision-register.md) DEC-A06/DEC-B09 records the chosen region as provisional.
  - Teardown/recreate steps documented (so a BLK-9 region change is cheap).

#### S0-INF-2 — Environment variable strategy
- **Description:** Define and document the env-var contract (Supabase URL/keys, DB URL, auth secrets, email/SMS provider placeholders) across local / CI / preview / prod. Provide a committed `.env.example`; never commit real secrets.
- **Dependency:** S0-INF-1
- **Estimate:** 0.5 day (1 pt)
- **Acceptance criteria:**
  - `.env.example` committed with every required key documented (purpose + where to obtain).
  - Real secrets only in the secret store / local untracked `.env`.
  - App fails fast with a clear message when a required var is missing.

#### S0-INF-3 — CI/CD pipeline
- **Description:** Set up CI for lint + typecheck + build on every PR, and a deploy/preview pipeline (per chosen deployment target — Vercel default, TBD BLK-AR2). Migrations run in CI against an ephemeral/staging DB.
- **Dependency:** S0-INF-1, S0-INF-2, S0-DB-2
- **Estimate:** 1.5 days (3 pts)
- **Acceptance criteria:**
  - PR pipeline runs lint, typecheck, build; red on failure, blocks merge.
  - Migrations apply cleanly in CI from scratch.
  - Preview deployment produced per PR (or documented why deferred under BLK-AR2).

#### S0-INF-4 — Local development setup
- **Description:** One-command local bring-up (Supabase local or hosted-dev), seed script for foundation data, README "getting started" so a new dev is productive in <30 min.
- **Dependency:** S0-INF-1, S0-INF-2
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Documented steps bring up the app + DB locally.
  - Seed populates `organization` (Effitrans) + foundation roles/permissions + one admin user.
  - New-dev onboarding validated by someone other than the author.

### 2. Database Foundation

#### S0-DB-1 — tenant_id strategy & convention
- **Description:** Document and enforce the tenancy convention (every business table will carry `tenant_id`; a `current_tenant()` resolution approach for RLS) per DEC-C01. No business tables created — this establishes the **pattern + helper** only.
- **Dependency:** none
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Written convention: column name, type, FK to `organization`, NOT NULL rule, indexing guidance.
  - Tenant-resolution helper approach defined (how the current tenant is set per request/session).
  - Lint/PR checklist item added: "new business table must include tenant_id + RLS."

#### S0-DB-2 — organization table + migration baseline
- **Description:** Create the `organization` (tenant root) table and seed Effitrans as row 1. This is foundation, **not** business domain. Establishes the first migration.
- **Dependency:** S0-DB-1, S0-DB-4
- **Estimate:** 0.5 day (1 pt)
- **Acceptance criteria:**
  - `organization` table exists with the columns in [database-design.md §3.1](database-design.md).
  - Effitrans seeded as the single tenant.
  - Created via the migration pipeline (not manual SQL in console).

#### S0-DB-3 — audit_log table (structure only)
- **Description:** Create the append-only `audit_log` table per [database-design.md §3.9](database-design.md) (actor, action, entity, before/after, override_reason, occurred_at, tenant_id). Structure + constraints only; write path is S0-AUD-1.
- **Dependency:** S0-DB-1, S0-DB-2
- **Estimate:** 0.5 day (1 pt)
- **Acceptance criteria:**
  - Table exists with the documented columns.
  - No UPDATE/DELETE permitted (append-only enforced at the policy/grant level).
  - jsonb before/after fields present.

#### S0-DB-4 — Migration strategy & tooling
- **Description:** Choose and wire the migration tool (per DEC: Prisma or Supabase migrations), establish naming/versioning, forward-only convention, and how migrations run in local/CI/prod. No business schema.
- **Dependency:** S0-INF-1
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Migration tool committed and documented; one baseline migration exists.
  - Reproducible: drop + re-migrate yields identical schema.
  - Rollback/forward policy documented.

### 3. Authentication Foundation

#### S0-AUTH-1 — Supabase Auth integration
- **Description:** Wire Supabase Auth into the Next.js app (login/logout, server-side session). Email/password baseline; SSO/MFA decision deferred (DEC-B16, BLK-DB1/AR3) — build so MFA can be enabled without rework.
- **Dependency:** S0-INF-1, S0-INF-2
- **Estimate:** 1.5 days (3 pts)
- **Acceptance criteria:**
  - A user can log in and log out; invalid credentials rejected.
  - Session validated **server-side** on protected routes.
  - MFA/SSO not implemented but not architecturally precluded (documented).

#### S0-AUTH-2 — User profile model (app_user)
- **Description:** Create `app_user` (tenant_id, email, name, status, is_system_admin) linked to the Supabase Auth identity per [database-design.md §3.1](database-design.md). Decision on 1:1 vs HR-sync is DEC-B16/BLK-DB1 → default 1:1 with Auth.
- **Dependency:** S0-AUTH-1, S0-DB-2
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Each authenticated identity maps to exactly one `app_user` in the Effitrans tenant.
  - Profile fields editable by an admin; `status` can deactivate a user (login blocked).
  - `is_system_admin` single-holder rule respected (DEC-B12).

#### S0-AUTH-3 — Session handling & route protection
- **Description:** Centralize session retrieval + a server-side guard that resolves the current user, tenant, and roles for every protected request; unauthenticated → redirect to login.
- **Dependency:** S0-AUTH-1, S0-AUTH-2, S0-AUTHZ-2
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Protected routes/actions reject unauthenticated requests server-side.
  - Current user + tenant + roles available to server handlers via one helper.
  - Tenant context set so RLS policies (S0-RLS-1) receive the correct tenant.

### 4. Authorization Foundation

#### S0-AUTHZ-1 — Roles & permissions model + seed (provisional)
- **Description:** Create `role`, `permission`, `role_permission` tables and seed the 13–15 roles + the module×action×scope permissions from [rbac-matrix.md](rbac-matrix.md). Seed is **provisional** pending BLK-RB1 (role-name confirmation) — values are the documented defaults, not hardcoded logic.
- **Dependency:** S0-DB-2
- **Estimate:** 2 days (4 pts)
- **Acceptance criteria:**
  - Roles + permissions seeded from the matrix; re-runnable seed.
  - Permission = (module, action, data_scope) as defined.
  - A note flags the seed provisional until DEC-B11/BLK-RB1 is Approved.

#### S0-AUTHZ-2 — user_role mapping + permission resolution
- **Description:** Create `user_role` (M:N) and implement permission resolution = **union** of a user's roles' permissions (DEC-B13). Provide a server-side `can(user, module, action, scope)` check.
- **Dependency:** S0-AUTHZ-1, S0-AUTH-2
- **Estimate:** 1.5 days (3 pts)
- **Acceptance criteria:**
  - A user can hold multiple roles; effective permissions = union.
  - `can(...)` check available to all server handlers; denies by default.
  - Unit-level coverage for representative role combinations (e.g. Declarant vs Account Manager vs Admin).

#### S0-AUTHZ-3 — Admin governance scaffolding
- **Description:** Enforce the governance rules from [rbac-matrix.md §5](rbac-matrix.md): single System Admin + break-glass backup (DEC-B12/BLK-RB2), no shared accounts, override actions flagged for audit. UI is the existing `/users` + `/settings` shells.
- **Dependency:** S0-AUTHZ-2, S0-AUD-1
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Exactly one `is_system_admin` enforced; assigning a second is blocked or warns.
  - Admin/override actions route through the audit log with a reason.
  - No generic/shared login exists.

### 5. RLS Foundation

#### S0-RLS-1 — Tenant-isolation baseline policies
- **Description:** Enable RLS and apply the tenant-isolation policy pattern (`tenant_id = current_tenant()`) to every foundation table (`organization` scoping, `app_user`, `audit_log`, RBAC tables). Establish the reusable policy template for S2+ business tables.
- **Dependency:** S0-DB-2, S0-DB-3, S0-AUTHZ-1, S0-AUTH-3
- **Estimate:** 2 days (4 pts)
- **Acceptance criteria:**
  - RLS enabled on all foundation tables (no table left open).
  - A user in tenant A cannot read/write tenant B rows (proven by test with a second seeded tenant, then removed).
  - Reusable policy template + docs so every future table inherits the pattern.

#### S0-RLS-2 — Role-scope policy hooks (foundation only)
- **Description:** Establish the **mechanism** for role-based row scoping (own/team/client/all from [rbac-matrix.md §4](rbac-matrix.md)) as helper functions/policies, validated on the foundation tables. Business-table scoping happens in S2+ — this proves the approach.
- **Dependency:** S0-RLS-1, S0-AUTHZ-2
- **Estimate:** 1.5 days (3 pts)
- **Acceptance criteria:**
  - Helper(s) exist to express own/team/client/all scoping in policies.
  - Demonstrated on `app_user`/`audit_log` visibility (e.g. non-admin can't list all users; admin/CEO can).
  - Documented so S2 can apply scopes to `operational_file` without reinventing.

### 6. Audit Foundation

#### S0-AUD-1 — Append-only audit logging write path
- **Description:** Implement the server-side audit-write helper invoked on every privileged/state-changing action: records actor, action, entity, before/after, tenant, timestamp. Append-only (no update/delete).
- **Dependency:** S0-DB-3, S0-AUTH-3
- **Estimate:** 1.5 days (3 pts)
- **Acceptance criteria:**
  - One helper writes audit entries; used by auth/role/admin actions in this sprint.
  - Entries immutable (attempted update/delete rejected).
  - Before/after captured for changes; reason captured for overrides.

#### S0-AUD-2 — Actor & override tracking + minimal audit view
- **Description:** Ensure every audit entry carries a resolved actor (never anonymous for privileged actions) and override reason where applicable; add a read-only audit view (reuse `/settings` or `/users`) for admins/compliance.
- **Dependency:** S0-AUD-1, S0-AUTHZ-2
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - No privileged action writes an audit row without a resolved actor.
  - Overrides include a mandatory reason.
  - Admin/Compliance can view (not edit) the audit log, tenant-scoped.

### 7. Existing UI Assessment

#### S0-UI-1 — Reuse vs throwaway inventory
- **Description:** Assess the existing mock-UI pages and `lib/*.ts` mock data against the Phase-1 module map ([architecture.md §5](architecture.md)); classify each as **Keep & wire**, **Refactor**, or **Throwaway**. Produce a short report (table) — no code changes.
- **Dependency:** none
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Every existing route classified with a one-line rationale.
  - `lib/*.ts` mock files marked as "typing/seed reference" vs "discard."
  - Report committed (e.g. appended here or `docs/ui-assessment.md`).
- **Provisional classification (to validate in the task):**
  | Route / asset | Provisional verdict | Rationale |
  |---|---|---|
  | `/users`, `/settings` | **Keep & wire** | Host this sprint's RBAC/admin/audit UI |
  | `/dashboard` | Keep (rewire later) | Becomes Tier-1 dashboards in S10 |
  | `/shipments`, `/customs`, `/documents`, `/customers`, `/tasks` | Keep shell, rewire S2+ | Map to business modules; no logic yet |
  | `/finance`, `/reports` | Keep as placeholder | Finance = P2; reports = S10 |
  | `lib/*.ts` (mock data) | Typing/seed reference | Inform schema; not runtime data |

#### S0-UI-2 — Auth/session shell into the app frame
- **Description:** Wire login state into the existing app shell (header/sidebar): show current user, role, logout; hide nav items the user can't access (cosmetic only — real enforcement is server-side S0-AUTHZ-2/RLS).
- **Dependency:** S0-AUTH-3, S0-AUTHZ-2
- **Estimate:** 1 day (2 pts)
- **Acceptance criteria:**
  - Logged-in user + role visible in the shell; logout works.
  - Nav items the user lacks permission for are hidden (UI nicety, not the security boundary).
  - No business pages activated.

---

## Estimate roll-up

| Section | Tasks | Days |
|---|---|---|
| 1. Infrastructure | INF-1..4 | 4.0 |
| 2. Database Foundation | DB-1..4 | 3.0 |
| 3. Authentication | AUTH-1..3 | 3.5 |
| 4. Authorization | AUTHZ-1..3 | 4.5 |
| 5. RLS | RLS-1..2 | 3.5 |
| 6. Audit | AUD-1..2 | 2.5 |
| 7. UI Assessment | UI-1..2 | 2.0 |
| **Total** | **20 tasks** | **~23 days** |

≈ one 2-week sprint for 2 engineers including review/buffer.

---

## Risks

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RS0-1 | BLK-9 closes with an **on-prem/regional** mandate, invalidating the provisional Supabase region | Medium | Medium | Region is provisional (AR-1); teardown/recreate documented (S0-INF-1); no data of value yet |
| RS0-2 | Role/permission seed (AUTHZ-1) **diverges** from real roles once BLK-RB1 closes | Medium | Low | Seed is data, re-runnable; flagged provisional; no logic hardcoded to role names |
| RS0-3 | **RLS misconfiguration** leaves a table open or over-restricts | Medium | High | RLS-1 proves isolation with a second test tenant; template + PR checklist; security review before S2 |
| RS0-4 | **Scope creep** into business schema/workflow (violating the guardrail) | Medium | Medium | Guardrail table at top; PR reviewers reject any business-domain table this sprint |
| RS0-5 | Supabase **not accepted** by Effitrans IT (BLK-AR1) after work starts | Low/Med | High | Confirm BLK-AR1 in the management workshop **before INF-1**; Postgres-portable choices keep exit cheap |
| RS0-6 | **Single-admin** key-person risk realized during setup | Low | Medium | Break-glass backup admin defined in AUTHZ-3 (DEC-B12) |
| RS0-7 | CI/deploy target undecided (BLK-AR2) delays INF-3 | Low | Low | Default to Vercel preview; document if deferred; not on critical path |

---

## Definition of Done (Sprint S0)

The sprint is done when **all** hold:

- [ ] Supabase project live; CI runs lint/typecheck/build/migrations on every PR; a new dev can bring the app up locally from the README in <30 min.
- [ ] Migration pipeline is the **only** way schema changes land; drop + re-migrate reproduces the schema exactly.
- [ ] `organization` seeded (Effitrans = tenant 1); `audit_log` table append-only.
- [ ] A user can **log in/out**; sessions validated server-side; deactivated users blocked.
- [ ] `role` / `permission` / `user_role` seeded from [rbac-matrix.md](rbac-matrix.md) (flagged provisional); `can(...)` resolves the **union** of a user's roles and **denies by default**.
- [ ] Single System Admin + break-glass backup enforced; no shared accounts.
- [ ] **RLS enabled on every foundation table**; a second test tenant cannot see Effitrans rows (proven, then removed); reusable tenant + role-scope policy templates documented for S2+.
- [ ] Every privileged action this sprint writes an **immutable, actor-attributed** audit entry; admins/compliance can view (not edit) it.
- [ ] Existing UI **assessed and classified** (keep/refactor/throwaway); auth/session shell wired into the app frame.
- [ ] **No business schema, no workflow engine, no document catalog, no customs code exists.**
- [ ] None of BLK-1, BLK-3, BLK-6, BLK-9 was depended upon; any provisional default used is recorded in [decision-register.md](decision-register.md) and [s0-readiness-checklist.md](s0-readiness-checklist.md).
- [ ] A short security review confirms the RLS/RBAC boundary before S2 is authorized.
