# Phase 2.1A — User Presence & Login Visibility

**Date:** 2026-06-17
**Goal:** give SYSTEM_ADMIN / `admin:users:manage` a clear view of user activity — who's online, last login/seen, login method, account status, onboarding-email status, and whether a user has ever logged in. Operational admin metadata **only** (no realtime, no page-level surveillance, no route history).

**Validation:** `tsc --noEmit` clean · **200 tests** pass (+7) · `next build` succeeds · boundary + secrets checks clean.

---

## 1. Login metadata fields added

Migration **`20260617000002_user_presence.sql`** (additive, idempotent):

| Field | app_user | client_user |
|---|---|---|
| `last_login_at` | **added** | already existed |
| `last_seen_at` | added | added |
| `last_login_method` | added | added |
| `login_count` (default 0) | added | added |
| `onboarding_email_sent_at` | added | added |

Plus `idx_app_user_last_seen` / `idx_client_user_last_seen` for the dashboard counts. **No RLS change.** `lib/db/types.ts` updated for both tables.

## 2. Presence model (derived, no websockets)

Pure `classifyPresence(input, now)` (`lib/users/presence.ts`):
- **never** — never logged in (`login_count === 0` and no `last_login_at`)
- **online** — `last_seen_at` within 5 min
- **recently_active** — within 30 min
- **offline** — older than 30 min, or null

`loginMethodLabel()` maps the five methods to French labels.

## 3. Login + last-seen updates

Best-effort writers (`lib/users/presence-track.ts`, service-role, never throw) bump `last_login_at` + `last_seen_at` + `last_login_method` + `login_count++` at each login, and a **throttled (60 s)** `last_seen_at` heartbeat on authenticated load.

| Event | Hook | Method |
|---|---|---|
| Staff email/password | `recordLoginAudit` (auth/actions) | `password` |
| Staff Google | `gateStaffOAuthLogin` (auth/oauth) | `google` |
| Staff password reset complete | `recordPasswordResetComplete` (auth/password-reset) | `recovery` |
| Portal password | `recordPortalLogin` action (portal/actions) | `portal_password` |
| Portal Google | `gatePortalOAuthLogin` (portal/oauth) | `portal_google` |
| Authenticated load (heartbeat) | `getCurrentUser` / `getCurrentPortalUser` | — (`last_seen_at` only, throttled) |
| Onboarding email queued | `queueStaffWelcome` (users/actions) | sets `onboarding_email_sent_at` |

## 4. UI changes

- **`/users` directory** (gated `admin:users:manage`): new **Présence** column (🟢 online / 🟡 recently active / ⚪ offline / ○ never + "Vu" timestamp) and **Connexion** column (last login datetime, method label, login count, onboarding-email status ✓). Table wrapped in a horizontal-scroll container.
- **Dashboard** (`AdminPresenceCard`, SYSTEM_ADMIN / `admin:users:manage` only): Users online · Active today · Never logged in · Portal clients active today.

## 5. Security & privacy

- Presence is exposed only through the admin directory (`listUsers`, `getPresenceSummary` — both `assertPermission('admin:users:manage')`) and the admin-gated dashboard card. Normal staff never see it; portal-user presence is admin-only and never exposed to other clients. No public presence API.
- Only login/last-seen metadata is stored — **no** page-by-page browsing, routes visited, keystrokes, or device details. `last_seen` updates are not audited (existing `auth.login.*` events remain the audit trail).

## 6. Files changed

**New:** `lib/users/presence.ts` (pure), `lib/users/presence-track.ts` (server-only), `components/dashboard/admin-presence-card.tsx`, `supabase/migrations/20260617000002_user_presence.sql`, `tests/users-presence.test.ts`, `docs/phase-2.1a-user-presence.md`.
**Edited:** `lib/auth/actions.ts`, `lib/auth/current-user.ts`, `lib/auth/oauth.ts`, `lib/auth/password-reset.ts`, `lib/portal/auth.ts`, `lib/portal/oauth.ts`, `lib/portal/actions.ts` (login + heartbeat hooks); `lib/users/actions.ts` (`onboarding_email_sent_at`); `lib/users/service.ts` (`listUsers` + `getPresenceSummary`), `lib/users/types.ts`; `components/users/users-admin.tsx`; `app/dashboard/page.tsx`; `lib/i18n.ts`; `lib/db/types.ts`.

## 7. Tests added

`tests/users-presence.test.ts` (7): never-logged-in, online ≤5 min, recently-active ≤30 min, offline >30 min / null, login-count-without-last-login, and login-method labels.

## 8. Validation results

| Gate | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `npm test` | ✅ 200 passed (+7) |
| `next build` | ✅ success |
| boundary grep | ✅ no client imports the server-only presence-track / admin client; `presence.ts` is pure |
| secrets check | ✅ no `NEXT_PUBLIC_` secret leak |

## 9. Production migration instructions

- Ships with the normal deploy (`supabase db push` / CI migration step). `20260617000002_user_presence.sql` is additive + idempotent (`add column if not exists`), zero downtime, no backfill (existing users start at `login_count = 0` / null timestamps → shown as "Jamais connecté" until their next login).
- Regenerate DB types in the pipeline if applicable; the committed `lib/db/types.ts` already includes the new columns.

## 10. Live testing checklist

1. **Email login** → `/users` shows that user 🟢 online, method "Mot de passe", login count incremented, "Vu" just now.
2. **Google login** → method "Google"; **password reset completion** → method "Réinitialisation".
3. **Portal login (password & Google)** → reflected in admin views with methods "Portail (mot de passe)" / "Portail (Google)" (portal presence is admin-only).
4. **Heartbeat**: navigate a few authenticated pages → "Vu" updates at most once/minute (throttled).
5. **Presence decay**: wait >5 min without activity → badge → 🟡 recently active; >30 min → ⚪ offline.
6. **Never logged in**: create a user, don't log in → ○ "Jamais connecté"; "E-mail envoyé" shows ✓ if the welcome email was queued.
7. **Dashboard card**: as SYSTEM_ADMIN, confirm Online / Active today / Never logged in / Portal clients active today; confirm a non-admin staff user does **not** see the card or the presence columns.

## 11. Constraints honoured

No realtime websocket presence · no page-level surveillance · no route history · no tracking beyond login/last-seen metadata · no exposure outside admin users.
