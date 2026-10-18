# CUSTOMS-REF-UAT-02 — zero-cost local feasibility audit

**Status: AUDIT ONLY. Nothing installed, no container started, no database created, no
account created, no migration run.**

Budget ceiling: **$0 additional recurring or usage charges.**

---

## 0. The finding that should be read before the rest

**Most of UAT-02's transactional matrix is already automated and already runs on every
pull request, at zero cost.**

`tests/journey/customs-reference-library.journey.ts` is **61 tests** executed by CI's
`rls-tests` job against a **real local Supabase stack** — real PostgreSQL 15, all 155
migrations, the real seed, real single-role identities, real RLS, real storage. From
the release run's own log (`5440af9`):

```
customs-reference-library.journey.ts (61 tests)
Tests  247 passed (247)
```

It is not a mock suite. [vitest.journey.config.ts](../../vitest.journey.config.ts)
stubs exactly four boundaries — `server-only`, `next/cache`, `react`'s `cache()`, and
`lib/auth/current-user` (who is signed in) — and says why: *"Everything else —
permissions, tenancy, the engine, gates, evidence, audit, Finance, custody, closure —
executes for real against the real database."* The journey imports the **real route
handlers and server actions** (`POST as uploadRoute`, `GET as viewRoute`, and the six
actions), and `identity()` resolves a real account whose permissions come from the real
grants: *"Permissions are NOT stubbed."*

So the question is not "can we build a local UAT environment for $0". It is **"what, if
anything, is still uncovered?"** — and the answer is narrow (§5.2).

## 1. Local prerequisites — current machine

Read-only inspection; nothing was installed or started.

| Requirement | State |
|---|---|
| `docker` | **ABSENT** |
| `docker compose` | **ABSENT** |
| `podman` / `nerdctl` | **ABSENT** |
| Supabase CLI | **ABSENT** (obtainable via `npx`, but it still needs a container runtime) |
| `psql` / `pg_ctl` | **ABSENT** |
| Node / npm / npx | present — Node **v24.11.1**, npm 11.6.2 |
| OS | **Windows 11 Home**, build 26200 |
| Virtualization | `HypervisorPresent: True` |
| **WSL** | **NOT INSTALLED** — *"The Windows Subsystem for Linux is not installed."* |
| RAM | 23.6 GB total, ~6.1 GB free |
| Disk (C:) | **748 GB free** |

**`supabase start` cannot run on this machine today.** It requires a container runtime,
and there is none.

### 1.1 What installing one would involve

Windows 11 **Home** has no Hyper-V, so Docker Desktop's only backend is WSL2 — which is
not installed. Standing the stack up therefore means: install WSL2 (elevation, reboot),
install Docker Desktop, then pull the Supabase images (several GB — disk is ample).

Two caveats that matter under a $0 ceiling:

- **Docker Desktop's licence is free for personal use, education, non-commercial open
  source and small businesses, but requires a paid subscription above a company-size /
  revenue threshold.** Effitrans is very likely below it, but this is a licensing
  question for the owner, not a technical one. **Confirm the current terms before
  installing** — the thresholds have been revised more than once.
- **Rancher Desktop** and **Podman Desktop** are unambiguously free and open source and
  are the fallback if the Docker licence is unwelcome. Supabase's CLI documents Docker
  Desktop; other runtimes generally work via `DOCKER_HOST` but are not the supported
  path, so budget time for friction.

Neither was installed, and nothing above should be read as a recommendation to install
anything — see §6.

## 2. Migration compatibility

**Not an open question: it is proven continuously.** CI's `rls-tests` job runs, on every
pull request, with the CLI pinned at **2.106.0** (deliberately pinned "to stop upstream
CLI/runtime image changes from breaking CI without warning"):

```
supabase start        # boots the stack AND applies migrations + seed
supabase db reset     # re-applies migrations + seed deterministically
```

Both succeeded on the current release. So all **155** migrations apply to a clean local
PostgreSQL 15 from scratch, in order, followed by the seed — including the four Customs
Reference migrations and the private `customs-reference` bucket. A static audit for
cloud-only extensions would be weaker evidence than a green run that does it for real,
twice, every PR.

The local stack per [supabase/config.toml](../../supabase/config.toml): API `54321`,
database `54322` (PostgreSQL **15**), Studio `54323`, Auth enabled with
`site_url = http://localhost:3000`, Storage enabled; `edge_runtime` and `analytics`
**disabled** — neither is used by this feature.

## 3. Authentication and RLS compatibility

### 3.1 Role grants reproduce locally

[supabase/seed.sql](../../supabase/seed.sql) (1 677 lines) carries **126 `role_permission` grant
statements** and the full permission catalogue, including both `customs:reference:read` and
`customs:reference:publish` with the same role lists as production. So a local project
has the same authorization contract.

> **The trap:** the `role` table is empty *during* migrations, so grants live in the
> seed, not in a migration. A database with migrations applied but **unseeded** has
> every table and **no permissions**, and every UAT account looks correctly locked out
> for entirely the wrong reason. `supabase start` and `supabase db reset` both run the
> seed; a hand-rolled `db push` would not.

### 3.2 Identities exist, with exactly one role each

[supabase/tests/journey_identities.sql](../../supabase/tests/journey_identities.sql)
(351 lines) inserts into `auth.users`, `public.app_user` and `public.user_role` with
deterministic, idempotent UUIDs. The main block grants *"EXACTLY one canonical role
each, so a maker/checker proof can"* be made — and one identity is a **deliberate**
exception, because *"aa20 holds BOTH Déclarant and Chef, which four production accounts
do."* Among them:

| Identity | Email | Role(s) | Use in UAT-02 |
|---|---|---|---|
| `…aa03` | `journey.transit@test.local` | **CHIEF_OF_TRANSIT** only | publisher (PUB-A) |
| `…aa20` | `journey.declarantchief@test.local` | **CUSTOMS_DECLARANT + CHIEF_OF_TRANSIT** | second publisher (PUB-B), for maker-checker — the journey uses these two as `chief` and `chief2` |
| `…aa04` | `journey.declarant@test.local` | **CUSTOMS_DECLARANT** only | reader (READ-A) |
| `…aa05` | `journey.coordinator@test.local` | COORDINATOR only | second reader |

No SYSTEM_ADMIN identity exists or is needed: `CHIEF_OF_TRANSIT` is the other holder of
`customs:reference:publish`, so two Chef identities satisfy maker-checker. Note that
`aa20` is multi-role **on purpose** — it mirrors real accounts, and it is the same
condition that made UAT-01B's isolation verdicts `PARTIAL`. Use `aa03` and `aa04` when
the point is isolation; use `aa20` only as the second approver.

**This is what UAT-01B could not obtain.** Its §D records that SYSTEM_ADMIN-only and
CHIEF_OF_TRANSIT-only isolation were `PARTIAL` because the accounts held several roles.
Single-role local identities make role *isolation* provable, and the journey already
exercises it ("the Déclarant cannot upload", "cannot publish, verify, licence or
withdraw", "a driver cannot read it, fetch it, or upload to it").

### 3.3 The one thing these identities cannot do: log in

The insert is `insert into auth.users (id, email)` — **no `encrypted_password`, no
`email_confirmed_at`**. These rows exist so server-side code can resolve an identity;
they are **not browser-loginable**.

Consequences:

- An **API/journey-level** local UAT needs no passwords at all — the harness stubs only
  *who is signed in* and runs everything else for real. This is how the 61 tests work.
- A **browser** local UAT would additionally need passwords set, via the Auth Admin API
  against the **local** service-role key (`auth.admin.updateUserById`). Editing
  `auth.users` by hand is possible but fragile across Supabase versions.
- But the browser layer is the part that **no longer needs UAT**: the three UI
  authorization gates were automated by PR #40 (24 tests, merged `d4da023`), and
  UAT-01B already observed them manually in production.

## 4. Storage and upload compatibility

Seven buckets are created **by migrations**, so they appear in any project that applies
the chain, with their policies, in that project's own namespace:

`documents`, `brand-assets`, `ec-inbound`, `finance-expense`, `hr-documents`,
`messaging-attachments`, and **`customs-reference`** — private, `file_size_limit
52428800` (50 MB), `allowed_mime_types ['application/pdf']`, from migration #152.

Local Storage is enabled in `config.toml`, so uploads, signed URLs and the private-read
path all work locally. The journey already proves the authorization boundary on bytes:
*"…and the bytes are refused to the reader with 404, not 403."*

## 5. UAT-02 coverage matrix

### 5.1 Already covered, already running in CI

| UAT-02 case | Where it is already proven |
|---|---|
| 1 Valid PDF upload | journey — "records the bytes, the checksum and nothing it was not asked to record" |
| 2 Invalid file rejection | journey — "a disguised non-PDF is refused on its bytes"; "a non-PDF declared type, a tiny file and missing metadata are refused" |
| 3 Size-boundary validation | journey (tiny file) + 66 REF-2 unit tests for both ceilings; bucket enforces 50 MB |
| 4 Metadata validation | journey — "names the missing fact, one at a time, and writes nothing"; "an upload with no business key is refused" |
| 5 Customs-regime validation | **RLS suite, 4 behavioural checks** — `regime_normalised`, `regime_over_long_refused`, `regime_cardinality_bounded`, `regime_reader_write_blocked`; plus #155's verifier 22/22 |
| 6 Quarantine behaviour | journey — "the publisher sees it; the Déclarant does not" |
| 7 Publisher / reader isolation | journey — four dedicated tests, with **single-role** identities |
| 8 Private-storage authorization | journey — 404-not-403; identity trigger refuses repointing the path or rewriting the checksum |
| 9 Audit-trail verification | journey — "a refused upload leaves no row and no audit"; "every verdict leaves append-only evidence" |
| 10 Cleanup / reset | `supabase db reset` — the journey's fixtures are disposable by construction |

Beyond the matrix, the journey also covers maker-checker ("the SAME person cannot submit
and approve"), every non-CLEAN scan state failing closed, replay-nonce behaviour,
cross-tenant refusals, lineage and withdrawal — 61 tests in all.

### 5.2 The genuine gap — one thing, and it is narrow

**REF-2's direct-to-storage upload path has no transactional test.**

| Surface | journey | RLS SQL | unit |
|---|---|---|---|
| `upload-url` route | **0** | **0** | 2 (structural) |
| `finalize` route | **0** | **0** | 20 |
| `buildStagingPath` | **0** | **0** | 1 |
| `MAX_DIRECT_UPLOAD_BYTES` | **0** | **0** | 1 |
| `customsRegimes` (app-side normaliser) | **0** | **0** | 1 |

The journey predates REF-2. It drives the ≤4 MB `upload/route` only. So nothing
anywhere drives **ticket → signed upload → finalize** against a real database and real
storage: not the staging-prefix placement, not finalize reading the bytes back, not the
SHA-256 binding, not the staging object being swept, not `customs_regimes` arriving
through the real route.

The validation *logic* is well covered by REF-2's 66 unit tests and the database trigger
by the RLS suite's 4 checks. What is untested is the **sequence**.

### 5.3 Out of scope, and unprovable locally either way

- **Real antivirus detection / EICAR** — excluded by the brief; needs a real scanner.
- **Successful publication** — needs a CLEAN verdict, so needs a scanner. (The journey
  *does* cover publication by injecting a trusted CLEAN at the database layer, which
  proves the gate's logic but not a scanner.)

## 6. Zero-cost execution sequence

Two options. **A is the recommendation.**

### Option A — extend the existing journey (recommended; $0, no Docker, no install)

Close §5.2 by adding cases to `tests/journey/customs-reference-library.journey.ts`,
which already runs in CI against a real stack. **The container runtime comes from the
CI runner, so nothing is installed on anyone's machine.**

Roughly 60–100 lines, mirroring the existing tests' style:

1. `POST upload-url` as PUB-A → assert 201, a `uploadId`/`path`/`token`, **no document
   row and no audit** (nothing has happened yet).
2. Place bytes at the returned staging path using the local service-role client, then
   `POST finalize` → assert 201, exactly one QUARANTINE row, `content_sha256` equal to
   the sha256 of the bytes, and the **staging object gone**.
3. `finalize` with a declared sha256 that does not match → **refused**, no row.
4. `finalize` with an `uploadId` that is not a UUID → refused before any path is built.
5. `finalize` as READ-A → **403**, no row.
6. Regimes through the real route → stored normalised (`{MISE EN CONSOMMATION,
   TRANSIT}`), over-long refused, >24 refused.

Then: `npx vitest run --config vitest.journey.config.ts` in CI — already wired; no
workflow change. Evidence is the CI log, as for the other 61.

**Cost: $0. Local setup: none. Blocker removed: Docker.**

### Option B — full local stack (only if a browser UAT is genuinely wanted)

Commands listed for completeness. **None of these was executed, and several are
forbidden without separate authorization.**

```bash
# 0. PREREQUISITES — requires elevation and a reboot. NOT RUN.
#    wsl --install                    (Windows 11 Home has no Hyper-V; WSL2 is the only backend)
#    then install Docker Desktop (confirm licence terms first) or Rancher/Podman Desktop

# 1. Pin the same CLI version CI uses. NOT RUN.
npx supabase@2.106.0 --version

# 2. Boot the stack: applies all 155 migrations AND the seed. NOT RUN (starts containers).
npx supabase@2.106.0 start

# 3. Confirm it is LOCAL before anything transactional (see §7). NOT RUN.
curl -s http://127.0.0.1:54321/rest/v1/ -o /dev/null -w '%{http_code}\n'

# 4. Seed identities — single-role accounts. NOT RUN (mutates a database).
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/journey_identities.sql

# 5. Passwords, for browser login only, against the LOCAL service-role key. NOT RUN.
#    (auth.admin.updateUserById per identity; local keys are printed by `supabase start`)

# 6. Point the app at local, in .env.local ONLY. NOT RUN.
#    NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=<printed by supabase start>
#    SUPABASE_SERVICE_ROLE_KEY=<printed by supabase start>
#    CUSTOMS_SCAN_ENDPOINT / _CALLBACK_SECRET / _PROVIDER  -> leave UNSET
#    PAYMENTS_ENABLED / EFFITRANS_EC_INBOUND_ENABLED       -> leave UNSET

# 7. Verify the binding guard agrees it is local. NOT RUN.
node scripts/check-env-binding.mjs --dotenv --json     # expect status "local"

# 8. Run the app. NOT RUN.
npm run dev

# 9. Reset between campaigns — destroys all local test data. NOT RUN.
npx supabase@2.106.0 db reset
```

## 7. Isolation controls — fail-closed, and already built

The binding guard ([lib/env/project-binding.mjs](../../lib/env/project-binding.mjs),
run as **both** `prebuild` and `predev`) classifies a `127.0.0.1`/`localhost` Supabase
URL as target kind **`local`** and allows it unconditionally, while refusing any
non-production environment bound to the production project.

**Positive local identification, before any transactional step:**

1. `node scripts/check-env-binding.mjs --dotenv --json` → status **`local`**. Anything
   else — in particular a `cloud(...)` target — means **stop**.
2. `NEXT_PUBLIC_SUPABASE_URL` must be `http://127.0.0.1:54321`. If it contains a
   project ref, stop.
3. The production fingerprint is **`7bc7cb666973`**. A local stack has no project ref,
   so the guard reports `local`, never that fingerprint. If you ever see it during a
   local UAT, stop immediately.
4. `supabase/.temp/` must **not** be present in the working copy used for local UAT —
   it is what `--linked` resolves production from. The repo-root worktree is where it
   lives; use a different checkout.
5. Scanner, payments and EC inbound variables unset, so all three are dark.
6. Local keys only. **Never** place a production `service_role` key in `.env.local`;
   production keys belong only to the production scope.

## 8. Limitations and risks

| Item | Severity | Note |
|---|---|---|
| Docker/WSL2 install needs elevation + reboot | — | Option A avoids it entirely |
| Docker Desktop licence above the SME threshold | **Budget** | confirm terms; Rancher/Podman Desktop are free fallbacks |
| Unseeded database reads as an authorization failure | Medium | use `supabase start` / `db reset`, never a bare `db push` |
| Seeded identities cannot log in | Medium | passwords needed for a *browser* UAT only; Option A needs none |
| Local stack is not production | Low | same migrations, seed and RLS, but not production data volume or latency |
| A local UAT proves nothing about production config | Medium | scanner absence, env binding and permissions in production stay verified separately, read-only |
| Option A's gap-closing tests run only in CI | Low | that is also where they will keep running — a local-only test rots |

## 9. Verdict

**Do not install Docker, and do not build a local UAT environment, to run UAT-02's
transactional matrix. It is already running in CI, on every pull request, for $0.**

What is actually missing is one narrow thing: **no transactional test drives REF-2's
`upload-url` → `finalize` sequence.** Close that by extending the journey that already
runs (Option A) — 60–100 lines, no infrastructure, no licence question, no local setup,
and it keeps running forever instead of being a one-off afternoon.

Build the full local stack (Option B) only if a **browser-level** local UAT is wanted
for its own sake. That is a legitimate thing to want, but it is not what UAT-02 needs,
and the UI gates it would exercise were automated by PR #40.
