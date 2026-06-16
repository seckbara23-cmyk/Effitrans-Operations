# Pilot Launch Checklist (Phase 1.18)

**Goal:** onboard 1–3 pilot logistics companies onto a monitored, recoverable, hardened production environment — with **no new business functionality**.
**How to use:** work top to bottom. Every box must be ticked (or explicitly waived with a reason) before the **Go/No-Go** sign-off at the bottom.

Related: [operational hardening report](phase-1.18-operational-hardening.md) · [monitoring verification](monitoring-verification.md) · [backup & recovery runbook](backup-recovery-runbook.md).

---

## A. Pre-launch — environment

- [ ] All required env vars set in Vercel (see `.env.example`): Supabase URL/anon/service-role.
- [ ] `NEXT_PUBLIC_SITE_URL` set to the real production URL (used for portal links in emails).
- [ ] Security headers verified live (see §D).
- [ ] Error monitoring decision made: either Sentry DSN wired (`NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN`) **or** accepted log-only for pilot (`[observe]` lines in Vercel logs). Record choice: `____`.
- [ ] Backups/PITR/region confirmed per the [runbook §2](backup-recovery-runbook.md#2-backup-posture--⚠-confirm-at-setup).
- [ ] `tsc --noEmit`, `npm test`, and `next build` all green on the deployed commit.

## B. Pre-launch — accounts & access

- [ ] **Admin account** created (the designated IT System Admin) with `admin:users:manage` + `admin:config:manage`.
- [ ] **Break-glass backup admin** created (DEC-B12); credentials stored securely; no shared accounts.
- [ ] **Staff invites** sent for the pilot operators (transit, finance, etc.); each has the correct role/permissions per [rbac-matrix](rbac-matrix.md).
- [ ] **Portal users** invited for each pilot customer (via `/clients/[id]` → portal invitation). Verify the dual-identity guard (a staff email cannot become a portal user).
- [ ] Disabled/test accounts removed or deactivated.

## C. Pre-launch — branding & content

- [ ] Company/branding (logo, names) reflects Effitrans pilot identity.
- [ ] No mock/prototype data visible (B1 resolved — `/customers`, `/shipments`, `/documents` removed from nav; confirm sidebar shows only real modules).
- [ ] French copy reviewed on the surfaces pilot users will see (login, portal, emails).

## D. Pre-launch — email & security verification

- [ ] **Email configuration:** decide pilot mode —
  - *No-op (default):* messages are queued + marked SENT but **nothing is delivered**. Acceptable only if pilots are told notifications are internal-only.
  - *Live (Resend):* set `COMMUNICATIONS_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `COMMUNICATIONS_EMAIL_FROM` (verified sender). Send one real test email and confirm receipt.
  - Record choice: `____`.
- [ ] **Security headers** present on a live response (DevTools → Network → any page → Response Headers): `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- [ ] OAuth + Supabase still work with headers on (login, callback, portal) — see §E.

## Operational tests (run on production before go-live)

Run as a pilot-representative staff user, then as a portal user. Tick each when it behaves correctly **and** writes an `audit_log` entry where expected.

- [ ] **Dossier** — create an operational file; update status through the workflow; close it.
- [ ] **Documents** — upload (valid type ≤ 25 MB); reject an oversized/invalid file; approve; share with client.
- [ ] **Customs** — run the customs workflow on a dossier (declaration / BAE references).
- [ ] **Transport** — run the transport workflow (pickup/delivery).
- [ ] **Invoice** — create a draft invoice; add lines; verify totals; reject a **negative/zero** amount (1.17A validation); issue the invoice.
- [ ] **Payment** — record a payment; verify it; reject one; confirm it cannot exceed the balance; check reconciliation view.
- [ ] **Portal** — log in as the pilot client; confirm **only their own** files/documents/invoices appear (RLS); download a shared document.
- [ ] **Google OAuth** — staff sign-in via Google succeeds for an allowed identity; an unknown/disabled identity is rejected with no standing session.
- [ ] **Password reset** — request a reset; complete it; confirm the old password no longer works.
- [ ] **Logout / session expiry** — sign out; confirm protected routes redirect to login.

## E. Compatibility regression (headers on)

- [ ] Staff email login.
- [ ] Staff Google OAuth round-trip.
- [ ] Portal login + Google OAuth round-trip.
- [ ] Supabase data loads on dashboard/finance/analytics (no CSP/connect blockage — none set this phase).
- [ ] Document upload + download from Storage.

## F. Recovery readiness

- [ ] [Backup & recovery runbook](backup-recovery-runbook.md) reviewed; escalation contacts filled in.
- [ ] Vercel rollback path confirmed (previous deployment is available).
- [ ] One **restore drill** rehearsed (at minimum: confirm PITR is selectable in the dashboard).

---

## Go / No-Go

| Gate | Owner | Status |
|---|---|---|
| Environment + build green (A) | IT Admin | ☐ Go ☐ No-Go |
| Accounts & access (B) | IT Admin | ☐ Go ☐ No-Go |
| Branding & no mock data (C) | Product | ☐ Go ☐ No-Go |
| Email + security headers (D) | IT Admin | ☐ Go ☐ No-Go |
| Operational tests pass | Ops lead | ☐ Go ☐ No-Go |
| Compatibility regression (E) | IT Admin | ☐ Go ☐ No-Go |
| Recovery readiness (F) | IT Admin | ☐ Go ☐ No-Go |

**Decision:** ☐ GO for pilot ☐ NO-GO — _reason:_ `__________`
**Signed:** IT Admin `______` · Product `______` · Date `______`
