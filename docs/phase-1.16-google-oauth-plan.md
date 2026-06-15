# Phase 1.16 — Google OAuth Sign-In (PLAN ONLY)

> **Status: DESIGN. No code, no migration.** Adds "Continue with Google" to the
> two existing, separate logins (`/login` staff, `/portal/login` portal) using
> Supabase Auth's Google provider — **without** open self-registration. Unknown
> Google emails are rejected; staff and portal identities never cross.

---

## 0. The core constraint (read this first)

Effitrans has two identity classes on **one** Supabase Auth project (DEC-B22):

- staff → `public.app_user` where **`app_user.id = auth.users.id`** (1:1 FK)
- portal → `public.client_user` where **`client_user.id = auth.users.id`** (1:1 FK)

Both existing login gates resolve the profile **by `auth.users.id`**, never by a
free-text email lookup — see [recordPortalLogin](../lib/portal/actions.ts) (looks up
`client_user` by `user.id`) and [getCurrentUser](../lib/auth/current-user.ts) (app_user by id).
**This is the security backbone and Google OAuth must preserve it.**

Two consequences drive the whole design:

1. **OAuth would otherwise be open registration.** Supabase creates an
   `auth.users` row for *any* Google account that completes the flow. So the
   platform must (a) **never** auto-create `app_user`/`client_user`, and (b)
   **reject + tear down** any session whose auth id has no matching active
   profile — otherwise an unknown Google user lands in an infinite
   middleware→/login bounce (every protected page redirects because
   `getCurrentUser` returns null).

2. **The Google identity must resolve to the *existing* auth id.** An invited
   staff member already has an `auth.users` row (id `X`) that `app_user.id = X`
   points to. For their Google login to "be" that staff user, Supabase must
   **link** the Google identity to user `X` — which it does **automatically when
   the email matches and is verified**. If linking did not happen, Google would
   mint a new id `Y`, `app_user.id = X ≠ Y`, and the gate (correctly) rejects.
   We must therefore **rely on verified-email identity linking** and **never**
   look up a profile by email to "find" the account (that would let session id
   `Y` impersonate app_user `X` — an escalation). The gate keys on id, and email
   match is an *additional* assertion, not the lookup key.

> **Rule restated in implementation terms:** "Google login succeeds **iff** the
> linked `auth.users.id` already has an **active** profile in the
> flow-appropriate table **and** that profile's email equals the verified Google
> email." Everything below enforces exactly this.

---

## 1. Supabase Google OAuth configuration

1. **Google Cloud Console:** create an OAuth 2.0 Client (Web application) under a
   project owned by Effitrans. Configure the OAuth consent screen (Internal if a
   Google Workspace domain is used — that alone restricts to the org's Workspace
   accounts; External otherwise). Authorized redirect URI (the **Supabase**
   callback, not ours):
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. **Supabase dashboard → Authentication → Providers → Google:** enable, paste
   the Google **Client ID** + **Client Secret**.
3. **Authentication → Providers → "Allow new users to sign up" = OFF.** This is
   the first line of defense against open registration: with sign-ups disabled,
   a brand-new Google email is rejected **at the Supabase layer** (no orphan
   `auth.users` is created). An **already-invited** user is not a "new sign-up" —
   linking a Google identity to their existing `auth.users` row still works.
4. **Authentication → "Link identities with the same email" = ON** (verified
   email linking). This is what lets invited staff/portal users use Google.
   Combined with (3), only provisioned accounts can ever complete OAuth.
5. Keep email/password enabled (both flows keep their current forms).

> Defense in depth: even with (3)+(4), the app-level gate (§5) still runs and is
> authoritative — config can be changed in the dashboard; the gate cannot be
> bypassed from outside.

---

## 2. Redirect URLs (Vercel)

Supabase **Authentication → URL Configuration → Redirect URLs** allowlist must
contain every post-OAuth return URL we pass as `redirectTo`:

- `https://<prod-domain>/auth/callback`            (staff)
- `https://<prod-domain>/portal/auth/callback`     (portal)
- Preview/staging: `https://<preview>/auth/callback` + `/portal/auth/callback`
  (use Supabase wildcard `https://*-effitrans.vercel.app/**` if previews are
  needed, or a dedicated staging Supabase project).
- Local dev: `http://localhost:3000/auth/callback` + `/portal/auth/callback`.

`Site URL` = the production domain. Anything not on the allowlist is refused by
Supabase, which blocks open-redirect attacks via a forged `redirectTo`.

---

## 3. Login UI changes

Both pages keep their existing email/password form and gain **one** button.

- **[/login](../app/(auth)/login/page.tsx) (staff):** add "Continuer avec Google" →
  ```
  supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback`, queryParams: { prompt: "select_account" } },
  })
  ```
- **[/portal/login](../app/portal/login/page.tsx) (portal):** identical, but
  `redirectTo: ${origin}/portal/auth/callback`.

The **distinct `redirectTo` per page is what keeps the flows separate** — the
callback path encodes which identity class is expected. Supabase uses the PKCE
flow by default (browser client), so no secret is exposed. New i18n keys:
`t.auth.google`, `t.portal.login.google`, plus rejection messages.

---

## 4. Callback handling

Two **Route Handlers** (server, public — see §middleware note), one per flow, so
"staff" and "portal" never share a code path:

- `app/auth/callback/route.ts`         → staff gate
- `app/portal/auth/callback/route.ts`  → portal gate

Each does:
1. Read `?code=` (and `?error=`). On provider error → redirect to the matching
   login with a generic error.
2. `supabase.auth.exchangeCodeForSession(code)` using a **route-handler server
   client** (`@supabase/ssr`, cookie read/write) — this sets the session cookie.
3. Run the **identity gate** (§5) for this flow.
4. **Pass** → redirect to `/dashboard` (staff) or `/portal` (portal).
   **Fail** → `supabase.auth.signOut()` **and** orphan cleanup (§5), then
   redirect to `/login?error=unauthorized` (or `/portal/login?error=...`) with a
   generic message.

> **Middleware note (must change):** [isPublicPath](../lib/supabase/middleware.ts)
> currently allows only `/login` and `/auth/*`. The callback runs **before** the
> session cookie exists, so an unauthenticated hit to `/portal/auth/callback`
> would be redirected to `/login`, dropping the `code`. The plan adds
> `/portal/auth/callback` **and** `/portal/login` to the public set (the latter
> is a latent gap today — portal login currently isn't whitelisted). `/auth/callback`
> is already covered by the `/auth` prefix.

---

## 5. Staff / portal identity resolution (the gate)

A new server-only helper per flow, reusing the existing by-id pattern. Pseudocode:

```
async function gateStaffOAuth():
  user = serverClient.auth.getUser()                      # the linked auth.users
  if !user: return reject("no_session")
  if !user.email_confirmed_at (or identity email not verified): return reject
  appUser = admin.from("app_user").select().eq("id", user.id).maybeSingle()   # BY ID
  if !appUser:                       return reject("not_staff")   # unknown / portal-only
  if appUser.status != "active":     return reject("disabled")
  if normalize(appUser.email) != normalize(user.email): return reject("email_mismatch")
  writeAudit(AUTH_LOGIN_GOOGLE, actorId=user.id, tenantId=appUser.tenant_id)
  return allow
```

Portal is the mirror image against `client_user` (reusing
[recordPortalLogin](../lib/portal/actions.ts)'s INVITED→ACTIVE activation +
`last_login_at` + audit), but additionally asserting the **verified email match**
and adding the Google audit code.

Why this enforces every rule:
- **Unknown Google email** → no row by id → `reject` → session torn down. ✔
- **Staff ⇏ portal / portal ⇏ staff** → the staff callback only consults
  `app_user`; a portal-only user has no `app_user` for that id → rejected (and
  vice versa). No auto-creation anywhere. ✔
- **Inactive** (`app_user.status='inactive'` / `client_user.status='DISABLED'`)
  → rejected. ✔
- **Email match** is asserted *after* the by-id lookup, so it can only ever
  *tighten* (never used to find an account) — closing the impersonation gap. ✔

**Orphan cleanup (open-registration backstop):** if the gate rejects because no
profile exists for `user.id` (i.e. Supabase still minted a fresh auth user
despite §1.3 — e.g. signups were temporarily on), the staff/portal callback
**deletes that orphan `auth.users` row via the admin client**
(`admin.auth.admin.deleteUser(user.id)`) before redirecting. We only ever delete
an auth user that has **no** `app_user` **and no** `client_user` — provisioned
accounts are never touched. This guarantees no unknown identity persists.

---

## 6. Security risks & mitigations

| Risk | Mitigation |
|---|---|
| **Open self-registration** via OAuth auto-provisioning | Supabase signups OFF (§1.3) + by-id gate rejects unknown + orphan `auth.users` deletion (§5) |
| **Email spoofing / unverified email** | Trust only Google **verified** email; gate checks `email_confirmed_at` / identity `email_verified`; reject otherwise |
| **Cross-identity escalation** (portal user gaining staff, or impersonating another profile) | Gate keys on `auth.users.id`, never an email lookup; each callback consults only its own table; email match is an extra assertion |
| **Identity-link hijack** (attacker links Google to a victim's account) | Linking only on **verified** matching email (Google-verified); attacker can't verify the victim's address. Keep "manual linking" off |
| **Open redirect** via forged `redirectTo` | Supabase Redirect URL allowlist (§2); we pass only our two fixed callback paths |
| **CSRF on the OAuth handshake** | Supabase **PKCE** flow (default for the browser client) — state + code-verifier bound to the browser |
| **Stale/disabled access** | Gate re-checks `status` on every login; deactivating `app_user`/`client_user` blocks the next Google login immediately (RLS already denies a deactivated user mid-session) |
| **Account collision** (same person password + Google) | Verified-email linking attaches Google to the *existing* `auth.users` id, so `app_user`/`client_user` still resolve — one identity, two sign-in methods |
| **Email change at Google** | Profile email is the source of truth; a changed Google email that no longer matches an active profile is rejected (email-mismatch). Email changes are an admin/invite operation, not self-service |
| **Audit gaps** | Dedicated audit events (§7); rejections are audited too (system-attributed) |
| RLS unaffected | No schema/policy change; identities still flow through `auth.uid()` → existing RLS holds |

---

## 7. Audit events

Add to [AuditActions](../lib/audit/events.ts):

```
AUTH_LOGIN_GOOGLE   = "auth.login.google"     // staff, actorId = app_user.id
PORTAL_LOGIN_GOOGLE = "portal.login.google"   // portal, clientUserId = client_user.id
AUTH_LOGIN_REJECTED = "auth.login.rejected"   // machine/system — unknown/disabled/mismatch (reason in `after`)
```

- Success events are **attributed** (staff `actorId`, portal `clientUserId`) —
  satisfies the audit validator's non-system attribution rule.
- `auth.login.rejected` is a **machine event** (no actor — the caller failed the
  gate); add it to the validator's `SYSTEM_MACHINE_ACTIONS` allowlist (same
  mechanism used for the 1.15B webhook events) so it can be written with a null
  actor, carrying `{ flow, reason }` in `after` and never an email in plaintext.
- Existing `AUTH_LOGIN` / `PORTAL_LOGIN` stay for password logins; the `.google`
  variants disambiguate the method in the trail.

---

## 8. Tests

- **Pure unit:** an `evaluateOAuthGate(profile, authEmail, flow)` helper
  (extracted so it's I/O-free) → table tests: active+match→allow; missing
  profile→reject(not_staff/not_portal); inactive→reject(disabled);
  email mismatch→reject; portal user through staff gate→reject; staff user
  through portal gate→reject. Email normalization (case/trim) cases.
- **Audit validator:** `auth.login.rejected` allowed with null actor;
  `auth.login.google` requires an actor (mirrors the 1.15B machine-event test).
- **RLS regression (SQL):** unchanged-guarantee — a `client_user` id still
  cannot read staff tables and vice versa (already covered by
  `rls_portal_test`); add an assertion that an `auth.users` row with **no**
  profile sees nothing (the orphan case).
- **Manual E2E (deployment):** §9 checklist.
- (No provider HTTP to mock — Supabase performs the Google exchange; we test the
  gate logic, which is the security-relevant part.)

---

## 9. Deployment checklist

1. Google Cloud: OAuth client + consent screen; copy Client ID/Secret.
2. Supabase: enable Google provider; **signups OFF**; verified-email linking ON;
   Site URL + Redirect URLs (prod + preview + local) per §2.
3. Vercel env: confirm `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` set; no new
   public secrets (Google secret lives only in Supabase).
4. Deploy; verify middleware passes `/auth/callback` + `/portal/auth/callback`
   + `/portal/login` without redirect.
5. **E2E — must all hold:**
   - Invited **staff** Google account → lands on `/dashboard`; `auth.login.google` audited.
   - Active **portal** Google account → lands on `/portal`; `portal.login.google` audited; INVITED flips ACTIVE.
   - **Unknown** Google email → rejected at `/login` with generic error; **no** `app_user`/`client_user` created; orphan `auth.users` removed; `auth.login.rejected` audited.
   - **Staff** account via the **portal** Google button → rejected (and reverse).
   - **Deactivated** staff/portal account → rejected.
   - Same person password ↔ Google (same verified email) → resolves to the **same** identity (no duplicate).
6. Confirm email/password login still works on both pages.
7. Rollback: disable the Google provider in Supabase — the buttons fail gracefully (provider error → generic message); password login unaffected.

---

## Invariants this plan preserves

- **No open registration** — signups off + by-id gate + orphan deletion.
- **Identity separation** — each callback checks only its own table; no
  auto-creation; keyed on `auth.users.id`, not email.
- **RLS + audit unchanged** — no schema/policy change; new attributed audit
  events; rejections recorded.
- **Two separate logins** — distinct pages, distinct callbacks, distinct
  `redirectTo`.

## Open decisions (for confirmation before build)
- **Q1 — Workspace restriction:** is staff on a Google **Workspace** domain? If
  so, an *Internal* consent screen + an optional `hd` domain hint hardens it
  further. (Recommended: yes if available.)
- **Q2 — Orphan handling:** delete the rejected orphan `auth.users` (recommended,
  cleanest) **or** just sign out and leave it inert (signups-off means it can't
  be created anyway, so deletion is belt-and-suspenders)?
- **Q3 — Portal Google at launch:** enable Google on **both** logins now, or
  **staff-only first** (portal keeps password until customers are ready)?
- **Q4 — Self-service email change:** out of scope (email stays an
  admin/invite-managed field) — confirm.
