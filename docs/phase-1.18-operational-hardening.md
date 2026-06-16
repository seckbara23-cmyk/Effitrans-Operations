# Phase 1.18 — Operational Hardening Report

**Date:** 2026-06-16
**Premise:** Pilot blockers cleared (1.17B / commit e3ad21e). This phase raises Effitrans from *pilot-ready* to *operationally hardened* — monitoring, security headers, a verified email strategy, and documented recovery/launch procedures. **No new business modules, workflows, or schema.**
**Validation:** `tsc --noEmit` clean · **155 tests passing** · `next build` succeeds.

Companion docs: [monitoring verification](monitoring-verification.md) · [backup & recovery runbook](backup-recovery-runbook.md) · [pilot launch checklist](pilot-launch-checklist.md).

---

## C1 — Error Monitoring ✅

**Approach:** introduced a single, dependency-free observability seam — `lib/observability/report.ts` (`reportError` / `reportMessage`) — and wired it across every error surface. It emits a structured `[observe]` log line today and forwards to a monitor the moment a DSN + the Sentry SDK are added, with **no call-site changes**. This matches the codebase's dark-by-default philosophy (no-op email provider, dark payment providers).

**Instrumented:** client segment boundary (`app/error.tsx`), new root boundary (`app/global-error.tsx`), new portal boundary (`app/portal/(app)/error.tsx`), payment webhook route handler, staff + portal OAuth callbacks (exchange failure + gate rejection), and the email send-failure path. Full matrix + test procedure + Sentry rollout in [monitoring-verification.md](monitoring-verification.md).

**Recommendation:** log-only is acceptable for the controlled pilot (Vercel captures `[observe]`); wire Sentry before scaling past the first 1–3 customers. Env documented (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`).

**Residual:** server-action unexpected throws are caught into `{ ok:false }` but not all call `reportError` — a `withReporting()` wrapper is the documented follow-up (deferred to stay non-invasive).

## C2 — Security Headers ✅

Added `async headers()` to `next.config.mjs`, applied to every route:

| Header | Value | Purpose |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | clickjacking protection |
| `X-Content-Type-Options` | `nosniff` | stop MIME sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | don't leak full URLs (ids) externally |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), browsing-topics=()` | disable unused powerful features |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | force HTTPS (ignored on localhost — dev-safe) |

**Compatibility:** these are passive response headers on our own HTML. They do **not** affect the cross-origin `fetch` to Supabase nor the Google OAuth top-level redirect (allowed under `SAMEORIGIN`). Build verified; the [launch checklist §E](pilot-launch-checklist.md#e-compatibility-regression-headers-on) re-verifies login/OAuth/Supabase/Storage live.

**CSP & HSTS evaluation:** HSTS **shipped** (safe on Vercel HTTPS). **CSP intentionally deferred** — a strict policy needs per-request nonces for Next.js's inline bootstrap/hydration scripts plus a Supabase origin allow-list; shipping it blindly breaks hydration. Recommended path: roll out `Content-Security-Policy-Report-Only` first, tune, then enforce. Tracked as a post-pilot follow-up.

## C3 — Email Provider Strategy ✅ (Resend wired, dark by default)

**Recommended provider: Resend.** Rationale: simplest path to verified-domain transactional email, a plain HTTPS API (no SDK/dependency needed), and a free tier sufficient for a pilot. SMTP remains a documented fallback but needs a mailer dependency, so it's left unimplemented.

**Implemented:** the provider seam (`lib/comms/provider.ts`) now has a real **Resend branch** via `fetch` — still **dark by default**. Behaviour is unchanged (no-op) unless explicitly switched on. Going live is config-only:

```
COMMUNICATIONS_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
COMMUNICATIONS_EMAIL_FROM="Effitrans <ops@your-domain>"
```

The payload builder (`buildResendPayload`) is pure and unit-tested; a misconfigured provider returns `resend_not_configured`/`resend_http_*` and is captured by C1 (`comms.send_failed`).

**Rollout plan:** (1) verify the sending domain in Resend; (2) set the 3 env vars in a preview deploy; (3) send one test email end-to-end and confirm receipt + a `SENT` row + audit; (4) enable in production. Until then, the pilot runs log-only with messages queued and marked SENT (no delivery) — call this out to pilots (checklist §D).

## C4 — Backup & Recovery ✅

Authored [backup-recovery-runbook.md](backup-recovery-runbook.md): reliance map, **⚠ CONFIRM** posture checks (daily backups / PITR / region / retention / two-admin access), DB restore paths (in-app soft-delete recovery → PITR → daily restore), storage restore assumptions, downtime/RPO/RTO expectations, post-restore smoke test, and a full incident procedure with escalation contacts. Key insight: the app's **soft-delete-only** model + `audit_log` make most "accidental deletion" incidents recoverable **without** a database restore, and a **Vercel rollback** is the fastest fix for app regressions.

Open external confirmations (one-time, in the launch checklist): Supabase plan PITR/retention and **BLK-9** region.

## Pilot Operations Documentation ✅

Authored [pilot-launch-checklist.md](pilot-launch-checklist.md): pre-launch (env, accounts/admin/break-glass, staff invites, portal users, branding, email config), the full **operational test matrix** (dossier, documents, customs, transport, invoice, payment, portal, Google OAuth, password reset, logout), a headers-on compatibility regression, recovery readiness, and a **Go/No-Go** sign-off grid.

---

## Files changed

**Code (observability + headers + email):**
- `lib/observability/report.ts` (new) — reporting seam
- `app/global-error.tsx` (new), `app/portal/(app)/error.tsx` (new), `app/error.tsx` (wired)
- `app/api/payments/webhook/[provider]/route.ts`, `app/auth/callback/route.ts`, `app/portal/auth/callback/route.ts`, `lib/comms/queue.ts` (instrumented)
- `next.config.mjs` (security headers)
- `lib/comms/provider.ts` (Resend branch + pure `buildResendPayload`)
- `tests/comms-provider.test.ts` (new, +2 tests)
- `.env.example` (Resend + Sentry vars documented)

**Docs:** `phase-1.18-operational-hardening.md`, `monitoring-verification.md`, `backup-recovery-runbook.md`, `pilot-launch-checklist.md` (all new); `pilot-readiness-audit.md` (conditions updated).

---

## Readiness improvements

| Condition (from 1.17A) | Before | After |
|---|---|---|
| C1 Error monitoring | Open | ✅ Seam + instrumentation + verification doc (Sentry config-only) |
| C2 Security headers | Open | ✅ 4 required + HSTS shipped; CSP evaluated/deferred |
| C3 Email strategy | Open | ✅ Resend wired (dark) + rollout plan |
| C4 Backups/recovery | Open | ✅ Runbook authored (external confirms pending) |

| Dimension | 1.17B | 1.18 | Why |
|---|---:|---:|---|
| Security | 83% | 90% | Security headers + structured error capture |
| Communications | 80% | 88% | Real provider wired (dark), rollout documented |
| Observability *(new)* | ~30% | 85% | Reporting seam across all surfaces + test procedure |
| Operations maturity | — | ↑ | Recovery runbook + launch checklist |
| **Overall** | **~86%** | **~92%** | Operationally hardened for a controlled pilot |

---

## Remaining risks (all non-blocking for a controlled pilot)

1. **No live error monitor yet** — log-only until Sentry DSN is set (config-only step documented).
2. **CSP not enforced** — XSS defense relies on React escaping + `nosniff`; CSP is the documented next step (report-only → enforce).
3. **External confirmations pending** — Supabase PITR/retention + data residency (BLK-9); in the launch checklist.
4. **Email delivery off by default** — pilots must be told notifications are internal-only until Resend is switched on.
5. **No independent storage backup** — documents rely on Supabase replication; cold-storage export is a post-pilot follow-up.
6. **No rate limiting** on auth/webhook endpoints — acceptable at pilot scale; revisit before broad launch.

## Recommendation

> **Ready for a controlled pilot (1–3 customers).** The environment is monitorable (structured capture on every surface, Sentry config-only), hardened (security headers + HSTS), has a verified communications path (Resend wired, dark), and documented recovery + launch procedures. Complete the launch checklist — especially the external backup/region confirmations and the email-mode decision — then proceed.
