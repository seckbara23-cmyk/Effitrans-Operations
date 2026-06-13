# S0 → S2 Security Review

> **Governance Notice**
>
> This document is derived from decisions recorded in [`docs/decision-register.md`](decision-register.md).
> The Decision Register is the authoritative source for all decisions; in case of conflict it takes precedence.

**Purpose.** The gate review mandated by the [S0 backlog Definition of Done](s0-backlog.md#5-definition-of-done): confirm the RLS/RBAC/audit boundary before any business-domain (S2) work begins.
**Scope reviewed.** Foundation only — Waves 0–4 (commits `51080cf`, `332bcda`, `7ce6f3e`, `8e17d0f`, `15a810b`). No business tables exist yet.
**Date.** 2026-06-13 · **Result.** ✅ **PASS** (with conditions for S2, §5).

Related: [architecture.md](architecture.md) · [database-design.md](database-design.md) · [rbac-matrix.md](rbac-matrix.md) · [s0-backlog.md](s0-backlog.md) · [s0-readiness-checklist.md](s0-readiness-checklist.md)

---

## 1. Method
Static review of the three foundation migrations, the Supabase client/auth/RBAC/audit modules, the UI shell, and the CI/secret handling — plus the **two live validations** run against the linked Supabase DB:

| Validation | Result | Evidence |
|---|---|---|
| RLS-1 tenant isolation | ✅ `0 / 1 / 1 / 0` | tenant A cannot read tenant B `organization`/`app_user`; sees its own |
| RLS-2 role-scope | ✅ `admin=1 / plain=0` | `audit:read:all` holder sees audit rows; non-holder denied |
| RLS-1 regression (post RLS-2 refactor) | ✅ `0 / 1 / 1 / 0` | policy refactor did not weaken isolation |

---

## 2. Control assessment

| # | Control | Status | Evidence / notes |
|---|---|---|---|
| C1 | **Tenant isolation** (RLS) | ✅ PASS | RLS enabled on every foundation table; policies key off `auth_tenant_id()`/`auth.uid()`; validated live (`0/1/1/0`). |
| C2 | **Role-scoped reads** | ✅ PASS | `audit_log` requires tenant **and** `has_permission('audit:read:all')`; validated (`1/0`). Reusable `has_permission`/`has_role`/`auth_tenant_id` helpers. |
| C3 | **Deny-by-default** | ✅ PASS | RLS on with **no write policies** → anon/authenticated cannot INSERT/UPDATE/DELETE foundation tables; permission resolution returns only granted codes. |
| C4 | **Append-only audit** | ✅ PASS | `audit_log` has `BEFORE UPDATE/DELETE` triggers (`prevent_mutation`) that raise for **all** roles incl. service role; write helper is insert-only. Confirmed: cleanup cannot delete the test audit row. |
| C5 | **Service-role containment** | ✅ PASS | `lib/supabase/admin.ts` carries `import "server-only"`; grep confirms **no** `"use client"` file imports admin/server-only/server-client/`getServerEnv`/`SERVICE_ROLE`. Build would fail otherwise. |
| C6 | **Secret handling** | ✅ PASS | `.env` and `.env.*` git-ignored (`!.env.example`); only `.env.example` tracked; verified a live `.env` is ignored. No keys in `config.toml` or `test:rls` script. |
| C7 | **Audit viewer uses user-context client** | ✅ PASS | `lib/audit/read.ts` uses `getServerSupabaseClient` (RLS), not the admin client → only `audit:read:all` holders see rows. |
| C8 | **user_role tenant integrity** | ✅ PASS | `enforce_user_role_tenant` trigger rejects a `user_role` whose tenant ≠ both the user's and the role's tenant. |
| C9 | **Single-admin governance** | ✅ PASS (mechanism) | Partial unique index `uq_app_user_single_admin` enforces ≤1 `is_system_admin` per tenant (DEC-B12). *Named admin still to be assigned — BLK-RB2.* |
| C10 | **Auth & session** | ✅ PASS | Supabase Auth; middleware refreshes session (no business redirects); `requireUser()` guard; helper functions `SECURITY INVOKER` (no privilege escalation). |
| C11 | **Login hardening (basics)** | ✅ PASS (baseline) | Email/password only; **generic** error (no account enumeration); browser client uses **anon key only**; logout clears session. |
| C12 | **Nav filtering is cosmetic** | ✅ PASS | Sidebar filtering documented as UX-only; server/RLS remain authoritative; no business pages activated. |
| C13 | **No business surface leaked** | ✅ PASS | No operational/document/customs/workflow/transport/notification tables, file numbering, or expiry code exists. |

**No critical or high findings.** All foundation security controls pass.

---

## 3. Findings & gaps (none block S0; see §4 for when to fix)

| ID | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | **No RLS write policies** — all writes go via the service role. Fine now (no user-initiated writes), but every S2 business table will need explicit INSERT/UPDATE/DELETE policies. | Info → **S2 design** | Carry into S2 as a mandatory pattern. |
| F2 | **Provisional RBAC** — roles/permissions seeded `is_provisional=true` (BLK-RB1); no named System Admin assigned (BLK-RB2). | Medium | Reconcile when workshops close BLK-RB1/RB2; assign + audit the admin. |
| F3 | **Login lacks rate-limiting / lockout / password policy / MFA.** Supabase provides some defaults; none enforced by us. | Medium | **Before production / external users.** MFA for admins/external per AR-6. |
| F4 | **RLS tests are manual** (SQL Editor / psql), not in CI. | Medium | Add an RLS test job (boot local Supabase) to CI before S2 merges land, so isolation can't silently regress. |
| F5 | **DB types not generated** — `current-user.ts`/`permissions.ts`/`read.ts` use `as` casts. | Low | `npm run db:types` once linked; tighten casts. Type-safety, not a vuln. |
| F6 | **Next.js / postcss advisories** (major-upgrade fix). | Low (pre-prod) | Planned Next 14→16 upgrade before go-live; do not `audit fix --force` now. |
| F7 | **Audit `actor_id` nullable** to allow `system.*` events; write helper enforces actor for non-system actions. | Info | Acceptable by design; helper is the chokepoint. |
| F8 | **Storage RLS not yet defined** (documents land in S2/S5). | Info → **S2 design** | Supabase Storage bucket policies must be authored when documents arrive. |
| F9 | **`/login` is the only protected entry wired**; `requireUser()` used only on the audit page. | Info | Expected — business pages adopt guards in S2. |

---

## 4. When each gap must be addressed

| Before S2 starts | Before production / external exposure | Carry into S2 design |
|---|---|---|
| F4 (RLS tests in CI) — recommended | F3 (rate-limit/lockout/MFA/password policy) | F1 (write policies per table) |
| F5 (generate DB types) — recommended | F6 (Next.js upgrade) | F8 (Storage RLS) |
| F2 (reconcile RBAC) ties to BLK-RB1/RB2 | F2 (assign named admin) | |

---

## 5. Verdict & authorization

**✅ The S0 foundation security boundary is sound. The S0 → S2 security gate is PASSED.**

The platform has, and has *proven*: tenant isolation, role-scoped access, deny-by-default writes, append-only auditing, service-role containment, and clean secret handling. No control failed; no critical/high finding exists.

### May S2 begin once BLK-1, BLK-3, BLK-6, BLK-9 are resolved?
**Yes — conditionally.** S2 (Operational File + business modules) **may begin once all four 🔴 business blockers are `Approved` in the [decision register](decision-register.md)**. No further *foundation* work is required. The four blockers are business decisions (integration approach, document catalog/expiry rules, file-numbering scheme, hosting region), not security or engineering gaps.

**Binding conditions carried into S2 (from §3/§4):**
1. **Every business table** must ship in the same migration as its `tenant_id` + RLS policies, reusing the RLS-2 helper template (`auth_tenant_id`, `has_permission`, `has_role`). No table merges without them — enforced in review (F1).
2. **Add write policies** (INSERT/UPDATE/DELETE) per business table — the foundation deliberately has none (F1).
3. **Author Storage RLS** when documents arrive (F8).
4. **Recommended before the first S2 merge:** RLS tests in CI (F4) and generated DB types (F5).
5. **Reconcile provisional RBAC** (BLK-RB1) and assign the named System Admin (BLK-RB2) — tracked with the workshops (F2).
6. **Pre-production** (not pre-S2): login hardening/MFA (F3) and the Next.js upgrade (F6).

**S2 remains blocked solely by the four 🔴 business blockers — not by anything in this review.**

---

## Sign-off
| Role | Decision | Date |
|---|---|---|
| Security review (foundation) | ✅ PASS — authorize S2 on BLK-1/3/6/9 closure, conditions §5 | 2026-06-13 |
| Project sponsor | ______ | ______ |
| IT / Dev lead | ______ | ______ |
