# Effitrans Platform — Operational Runbook

Operator procedures for the multi-tenant platform (Phases 6.0A–6.0F). Platform actions
require an active `platform_admin` with the relevant `platform:*` permission. Nothing here
requires direct SQL against production; every step uses the console or a supported tool.

---

## Environment readiness

Confirm presence (never print values). `/api/copilot` GET and the Copilot config banner
report AI readiness without exposing the key.

**Required (core):**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — client + middleware.
- `SUPABASE_SERVICE_ROLE_KEY` — **server-only** (never `NEXT_PUBLIC_*`); powers gated actions/reads.
- `NEXT_PUBLIC_SITE_URL` — base for recovery/setup redirects (`/auth/update-password`).

**Email (invitations / welcome):**
- `COMMUNICATIONS_EMAIL_PROVIDER` (`resend` in prod), `RESEND_API_KEY`, `COMMUNICATIONS_EMAIL_FROM`.
- With no provider, invitations return a one-time link instead of claiming delivery (by design).

**AI (Platform + Ops Copilot — optional):**
- `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` (or `OPENAI_API_KEY`). Unset → Copilot returns a
  secret-free "not configured" diagnostic; no other feature is affected.

**Process rollout kill switches (default off):** `EFFITRANS_PROCESS_ENGINE_ENABLED`,
`EFFITRANS_PROCESS_WORKSPACES_ENABLED`, `EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED`,
`EFFITRANS_COLLECTIONS_ENABLED`. Global gate ANDed with the per-tenant rollout row.

**Deferred / keep unset in prod:** `PAYMENTS_ENABLED` (payments off; webhook 503s).
**Observability (optional):** `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.

**Vercel:** keep Preview and Production environments separate; `SUPABASE_SERVICE_ROLE_KEY`
scoped to server runtime only. No secret belongs in a `NEXT_PUBLIC_*` name.

---

## Procedures

### Provision a tenant
1. `/platform/companies/new` → complete the 7 steps (Identity → Profile → Branding → Modules/Rollout → Roles → First Administrator → Review).
2. Submit once. The wizard uses one provisioning key; a retry reuses the same key (idempotent RPC + slug guard). No partial rows appear before submit.
3. Verify the tenant appears in `/platform/companies` and the Audit tab shows the provisioning event.

### Recover from failed provisioning
- The RPC is transactional; a failed run leaves no partial tenant. **Retry the wizard** — the same provisioning key makes it idempotent; a changed slug that collides is rejected.
- If an auth user was created but no tenant (a rare orphan), see *Recover orphan auth user*.

### Resend a setup link / invitation
- `/platform/companies/[id]` → Users → eligible user → **Renvoyer** (email) or **Régénérer le lien** (one-time link shown once — copy it; it is never stored). Eligibility: active user who has not logged in.

### Recover an orphan auth user
- Re-run tenant user creation with the same email: `createUser` reconciles — an auth user with no `app_user` is **reused**, not re-created (heals the orphan). A duplicate with an existing profile returns `email_conflict`.

### Suspend / reactivate / archive a tenant
- `/platform/companies/[id]` → the lifecycle buttons (only valid transitions are shown). Confirm the dialog (it states users are signed out). On success it reports the transition + session-revocation summary.
- **Suspend/Archive** ban the tenant's auth users (revoke login+refresh) and block the tenant on the next request. **Reactivate** un-bans (users authenticate again). **Archive** is terminal; data is preserved and readable only by platform admins.

### Handle partial session revocation
- If the success dialog shows `X / Y · Z échec(s)`, the transition still applied and the tenant is blocked (next-request enforcement + the successful bans). Re-run the same lifecycle action if desired — banning is idempotent — or investigate the failing user ids via the audit `sessionRevocation` summary. **Never** treat a partial revocation as a failed transition.

### Investigate a failed email
- `/platform/companies/[id]` → Audit for `communication.failed` / `user.welcome.*`. Check `COMMUNICATIONS_EMAIL_PROVIDER` + `RESEND_API_KEY` presence. With no provider, delivery is honestly reported as "link returned", not sent.

### Inspect audit
- `/platform/audit` (all tenants) or `/platform/companies/[id]` → Audit (one tenant). Payloads carry safe metadata only; no secrets by construction.

### Validate tenant isolation
- CI runs `supabase/tests/rls_multitenant_acceptance_test.sql` (bidirectional) + the per-domain RLS suite on every push. To re-verify locally: `supabase db reset` then `psql … -f supabase/tests/rls_multitenant_acceptance_test.sql`.

### Disable Platform Copilot
- Remove the `platform:copilot:read` grant from a role, or unset the AI provider env (`AI_PROVIDER`/`AI_API_KEY`) — the Copilot returns a "not configured" diagnostic and no context is built. It is read-only regardless; there is no action to disable.

### Rotate provider credentials
- Rotate `RESEND_API_KEY` / `AI_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the Vercel env, redeploy. Old sessions are unaffected by an AI/email key rotation; a service-role rotation requires the new key to be present before the next server render.

### Incident response — suspected cross-tenant access
1. Capture the audit slice for both tenants (`/platform/companies/[id]` → Audit) and the timeframe.
2. If a tenant should be frozen, **Suspend** it (bans sessions + blocks next request).
3. Verify RLS still holds: re-run the bidirectional isolation test in CI/locally.
4. Do **not** grant a platform admin a tenant identity to "look" — use the platform console reads (safe metadata only); there is no tenant impersonation.
