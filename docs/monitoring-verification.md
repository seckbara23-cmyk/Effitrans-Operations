# Monitoring Verification Report (Phase 1.18 — C1)

**Goal:** verify error capture across every surface and document the test procedure + the Sentry rollout. Effitrans now routes all error/event reporting through **one seam** — `lib/observability/report.ts` (`reportError` / `reportMessage`) — which logs a structured `[observe]` line today and forwards to a monitor once the SDK is wired. This mirrors the codebase's dark-by-default pattern (no-op email provider, dark payment providers): observability degrades gracefully and turns on via env.

---

## 1. Instrumentation coverage

| Surface | Capture point | Mechanism | Status |
|---|---|---|---|
| **Client (segment)** | `app/error.tsx` | `reportError(scope: "client", event: "segment-error")` | ✅ Wired |
| **Client (root layout)** | `app/global-error.tsx` (new) | `reportError(scope: "client", event: "global-error")` | ✅ Wired |
| **Portal** | `app/portal/(app)/error.tsx` (new) | `reportError(scope: "portal", event: "portal-error")` | ✅ Wired |
| **Route handler** | `app/api/payments/webhook/[provider]/route.ts` | `reportError(scope: "webhook", event: "payments.webhook")` | ✅ Wired |
| **Auth / OAuth (staff)** | `app/auth/callback/route.ts` | `reportMessage` on code-exchange failure + gate rejection | ✅ Wired |
| **Auth / OAuth (portal)** | `app/portal/auth/callback/route.ts` | `reportMessage` on code-exchange failure + gate rejection | ✅ Wired |
| **Communications** | `lib/comms/queue.ts` (`queueAndSend`) | `reportMessage(scope: "comms", event: "comms.send_failed")` | ✅ Wired |
| **Server actions** | `lib/*/actions.ts` | return typed `{ ok:false, error }`; **also** surface unexpected throws through `reportError` | ⚠ Partial — see §3 |

### Notes on existing safety nets (already present, not changed)
- **Tenant isolation / RLS** errors throw and are caught by the boundaries above.
- **Audit log** (`audit_log`) records every *successful* mutation — complementary to error capture (the "what happened" vs the "what failed").
- Server actions are **defensive by contract**: they catch permission errors and return `{ ok:false, error }`, so the UI shows a message instead of crashing. Genuine unexpected throws propagate to `error.tsx` / `global-error.tsx`.

---

## 2. Test procedure

Run locally (`npm run dev`) and again on the deployed preview.

1. **Client boundary** — temporarily throw in a page component (`throw new Error("observe-test")`); load the page → app shows the retry card; console shows `[observe] {"level":"error","scope":"client","event":"segment-error",...}`. Revert.
2. **Global boundary** — throw in `app/layout.tsx` body once → `global-error.tsx` renders; `[observe] ... "event":"global-error"`. Revert.
3. **Portal boundary** — throw in a portal page → portal retry card; `[observe] ... "scope":"portal"`. Revert.
4. **Webhook** — `POST /api/payments/webhook/mock` (with `PAYMENTS_ENABLED=true`) and a malformed body → 500 to caller; `[observe] ... "event":"payments.webhook"` server-side. No internals leaked to the response.
5. **Auth** — attempt Google sign-in with a disabled/unknown identity → redirected to login with `?error=unauthorized`; `[observe] ... "event":"auth.callback.gate_rejected"`.
6. **Comms** — set `COMMUNICATIONS_EMAIL_PROVIDER=resend` **without** `RESEND_API_KEY`, trigger a send → message goes `FAILED`; `[observe] ... "event":"comms.send_failed","error":"resend_not_configured"`.
7. **Greppability** — confirm `[observe]` lines appear in Vercel runtime logs after deploy.

**Expected for all:** users never see a stack trace; every failure produces exactly one structured `[observe]` line with a stable `scope` + `event` for grouping.

---

## 3. Known gaps / follow-ups

- **Server-action throws** are caught and returned as `{ ok:false }`, but only a subset explicitly call `reportError`. Follow-up: add a thin `withReporting()` wrapper around action bodies so every unexpected throw is reported with `scope: "action"`. Low risk, deferred to keep this phase non-invasive.
- **No live monitor yet** — forwarding is a no-op until a DSN is set and the SDK wired (§4).
- **No alerting** — once Sentry is live, configure alert rules (error rate, new issue) → IT admin.

---

## 4. Sentry rollout (when approved)

The seam is ready; turning it on is additive and changes **no call sites**:

1. `npm i @sentry/nextjs`
2. Create `instrumentation.ts` at the repo root:
   ```ts
   export async function register() {
     if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
       const Sentry = await import("@sentry/nextjs");
       Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
     }
   }
   ```
3. Add a client init (`Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN })`) via the SDK's client config.
4. In `lib/observability/report.ts`, inside `reportError`, when `monitoringEnabled()`:
   ```ts
   Sentry.captureException(err, { tags: { scope: context.scope, event: context.event }, extra: context.extra });
   ```
   and `Sentry.captureMessage(...)` in `reportMessage`.
5. Set `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_DSN` in Vercel. Re-run the §2 procedure and confirm events arrive in Sentry.

**Recommendation:** for the controlled pilot, **log-only is acceptable** (Vercel captures `[observe]`). Wire Sentry before scaling beyond the first 1–3 customers so error trends and alerting are in place.
