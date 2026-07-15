# Phase 6.0G — Staging Live Acceptance (Operator Harness)

**Release-candidate SHA:** `65240a8` (origin/main). CI green: `build` + `rls-tests`.
**Baseline:** 1,707 tests / 106 files / 0 skipped · typecheck clean · Next build clean ·
bidirectional tenant isolation proven against real Postgres.

## Status of this document
This is a **ready-to-execute acceptance harness**, not a claim that the live run happened.
The engineering environment that produced the release candidate has **no reachable staging
deployment** (no Vercel link, Supabase admin access unauthorized, `.env.local` holds AI keys
only), so the browser-driven, live-Supabase steps **must be executed by an operator** with
staging credentials. Every automatable check has been verified at the RC SHA and is marked
**✅ VERIFIED**; every live step is written with exact actions + expected outcome and a blank
**observed** field, marked **⏳ PENDING (operator)**. No secret, setup link, or password
appears here or should be pasted into it — record only safe evidence (event ids, route
names, counts, "PASS/FAIL").

Legend: **✅ VERIFIED** = proven by code/CI at `65240a8`. **⏳ PENDING** = operator live step.

---

## Run header (operator fills)
| Field | Value |
|---|---|
| Environment | ☐ staging  ☐ approved non-customer (name: __________) |
| Staging app URL | __________ |
| Staging Supabase project ref | __________ |
| Staging Vercel project | __________ |
| Deployed SHA | must equal **65240a8** (reject "latest" without match) |
| Migration version | __________ (latest applied; expect `20260715000001_provision_tenant` + all prior) |
| Associated CI run | __________ (green build + rls-tests on 65240a8) |
| Operator | __________ |
| Date | __________ |
| Acceptance tenant — legal name | **Effitrans Staging Acceptance Tenant** |
| Acceptance tenant — display name | **Acceptance Tenant** |
| Acceptance tenant — slug | **effitrans-staging-acceptance** |
| First-admin email (operator-controlled) | __________ |
| Test-account emails (operator-controlled) | ops: ____ · driver: ____ · courier: ____ |
| Cleanup method | ☐ suspend (reusable)  ☐ archive (terminal) — see Part 18 |

## Environment readiness (report present / missing / invalid / mismatched / disabled — never values)
| Config | Required | Check |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | ☐ present |
| `SUPABASE_SERVICE_ROLE_KEY` (server-only, not `NEXT_PUBLIC_*`) | yes | ☐ present ☐ server-scoped |
| `NEXT_PUBLIC_SITE_URL` (recovery redirect base) | yes | ☐ present ☐ matches app URL |
| Auth allowed redirect URLs include `…/auth/update-password` | yes | ☐ configured |
| `COMMUNICATIONS_EMAIL_PROVIDER` + `RESEND_API_KEY` + `COMMUNICATIONS_EMAIL_FROM` | for email path | ☐ present (or ☐ intentionally disabled → link_returned path) |
| `AI_PROVIDER` + `AI_MODEL` + `AI_API_KEY` (or `OPENAI_API_KEY`) | for Copilot | ☐ present (or ☐ disabled → "not configured" diagnostic) |
| Rollout kill switches (`EFFITRANS_PROCESS_*_ENABLED`) | default off | ☐ recorded |
| `PAYMENTS_ENABLED` | must be unset/false | ☐ disabled |
| Platform administrator account (`platform_admin`, active) | yes | ☐ present |

---

## Part 1 — Deployment verification
| Check | Expected | Status |
|---|---|---|
| Deployed SHA equals `65240a8` | exact match | ⏳ PENDING |
| Deployment status | Ready | ⏳ PENDING |
| Migrations applied through `20260715000001_provision_tenant` | yes | ⏳ PENDING |
| CI run for the SHA green (build + rls-tests) | ✅ VERIFIED (65240a8 green) |

## Part 2 — Platform administrator access
| Check | Expected | Basis / Status |
|---|---|---|
| Admin can open `/platform/companies`, `/platform/companies/new` | renders | ⏳ PENDING |
| Tenant user cannot open `/platform/*` | rejected server-side | ✅ VERIFIED (`assertPlatformPermission`; `getPlatformUser` null for `app_user`) · ⏳ confirm live |
| Tenant SYSTEM_ADMIN has no platform permission | true | ✅ VERIFIED (platform↔tenant boundary tests) |
| Direct URL by unauthorized account rejected | 403 / redirect | ⏳ PENDING |
| Console renders without raw errors | true | ⏳ PENDING |
| No service-role / admin-client in bundles or responses | true | ✅ VERIFIED (bundle scans; RSC build) · ⏳ confirm in devtools |

## Part 3 — Live tenant provisioning (`/platform/companies/new`, 7 steps)
Steps: Identity · Profile · Branding · Modules/Rollout · Roles · First Administrator · Review.
| Check | Expected | Basis / Status |
|---|---|---|
| Draft client-held before submit; no rows appear pre-submit | true | ✅ VERIFIED (wizard 6.0B) · ⏳ confirm |
| One provisioning key; retry reuses key; double-click → one tenant | idempotent | ✅ VERIFIED (`rls_provision_tenant_test`: idempotency + slug guard) · ⏳ confirm |
| Wizard calls the existing engine; tenant created once | true | ✅ VERIFIED · ⏳ confirm |
| Branding defaults exist | yes | ⏳ PENDING |
| Rollout row exists, all features OFF | yes | ✅ VERIFIED (engine default) · ⏳ confirm |
| Roles + permissions materialized from registry | yes | ✅ VERIFIED (RPC) · ⏳ confirm |
| First administrator exists; SYSTEM_ADMIN assigned | yes | ⏳ PENDING |
| Provisioning audit event present | yes | ⏳ PENDING (Audit tab) |
| No temp password / setup link in SQL or audit | true | ✅ VERIFIED (audit-safety tests) · ⏳ confirm |

## Part 4 — Invitation outcome (per actual provider config — do not change config to force an outcome without recording it)
**Provider configured →** expected `email_sent`: ⏳ email delivered · secure link works · no plaintext password · delivery audit present · UI shows no reconstructed link.
**Provider disabled →** expected `link_returned`: ⏳ UI states "not sent" · one-time link shown · Copy works · refresh removes it · link absent from URL/storage/logs/audit/DB.
Basis: ✅ VERIFIED honest outcome classification (`classifyWelcome`, tenant-invitations tests); ⏳ live delivery.

## Part 5 — First administrator authentication
| Check | Expected | Basis / Status |
|---|---|---|
| Landing route | `/dashboard` (record exact) | ✅ VERIFIED (`postLoginPath`) · ⏳ confirm |
| Full admin sidebar; no `/driver` redirect | true | ✅ VERIFIED (identity) · ⏳ confirm |
| SYSTEM_ADMIN+DRIVER → full workspace | true | ✅ VERIFIED (identity-priority) · ⏳ confirm |
| Tenant branding applied; platform routes inaccessible; own-tenant data only | true | ⏳ PENDING |

## Part 6 — Role & identity acceptance
Accounts: SYSTEM_ADMIN · operational · driver-only · courier-only · SYSTEM_ADMIN+DRIVER · another operational role.
| Check | Expected | Basis / Status |
|---|---|---|
| driver-only → `/driver` | true | ✅ VERIFIED · ⏳ confirm |
| courier-only → courier workspace | true | ✅ VERIFIED · ⏳ confirm |
| SYSTEM_ADMIN+DRIVER → full workspace | true | ✅ VERIFIED · ⏳ confirm |
| narrow roles never override operational | true | ✅ VERIFIED (`isDriverOnly`) |
| no tenant role grants platform permission | true | ✅ VERIFIED |
| unauthorized pages/actions rejected server-side | true | ✅ VERIFIED · ⏳ confirm |

## Part 7 — User-creation credential modes
Setup email: ⏳ no password field · honest outcome · link works · no password emailed (✅ VERIFIED recovery-link-only).
Generated temp password: ⏳ server-side · shown once · Copy works · refresh removes · absent from logs/audit/storage/URL/tables (✅ VERIFIED never-persisted/audited).
Manual temp password: ⏳ policy validated · show/hide · not emailed · only Auth receives it (✅ VERIFIED).
Duplicate email → clean French conflict (✅ VERIFIED `email_conflict`) · ⏳ confirm message.

## Part 8 — Branding
⏳ Edit → change safe fields → preview updates without persistence → Cancel restores → Edit → Save → tenant runtime reflects it → audit records field names only → unsafe HTML rejected → logo/favicon upload absent (deferred).
Basis: ✅ VERIFIED (branding-edit tests: validation, field-name-only audit, local preview, logo preserved).

## Part 9 — Onboarding checklist
⏳ Verify each item vs real evidence (provisioned · admin · first login · branding · rollout row · engine live · team · first dossier) · incomplete stay incomplete · no manual checkbox · accurate count · no other tenant's counts.
Basis: ✅ VERIFIED (derived, no mutation of `onboarding_status`; per-tenant facts).

## Part 10 — Rollout
⏳ All features OFF initially → activate one via RolloutControls → permission enforced · audit event · state refresh · only this tenant changes.
Basis: ✅ VERIFIED (rollout gated `platform:rollout:manage`, audited; non-operable tenants rejected).

## Part 11 — Invitations
⏳ Resend eligible · regenerate link (prior link unusable where supported) · cancel unactivated (cancelled account cannot access) · honest outcomes · links never in audit/logs. **Do not test cancel on a real operator account.**
Basis: ✅ VERIFIED (invitation state/eligibility; cancel = deactivate enforced by getCurrentUser).

## Part 12 — Tenant isolation (bidirectional)
| Layer | Status |
|---|---|
| **DB-level bidirectional isolation** across org/app_user/role/user_role/audit (read + write) | ✅ VERIFIED — `rls_multitenant_acceptance_test.sql` PASS in CI (real Postgres) |
| Per-domain isolation (finance/customs/transport/document/communication/portal/client/dossier) | ✅ VERIFIED — dedicated RLS suites |
| ⏳ Live cross-tenant clicks (A↔B via console/URLs) return no rows / denial; no cross-tenant mutation | ⏳ PENDING (operator confirmation) |

## Part 13 — Lifecycle & session revocation
Suspend: ⏳ confirm copy states sign-out · lifecycle audit · revocation summary · open session denied on next protected route · new login blocked · driver+courier portals blocked · rollout mutation rejected · Platform Console still readable. (✅ VERIFIED enforcement + ban + next-request block.)
Reactivate: ⏳ users unbanned · old sessions not restored · sign in works · data intact. (✅ VERIFIED un-ban; no session manufactured.)
Archive (last): ⏳ all access blocked · data readable by platform admin · no deletion · no invalid action shown. (✅ VERIFIED terminal, no delete.)
If tenant must stay reusable → **suspend, not archive** (document why).

## Part 14 — Platform Copilot
⏳ Ask the safe questions (onboarding / suspended / incomplete branding / invitation issues / no rollout / needs attention). Verify: permission required · tenant user denied · only authorized names · no admin email · no PII · no raw audit payload · no finance/customs/shipment/document/communication content · mutation refused · secret request refused · links to valid Console routes · safe audit metadata.
Basis: ✅ VERIFIED (allowlist context, non-overridable prompt, gated, safe-metadata audit, no direct provider call).

## Part 15 — Browser & bundle review
⏳ No setup link/temp password in URL · no secret in console · no service-role key/admin client/provider SDK in client JS · no raw SQL/provider error to users · protected server actions reject unauthorized direct requests · network responses carry only safe fields.
Basis: ✅ VERIFIED (structural bundle scans; RSC build) · ⏳ confirm in devtools.

## Part 16 — Audit review
⏳ Confirm events exist: provisioning · user creation · invitation delivery · resend/regenerate/cancel · branding update · rollout · lifecycle · session-revocation summary · Copilot query. And no payload carries a password/temp-password/setup-link/access-token/refresh-token/session-id/service-role/raw-provider-payload.
Basis: ✅ VERIFIED (per-payload safety tests) · ⏳ confirm in Audit tab.

## Part 17 — Bounded failure tests
⏳ duplicate slug · duplicate email · invalid role · invalid lifecycle transition · unauthorized platform action · cross-tenant target · unsafe branding · provider-unavailable/simulated failure · repeated provisioning submit · resend double-click · lifecycle double-submit — each returns the established safe error, no breakage.
Basis: ✅ VERIFIED (closed error vocabularies; compare-and-set; pending-guards) · ⏳ confirm live.

## Part 18 — Cleanup
⏳ Suspend (reusable) or Archive (terminal) per plan · remove temp accounts via supported ops only · no hard delete · preserve audit · delete any local screenshots/emails with one-time material · ensure no setup link/temp password committed. **Final tenant state:** __________.

---

## Consolidated status
- **✅ Verified now (code/CI at 65240a8):** identity routing, lifecycle enforcement + bans, bidirectional isolation (real Postgres), honest invitation outcomes, secret-never-in-audit, no service-role in client bundles, Copilot allowlist + read-only, closed error vocabularies, provisioning idempotency + slug guard.
- **⏳ Pending operator execution:** the browser-driven live run (Parts 1–18 ⏳ rows) against staging with real config + email + Copilot provider.

Release decision: see `docs/phase-6.0g-release-decision.md`.
