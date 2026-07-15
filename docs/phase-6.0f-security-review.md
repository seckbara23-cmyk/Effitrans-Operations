# Phase 6.0F — Cross-Cutting Security & Isolation Review

Reviews the completed multi-tenant platform (Phases 6.0A–6.0E + 5.0E-4 + the identity fix)
as **one integrated system**. Scope: authentication, authorization, tenant isolation,
sensitive-data handling, lifecycle, audit, client bundles, error handling, and the threat
matrix. Verified defects are fixed in the smallest safe way and noted; where a limit is a
supported-API boundary rather than a defect, it is documented, not papered over.

**Outcome: no new verified security defect found.** The architecture holds as one system.
Three previously-documented boundaries remain (all intentional, all reported): GoTrue ban
*gates* tokens rather than deleting them (6.0E-4), the payments webhook is outside lifecycle
gating (disabled in prod; billing scope), and public logo storage is deferred. Coverage was
strengthened with `tests/threat-scenarios.test.ts` and the CI-run
`supabase/tests/rls_multitenant_acceptance_test.sql` (bidirectional isolation).

---

## 1. Authentication
| Surface | Enforcement | Verified |
|---|---|---|
| Login / OAuth callback | `postLoginPath` (shared by page + callback); `getCurrentUser` gates every landing | identity-priority, driver suites |
| Password setup / recovery | GoTrue recovery link only; **never a password by email** | user-creation, tenant-invitations |
| Generated temp password | CSPRNG, returned once in the result, never persisted/logged/audited | user-creation |
| User deactivation | `app_user.status != 'active'` → `getCurrentUser` null | user-creation |
| Invitation cancellation | deactivates the user → no session even if the link is used | tenant-invitations |
| Session revocation | GoTrue ban on suspend/archive (**gates** login+refresh; residual ≤1h access token already denied by next-request enforcement) | tenant-session-revocation |
| Lifecycle blocking | `tenantBlockReason` in `getCurrentUser` — the single point | tenant-lifecycle |
| Driver/courier routing | `isDriverOnly`/`narrowStaffIdentity` — membership ≠ identity | identity-priority |

**Finding:** none. The identity regression (DRIVER overriding SYSTEM_ADMIN) was fixed prior
to this phase and is regression-locked.

## 2. Authorization
- **Tenant** actions → `assertPermission` → `getCurrentUser` (null when blocked) → permission check. No action accepts a client actor/tenant; both come from the resolved session (`admin.id`, `admin.tenantId`).
- **Platform** actions → `assertPlatformPermission` → `getPlatformUser` (resolves `platform_admin` by `auth.uid`; a tenant user has no such row → null). Permissions derived from the fixed role→permission map, never client-supplied.
- **Page guards / route handlers / RPC**: pages call `requireUser`/`assertPlatformPermission`; API routes call `getCurrentUser`; the provisioning RPC is `SECURITY DEFINER` gated to platform (RLS test `rls_provision_tenant_test`).
- **Service-role boundary**: writes go through `getAdminSupabaseClient` in `"use server"`/`server-only` modules; never imported by client components (bundle scan below).

**Finding:** none. `platform:copilot:read` (new, 6.0F-1) is additive, platform-only, read-only, with no tenant equivalent (platform-roles test).

## 3. Tenant isolation
- **RLS**: per-domain SQL tests (finance/customs/transport/document/communication/portal/…) + the new **bidirectional** `rls_multitenant_acceptance_test.sql` proving A↔B read *and* write isolation across organization/app_user/role/user_role/audit — run against real Postgres in CI.
- **Platform service-role reads** are cross-tenant *by design* and gated (`platform:companies:read` etc.), returning only safe metadata + coarse aggregates — never business rows.
- **Client-supplied tenant ids**: platform actions treat `tenantId` as a target to validate (org existence), never as the caller's identity. Tenant actions ignore any client tenant entirely (derived from session).
- **AI context**: the platform Copilot context is an allowlist of safe aggregates; no tenant business data or PII enters it (admin email reduced to a boolean).

**Finding:** none. Bidirectional isolation is now explicitly proven, not assumed.

## 4. Sensitive data
Never persisted/logged/audited/URL-borne: passwords, temp passwords, setup/recovery links,
access/refresh tokens, service-role creds, raw provider payloads, raw audit payloads.
- Setup link: returned once in the action result; audit records booleans (`linkGenerated: !!setupLink`) — asserted per-writeAudit-payload (tenant-invitations, user-creation, threat-scenarios).
- Auth-provider errors: mapped to safe codes/French messages (`copilotErrorMessage`, `CreateUserError`), never surfaced raw.
- Copilot: allowlisted context + safe-metadata audit (provider/model/tenantCount/categories/outcome).

**Finding:** none.

## 5. Lifecycle
- Suspended/archived/trial-expired → `getCurrentUser` null on the next request (pages, actions, driver/courier portals, 4 API routes).
- Session bans on suspend/archive; **partial revocation** counted, never rolls back the applied transition, never reactivates.
- Reactivation un-bans (users re-authenticate); no session is manufactured.
- **Background entry points**: no cron; the payments webhook is external, signature-verified, and `PAYMENTS_ENABLED`-off in prod — **excluded from lifecycle gating by design** (billing scope, Phase 6.0G+).

**Finding:** none new; the webhook exclusion is a documented boundary.

## 6. Audit
Every sensitive platform operation writes a safe event: provisioning, lifecycle
(`platform.tenant.status_changed` + revocation summary), branding (`platform.branding.updated`,
field names only), invitations (`user.welcome.*`, `user.invitation.cancelled`), user creation
/ role assignment, rollout (`platform.rollout.updated`), Copilot (`platform.copilot.query`).
No audit payload carries a secret (enforced by per-payload tests + the existing engine
audit-safety scans).

**Finding:** none.

## 7. Client bundles
Scanned the client chunks and client components: no `getAdminSupabaseClient`, no
`service_role`/`SUPABASE_SERVICE_ROLE_KEY`, no `generateAI`/provider SDK, no server-only
module import. The Copilot panel, branding editor, invitation controls, and lifecycle
controls all call `"use server"` actions or the platform route — never a privileged client.
(Asserted structurally per component + verified by `next build` succeeding with the RSC
boundary intact.)

**Finding:** none.

## 8. Error handling
Production UI shows French, actionable messages; raw Supabase/SQL/provider errors and stack
traces are never surfaced. Copilot maps `AIError → CopilotError` codes; user/lifecycle/
branding/invitation actions return closed error vocabularies. `reportError` logs
server-side with a scope, never to the client.

**Finding:** none.

## 9. Threat matrix (see `tests/threat-scenarios.test.ts` + dedicated suites)
| # | Scenario | Defense | Where |
|---|---|---|---|
| 1 | A uses B's id in a server action | tenant derived from session; target validated | threat-scenarios, user-creation |
| 2 | Tenant admin attempts a platform action | `assertPlatformPermission` → no platform identity | threat-scenarios |
| 3 | Platform read from a tenant session | `getPlatformUser` null for `app_user` | threat-scenarios |
| 4 | Suspended tenant reuses a browser session | `getCurrentUser` null next request | tenant-lifecycle |
| 5 | Archived tenant calls an API directly | API routes → `getCurrentUser` null | tenant-lifecycle |
| 6 | Cancelled invitation link used | user deactivated → no session | tenant-invitations |
| 7 | Old regenerated setup link used | recovery token rotated on regenerate | tenant-invitations |
| 8/9 | Provisioning key changed / retried | RPC idempotency + slug guard | rls_provision_tenant (SQL) |
| 10 | DRIVER added to SYSTEM_ADMIN | `isDriverOnly` false | identity-priority, threat-scenarios |
| 11/12 | Client injects actor id / permission | resolved server-side only | threat-scenarios |
| 13/14 | Setup link / temp password in log or audit | never persisted/audited | threat-scenarios, user-creation |
| 15/16/17 | AI asks for secrets / an action / cross-tenant data | read-only, no tools, allowlist context, non-overridable prompt | platform-copilot |
| 18 | Revocation partial failure | transition stands; counted | tenant-session-revocation |
| 19 | Lifecycle transition race | compare-and-set | tenant-lifecycle, threat-scenarios |
| 20 | Branding contains HTML/script | rejected by validator | branding, threat-scenarios |

All scenarios have a proven defense.

## Documented boundaries (not defects)
1. **Session revocation** bans (gates login+refresh) rather than deleting refresh tokens — the supported API has no delete-sessions-by-id. Residual ≤1h access token is denied by next-request enforcement.
2. **Payments webhook** is outside lifecycle gating (external, disabled in prod) — a billing-phase item.
3. **Public logo storage** deferred (no approved public bucket) — branding editor is text+theme only.

## Recommendation
The platform is secure for a controlled production rollout of the platform-admin and
tenant-provisioning surfaces. Deferred items (below) are additive and do not block rollout.
