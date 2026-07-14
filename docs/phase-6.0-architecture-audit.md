# Phase 6.0 — Multi-Tenant Provisioning & Onboarding: Architecture Audit & Plan

Status: **PROPOSED — awaiting approval. No implementation has begun.**

---

## 1. What already exists (reuse, do not rebuild)

The audit found far more standing capability than the brief assumes. Phase 4.0B built
most of the contracts; what is missing is almost entirely the **engine and the UI**.

| Capability | Where | State |
|---|---|---|
| Provisioning contract | `lib/platform/provisioning/contract.ts` + `validate.ts` | **Contract only.** `ProvisionTenantInput/Result`, `validateSlug`, `RESERVED_SLUGS`, and — notably — `redactProvisionResult()` which already strips a temporary password from results. No engine behind it. |
| Role template engine | `lib/platform/role-templates.ts` | **Canonical and complete.** 23 tenant roles with full permission sets, `requiredForEveryTenant`, business-profile filtering. `tests/role-templates.test.ts` proves templates ≡ seed.sql, so templates are the source of truth a provisioner can materialize from. |
| Entitlements | `lib/platform/entitlements.ts` | Contract only (by design, 4.0B-2): `PLAN_KEYS`, `PLAN_MODULE_DEFAULTS`, `resolveTenantModules`. No persistence beyond `organization.plan_key`. |
| Company metadata | `organization` columns (4.0B) | `legal_name, trade_name, slug (unique, lower-indexed), lifecycle_status, product_profile, locale, currency, timezone, plan_key, trial_started_at, trial_ends_at, onboarding_status, branding_complete`. |
| Tenant branding | `tenant_branding` + `lib/branding/{service,resolve,types}` | Read/merge path complete (`resolveTenantBranding`, `mergeBranding`). **No write action.** |
| Rollout | `tenant_process_rollout` + `/platform/rollout` + `setTenantRollout` | Complete, audited, tested (5.0E-2A…-4B). |
| Staff user creation | `lib/users/actions.ts` `createUser` | Complete: `auth.admin.createUser` → `app_user` → `user_role` (tenant-validated) → audit → optional welcome email. |
| Password-setup links | `lib/users/welcome.ts` + `generateLink({type:"recovery"})` | Exactly D4's requirement, already the house rule: *"a plaintext credential never travels by email."* |
| Email | `lib/comms/provider.ts` (Resend, dark by default) + queue + templates + outbox | Complete. **No-op without env config** — a design fact the wizard must handle. |
| Numbering | `next_file_number` / `next_invoice_number` RPCs | **Lazily self-initializing** — the function inserts the per-tenant counter row on first use. Provisioning must NOT pre-create counters; that would duplicate the init logic. |
| Audit | `audit_log` + `writeAudit` + `platform_actor_id` | Complete. |
| Platform RBAC | `platform:companies:create/update`, `platform:status:update`, `platform:rollout:manage` | Already defined; SUPER_ADMIN holds all. |
| Companies console | `/platform/companies` (53 lines), `/platform/companies/[id]` (55 lines) | Read-only stubs over `listCompanies`/`getCompany`. |
| Multi-tenant isolation | 31 RLS suites, most with Tenant-B fixtures | Already proven at the RLS layer; D15 is an acceptance *run*, not a build. |
| Transaction idiom | `.rpc()` + migration-installed SQL functions | The codebase already ships Postgres functions for atomicity (`next_file_number`). |

## 2. The two architectural decisions that shape everything

### 2.1 The transaction boundary (D3)

Supabase JS **cannot execute multi-statement transactions** — this repo's whole CAS
idiom exists because of that. The only way to get "no partial tenants" is a Postgres
function installed by migration and called via RPC.

But one step can never live inside that transaction: `auth.admin.createUser` is a GoTrue
**API call**, not SQL. So `provisionTenant()` must be a two-stage protocol with
compensation — a pattern this codebase already uses (`lib/auth/oauth.ts` and
`lib/portal/admin-actions.ts` both delete the auth user on downstream failure):

```
Stage 1  (auth API)   create-or-reuse the administrator's auth.users row
Stage 2  (ONE txn)    provision_tenant(...) — SECURITY DEFINER SQL function:
                        organization → tenant_branding → roles (from templates,
                        passed as jsonb) → role_permission → rollout row (all
                        false) → app_user → user_role → audit rows
Failure of stage 2 →  if stage 1 CREATED the user, delete it. If it reused an
                        existing user, leave it. Nothing else exists to clean up.
```

- **Idempotency** keys on the slug (unique lower-index already exists). Re-running with
  a slug that exists returns `already_provisioned` with the tenant id — never a
  duplicate, never a partial repair.
- **Role templates stay canonical in TypeScript.** The action serializes
  `TENANT_ROLE_TEMPLATES` to jsonb and passes it in; the SQL function materializes rows.
  No second copy of the role catalog in SQL.
- **Security:** the function is `SECURITY DEFINER`, `REVOKE ... FROM authenticated, anon`,
  executable by `service_role` only, and the calling server action is gated on
  `platform:companies:create`. A tenant user can never reach it.

### 2.2 Lifecycle enforcement is a genuine gap (D8)

`lifecycle_status` exists with `TRIAL/ACTIVE/SUSPENDED/ARCHIVED` — but **nothing
enforces it**. `isTenantOperable()` is a pure helper nobody calls. Today, suspending a
tenant blocks nothing. Also `CANCELLED` is absent from the check constraint.

Fix: widen the constraint (additive migration), then enforce in exactly one place —
`getCurrentUser()` — which every staff guard already flows through and which is
request-memoized, so the cost is one extra column on a read that already happens.
Suspended ⇒ staff and portal sessions resolve to a "tenant suspended" state (block
access, preserve data, never delete). Platform admins are unaffected by construction
(separate stack).

## 3. Gaps to build (the actual Phase 6.0 work)

1. **`provision_tenant()` SQL function + engine action** (§2.1) — D3, D9
2. **New Company Wizard** `/platform/companies/new` — D2, D17 (no draft table; draft
   lives in client state, review step renders the full input)
3. **First-admin invitation** — compose existing `createUser` mechanics + recovery link
   + `staff_welcome` template. **When email is dark (no Resend env), the wizard must
   display the one-time setup link to the platform admin** — otherwise "invitation sent"
   silently sends nothing. D4, D11
4. **Companies dashboard aggregates** — users/dossiers/last-activity per company in
   ≤4 grouped queries total (not per-company). D1
5. **Company detail tabs** — Overview/Branding/Subscription/Users/Rollout/Audit/Health.
   The Rollout tab embeds the existing `RolloutControls`. D5
6. **Branding write action** (platform-side, audited) + preview using the existing
   `mergeBranding`. D6
7. **Subscription lifecycle actions** — trial/renew/expire/suspend/reactivate as audited
   platform actions; trial expiry **derived at read time** (no cron exists). D7, D8
8. **Onboarding checklist + health — derived, never stored** (same doctrine as queues
   and aging): branding_complete, admin active, users>1, rollout row, comms configured,
   first client, first dossier. `onboarding_status` column updates as a rollup. D10, D12
9. **Invitation tracking without a new table** — derive pending/accepted from
   `auth.users.last_sign_in_at` + `app_user.status`; resend = regenerate link; cancel =
   deactivate. D11
10. **Platform AI awareness** — platform-admin-only copilot context built from
    organization metadata + health/rollout aggregates; never tenant operational data. D16

## 4. Proposed sub-phases

| Sub-phase | Delivers | Contents | Risk |
|---|---|---|---|
| **6.0A** | D3, D4, D9 | Migration (`provision_tenant` fn + `CANCELLED` in lifecycle check), engine action + compensation, first-admin invite, RLS suite for the function's access, unit tests | **High** — the transaction protocol; everything else stands on it |
| **6.0B** | D2, D17 | The wizard (7 steps, client-held draft, validation via existing `validateProvisionInput`), confirmation page, dark-email setup-link fallback | Medium — UI-heavy |
| **6.0C** | D1, D5 | Companies dashboard (bounded aggregates, search/filter/pagination), company detail tabs reusing existing reads + `RolloutControls` | Low |
| **6.0D** | D7, D8 | Lifecycle actions + **enforcement in `getCurrentUser`** + trial derivation; suspension UX for tenant users | **High** — touches every authenticated request; must not break static prerender or lock out remediation |
| **6.0E** | D6, D10, D11, D12 | Branding editor + preview, derived onboarding checklist, derived health, invitations panel | Low-medium |
| **6.0F** | D15, D16, D13/D14 verification | Second-tenant acceptance run through the wizard, platform copilot context, cross-cutting audit/security review, acceptance report | Medium |

D13 (audit) and D14 (security) are **cross-cutting invariants** enforced in every
sub-phase, not phases of their own.

## 5. Risks and dependencies

- **Stage-1/stage-2 seam** (worst failure = orphan auth user; compensated, and idempotent
  retry heals it). Mitigated by the existing deleteUser pattern + slug idempotency.
- **Lifecycle guard on the hot path** — one extra column via the already-cached
  `getCurrentUser`; must keep the flag-off/static-prerender guarantees (`/login` stays
  static because the layout still checks the kill switch before any session work).
- **`provision_tenant` privileges** — if `authenticated` can execute it, any tenant user
  can mint tenants. REVOKE + RLS suite proving the refusal.
- **Email dark-by-default** — "invitation sent" must be honest; surface the link.
- **Clean-replay rule** — the migration adds a function + constraint; no tenant-scoped
  literal inserts. Safe by construction, verified by `migration-clean-replay.test.ts`.
- **Platform reads cross tenants by design** — keep them in `lib/platform/*` where the
  tenant-scope guard already tolerates platform files; never import them into tenant code.
- **No payment gateway** (D7 explicitly) — plan/trial are metadata; nothing bills.

## 6. What I recommend NOT doing

- **No draft-persistence table** for the wizard (D17 "save draft") — client-side state +
  a review step covers the 5-minute flow; a half-provisioned-tenant table is a new
  consistency liability. If durable drafts are required, say so and 6.0B adds one.
- **No invitation table** — derivable state; a table would be a second source of truth.
- **No per-tenant email config in 6.0** — comms provider is deployment-wide today;
  per-tenant senders are a separate project.
- **No payment integration** — per the brief.
