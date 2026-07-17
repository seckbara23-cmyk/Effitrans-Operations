# Environment Variable Matrix — Phase 8.0A

Complete enumeration of every environment variable the application consumes (code-derived; **names and behavior only — never values**). Source of truth for resolution logic: `lib/env.ts`, `lib/ai/config.ts`, `lib/ai/provider.ts`, `lib/comms/provider.ts`, `lib/finance/providers/config.ts`, `lib/tracking/flags.ts`, `lib/process/flags.ts`, `lib/copilot/rate-limit.ts`.

Legend — **Class**: PUBLIC (NEXT_PUBLIC_, inlined into client bundle) · SRV (server-only) · FLAG · CRED (credential) · CFG. **Prod**: REQUIRED / RECOMMENDED / OPTIONAL / FORBIDDEN / PREVIEW-ONLY.

## Hard-required (app throws without them)

| Variable | Class | Prod | Behavior when absent |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | REQUIRED | throws `[env] Missing required…` at first use |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | REQUIRED | throws |
| `SUPABASE_SERVICE_ROLE_KEY` | CRED/SRV | REQUIRED | server env getter throws |

`DATABASE_URL` — CLI/migration tooling only; intentionally **not** read at runtime.

## Site & links

| Variable | Class | Prod | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | PUBLIC/CFG | **REQUIRED for pilot** (F-8) | falls back to `""` → invitation/welcome/notification/card links break silently |
| `NEXT_PUBLIC_MAP_TILE_URL` | PUBLIC/CFG | OPTIONAL | defaults to OpenStreetMap tiles |

## AI (provider-neutral layer)

| Variable | Class | Prod | Notes |
|---|---|---|---|
| `AI_COPILOT_ENABLED` | FLAG (kill switch) | OPTIONAL | enabled unless exactly `"false"`; `"false"` darkens all four copilots (503) |
| `AI_PROVIDER` | CFG | OPTIONAL | default `openai`; unknown → `invalid_config` |
| `AI_MODEL` | CFG | OPTIONAL (required for vllm) | openai default `gpt-4o-mini` |
| `AI_BASE_URL` | CRED/CFG | OPTIONAL (required for vllm) | openai default `api.openai.com/v1` |
| `AI_API_KEY` | CRED/SRV | PREVIEW-ONLY until Production AI is deliberately enabled | falls back to `OPENAI_API_KEY` |
| `OPENAI_API_KEY` / `OPENAI_COPILOT_MODEL` | CRED/CFG | back-compat aliases | same posture as above |
| `AI_REQUEST_TIMEOUT_MS` | CFG | OPTIONAL | 30 000 ms default, 180 000 max |
| `AI_LOCAL_PROVIDER_ENABLED` | FLAG | **FORBIDDEN in prod** (keep unset/false) | local providers dark by default |
| `OLLAMA_BASE_URL/MODEL/REQUEST_TIMEOUT_MS/THINKING/NUM_PREDICT/RETRY_ON_TIMEOUT` | CFG | FORBIDDEN in prod (dev-only) | Vercel guard refuses localhost anyway |
| `AI_ALLOW_INSECURE_HTTP` / `AI_ALLOW_NO_AUTH` | FLAG (security) | **FORBIDDEN** | escape hatches for the hosted-safety guard |
| `AI_BASE_URL_ALLOWLIST` | CFG (security) | RECOMMENDED when AI enabled | host pinning |
| `AI_FALLBACK_PROVIDER/MODEL/BASE_URL/API_KEY` | CFG/CRED | OPTIONAL | no silent fallback unless configured |

**Verified guard (I-5):** on Vercel (`VERCEL=1`), localhost AI URLs, plain-HTTP remotes, and unauthenticated local providers are refused (`unsafe_config` → 503) — a developer's Ollama config cannot leak into production behavior (`lib/ai/config.ts:301-314`, `lib/ai/provider.ts:67-69`).

## Copilot rate limits (all optional; safe defaults)

`COPILOT_USER_RATE_PER_MIN` (12) · `COPILOT_TENANT_RATE_PER_DAY` (2000) · `PORTAL_COPILOT_USER_RATE_PER_MIN` (6) · `PORTAL_COPILOT_TENANT_RATE_PER_DAY` (1000) · `EXECUTIVE_COPILOT_USER_RATE_PER_MIN` (12) · `EXECUTIVE_COPILOT_TENANT_RATE_PER_DAY` (1000). Over-limit → deterministic summary, never a failure.

## Email / notifications

| Variable | Class | Prod | Notes |
|---|---|---|---|
| `COMMUNICATIONS_EMAIL_PROVIDER` | FLAG/CFG | REQUIRED for pilot emails (`resend` or `smtp`) | unset → **no-op stub** (marked sent, nothing leaves) |
| `RESEND_API_KEY` | CRED | required when resend | missing → `resend_not_configured` |
| `COMMUNICATIONS_EMAIL_FROM` | CFG | required when resend | `resend.dev` sender **blocked in production** by code |
| `COMMUNICATIONS_EMAIL_DEBUG` | FLAG | OPTIONAL | logs would-send lines for the stub |
| `NOTIFICATIONS_EMAIL_ENABLED` | FLAG | OPTIONAL | default off — in-app only |

## Payments (dark by default)

`PAYMENTS_ENABLED` (master, default off) · `PAYMENTS_PROVIDERS` (default MOCK) · `PAYMENTS_INTENT_TTL_MINUTES` (30) · `PAYMENTS_WEBHOOK_SKEW_MINUTES` (15) · `PAYMENTS_MOCK_WEBHOOK_SECRET` · `WAVE_API_KEY` · `WAVE_WEBHOOK_SECRET` · `ORANGE_MONEY_CLIENT_ID/CLIENT_SECRET/WEBHOOK_SECRET`. A missing credential degrades that provider to "not configured" — never a crash. **Pilot: keep `PAYMENTS_ENABLED` unset.**

## Real-time tracking (dark by default)

`TRACKING_ENABLED` (master) · `DRIVER_MOBILE_TRACKING_ENABLED` · `PORTAL_LIVE_TRACKING_ENABLED` · `TRACKING_REALTIME_ENABLED` · `TRACKING_GEOFENCE_ENABLED` — sub-flags require the master.

## Process engine (dark by default)

`EFFITRANS_PROCESS_ENGINE_ENABLED` (master) · `EFFITRANS_PROCESS_COMPATIBILITY_ENABLED` · `EFFITRANS_PROCESS_OVERRIDE_ENABLED` · `EFFITRANS_PROCESS_WORKSPACES_ENABLED` · `EFFITRANS_PHYSICAL_INVOICE_DEPOSIT_ENABLED` · `EFFITRANS_COLLECTIONS_ENABLED` · `EFFITRANS_SHARE_DRIVER_PHONE` (default: driver's personal phone never shared).

## Portal

`PORTAL_CONTACT_EMAIL` / `PORTAL_CONTACT_PHONE` (RECOMMENDED — otherwise the UI shows a generic fallback) · `PORTAL_ALLOW_PASSWORD_EMAIL` (default false — temp password never emailed unless this AND an admin opt-in).

## Observability

`NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_DSN` — optional; today only flips `monitoringEnabled()`; forwarding requires wiring the SDK (F-9).

## Platform-injected

`VERCEL` (drives the AI hosted-safety guard) · `NODE_ENV` (drives the resend.dev production block). No `VERCEL_ENV` usage in code.

## Dev/eval-only

`EVAL_MODEL` · `EVAL_NUM_PREDICT` · `EVAL_LIMIT` · `OLLAMA_VERSION` — `scripts/eval` live-Ollama harness only. Never set in any deployed environment.

## Verification checklist results (Part 3)

- ✅ No secret uses `NEXT_PUBLIC_` (bundle scan I-2; DSN is public-by-design).
- ✅ No duplicate AI contract — one `AI_*` contract with documented `OPENAI_*` back-compat fallbacks.
- ✅ Local Ollama cannot affect production (I-5 guard, quoted above).
- ✅ Payment flags explicit and dark by default.
- ✅ Kill switches exist and are tested (`AI_COPILOT_ENABLED`, per-provider degradation).
- ⚠️ `NEXT_PUBLIC_SITE_URL` must be set in production (F-8).
- ⚠️ Presence/values per Vercel environment could not be read from this environment — **operator confirms** production has exactly: the 3 required Supabase vars, `NEXT_PUBLIC_SITE_URL`, email provider trio; and that Preview does **not** share the production `NEXT_PUBLIC_SUPABASE_URL` (F-6).
- ✅ No stale/deprecated keys found in code; `.env.example` gaps fixed in this phase (F-12).

## Environment separation (Part 2) — current truth

| Environment | Exists? | Notes |
|---|---|---|
| Local dev | ✅ | `.env.local` (gitignored); Docker unavailable on this workstation → local Supabase not runnable here (CI covers it) |
| Vercel Preview | ✅ (same project) | protected by Vercel auth; **must point at a non-production Supabase project — confirm (F-6)** |
| Staging | ❌ none dedicated | 6.0G posture: Preview + separate Supabase project acts as staging; still an operator-run step |
| Production | ✅ | currently behind Deployment Protection (F-1); no custom domain |
| Supabase envs | unverified from here | operator documents project ref(s) per environment |
| OpenAI projects | dev key only (if any); production project not created | Preview-only until deliberate enablement |
