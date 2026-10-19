# CUSTOMS-REF-UAT-02 — isolated environment design

**Status: DESIGN ONLY. Nothing provisioned. No Supabase project, no Vercel project, no
environment variable, no account.**

Companion to [uat-02-plan.md](./uat-02-plan.md) (what to test) and
[uat-01b-closure.md](./uat-01b-closure.md) (what is already closed). This document
answers only: *where should UAT-02 run, and what stops it touching Production?*

> **Since this design — what changed, and what did not.** Written 2026-10-18.
> UAT-02's transactional matrix no longer waits on an isolated project: it runs on
> every pull request against CI's disposable Supabase stack (**PR #42**, plus
> **PR #43** for the F-2 cleanup). §6's recommendation still stands for what it
> actually argues — Production cannot forget a test, and F-6 remains open — but what
> provisioning would now unblock is a **browser-level** round, not the transactional
> one. See [uat-02-plan.md §11](./uat-02-plan.md).

---

## 1. The architecture already exists — do not rebuild it

[docs/production/staging-isolation-plan.md](../production/staging-isolation-plan.md)
(EFF-STAGING-ISOLATION-01, 474 lines) already specifies a dedicated non-Production
Supabase environment: the full inventory of variables to re-point, the service-role
surface, bucket behaviour, auth callbacks, inbound webhooks, provisioning steps,
seeding, Vercel Preview binding, synthetic test data, storage isolation, cost,
rollback and maintenance.

**UAT-02 does not need a new architecture. It needs that one, built, plus the deltas
below.** A second parallel design document would diverge from the first within a
release and leave an operator choosing between two governance records.

### 1.1 Deltas since that plan was written

It predates the Customs Reference Library entirely, so three facts in it are stale:

| Item | Plan says | Actual (main @ `5440af9`) |
|---|---|---|
| Governed migrations | 151 | **155** |
| Storage buckets | 6 — `documents`, `brand-assets`, `ec-inbound`, `finance-expense`, `hr-documents`, `messaging-attachments` | **7** — all of those **plus `customs-reference`** |
| `customs-reference` bucket | not mentioned | created by migration #152: **private**, `file_size_limit 52428800`, `allowed_mime_types ['application/pdf']` |

Nothing structural changes: the new bucket is migration-created like the other six, so
it appears automatically in any project that applies the chain, with its own policies
in its own storage namespace. **Storage isolation remains automatic once the project
is separate.**

### 1.2 One environment, not two

**Recommendation: run UAT-02 on the Staging project that plan specifies. Do not create
a third environment.**

- UAT-02's requirements — isolated database, isolated auth users, isolated private
  storage, the same migration chain, equivalent role and RLS contracts — are exactly
  what Staging provides. There is no requirement unique to UAT.
- The Supabase Free plan permits **two** active projects. Production already uses one.
  A third environment forces a paid plan for a need that does not exist.
- Every extra environment multiplies migration drift and the work of keeping role
  grants equivalent.

If a future campaign genuinely needs Staging and UAT simultaneously, that is the point
to revisit — not now.

## 2. What makes it isolated

### 2.1 The enforcement already ships

[lib/env/project-binding.mjs](../../lib/env/project-binding.mjs), gated by
[scripts/check-env-binding.mjs](../../scripts/check-env-binding.mjs) as **both
`prebuild` and `predev`**, already implements the control this phase asks for. It
classifies the environment from `VERCEL_ENV` and the target from
`NEXT_PUBLIC_SUPABASE_URL`, and refuses:

| Environment | Bound to | Verdict |
|---|---|---|
| production | the production ref | `verified_production` — allowed |
| production | any other ref | **REFUSED** `production_bound_to_foreign_project` |
| preview / development | the production ref | **REFUSED** `non_production_bound_to_production_project` |
| preview / development | any other ref | `verified_isolated` — allowed |
| anything | localhost | allowed |

**It is currently INERT, and that is the whole gap.** Until
`PRODUCTION_SUPABASE_PROJECT_REF` is installed the status is
`unverified_no_expectation` — which is exactly what production reports today
(`/api/version` → `"status": "unverified_no_expectation"`, `"verified": false`).

So the isolation work is not "build a guard". It is:

1. install `PRODUCTION_SUPABASE_PROJECT_REF` (the production ref — not a secret, but
   keep it out of commits by habit), which activates the guard;
2. set `ENV_BINDING_STRICT=true`, so an *unverifiable* binding is refused rather than
   waved through;
3. point the Preview-scoped Supabase variables at the staging project.

With (1) and (2) in place, a Preview bound to Production **cannot build**. That closes
audit item **F-6** — open since phase 8.0A — as a side effect.

### 2.2 Credentials

- **No Production service-role key reaches UAT.** Each project has its own
  `anon` and `service_role` keys; the staging ones are generated with the project and
  are the only ones installed on the Preview scope.
- **No Production anon key either** — the Preview scope gets staging's.
- Separate `auth.users`: staging accounts are created in staging's auth schema and
  cannot authenticate against Production, nor the reverse. A Production JWT is signed
  with Production's secret and is rejected by staging.
- The scanner stays absent in both: `CUSTOMS_SCAN_ENDPOINT`,
  `CUSTOMS_SCAN_CALLBACK_SECRET` and `CUSTOMS_SCAN_PROVIDER` unset. The dev stub
  refuses to start unless its callback is loopback, so it cannot answer a deployed
  environment at all.
- Payments and EC inbound stay dark: `PAYMENTS_ENABLED` and
  `EFFITRANS_EC_INBOUND_ENABLED` unset, both strict `=== "true"` opt-ins.

### 2.3 Do we need a dedicated Vercel project?

**No — provided the two guard variables above are installed.**

The reason Previews are unsafe *today* is not that Previews are inherently unsafe; it
is that Preview-scoped Supabase variables are absent, so previews inherit Production's.
Once Preview scope points at staging and the guard is active, a preview is
`verified_isolated` and a misconfiguration is a failed build rather than a silent
cross-environment write.

A dedicated Vercel project would also work, and buys marginally stronger separation
(distinct domains, no shared variable surface). It costs a second deployment surface
to configure and keep aligned. **Not worth it for UAT-02**, and reconsiderable if a
long-lived staging URL is ever wanted for external testers.

One consequence to accept deliberately: Preview-scoped variables apply to **every**
preview, so all PR previews would begin using staging. That is the desired end state —
it is what F-6 asks for — but it changes behaviour for every open PR at once, so it
should be done knowingly rather than as a side effect of a UAT.

### 2.4 The four containment requirements

| Requirement | Control |
|---|---|
| UAT requests must not reach Production | Preview-scoped `NEXT_PUBLIC_SUPABASE_URL` + keys point at staging; the binding guard refuses a non-production build bound to the production ref, at `prebuild` **and** `predev` |
| Production credentials must not enter UAT | staging keys only on the Preview scope; Production keys remain Production-scoped. Never copy a service-role key between scopes |
| UAT documents must not become visible to Production users | separate project ⇒ separate `customs_reference_document` table and separate `customs-reference` bucket. There is no shared storage namespace and no cross-project query path |
| Accidental Production migrations | the governed runner requires an explicit target. `--linked` resolves from `supabase/.temp/`, so a staging run must be driven by `--project-ref` + `--pooler-url` (or a re-linked checkout) — never by accident. Preflight additionally requires a clean tree and a committed file, and the integrity guard refuses a ledger it does not recognise |
| Cross-environment auth or storage access | distinct JWT secrets and distinct storage namespaces; a token or signed URL from one project is invalid in the other |

## 3. Mapping UAT-02 onto the isolated environment

Every case in [uat-02-plan.md](./uat-02-plan.md) runs unchanged, with three
improvements that come from the environment rather than the plan:

| Plan case | In the isolated environment |
|---|---|
| **B** small PDF ≤ 4 MB | unchanged; the row and object land in staging |
| **C** large PDF > 4 MB | unchanged; staging's own `customs-reference` bucket, same 50 MB ceiling (migration-created, so identical) |
| **D** byte-signature / size rejection | unchanged; no document created either way |
| **E** metadata and regime normalisation | unchanged; the trigger is the same because the migration is the same |
| **F** quarantine state | unchanged |
| **G** reader vs publisher isolation | **improved** — staging accounts can be created with exactly one role each, so G finally proves role *isolation* rather than the behaviour of a union. UAT-01B could not do this; §D of the closure record records that limitation |
| **H** audit and private storage | **improved** — a read-only query against a non-Production database is an ordinary operation, so H stops depending on inference from migration verifiers |
| **I** cleanup | **transformed** — see §4 |

Out of scope here, as in the plan: antivirus detection and publication. Both need a
real scanner.

## 4. The thing an isolated environment actually changes: cleanup

In Production, UAT-02's defining constraint is that **a test document cannot be
deleted** — no operator-facing delete path, append-only audit and scan evidence,
immutable stored bytes. §0 of the plan opens with it, and §8 reduces cleanup to
withdrawal plus inventory.

In a disposable staging project that constraint stops mattering: the whole project can
be reset (`supabase db reset` against staging, or delete and re-provision) and no
permanent residue exists anywhere. **This is the strongest argument for provisioning,
and it is stronger than cost.**

Two consequences:

- The naming discipline in §3 of the plan (`[TEST UAT-02 — NE PAS UTILISER]`,
  `UAT02-<nn>`) becomes a convenience rather than a safeguard. **Keep it anyway** — if
  a campaign is ever run against Production, the habit is already in place.
- The written acknowledgement the plan demands — that test documents are permanent —
  is **no longer required** for an isolated run. That removes the single largest
  blocker in front of UAT-02.

## 5. Cost, effort, risk

### 5.1 Cost — figures to confirm before committing

Third-party sources (checked mid-2026; none is Supabase's own pricing page):

| Option | Cost | Fitness for UAT-02 |
|---|---|---|
| **Supabase Free** | **$0** — 2 projects, 500 MB database, 1 GB storage, 5 GB egress | Fits comfortably: UAT-02 creates two documents of a few MB. **But free projects auto-pause after ~7 days of inactivity** — data is retained, the project becomes unreachable until resumed |
| **Supabase Pro** | **≈ US$25/month**, includes a $10 compute credit | No pausing; appropriate if UAT is continuous |
| Vercel | **$0** | Same project, Preview environment; previews already build today |
| Scanner / payments / EC | **$0** | all remain unconfigured and dark |

⚠️ **One unresolved figure materially changes the answer.** Sources disagree on whether
Pro is **per organization** or **per project**. If per organization and the
organization is already on Pro for Production, a staging project may add **$0** beyond
usage. If per project, it adds ≈$25/month. Confirm on
<https://supabase.com/pricing> and against the organization's current plan before
provisioning. Do not quote a figure from this table as settled.

**A paused free project mid-UAT reads as a platform outage**, which is how a tester
loses a day. For a short, scheduled campaign, Free is defensible — resume the project
first and verify it is awake. For anything ongoing, Pro.

### 5.2 Setup effort

Roughly half a day, following §3–§5 of the existing plan, dominated by two steps:

1. **Applying 155 migrations in order.** Not a `db push` — the governed path, in order,
   with each companion verifier passing. CI does this routinely against an ephemeral
   database, so the chain is known to apply cleanly from scratch.
2. **Seeding roles and permissions.** The step §3.3 of the plan calls "easy to miss".
   The `role` table is **empty during migrations**, so role→permission grants come from
   `supabase/seed.sql`; a project with migrations applied but unseeded has tables and
   no permissions, and every UAT account will look correctly locked out for the wrong
   reason.

Then: create the three accounts (§2 of the plan), set Preview-scoped variables,
install the two guard variables, redeploy — §4.4 of the plan notes redeployment is
mandatory, since variables are read at build time.

### 5.3 Operational risks

| Risk | Severity | Mitigation |
|---|---|---|
| Free project pauses mid-campaign | Medium | resume and verify before starting; or use Pro while active |
| Migrations applied out of order or unseeded | Medium | use the governed runner, one at a time; verify `CLEAN 155/155`; confirm the seed ran by checking a role holds `customs:reference:publish` |
| **Preview-scoped variables change behaviour for every open PR at once** | Medium | do it deliberately, announce it; it is the F-6 fix, not a side effect |
| A Production key pasted into the Preview scope | **High** | the guard refuses the build, so the failure is loud. Still: never copy keys between scopes |
| Staging drifts from Production over time | Low | re-apply new migrations to staging as part of each release, or reset between campaigns |
| Someone runs the migration runner against Production believing it is staging | **High** | the runner never defaults to a target; `--linked` resolves only from `supabase/.temp/`. Verify the fingerprint before every run — Production is `7bc7cb666973` |

## 6. Recommendation

**Provision the Staging project from the existing plan, apply the two guard variables,
and run UAT-02 there** rather than against Production.

The decisive argument is not cost. It is that Production cannot forget a test: no
delete path, append-only audit, immutable bytes. A disposable project removes the only
genuinely irreversible thing about UAT-02, and closes F-6 — open since phase 8.0A — on
the way.

What is still required before provisioning: **separate authorization** (this phase is
design only), a decision on Free versus Pro once the per-organization question is
settled, and acceptance that Preview-scoped variables will redirect every preview to
staging.
