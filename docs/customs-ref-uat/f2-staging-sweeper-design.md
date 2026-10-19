# REF-2 F-2 — abandoned staging objects: design

**Status: IMPLEMENTED AND LIVE** — PR #43, merged 2026-10-19 as `d3682c6`, production READY on it. §9's gate was satisfied before the work began; it is kept as the record of what was required.

> This document was written as a design, and the rest of it is left in that
> voice on purpose: it is the argument the implementation was reviewed
> against, not a description written afterwards. Where the implementation
> went further than the design, the design says so — §3's threshold gate and
> §4's S-10 were added during implementation.

Finding F-2 was raised when REF-2 shipped: the direct-to-storage upload puts
bytes into the private bucket *before* the application decides a document
exists, and if the second step never comes, those bytes stay. This document is
the design for cleaning them up, and the evidence behind it.

It is written to be falsifiable. Every claim below is either **confirmed** with
the evidence that confirms it, or listed in §2 as **unverified** with what it
would take to settle it. The recommendation in §3 is deliberately built so that
nothing in §2 can make it unsafe.

---

## 1. Confirmed facts

**How a staging object is named.** `${tenantId}/_staging/${uploadId}.pdf`, built
by `buildStagingPath` in `lib/customs/reference/validate.ts`. `uploadId` is a
server-generated `randomUUID()`. The caller supplies no part of any path — pinned
by `customs-reference-ref2.test.ts` test 32.

**Only three files touch that prefix:** `upload-url/route.ts`,
`finalize/route.ts` and `validate.ts`. (A repository search also matches many
`*_staging_row` names; those are an unrelated HR/aging **table**, not storage.)

**The only cleanup that exists today** is `dropStaging()` in `/finalize`:
defined at line 115, called at **12 sites** — every path after the object has
been located, plus a final non-fatal sweep after success — and deliberately
best-effort (`.catch(() => {})`). `/upload-url` cleans nothing.

**A ticket nobody uses leaks nothing.** `createSignedUploadUrl` creates no
object and no row; journey test R20 asserts exactly that. Only a *completed
upload* can become debris.

**Four leak classes.**

| # | Cause | Notes |
|---|---|---|
| 1 | `/finalize` never called | tab closed, network dropped, operator walked away. The common case |
| 2 | `/finalize` refused **before** line 115 — `401`, `403`, `invalid_input`, `invalid_upload_id`, a regime error | `dropStaging` is not yet in scope at those returns. For `403` this is **deliberate**: a reader's refusal must not destroy a publisher's work in progress, which journey R22 pins |
| 3 | `remove` fails transiently | swallowed by design |
| 4 | the function dies between the bytes landing and `dropStaging` | serverless timeout, crash |

Each leak is at most 50 MiB — the bucket's own per-object limit.

**Production today (read-only probe, 2026-10-18).** 0 staging objects, 0
document objects, 0 document rows: the direct path has never been used in
production. The bucket is private, limited to 52 428 800 bytes and
`{application/pdf}`. `storage.objects` carries **0 policies**, which is why an
unprivileged client cannot read the bucket at all (journey R21).

**⚠ There is no scheduler anywhere — verified, not assumed.** `pg_cron`,
`pg_net`, `pgmq` and `http` are **all absent** from production; `vercel.json`
contains only `regions: ["dub1"]` and no `crons`; neither `ci.yml` nor
`migrate-production.yml` has a `schedule:` trigger. The only job-shaped thing in
the repository is `workflow_dispatch` plus the protected `production-db`
environment.

**A database-side sweeper would be wrong even if `pg_cron` existed.** Deleting
rows from `storage.objects` in SQL does not reclaim the object in the storage
backend. Cleanup has to go through the Storage API.

**What the client can do.** `list(prefix, { limit, offset, sortBy, search })` —
default limit 100, and `sortBy.column` may be any `FileObject` column including
`created_at`. Each entry carries `name`, `created_at`, `updated_at` and
`metadata.size`. `remove(paths: string[])` takes a batch and needs `delete` +
`select` on `storage.objects`, which the service-role client used by
`getAdminSupabaseClient()` already has — the same client `dropStaging` uses.

**Two ratified pins constrain the implementation, and both point the same way.**
`customs-reference-ref2.test.ts` test 38 asserts the ticket route contains
neither `.insert(` nor `writeAudit`; test 27 asserts
`getAdminSupabaseClient()` appears *after* the permission check in both routes.
So the sweep must write no audit row and must run after authorization — which is
what §3 and §4 recommend on their own merits.

---

## 2. Unverified assumptions

**U-1 — the signed-upload token lifetime is UNKNOWN, and the documentation
conflicts three ways.** `createSignedUploadUrl(path, options?: { upsert })` in
`@supabase/storage-js` 2.108.1 takes **no expiry argument**: the lifetime is
decided server-side. Published sources disagree — an unofficial wiki states
`UPLOAD_SIGNED_URL_EXPIRATION_TIME` defaults to **60 seconds**, the official
JavaScript reference says signed upload URLs are valid for **2 hours**, and a
2023 Supabase discussion describes a hard-coded **1 hour** in code against a
documented 2 hours. No value is asserted here.

> **This is why §3 does not depend on it.** The sweep ages an object from its own
> `created_at` — the moment the bytes finished landing — not from when the
> ticket was minted. The token's lifetime therefore never enters the safety
> argument. Even if it did, the recommended 24 h threshold is 12× the largest
> published candidate.

**Measurement procedure, prepared and NOT run** (it needs new CI code and a
push, so it stops at §9 with everything else): the `token` returned by
`createSignedUploadUrl` is a JWT. Its middle segment base64url-decodes to a
payload carrying `exp` and `iat`; `exp - iat` is the lifetime in seconds, and
reading it needs no secret. One journey assertion in CI's disposable Supabase
measures and pins it for free. Note that this measures the **CLI 2.106.0** local
storage-api, which may differ from the managed version production runs, so the
measurement pins a *floor for the test environment*, not a production
guarantee — another reason the design must not depend on it.

**U-2 — `created_at` is assumed to be the moment the upload completed**, not the
moment it started. This follows from how a plain signed `PUT` works: the object
row appears when the bytes have been stored. It matters because it is what makes
an in-flight upload invisible to the sweep.

**Now verified.** §6's journey test 13 shipped as `R24` case 6 and passes in CI
against real Storage: the object's `created_at` is present, parseable and within
seconds of the upload, and the real predicate agrees with the real metadata both
ways round. It would still need re-checking if the client ever moved to
resumable/TUS uploads, which track progress separately — and that test is where
such a change would surface.

**U-3 — the server's maximum batch size for `remove`** is not documented in the
client. §3 caps the batch at 50 regardless, so the limit is never approached.

**U-4 — `remove` on a path that no longer exists** is assumed to be a no-op
rather than a hard failure. The design does not rely on it: sweep errors are
swallowed.

---

## 3. Recommended implementation — sweep at the door

A new `lib/customs/reference/staging-sweep.ts`, called from `/upload-url` after
the `customs:reference:publish` check and before the ticket is minted.

```
  authenticate → authorize → validate metadata and size
               → sweepAbandonedStaging(supabase, user.tenantId)   ← new
               → createSignedUploadUrl → respond
```

**Why the door and not a scheduler.** There is no scheduler to reuse (§1), and
every way of adding one costs something this design refuses to spend: `pg_cron`
is absent and would be wrong anyway; a Vercel cron means a new production
scheduled surface and a `CRON_SECRET`; a scheduled GitHub Actions job means a
standing production service-role credential in CI secrets for janitorial work.
The door needs none of them. It runs only when a publisher is already
authenticated, already authorized, and already uploading — and it is
structurally confined to that publisher's own tenant.

**Why only this door.** A `/finalize` call is always preceded by a ticket
request in the same session, so the prefix has just been swept. Adding the sweep
there would double the code path for no new coverage.

**The algorithm, in full.**

1. `list(\`${tenantId}/_staging\`, { limit: 100, sortBy: { column: "created_at", order: "asc" } })`.
   Oldest first, so a single page always makes progress even against a backlog.
   **Never paginate inside a request** — one page, one batch, bounded latency.
2. Keep an entry only if: `created_at` is a parseable timestamp **and** it is
   older than the threshold **and** `name` contains neither `/` nor `..`.
   An entry whose `created_at` is null or unparseable is **never** removed:
   unknown age is not evidence of abandonment.
3. Rebuild each path as `` `${tenantId}/_staging/${name}` ``. **The returned name
   is never trusted as a path** — re-prefixing is what makes it impossible to
   address anything outside this tenant's staging prefix.
4. Cap at 50 paths; `remove(paths)` once.
5. Return `{ scanned, removed, oldest }` for logging. Never throw.

**The threshold.** Default **24 hours**, overridable by
`CUSTOMS_STAGING_TTL_HOURS`. A malformed, absent, signed, fractional or
otherwise-notated value falls back to 24 — plain decimal digits only, because
`Number()` reads `0x0` as 0 and `1e1` as 10 and neither is how anyone writes a
number of hours.

**A shorter window is gated on the DATABASE, not on `NODE_ENV`** — implemented
after this document's first draft, and now the load-bearing safety property.
`NODE_ENV` says what kind of build this is; it says nothing about which database
the build talks to, and in this project a Preview is bound to the **production**
Supabase project. So a window shorter than the default is honoured only when
Vercel does not call this deployment production **and** the Supabase URL is a
loopback host. Each refuses on its own, both answers come from
`classifyEnvironment` / `classifyTarget` in `lib/env/project-binding.mjs` — the
same classifiers the deployment-binding guard uses — and that function reports
`unknown` for a URL it cannot parse and `unconfigured` for one that is absent,
so every uncertainty keeps the long window. A **longer** window needs no
permission anywhere: keeping more files is not destructive.

The variable is therefore **inert in production whether or not anybody sets it**,
and no production environment change is needed to make it safe.

24 h is chosen for margin, not from measurement: the actual exposure window
between bytes landing and `/finalize` being called is a single client round trip.

**Keep `dropStaging` exactly as it is.** It is the fast path; the sweep is the
backstop.

---

## 4. Security invariants

| # | Invariant | How it holds |
|---|---|---|
| S-1 | Only an authorized publisher can trigger a sweep | it runs after the `customs:reference:publish` check; test 27's ordering pin already enforces that shape |
| S-2 | A sweep can only ever touch the session tenant's staging prefix | the prefix is built from `user.tenantId`; every path is re-prefixed (§3 step 3); no bucket-wide list exists anywhere in the design |
| S-3 | A finalized document's object can never be swept | document objects live at `${tenant}/<id>.pdf`, one level above `_staging/`, and `list` is prefix-scoped. Note the basenames are **both** `<uuid>.pdf`, so a name-shape check would *not* distinguish them — only the prefix does, which is why S-2's re-prefixing is the real protection |
| S-4 | An in-flight upload cannot be swept | the object row does not exist until the `PUT` completes, so `list` cannot see it (rests on U-2) |
| S-5 | A recently landed object cannot be swept | the age threshold, measured from `created_at` |
| S-6 | A sweep failure can never deny an authorized upload | `list` and `remove` errors are caught and dropped; the function returns counts, never throws |
| S-7 | No new authority | no new permission, no new role, no new grant, no migration, no RLS change. The service-role client is the one both routes already use |
| S-8 | No secret or path is disclosed | the sweep logs counts and timestamps only — never names, uploadIds, tokens, signed URLs or raw error objects (§5) |
| S-9 | No new attack surface | no new route, no new webhook, no scheduled invocation, no new dependency |
| S-10 | Production can never sweep aggressively | a sub-default threshold needs a non-production deployment **and** a loopback database; a Preview bound to the production project is refused by the second condition even though it passes nothing else |

**Concurrency, case by case.**

- **Sweep vs `/finalize` of the same object** — only reachable if the object is
  older than the threshold. Outcome: `/finalize` answers `404 upload_not_found`,
  creates no row, writes no audit. Already pinned by journey R22's
  "a well-formed identifier for bytes nobody staged is simply not found".
- **Sweep vs `dropStaging`** — two deletes of the same path. No row is involved,
  both are idempotent, and both swallow errors.
- **Two sweeps at once** (two publishers in one tenant) — both may remove the
  same paths; idempotent.
- **Sweep vs an upload in progress** — invisible to `list` (S-4).

---

## 5. Audit and observability

**No `audit_log` row. Three independent reasons, in increasing order of force.**

1. **There is no entity to attach one to.** `writeAudit` requires an `entity`
   and a UUID `entityId`. A staging object has no document id — the `uploadId`
   is not one and never becomes one. Fabricating an id to satisfy the schema
   would put a row in the ledger that points at nothing.
2. **The object was never adopted.** No `customs_reference_document` row ever
   referenced it. It is indistinguishable from an abandoned HTTP upload, and it
   belongs to no document's history.
3. **A ratified test already forbids it.** `customs-reference-ref2.test.ts`
   test 38 asserts the ticket route contains no `writeAudit`. Beyond the pin,
   WES-9 makes a failed mandatory audit abort its action — so binding a
   janitorial delete to the audit path would let a failing audit write block a
   legitimate upload ticket, inverting the priority.

**On success**, one structured server line:

```
[customs-ref] staging sweep tenant=<uuid> scanned=<n> removed=<n> oldest=<iso|->
```

**On failure**, one line naming only the stage and the error *message*:

```
[customs-ref] staging sweep failed tenant=<uuid> stage=list|remove msg=<message>
```

The message, not the error object: a thrown Storage error can carry the request
URL, and a signed URL contains a token.

**Never logged, and never put in the response:** object names, uploadIds,
tokens, signed URLs, byte contents.

**How an operator finds accumulated debris.** Baseline, needing no code — the
read-only SQL used for this document:

```sql
select count(*)                                as staging_objects,
       min(created_at)                         as oldest,
       sum((metadata->>'size')::bigint)        as bytes
from storage.objects
where bucket_id = 'customs-reference'
  and strpos(name, '/_staging/') > 0;
```

Recommended one-line addition: return `stagingPending: scanned` in the ticket
response. Only a publisher ever sees it, `list` already computed it, and it
makes the backlog visible in the one place someone is already looking.

---

## 6. Test plan — all of it in the existing CI step, no new infrastructure

**Unit** — a new `tests/customs-reference-f2-sweep.test.ts`, executing the real
route against an in-memory fake, following the proven pattern of
`customs-reference-audit-compensation.test.ts` (which already mocks the session,
the permissions, the admin client and the audit writer, with injectable
failures):

| # | Claim |
|---|---|
| 1 | the threshold is 24 h with the env var absent, and with a malformed value; an explicit `0` is honoured |
| 2 | the age predicate: an object exactly at the threshold, one in the future, and one with a null `created_at` — the last is **never** removed |
| 3 | every path passed to `remove` begins with `${tenantId}/_staging/`; a name containing `/` or `..` is skipped |
| 4 | `list` rejects → the route still answers `201` and does not throw |
| 5 | `remove` rejects → the route still answers `201` and does not throw |
| 6 | `remove` is never called with an empty array |
| 7 | neither the response nor the logs contain a token, a signed URL or an object name |

**Journey** — a new `R24` describe in
`tests/journey/customs-reference-library.journey.ts`, against CI's real
PostgreSQL and Storage:

| # | Claim |
|---|---|
| 8 | **expired removed** — `TTL=0`: stage bytes, request a ticket, the staged object is gone |
| 9 | **fresh retained** — default TTL: stage bytes, request a ticket, the object survives **and `/finalize` still returns `201`**. The load-bearing anti-regression: a sweep that can eat a live upload is worse than the debris |
| 10 | **foreign tenant untouched** — an object placed under `${FOREIGN}/_staging/` with privilege survives a `TTL=0` sweep by tenant A, mirroring R23 |
| 11 | **finalized document untouched** — after a successful finalize, a `TTL=0` sweep leaves `${tenant}/<id>.pdf`, the row and the library intact |
| 12 | **concurrent finalize degrades safely** — `TTL=0`: stage, request a ticket (which sweeps), then finalize → `404 upload_not_found`, document count unchanged, no audit row |
| 13 | **U-2 holds** — after the `PUT`, the object's `created_at` is within seconds of now, so age really does measure time since the bytes landed |

**Structural** — one assertion in the REF-2 suite that `vercel.json` still has no
`crons` and no workflow has gained a `schedule:`, in the house style of pinning
an absence so a later edit has to argue with a test.

Cost: zero. All of it runs in the `rls-tests` job that already exists, on the
disposable Supabase that `supabase start` already boots.

---

## 7. Operational limitations — stated, not hidden

1. **Debris can persist indefinitely during inactivity.** The sweep only runs
   when a publisher requests a ticket. If nobody uploads again, nothing is
   reclaimed. This is accepted because the population is self-limiting — debris
   exists only where someone uploaded — and because the alternative is a
   scheduler nobody has. §5's operator query is the compensating control.
2. **Up to 50 objects per ticket request.** A larger backlog drains over
   successive uploads rather than in one sweep. This is a deliberate latency
   bound, not an oversight.
3. **No cross-tenant sweep.** A tenant's debris needs one of that tenant's own
   publishers to act. That is the direct consequence of S-2, and the right
   trade.
4. **The token TTL remains unverified** (U-1). The design does not depend on it;
   the measurement in U-1 would merely pin it.
5. **A sweep adds one `list` round trip to every ticket request** — normally
   returning zero entries, so a few tens of milliseconds.
6. **If Supabase ever changed `created_at` semantics** (U-2), test 13 fails
   loudly rather than the sweep deleting live uploads quietly.

---

## 8. What implementation would touch

| File | Change |
|---|---|
| `lib/customs/reference/staging-sweep.ts` | **new** — the pure age predicate and the sweep |
| `app/api/customs/reference/upload-url/route.ts` | one awaited call after the permission check; optional `stagingPending` in the response |
| `tests/customs-reference-f2-sweep.test.ts` | **new** — §6 unit claims |
| `tests/journey/customs-reference-library.journey.ts` | **new** `R24` describe — §6 journey claims |
| `tests/customs-reference-ref2.test.ts` | one structural assertion (§6) |

**Not touched:** no migration, no verifier, no permission, role or grant, no RLS
policy, no `finalize` behaviour, no scheduler, no workflow, no `vercel.json`, no
new dependency, no Finance or dossier surface.

---

## 9. Implementation authorization gate — SATISFIED

**Kept as the record of what implementation required.** All four were met before
any code was written, and the owner's authorization named this document.
Implementation required all of:

1. **Owner authorization naming this document.**
2. **Ratification of §5's no-audit decision.** It is consistent with test 38 and
   with the absence of any entity, but it is a boundary call about the audit
   trail and belongs to the owner, not to the implementer.
3. **Agreement on the 24 h default.** The rule that
   `CUSTOMS_STAGING_TTL_HOURS` must not be set in production is now *enforced*
   rather than documented (S-10), so this is a decision about the number, not
   about operational discipline.
4. **Acceptance of limitation 7.1** — that debris persists during inactivity,
   and that the operator query is the compensating control.

Settling U-1 is **not** a precondition: the design is built so that no value it
could take makes the sweep unsafe. If the owner wants it pinned anyway, the
measurement in U-1 is one journey assertion and can ride along with §6.
