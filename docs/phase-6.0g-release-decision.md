# Phase 6.0G — Release Decision

**Release candidate:** `65240a8` (origin/main) · CI green (`build` + `rls-tests`) · 1,707
tests / 0 skipped · bidirectional tenant isolation proven against real Postgres.

## Decision: **CONDITIONAL GO**

Conditioned on the operator executing the staging acceptance harness
(`docs/phase-6.0g-staging-acceptance.md`) with staging credentials and recording PASS on
every ⏳ live step. That run is the last remaining gate; it could not be executed from the
engineering environment (no reachable staging deployment — no Vercel link, Supabase admin
access unauthorized, `.env.local` has AI keys only), and fabricating its evidence is
explicitly out of scope.

Why not **GO**: the DoD's GO criteria ("provisioning succeeds end to end", "administrator
setup succeeds", "invitation outcomes honest in situ", …) require the live browser+Supabase
run to have actually happened. It has not. Claiming GO would be a synthetic production claim.

Why not **NO-GO**: none of the NO-GO triggers is present. No cross-tenant exposure, no
unauthorized platform action, no service-role exposure, no password/setup-link persistence,
no lifecycle bypass, no duplicate-tenant path, no identity mis-routing, no unsafe Copilot
context, no missing critical audit — each is verified at the code/CI level and by the
real-Postgres RLS suite. The only open item is a **bounded operational task** (execute the
run), which has an owner (operator), a mitigation (the provided harness), and a deadline
(before onboarding the first external customer). That is the definition of CONDITIONAL GO.

## Rationale (evidence already in hand at `65240a8`)
- **Isolation** — `supabase/tests/rls_multitenant_acceptance_test.sql` proves A↔B read *and*
  write isolation across org/app_user/role/user_role/audit against real Postgres in CI;
  per-domain tables covered by their own RLS suites.
- **Authorization** — tenant→platform boundary (`getPlatformUser` null for tenant users;
  permissions from the fixed role map), server-resolved actor/tenant, no client override.
- **Identity** — DRIVER never demotes SYSTEM_ADMIN; narrow identities by absence of an
  operational role; deterministic multi-role priority.
- **Lifecycle** — single enforcement point denies suspended/archived/trial-expired on the
  next request; GoTrue bans on suspend/archive; partial revocation never rolls back.
- **Sensitive data** — passwords, temp passwords, setup links, tokens never persisted /
  logged / audited / URL-borne (per-payload tests); no service-role in client bundles.
- **Copilot** — read-only, `platform:copilot:read`-gated, allowlisted aggregate context,
  non-overridable guardrail prompt, safe-metadata audit, reuses the shared engine.
- **CI** — green on the exact RC SHA.

## Condition for promotion to GO
Operator runs the harness; **all** ⏳ live steps PASS, specifically:
1. Deployed SHA equals `65240a8`.
2. Wizard provisions the staging acceptance tenant once (idempotent on retry/double-click).
3. First administrator authenticates → lands on `/dashboard` with the full sidebar.
4. Credential modes behave (no password emailed; temp password once, never persisted).
5. Live cross-tenant attempts (A↔B) return no rows / denial; no cross-tenant mutation.
6. Suspend blocks next request + new login + portals + rollout; reactivate restores;
   archive blocks all access while data remains readable to platform admins.
7. Copilot answers only from safe aggregates; tenant users denied; mutation/secret refused.
8. No setup link / temp password / secret in URL, console, bundle, logs, audit, or DB.
Any NO-GO trigger observed during the run → **flip to NO-GO**, file the defect, fix under
the 6.0G code-change rules, re-run.

## Unresolved limitations (deferred beyond 6.0G — do not block rollout)
- Live staging run pending operator execution (this condition).
- Approved public logo/favicon storage.
- Trial-expiry materialization; payment-webhook lifecycle gating; billing / grace /
  subscription enforcement.
- True per-user refresh-token deletion (pending a supported Supabase API).
- Tenant impersonation; autonomous Copilot actions — intentionally never.

## Required mitigations before first external customer
- Execute and archive the staging acceptance harness (owner: operator).
- Confirm production email provider + Auth redirect URLs + server-only service-role scoping.
- Keep `PAYMENTS_ENABLED` unset; keep rollout kill switches off until per-tenant activation.

## Approved rollout scope (upon the condition being met)
Controlled rollout of the **platform-admin** surfaces: tenant provisioning, companies
console, lifecycle operations, branding/onboarding/invitations, and the read-only Platform
Copilot — plus onboarding tenants behind their (default-off) rollout flags. Tenant
operational workflows continue under their existing per-tenant rollout gates.

## Rollback criteria
Roll back / re-gate if, in production, any of these is observed:
- any cross-tenant read or write, or a service-role artifact in a client bundle/response;
- a suspended/archived tenant reaching a protected surface, or a duplicate-tenant creation;
- a setup link / temporary password appearing in a URL, log, audit payload, or the DB;
- identity mis-routing (e.g. a SYSTEM_ADMIN sent to `/driver`);
- the Platform Copilot emitting tenant business data, PII, or a secret, or performing an action.
Rollback = redeploy the last known-good SHA and, if a tenant is implicated, **suspend** it
(bans sessions + blocks next request) while investigating.
