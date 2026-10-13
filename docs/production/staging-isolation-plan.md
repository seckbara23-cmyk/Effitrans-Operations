# EFF-STAGING-ISOLATION-01 — dedicated Staging architecture and deployment plan

**Status: architecture approved in principle. PHASE A IMPLEMENTED (repository only) on branch `chore/env-binding-guard-01`; Phase B (Supabase project, Vercel variables) NOT started and requires explicit approval.** No production change, no environment-variable change, no migration applied, no project created, no secret printed. Analysis of `main` @ `616a223` (the SHA production serves), 2026-10-12.

### What Phase A installed (EFF-STAGING-ISOLATION-02)

| File | Role |
|---|---|
| `lib/env/project-binding.mjs` | **The rule, once.** Pure — no `process.env`, no I/O, no node builtins — so the app (TypeScript via `allowJs`), `next.config.mjs` and the operator scripts share one implementation instead of three copies. |
| `lib/env/binding-runtime.ts` | `server-only`: reads the environment, caches the verdict, throws on refusal, renders the public report. |
| `lib/supabase/admin.ts` | Asserts before constructing the **service-role** client — the choke point for all 237 privileged modules. |
| `lib/supabase/server.ts` | Asserts before constructing the user-context client — six modules write through it. |
| `next.config.mjs` | **Build-time hard gate.** Protects the browser surface, because `NEXT_PUBLIC_SUPABASE_URL` is baked into the bundle here. Immune to a changed Vercel Build Command. |
| `scripts/check-env-binding.mjs` | `prebuild` + `predev` gate; `--dotenv` for local `.env.local`; `--json` for machines. |
| `scripts/gate/verify-deployment-binding.mjs` | Read-only external probe: compares two deployments' bindings via `/api/version`. |
| `app/api/version/route.ts` | Publishes `db: { envClass, target, refHint, refFingerprint, status, verified }` — no key, host, URL or full ref. |
| `.env.example` | Documents `PRODUCTION_SUPABASE_PROJECT_REF`, `ENV_BINDING_STRICT` and the previously **undocumented** `EFFITRANS_EC_INBOUND_ENABLED`. |
| `tests/env-binding-guard-01.test.ts` | 31 tests: the truth table, the runtime refusal, the wiring, and the three states that must NOT fire. |

**It is inert until configured.** With `PRODUCTION_SUPABASE_PROJECT_REF` unset — today's state everywhere — every verdict is `ok` with a non-verified status that the build log and `/api/version` report. Production behaviour is unchanged until Phase B installs the expectation.

Predecessor: **EFF-PR33-PREVIEW-DATA-ISOLATION-01** — verdict **SHARED**: Production, the repo-linked migration target and the ref observed baked into a preview build on 2026-09-14 are one Supabase project (`xtpp…hdlc`); one Vercel project serves production and every preview; no Supabase branching; audit item **F-6** (phase 8.0A, *"previews and local dev must NOT use the production Supabase project"*, pilot-blocking) has never been closed.

---

## 1. Inventory of everything that must be re-pointed or contained

### 1.1 Environment variables (from `.env.example`, the authoritative catalogue)

`MUST DIFFER` = a staging value is required for isolation. `MUST BE DARK` = must stay unset/false in Preview or it can reach the outside world. `MAY SHARE` = harmless to inherit from Production.

| Group | Variables | Staging posture |
|---|---|---|
| **Supabase (the isolation boundary)** | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` | **MUST DIFFER** — all four. `DATABASE_URL` is used only by the migration CLI, never at runtime. |
| **Application URL** | `NEXT_PUBLIC_SITE_URL` | **MUST DIFFER** — 9 modules build outbound links from it (`lib/comms/actions.ts`, `lib/customer-notify/service.ts`, `lib/platform/invitation-actions.ts`, `lib/platform/provisioning/engine.ts`, `lib/portal/admin-actions.ts`, `lib/process/billing/actions.ts`, `lib/users/welcome-send.ts`, `lib/brand/server/card-service.ts`, `lib/platform/ops/readers.ts`). A production value here makes a staging email link into Production. |
| **Email** | `COMMUNICATIONS_EMAIL_PROVIDER`, `RESEND_API_KEY`, `COMMUNICATIONS_EMAIL_FROM`, `COMMUNICATIONS_EMAIL_DEBUG`, `NOTIFICATIONS_EMAIL_ENABLED`, `PORTAL_ALLOW_PASSWORD_EMAIL` | **MUST BE DARK** (provider unset). `lib/comms/provider.ts` is *dark by default*: with no provider selected it is a no-op/console provider that "accepts" and returns ok, so the whole pipeline is exercised and **nothing leaves**. That is the correct staging configuration — do **not** give staging a real Resend key. |
| **Payments** | `PAYMENTS_ENABLED`, `PAYMENTS_PROVIDERS`, `PAYMENTS_MOCK_WEBHOOK_SECRET`, `PAYMENTS_INTENT_TTL_MINUTES`, `PAYMENTS_WEBHOOK_SKEW_MINUTES`, `WAVE_API_KEY`, `WAVE_WEBHOOK_SECRET`, `ORANGE_MONEY_CLIENT_ID/_SECRET/_WEBHOOK_SECRET` | **MOCK ONLY.** `paymentsEnabled()` is `=== "true"`; `enabledProviders()` defaults to `MOCK`; `isProviderConfigured("MOCK")` needs only a dev secret. Staging: `PAYMENTS_ENABLED=true`, `PAYMENTS_PROVIDERS=MOCK`, a staging-only `PAYMENTS_MOCK_WEBHOOK_SECRET`, and **no** Wave/Orange credentials. |
| **AI / copilots** | `AI_COPILOT_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_COPILOT_MODEL`, `AI_FALLBACK_*`, `AI_REQUEST_TIMEOUT_MS`, `AI_BASE_URL_ALLOWLIST`, `AI_ALLOW_INSECURE_HTTP`, `AI_ALLOW_NO_AUTH`, `AI_LOCAL_PROVIDER_ENABLED`, `OLLAMA_*` | **MUST DIFFER or be dark.** Use a separate (or no) AI key so staging usage is not billed to, or rate-limited with, Production. `AI_ALLOW_INSECURE_HTTP` / `AI_ALLOW_NO_AUTH` stay unset; `AI_LOCAL_PROVIDER_ENABLED` stays unset (`lib/ai/config.ts` already refuses a localhost base on a hosted deployment). |
| **Monitoring** | `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` | **SHOULD DIFFER** — a staging DSN or none, so UAT noise never pollutes production error budgets (`lib/observability/report.ts`). |
| **Tracking flags** | `TRACKING_ENABLED`, `DRIVER_MOBILE_TRACKING_ENABLED`, `PORTAL_LIVE_TRACKING_ENABLED`, `TRACKING_REALTIME_ENABLED`, `TRACKING_GEOFENCE_ENABLED` | **MUST DIFFER (ON in staging).** They are dark in Production; the PR #33 driver UAT needs the first two `true`. |
| **Process engine flags** | `EFFITRANS_PROCESS_ENGINE_ENABLED` + 10 sub-flags, `EFFITRANS_MESSAGING_CENTER_ENABLED`, `EFFITRANS_EC_INBOUND_ENABLED` | **SET DELIBERATELY** — mirror Production for faithful UAT, or go further to test a dark feature. A sub-flag alone does nothing (master switch required). ⚠ **`EFFITRANS_EC_INBOUND_ENABLED` is undocumented**: it gates the inbound-mail webhook (`lib/ec/inbound/providers.ts:37`, `lib/ec/mailboxes/service.ts:207`) but appears nowhere in `.env.example`. Add it there (a separate, trivial fix). |
| **Portal contact / misc** | `PORTAL_CONTACT_EMAIL`, `PORTAL_CONTACT_PHONE` | **SHOULD DIFFER** — a staging page must not publish the real support channels. |
| **Maps / imagery** | `NEXT_PUBLIC_MAP_TILE_URL`, `TRANSPORT_SATELLITE_TILE_URL`, `TRANSPORT_SATELLITE_TILE_SIZE`, `TRANSPORT_SATELLITE_LABELS_TILE_URL`, `TRANSPORT_SATELLITE_ATTRIBUTION`, `TRANSPORT_SATELLITE_DEFAULT` | **MAY SHARE / Preview-only key.** Tile quota is the only shared resource; an Esri key restricted to `https://*.vercel.app` is Preview-scoped already (see the satellite doc). |
| **Copilot rate limits** | `COPILOT_*`, `PORTAL_COPILOT_*`, `EXECUTIVE_COPILOT_*` | **MAY SHARE.** |

### 1.2 Supabase clients and the service-role surface

| Client | File | Key | Reach |
|---|---|---|---|
| Browser (RLS-bound) | `lib/supabase/client.ts` | anon | the user's own rows |
| Server, user context (RLS-bound) | `lib/supabase/server.ts` | anon + request cookies | the user's own rows |
| Middleware (session refresh) | `lib/supabase/middleware.ts` | anon, from `process.env` directly | session only |
| **Admin** | `lib/supabase/admin.ts` | **service-role — bypasses RLS entirely** | **everything** |

`getAdminSupabaseClient()` composes `env.NEXT_PUBLIC_SUPABASE_URL` + `env.SUPABASE_SERVICE_ROLE_KEY` and is used by **237 modules** — every driver write, every workflow transition, every finance action. **This single function is the whole write surface and therefore the single best place to enforce the binding guard (§8).** No write path anywhere consults `VERCEL_ENV`: it is read only by `app/api/version/route.ts:22` and `lib/platform/ops/readers.ts:132`, for display.

### 1.3 Storage buckets — created by migrations, so they come free with a staging project

Declared via `insert into storage.buckets` in migrations: **`documents`, `brand-assets`, `ec-inbound`, `finance-expense`, `hr-documents`, `messaging-attachments`** (6). Because they are migration-created, a staging project that applies all 151 migrations has the same buckets with the same policies, in its own storage namespace — **storage isolation is automatic once the project is separate**. Only `ec-inbound` is referenced by name in application code.

### 1.4 Authentication callbacks and redirect surface

Four return URLs are constructed from `window.location.origin` (so they follow whatever host serves the page) plus two built from `NEXT_PUBLIC_SITE_URL` (so they follow configuration):

| Path | Built from | Where |
|---|---|---|
| `/auth/callback` | `window.location.origin` | `app/(auth)/login/page.tsx:55` |
| `/auth/update-password` | `window.location.origin` | `app/(auth)/login/page.tsx:101` |
| `/portal/auth/callback` | `window.location.origin` | `app/portal/login/page.tsx:64` |
| `/portal/auth/update-password` | `window.location.origin` | `app/portal/login/page.tsx:112` |
| `/auth/update-password` (invitations) | **`NEXT_PUBLIC_SITE_URL`** | `lib/platform/invitation-actions.ts:140,185` |
| `/auth/update-password` (provisioning) | **`NEXT_PUBLIC_SITE_URL`** | `lib/platform/provisioning/engine.ts:249` |

Consequence: Google OAuth and password-reset flows on a staging host need **that host's** callbacks in the staging project's redirect allowlist, and invitation links need `NEXT_PUBLIC_SITE_URL` set to the staging host.

### 1.5 Scheduled jobs — none

No Vercel crons (`vercel.json` contains only `{"regions":["dub1"]}`), no `schedule:` in either GitHub workflow, no `pg_cron` in any migration. **Nothing fires on a timer**, so staging introduces no scheduled-job duplication risk. (All "recurring" behaviour in the platform is request-triggered: `components/transport/live-refresh.tsx` polls from the browser at 30 s.)

### 1.6 Inbound webhooks (the only externally-callable write paths)

| Route | Gate | Staging posture |
|---|---|---|
| `POST /api/payments/webhook/[provider]` | `paymentsEnabled()`; real providers return `not_configured` (503); only MOCK completes a flow; signature + skew verified | MOCK only, staging-only secret. **Never register the staging URL with Wave/Orange Money.** |
| `POST /api/ec/inbound/[provider]` | dark unless `EFFITRANS_EC_INBOUND_ENABLED=true`; secured entirely by signature verification over the raw body | Keep dark, or use a staging-only signing secret and a test mailbox. **Never point the production inbound-mail provider at staging.** |
| `POST /api/driver/positions` | session-owned, driver-only, flag-gated | needs the tracking flags ON in staging |

Everything else under `app/api/**` is authenticated app surface (copilots, PDFs, exports, diagnostics, `workspaces`) plus the public `GET /api/version`.

### 1.7 External integrations

Only two modules reach the internet: `lib/comms/provider.ts` (Resend HTTP / SMTP) and `lib/ai/config.ts` (OpenAI-compatible endpoints, with a hosted-safety guard and an optional host allowlist). Map/satellite tiles are fetched **by the browser**, not the server. **There is no SMS integration anywhere in the codebase** — the requirement's SMS item has no surface to contain today; if one is added later it must enter this table dark-by-default like email.

---

## 2. Target architecture

```
                    ┌──────────────────────── Vercel project: effitrans-operations ───────────────────────┐
  push to main  →   │  Production env   →  NEXT_PUBLIC_SUPABASE_URL = <prod ref>   ──────┐                │
                    │                                                                    ├──→ Supabase PROD  (xtpp…hdlc)
  PR / branch   →   │  Preview env      →  NEXT_PUBLIC_SUPABASE_URL = <stag ref>  ──┐    │     151 migrations, real data
                    │   (branch-scoped where needed)                                 │   │     service-role = production
                    └────────────────────────────────────────────────────────────────┼───┘
                                                                                     └──→ Supabase STAGING (new ref)
  local dev     →   .env.local → staging or local Docker  ───────────────────────────┘        151 migrations, seed,
                                                                                              synthetic data only
  CI (rls-tests)→   ephemeral `supabase start` + `db reset` (unchanged — NOT staging)
```

Four hard rules the architecture rests on:

1. **One Supabase project per environment class.** Production, Staging, and the ephemeral CI database. No branching product is used (none is configured, and none is needed).
2. **`--linked` means Production, always.** The CLI's linked context is just two files (`supabase/.temp/project-ref` and `pooler-url`), and `--linked` is a direct pooler connection, not a Management API path. Staging work therefore uses **`--db-url <staging pooler>`** and never rewrites `supabase/.temp`. Rewriting it would silently re-aim `migration:guard`, `migrate-production.mjs` and every read-only `db query --linked` at the wrong database.
3. **`NEXT_PUBLIC_*` is baked at build time.** Changing a Preview variable does not change an existing deployment — a **redeploy is mandatory** (§4).
4. **The app refuses the wrong binding itself** (§8), so the configuration is not the only thing standing between a preview and production data.

---

## 3. Build the Staging Supabase project (requirement 2)

### 3.1 Provision

1. Supabase dashboard → **New project** in the same organization. Name `effitrans-staging`. **Region: the same as Production** (keeps latency behaviour comparable; Production currently runs on Vercel `dub1`). Record the new project ref — it is not a secret, but keep it out of chat/commits by habit.
2. Note the **pooler connection string** (Project Settings → Database → Connection pooling). Treated as a credential: never printed, never committed.
3. Plan: see §9 for cost. **Free-tier projects pause after a period of inactivity** — a paused staging project makes a UAT look like a platform outage, so Pro is the operationally honest choice if UAT is ongoing (verify current Supabase pricing and pause rules before committing).

### 3.2 Apply the 151 governed migrations, in order

The proven path already exists and is exercised on every CI run: `supabase db reset` applies all 151 from empty, then ~100 SQL suites run against the result (`.github/workflows/ci.yml`, job `rls-tests`). The remote equivalent, without touching the production link context:

```
# From the repository root, on main. Confirm the flag exists on the pinned CLI first:
npx -y supabase@2.106.0 db push --help

npx -y supabase@2.106.0 db push --db-url "<STAGING_POOLER_URL>"
```

`db push` applies every migration the target's `supabase_migrations.schema_migrations` ledger lacks, **in version order**, and records each one. On an empty project that is all 151. The governed `scripts/migrate-production.mjs` is deliberately **not** used here: it is the production one-at-a-time path with its own integrity gate, and staging is being built from empty.

### 3.3 Seed — the step that is easy to miss

`supabase/seed.sql` is applied by `db reset` **locally** and is **not** applied by `db push`. Staging needs it explicitly (it is idempotent and foundation-only: the single `organization` row `00000000-0000-0000-0000-000000000001`, platform metadata, branding):

```
psql "<STAGING_POOLER_URL>" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Then, for a usable staging estate, the existing bootstrap script:

```
psql "<STAGING_POOLER_URL>" -v ON_ERROR_STOP=1 -f supabase/scripts/bootstrap_platform_super_admin.sql
```

Optional: `supabase/demo/aging_preview_dataset.sql` for receivables-aging UAT. **Do not** apply `supabase/data-corrections/*` — those are one-off production corrections.

### 3.4 Verify the staging build (read-only)

| Check | Command | Expected |
|---|---|---|
| Ledger completeness | `psql "<STAGING>" -c "select count(*) from supabase_migrations.schema_migrations"` | **151** |
| Repo ↔ ledger agreement | `node scripts/migration-integrity.mjs --db-url "<STAGING>"` | `CLEAN` (confirm the script accepts `--db-url`; it advertises `--linked \| --local \| --db-url <url> \| --project-ref … --pooler-url …`) |
| Every verifier passes where its migration IS applied | `node scripts/verify-migrations.mjs` against staging | all 14 companion verifiers pass; read-only by construction |
| Buckets | `psql "<STAGING>" -c "select id from storage.buckets order by 1"` | the 6 of §1.3 |
| RLS enabled | `psql "<STAGING>" -c "select count(*) from pg_policies where schemaname='public'"` | same order of magnitude as Production (compare, don't assume a number) |

**Do not run `npm run test:rls` (or any `supabase/tests/rls_*.sql`) against Staging.** Those suites INSERT fixture tenants and `@test.local` users; `scripts/guard-local-db.mjs` exists precisely because that suite was once pointed at Production and left fixture rows there. They belong to the disposable local/CI database. Staging is a *long-lived* environment and must not accumulate fixtures.

---

## 4. Vercel Preview variables and binding (requirements 3 and 4)

### 4.1 The variables to create, Preview-scoped

Vercel → project `effitrans-operations` → **Settings → Environment Variables**. For each: **Environment = Preview only**, type **Sensitive** for the two keys.

| Name | Value | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-ref>.supabase.co` | inlined into the client bundle at build time |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key | public by design, still mark Sensitive |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service-role key | **Sensitive.** Never in a `NEXT_PUBLIC_` name, never in the repo |
| `NEXT_PUBLIC_SITE_URL` | the staging/preview host (see §4.3) | otherwise staging emails link to Production |
| `TRACKING_ENABLED`, `DRIVER_MOBILE_TRACKING_ENABLED` | `true` | needed by the PR #33 driver UAT |
| `PAYMENTS_ENABLED` / `PAYMENTS_PROVIDERS` / `PAYMENTS_MOCK_WEBHOOK_SECRET` | `true` / `MOCK` / staging-only secret | mock rails only |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | staging DSN or empty | keep UAT noise out of production monitoring |
| `PORTAL_CONTACT_EMAIL`, `PORTAL_CONTACT_PHONE` | staging placeholders | never publish the real support channels |
| `COMMUNICATIONS_EMAIL_PROVIDER`, `RESEND_API_KEY` | **do not create** | absence = the no-op provider; nothing leaves |

**The critical Vercel semantic:** a variable set for *All Environments* is inherited by Preview. Creating a Preview-scoped variable of the same name **overrides** it for Preview. Verify in the UI that each of the four Supabase/URL rows shows **Preview** (and not *All*) before trusting the isolation.

### 4.2 Branch-specific overrides — when and when not

Branch scoping (Environment = Preview + a branch name) is the right tool for a value that belongs to **one** branch — e.g. the Esri satellite key while PR #33/#32-style work is in flight. It is the **wrong** tool for the Supabase binding: a branch-scoped Supabase URL would isolate one branch and leave every other preview pointing at Production. **Bind Supabase at the Preview level, unscoped by branch.**

### 4.3 `NEXT_PUBLIC_SITE_URL` on previews

Preview hostnames are generated per deployment (`effitrans-operations-git-<branch-hash>-<team>.vercel.app`), so no single literal is correct for all of them. Three options, in order of preference:

1. **A stable staging alias.** Assign a Vercel domain alias (e.g. `effitrans-staging.vercel.app`) that always points at the newest preview of a chosen branch, and set `NEXT_PUBLIC_SITE_URL` to it. One stable value, one allowlist entry, emails land somewhere real.
2. Set it to the branch alias of the branch you UAT from, accepting that other previews' links are wrong (they go nowhere harmful — a non-existent host — rather than to Production).
3. Leave it empty on Preview. Links degrade to relative/empty (`?? ""`), which is visibly broken but **never points at Production** — the safe failure.

Never leave the Production value in place for Preview.

### 4.4 Redeployment is mandatory

`NEXT_PUBLIC_*` values are compiled into the client bundle at build time. After creating the variables, **redeploy** the branch (Vercel → Deployments → the branch's newest → ⋯ → Redeploy) or push an empty commit. An existing preview keeps whatever it was built with — this is exactly why the prior audit could not clear the current PR #33 deployment.

---

## 5. Staging test data (requirement 5) — synthetic only

**Constraint honoured: no Production personal data is copied.** No `pg_dump` of Production, no anonymised export, no re-use of real client, employee or driver identities. Staging data is *constructed*.

### 5.1 Accounts and roles

Create accounts through **Supabase Auth on the staging project** (dashboard → Authentication → Add user, or `auth.admin` from a one-off script), then link an `app_user` row and grant roles (`user_role`), following `supabase/scripts/bootstrap_platform_super_admin.sql` as the pattern.

**Use `@staging.invalid` addresses.** `.invalid` is reserved by RFC 2606 and can never resolve, so even a misconfigured provider cannot deliver a staging email to anyone. Minimum cast for end-to-end UAT of the 26-step process:

| Account | Roles | Needed for |
|---|---|---|
| `admin@staging.invalid` | `SYSTEM_ADMIN` | setup, overrides |
| `am@staging.invalid` | `ACCOUNT_MANAGER` | dossier opening, step 16, completeness (19) |
| `coord@staging.invalid` | `COORDINATOR` | reception, pickup (`transport:update`), POD handoff (17), completeness (18) |
| `transit@staging.invalid` | `CUSTOMS_DECLARANT` | steps 5–11 |
| `chief@staging.invalid` | `CHIEF_OF_TRANSIT` | customs validation (7), release approval, `document:approve` |
| `field@staging.invalid` | `CUSTOMS_FIELD_AGENT` | BAE / field clearance (13) |
| `transport@staging.invalid` | `TRANSPORT_OFFICER` | assignment (14), `transport:complete` |
| `driver@staging.invalid` | `DRIVER` | the PR #33 mission UAT |
| `driver2@staging.invalid` | `DRIVER` | cross-driver isolation checks |
| `billing@staging.invalid` | `BILLING_OFFICER` | invoice draft (20), dispatch (22) |
| `finance@staging.invalid` | `FINANCE_OFFICER` | invoice validation (21) — **must differ from billing** |
| `ops@staging.invalid` | `OPS_SUPERVISOR` | supervised overrides |
| `client@staging.invalid` | portal `client_user` | portal visibility checks |

**Maker/checker needs genuinely distinct accounts.** `customs_validation` (6→7), `invoice_validation` (20→21) and `completeness_review` (18→19) all refuse the same actor twice; POD verification must be performed by someone other than the uploader. A single shared admin account cannot test any of them.

### 5.2 Synthetic dossiers — build them through the application, not SQL

Create dossiers via the app's own flows (`createFile` → `openDossierWorkflow`), so every row is coherent with the process engine, the numbering sequence and the audit log. Raw-SQL dossiers drift from the engine and produce UAT results that mean nothing. Suggested estate:

| Dossier | State to reach | Exercises |
|---|---|---|
| `S-1` | fresh IMP, documents unverified | steps 1–5, receivability |
| `S-2` | customs `RELEASED`, transport at **`DRIVER_ASSIGNED`** | **PR #33 pickup-pending messaging** (the exact 00014 shape) |
| `S-3` | customs `RELEASED`, transport at **`PICKED_UP`**, driver assigned, tracking session live | **PR #33 return-leg GPS, evidence, delivery** |
| `S-4` | `DELIVERED`, signed delivery note uploaded, not yet verified | POD verification + maker/checker |
| `S-5` | `POD_RECEIVED`, steps 18/19 complete | billing readiness, invoice lifecycle |
| `S-6` | invoice `ISSUED`, part-paid | receivables, aging, collections |
| `S-7` | cancelled / blocked transport | refusal messaging |

### 5.3 Driver missions and delivery evidence

With the tracking flags ON: assign `driver@staging.invalid` to `S-2` and `S-3`; from a phone or a browser with geolocation, start the mission, let a few fixes record, confirm pickup, tap « Démarrer le retour », then run the PR #33 checklist. Evidence files must be **synthetic** — a photographed blank sheet, a scribbled signature, a generated PDF. Never a real client's signed delivery note.

### 5.4 Finance UAT scenarios

1. Billing blocked before steps 18+19 (`dossier_not_billing_ready`) — prove the gate, on `S-4`.
2. `S-5`: draft → submit → validate with **billing ≠ finance** accounts; confirm the maker/checker refusal when the same account tries both.
3. Issue, then dispatch; confirm the invoice is client-visible in the portal by RLS (`client@staging.invalid`).
4. Record a part payment, then full payment; confirm the archive handoff fires.
5. MOCK payment intent + webhook with the staging secret; confirm signature and skew rejection paths.
6. Expense authorisation chain with distinct signers.

---

## 6. Containing outbound effects (requirement 6)

| Channel | Mechanism that contains it | Residual risk |
|---|---|---|
| **Email** | `COMMUNICATIONS_EMAIL_PROVIDER` unset ⇒ no-op/console provider "accepts" and returns ok; only a real provider's acceptance may mark a message `SENT`. Addresses are `@staging.invalid` (RFC 2606, undeliverable). | Someone sets a real `RESEND_API_KEY` on Preview "to test email". Mitigate: documented prohibition + the CI assertion in §8.5. |
| **SMS** | No SMS integration exists in the codebase. | A future one must land dark-by-default. |
| **Payments** | `PAYMENTS_PROVIDERS=MOCK`; real providers answer `not_configured` (503) without credentials; staging-only mock secret. | Registering the staging webhook URL with a real PSP. Prohibited in §1.6. |
| **Inbound mail (EC)** | Dark unless `EFFITRANS_EC_INBOUND_ENABLED=true`, and secured by signature over the raw body. | Pointing the production mail provider at the staging URL. Prohibited. |
| **AI** | Separate or absent key; `AI_COPILOT_ENABLED=false` darkens all four copilots (503); the hosted-safety guard already refuses localhost bases and off-allowlist hosts. | Cost only, if a shared key is used. |
| **Tiles / imagery** | Browser-fetched; a Preview-scoped, origin-restricted Esri key. | Quota only. |
| **Production database** | §8 — the guard. | See §11 risks. |
| **Production deployments** | Staging work never pushes to `main`; `migrate-production.yml` remains `workflow_dispatch` only, human-dispatched. | Unchanged by this plan. |

---

## 7. Auth, URLs, RLS, storage and service-role boundaries (requirement 7)

### 7.1 Staging Supabase Auth → URL Configuration

* **Site URL** = the staging host from §4.3.
* **Redirect URLs** must include, for the staging host(s): `/auth/callback`, `/auth/update-password`, `/portal/auth/callback`, `/portal/auth/update-password`. Because preview hostnames vary, add the wildcard form `https://effitrans-operations-git-*-<team>.vercel.app/**` (Supabase supports `*` wildcards in redirect patterns — verify the exact matching rules in the dashboard) or standardise on the stable alias of §4.3, which needs only four literal entries.
* **Google provider**: a staging OAuth client, signups OFF, verified-email linking ON — mirroring `docs/phase-1.16-google-oauth-plan.md` §2. Never add a staging host to the **Production** project's allowlist: that is the open-redirect hole the allowlist exists to close, and it would let a staging page complete a production login.
* An un-allowlisted `redirectTo` makes Supabase return the browser to the project's Site URL — the precise failure mode diagnosed in EFF-PREVIEW-AUTH-01. Getting this list right is what prevents "login bounces back to /login" on staging.

### 7.2 RLS

RLS policies are created by the migrations, so Staging gets the identical policy set — nothing to configure. Verify by comparing `pg_policies` counts (§3.4) and by running the **tenant-isolation acceptance** reasoning manually on staging data (two tenants' rows are not visible across tenants). Remember: the fixture-writing `rls_*` suites stay on the local/CI database (§3.4).

### 7.3 Storage

Separate project ⇒ separate buckets and objects, created by migration with their policies. Nothing in Production storage is reachable from Staging. Verify the 6 bucket ids and spot-check that a staging document's `storage_path` resolves only within the staging project.

### 7.4 Service-role boundary

The staging service-role key must exist **only** in Vercel's Preview scope (and a developer's gitignored `.env.local`). It must never appear in `.env.example`, a commit, a log, a PR comment, or a `NEXT_PUBLIC_` name. The guard of §8 adds the complementary rule: **a production service-role key must be unusable from a non-production deployment**, so even a mis-paste cannot write Production.

---

## 8. Automated safeguards (requirement 8) — design

Configuration alone is not a control: it was configuration that produced the current state. Five layers, in the idiom the repository already uses (`scripts/guard-local-db.mjs`, the AI hosted-safety guard).

### 8.1 A pure guard module — `lib/env/project-binding.ts`

```ts
export type EnvClass = "production" | "preview" | "development";
export function environmentClass(env): EnvClass;              // VERCEL_ENV, else local
export function projectRefOf(supabaseUrl: string): string | null;  // https://<ref>.supabase.co
export function assertProjectBinding(env): { ok: true } | { ok: false; reason: string };
```

The rule, stated once: **if the environment class is not `production` and the Supabase project ref equals the production ref, refuse.** The production ref comes from a new non-secret variable `PRODUCTION_SUPABASE_PROJECT_REF` (it is already public in the production bundle; naming it explicitly is what makes the comparison possible). No escape hatch — deliberately. The precedent `AI_ALLOW_INSECURE_HTTP` exists and is marked **FORBIDDEN in production** in the environment matrix; this guard should not acquire a sibling.

**Fail-open for production, fail-closed everywhere else.** The guard can only ever refuse a non-production environment, so a bug in it cannot take Production down.

### 8.2 Build-time check (strongest — a misconfigured preview never ships)

Call the guard from `next.config.mjs` (which already exports a config object and runs on every build) and `throw` on refusal. `VERCEL_ENV` and the Supabase variables are both present at build time, and `NEXT_PUBLIC_*` is baked then — so this is the correct moment to refuse. A Preview build pointed at Production fails with a clear message instead of deploying.

### 8.3 Server-side write-path protection (the choke point)

Call the guard inside **`getAdminSupabaseClient()`** (`lib/supabase/admin.ts`) and throw on refusal. All 237 service-role consumers inherit the protection from one place; no per-module work, nothing to forget in a future module. Keep the user-context clients (`server.ts`, `client.ts`, `middleware.ts`) guarded too — via `getPublicEnv()` — so a preview cannot even authenticate against Production, but note that the admin client is where the damage would be done.

### 8.4 Local development

Extend the existing pattern: a `predev` script running the same guard over `.env.local`, so `npm run dev` refuses a production binding on a developer machine. `scripts/guard-local-db.mjs` already does the equivalent for `DATABASE_URL` in the RLS suite and is the model.

### 8.5 CI and deployment verification

* A unit test over the guard's truth table (production ref + preview ⇒ refuse; staging ref + preview ⇒ allow; production ref + production ⇒ allow; missing ref ⇒ allow with a warning, since the variable is new).
* A structural test asserting `getAdminSupabaseClient` and `next.config.mjs` both call the guard — the pattern used throughout `tests/`.
* A test asserting `.env.example` documents `PRODUCTION_SUPABASE_PROJECT_REF` (four suites already assert `.env.example` content, so this is idiomatic).
* **A read-only deployment check that closes the prior audit's gap:** extend `GET /api/version` with a **non-secret fingerprint** of the bound project — e.g. `dbRef: "<first4>…<last4>"` or a SHA-256 prefix — plus the existing `env`. Then *any* deployment's binding can be verified from outside with a single request, no Vercel access needed. (The full ref is already public in every production bundle, so this discloses nothing new; a fingerprint is the tidy form.) This is the single highest-value addition for future audits: it turns today's **UNVERIFIED** into a one-command check.

### 8.6 What these safeguards cannot do

They protect the **application**. They do not stop `psql`, a script, or a Supabase dashboard session from writing Production with production credentials — only key hygiene and the existing `guard-local-db` discipline cover that. And they cannot protect a deployment whose `VERCEL_ENV` is itself wrong (it is system-provided, so this is a theoretical concern).

---

## 9. Cost, overhead, rollback, maintenance (requirement 9)

### 9.1 Cost — verify current pricing before committing

| Item | Estimate | Note |
|---|---|---|
| Supabase Staging project | **Free tier: $0** (pauses after inactivity; small DB; no PITR) or **Pro ≈ US$25/month** | Pausing mid-UAT reads as an outage. Pro is recommended while UAT is active; downgrade between campaigns. |
| Vercel | **$0** | Same project, Preview environment; previews already build today. |
| Supabase egress/storage (staging) | negligible | synthetic data only |
| AI (if a staging key is used) | usage-based, small | or keep copilots dark: $0 |
| Esri tiles | within the free allowance | see the satellite doc |
| **Engineering, one-off** | ~0.5–1 day | guard + tests + `.env.example` + this doc's checklist |
| **Operator, one-off** | ~1–2 h | provision, migrate, seed, Vercel variables, Auth URLs, verification |

### 9.2 Operational overhead (recurring)

* **One `db push --db-url <staging>` per merged migration** — or staging drifts and UAT stops meaning anything. Natural owner: whoever merges a migration PR. Could later be automated by a GitHub Action on `push: main` restricted to `supabase/migrations/**` (out of scope here).
* **Synthetic data refresh** per UAT campaign (~30 min); staging data is disposable by design.
* **Key rotation** if a staging key leaks — low blast radius, which is the point.
* **Quarterly drift check**: ledger count + `migration-integrity --db-url` on staging vs Production.

### 9.3 Rollback

| Change | Rollback |
|---|---|
| Preview-scoped variables | Delete them → Preview re-inherits Production. **With the §8 guard in place, previews then REFUSE to build/serve** — fail-closed, by design. To genuinely return to today's behaviour you must also remove the guard. State this plainly in the runbook so nobody is surprised mid-incident. |
| The guard | Revert its commit; no data effect. |
| Staging project | Delete it. No Production effect — nothing in Production references it. |
| `/api/version` fingerprint | Revert; it is additive and non-secret. |
| Migrations applied to staging | None needed — staging is disposable. **No migration is applied to Production by this plan at any point.** |

### 9.4 Responsibilities

| Area | Owner |
|---|---|
| Supabase projects, keys, Auth URL configuration, Vercel variables | **Operator** |
| Guard module, tests, `.env.example`, docs | **Engineering** |
| Staging migration currency after each merge | **Whoever merges the migration** |
| Synthetic UAT data and campaign results | **UAT lead** |
| Closing F-6 in `environment-matrix.md` once verified | **Operator + engineering** |

---

## 10. Operator checklist (requirement 10)

Read-only verification follows every mutating step. Nothing here has been executed.

### Phase A — Staging database
- [ ] **A1** Create Supabase project `effitrans-staging`, same region as Production. Record its ref.
- [ ] **A2** Copy the pooler connection string somewhere safe (never into chat, a commit or a log).
- [ ] **A3** `npx -y supabase@2.106.0 db push --help` → confirm `--db-url` is accepted by the pinned CLI.
- [ ] **A4** `npx -y supabase@2.106.0 db push --db-url "<STAGING>"` → applies 151 in order.
- [ ] **A5 (verify)** `psql "<STAGING>" -c "select count(*) from supabase_migrations.schema_migrations"` → **151**.
- [ ] **A6 (verify)** `node scripts/migration-integrity.mjs --db-url "<STAGING>"` → `CLEAN`.
- [ ] **A7** `psql "<STAGING>" -v ON_ERROR_STOP=1 -f supabase/seed.sql`.
- [ ] **A8** `psql "<STAGING>" -v ON_ERROR_STOP=1 -f supabase/scripts/bootstrap_platform_super_admin.sql`.
- [ ] **A9 (verify)** `node scripts/verify-migrations.mjs --db-url "<STAGING>"` → all 14 verifiers pass (the script documents `--db-url` and `--linked`, and is read-only by construction).
- [ ] **A10 (verify)** `psql "<STAGING>" -c "select id from storage.buckets order by 1"` → the 6 buckets.
- [ ] **A11 (verify)** `psql "<STAGING>" -c "select count(*) from pg_policies where schemaname='public'"` → compare with the same query on Production (`db query --linked`, read-only).
- [ ] **A12** Confirm `supabase/.temp/project-ref` **still holds the Production ref** — no staging step may have rewritten it.

### Phase B — Vercel Preview binding
- [ ] **B1** Settings → Environment Variables → add, **Environment = Preview**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Sensitive), `SUPABASE_SERVICE_ROLE_KEY` (Sensitive).
- [ ] **B2** Add `NEXT_PUBLIC_SITE_URL` per §4.3, plus `TRACKING_ENABLED=true`, `DRIVER_MOBILE_TRACKING_ENABLED=true`, the MOCK payments trio, staging Sentry DSN, staging portal contacts.
- [ ] **B3** Confirm **no** `COMMUNICATIONS_EMAIL_PROVIDER` / `RESEND_API_KEY` exists in the Preview scope.
- [ ] **B4 (verify)** Each row's Environment column reads **Preview**, not *All Environments*.
- [ ] **B5** Redeploy the branch under test (variables do not reach an existing build).
- [ ] **B6 (verify)** Once §8.5 ships: `GET <preview>/api/version` → `env: "preview"` and the **staging** ref fingerprint. Until then: open the preview's client bundle in DevTools and confirm the `*.supabase.co` host is the staging ref (requires Vercel SSO access, since previews are sealed).
- [ ] **B7 (verify)** Production is untouched: `GET https://effitrans-operations.vercel.app/api/version` still reports `env: "production"` and the production ref.

### Phase C — Staging Auth
- [ ] **C1** Staging project → Authentication → URL Configuration → Site URL = the staging host.
- [ ] **C2** Redirect URLs: the four paths of §7.1 for the staging host (or the wildcard form).
- [ ] **C3** Google provider (if OAuth is in UAT scope): staging OAuth client, signups OFF.
- [ ] **C4 (verify)** The **Production** project's redirect list contains **no** staging/preview host.
- [ ] **C5 (verify)** Sign in on the preview with a staging account; confirm you land on `/dashboard` and that the account does **not** exist in Production.

### Phase D — Synthetic data
- [ ] **D1** Create the §5.1 accounts with `@staging.invalid` addresses; link `app_user`; grant roles.
- [ ] **D2 (verify)** No production email address exists in staging: `psql "<STAGING>" -c "select count(*) from auth.users where email not like '%@staging.invalid'"` → **0**.
- [ ] **D3** Build dossiers `S-1…S-7` **through the application**, not SQL.
- [ ] **D4** Attach synthetic evidence only.
- [ ] **D5 (verify)** Note that staging dossier and invoice numbers come from the staging project's own sequences, so they will *look* exactly like production references (`EFT-IMP-2026-0000X`). They cannot collide — separate databases — but a screenshot or a pasted reference from staging can easily be mistaken for a real dossier. Agree a convention before the campaign (e.g. UAT clients named `ZZ-UAT-*`, and never quoting a staging reference without the word "staging").

### Phase E — Safeguards (engineering, separate PR)
- [ ] **E1** `lib/env/project-binding.ts` + unit tests (truth table).
- [ ] **E2** Build-time call in `next.config.mjs`.
- [ ] **E3** Runtime call in `getAdminSupabaseClient()` (+ `getPublicEnv`).
- [ ] **E4** `predev` local guard.
- [ ] **E5** `PRODUCTION_SUPABASE_PROJECT_REF` documented in `.env.example`, set in Vercel for **all** environments.
- [ ] **E6** `/api/version` ref fingerprint.
- [ ] **E7** Structural tests pinning E2/E3; full suite, typecheck, build.
- [ ] **E8 (verify)** Temporarily point a scratch branch's Preview at the production ref → the build **fails**. Revert.

### Phase F — Close the loop
- [ ] **F1** Re-run **EFF-PR33-PREVIEW-DATA-ISOLATION-01** → expect verdict **ISOLATED**.
- [ ] **F2** Update `docs/production/environment-matrix.md` §Separation with the per-environment project refs; mark **F-6 CLOSED** with the evidence.
- [ ] **F3** Then, and only then, run the PR #33 transactional UAT checklist.

---

## 11. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | A staging step rewrites `supabase/.temp/project-ref`, silently re-aiming `migration:guard` / `migrate-production.mjs` / every `db query --linked` at the wrong database | **High** | Use `--db-url` for all staging work; never `supabase link`. Checklist **A12** verifies the link context afterwards. |
| R2 | Preview variables created but the deployment not rebuilt → isolation believed, not real | **High** | **B5** redeploy is mandatory; **B6** verifies the served binding. |
| R3 | A variable created as *All Environments* instead of *Preview* → **Production is re-pointed at Staging** | **Critical** | **B4** explicit check; **B7** verifies Production's binding immediately after. |
| R4 | Someone adds a real `RESEND_API_KEY` to Preview and staging mail reaches real customers | Medium | `@staging.invalid` addresses; **B3**; the §8.5 CI assertion. |
| R5 | The new guard is wrong and breaks Production | Medium | Fail-open for production by construction; unit-tested truth table; **E8** rehearsal on a scratch branch. |
| R6 | Staging drifts behind Production's schema; UAT results stop meaning anything | Medium | One `db push` per merged migration (§9.2); quarterly drift check. |
| R7 | Fixture-writing `rls_*` suites run against long-lived Staging | Medium | Documented prohibition (§3.4); they already have the `guard-local-db` precedent. |
| R8 | Free-tier staging pauses mid-UAT and looks like a platform fault | Low | Pro while UAT is active (§9.1). |
| R9 | Staging host added to the **Production** project's redirect allowlist → a staging page completes a production login | **High** | **C4** explicit check. |
| R10 | Rollback by deleting Preview variables leaves previews fail-closed by the guard | Low | Documented in §9.3 so it is expected, not a surprise. |
| R11 | `PRODUCTION_SUPABASE_PROJECT_REF` unset ⇒ the guard cannot compare and allows everything | Medium | Treat "missing" as a loud warning in the build log; **E5** sets it for all environments. |

---

## 12. What this plan deliberately does not do

* Does not copy, anonymise or derive any Production personal data (explicit constraint).
* Does not change Production, any environment variable, any Auth setting, or apply any migration.
* Does not use Supabase branching (none configured; a separate project is simpler and matches the documented 6.0G posture).
* Does not touch the governed production migration workflow (`migrate-production.yml` stays `workflow_dispatch`, human-dispatched).
* Does not alter the CI database strategy — `supabase start` + `db reset` + the SQL suites remain the proving ground, and Staging is not a substitute for it.
* Does not introduce an escape hatch allowing a preview to connect to Production.
