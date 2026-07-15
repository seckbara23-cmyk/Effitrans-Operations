# Phase 6.0F — Acceptance Report

Release-readiness evidence for the multi-tenant platform. No secrets, setup links, tokens,
or passwords appear in this document.

## Environment
- **Code / CI**: GitHub `main`, GitHub Actions (`build` + `rls-tests` jobs). RLS tests run
  against a real local Supabase (Postgres) via `supabase start` + `db reset`.
- **Live provisioning run**: requires operator-held **staging** credentials (Supabase URL +
  service-role key + email provider). Those are **not** present in the build/CI environment,
  so the live wizard run is an **operator step** (procedure below). This report proves the
  *architecture* and the *isolation*; it makes no synthetic production claim.

## Tenants
| | Tenant A | Tenant B |
|---|---|---|
| Role | Seeded baseline (`00000000-…-000000000001`) | Acceptance tenant |
| Display name | Effitrans (seed) | **Effitrans Acceptance Tenant B** |
| Slug (suggested) | effitrans | **effitrans-acceptance-2** |
| Purpose | Existing seed data (rich) | Second-tenant provisioning + isolation |

## Provisioning evidence
- Engine: `provision_tenant` RPC (`SECURITY DEFINER`, platform-gated) — one key, idempotent
  retry, transactional (no partial rows). Proven by `supabase/tests/rls_provision_tenant_test.sql`
  ("privilege + provision + isolation + idempotency + slug guard PASS" in CI).
- Wizard: `/platform/companies/new` (7 steps, client-held draft, single submit). 6.0B.
- Operator live-run steps: see the runbook *Provision a tenant*; expected evidence = tenant
  visible in `/platform/companies`, roles/branding/rollout/admin rows created, provisioning
  audit event, honest invitation outcome (email_sent vs link_returned).

## Bidirectional isolation evidence
`supabase/tests/rls_multitenant_acceptance_test.sql` — **PASS in CI** (real Postgres):
- **A→B**: A cannot read B's organization/app_user/audit; A reads its own; UPDATEs of B's
  rows are prevented (no write grant / RLS).
- **B→A**: B cannot read A's organization/app_user/role/user_role/audit; B reads its own;
  UPDATEs of A's rows are prevented.
- Both read **and** write isolation proven, both directions. Per-domain tables
  (finance/customs/transport/document/communication/portal) proven by their own RLS suites.

## Role & identity evidence
- Roles materialize from the registry via the provisioning RPC; permissions come from the
  fixed role→permission map. No tenant role grants a platform permission
  (`tests/platform-roles.test.ts`, `tests/threat-scenarios.test.ts`).
- Identity routing (`tests/identity-priority.test.ts`, `tests/tenant-acceptance.test.ts`):
  SYSTEM_ADMIN+DRIVER → `/dashboard`; driver-only → `/driver`; courier-only narrow;
  multi-role deterministic; suspended narrow identities denied.

## Lifecycle evidence
- `tests/tenant-lifecycle.test.ts`, `tests/tenant-session-revocation.test.ts`,
  `supabase/tests/rls_tenant_lifecycle_test.sql`. Suspend/reactivate/archive act per-tenant;
  next-request blocking + GoTrue bans; partial revocation never rolls back; archive preserves
  data; invalid transitions rejected (compare-and-set).

## Invitation & user evidence
- `tests/tenant-invitations.test.ts`, `tests/user-creation.test.ts`. Honest email vs link;
  one-time link never stored/logged/audited; cancel = deactivate (enforced); duplicate →
  `email_conflict`; orphan auth-user healing; cross-tenant creation impossible.

## Branding & onboarding evidence
- `tests/tenant-branding-edit.test.ts`, `tests/tenant-onboarding.test.ts`,
  `tests/tenant-acceptance.test.ts`. Branding persists to one source, rejects HTML, preserves
  logo fields, audits field names only; onboarding derives per-tenant facts with no cross-leak.

## Platform Copilot evidence
- `tests/platform-copilot.test.ts`. Read-only, `platform:copilot:read`-gated (anon/tenant
  rejected), allowlisted aggregate context (no PII/secrets/business data), reuses the shared
  provider-neutral engine (no direct provider call), safe-metadata audit, non-overridable
  guardrail prompt. Data allowlist: lifecycle, plan, trial, onboarding, rollout, branding,
  activity, invitations, health.

## Client-bundle evidence
- No `getAdminSupabaseClient` / `service_role` / provider SDK / server-only import in client
  components (structural per-component + `next build` RSC boundary). Copilot panel, branding
  editor, invitation and lifecycle controls all call server actions/routes only.

## CI & test evidence
- **1,707 tests / 106 files / 0 skipped**, typecheck clean, `next build` clean.
- CI: `build` green; `rls-tests` green (incl. the new bidirectional acceptance test).

## Unresolved limitations (deferred beyond 6.0F)
- Live wizard provisioning against staging = operator step (no staging creds in CI).
- Approved public logo/favicon storage.
- Trial-expiry materialization; payment-webhook lifecycle gating; billing/grace/subscription.
- True per-user refresh-token deletion (if Supabase exposes a supported API).
- Tenant impersonation; autonomous Copilot actions — intentionally never.

## Recommendation
Proceed with a **controlled production rollout** of the platform-admin + provisioning +
lifecycle + branding/invitation + read-only Copilot surfaces. The deferred items are additive
and do not block rollout. Execute the operator live-provisioning run against staging to
capture the final end-to-end evidence before onboarding the first external customer.
