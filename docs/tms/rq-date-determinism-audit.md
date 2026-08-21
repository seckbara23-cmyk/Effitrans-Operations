# Printed issue date vs PDF determinism — AUDIT

**AUDIT ONLY. Nothing implemented. No production artifact regenerated; no document
version altered.** TMS-7 remains closed at `71c7004`; RQ-18b remains
RESOLVED/APPROVED at `5cab533`. Neither is reopened.

---

## 0. Headline: these ARE two separate problems — and today only one of them is live

The operator's instinct is correct, and the distinction matters more here than the
answer:

| # | Problem | Guaranteed by | Status today |
| --- | --- | --- | --- |
| 1 | **Business-document determinism** — a given version always represents the same historical facts | `document.source_snapshot` (jsonb) + `source_sha256` | ✅ **already guaranteed** |
| 2 | **Byte-level determinism** — the same version rendered twice yields identical bytes/hash | the renderer and the PDF engine taking no clock, no ID, no randomness | ✅ **verified, see §5** |

They are independent. **Freezing a displayed date would NOT by itself preserve
byte-level determinism** — that depends entirely on whether the PDF writer embeds
a `/CreationDate` or a fresh `/ID`. In this repository it does not, which is why
both properties can hold at once. That had to be verified, not assumed, and it was.

---

## 1. What issue date is printed today? **None.**

The premise of the question does not hold, and that reframes the decision from
"fix the date" to "should we add one".

| Artifact | Dates printed | Source | Meaning |
| --- | --- | --- | --- |
| **ORDRE DE TRANSPORT** | `pickupPlanned`, `deliveryPlanned` | snapshot | **Business dates** — planned enlèvement / livraison. **No issuance date of any kind** |
| **DEMANDE DE TRANSPORT** | above + **« Date de la demande »** (`requestedAt`) | snapshot | `transport_record.created_at` (falling back to the dossier's) — **when the need was raised**, a business fact |

Neither is a render time, a document-creation time, or a regeneration time. Both
come from the **snapshot**, so both are frozen per version by construction.

`render.ts` states the rule explicitly and my own suite pins it:

> *"this renderer takes NO clock and NO random source: there is no 'generated at
> 14:32' line, no document id in the footer, no creation date in the PDF trailer.
> The generation timestamp and the actor are recorded in the DATABASE row."*

The footer carries the governance sentence only — no date.

**Exact source of the only issuance-adjacent date:**
`lib/documents/artifacts/service.ts:104` —
`requestedAt: (t.created_at ?? file.data.created_at)?.slice(0, 10) ?? null`

---

## 2. Can regeneration produce different bytes because a date was injected?

**No — because no date is injected.** Verified statically and empirically (§5).

A second, stronger point: **the application never re-renders an existing version.**
`lib/documents/artifacts/actions.ts` computes
`nextVersion = (current?.version ?? 0) + 1` and always writes a NEW row. A
"regeneration" is version N+1, never a rewrite of N. Prior versions keep their
bytes, their `content_sha256`, and their storage object — as UAT-18 proved in
production (V1 survived V2).

So byte-determinism matters here for **verification** — re-rendering an archived
version from its stored snapshot to confirm the hash still matches — not for
normal operation.

---

## 3. Versioning behaviour

| Question | Answer |
| --- | --- |
| What causes a new version? | Any generation. `nextVersion = max(version) + 1`, always a new row |
| Should an issue-date change require a new version? | **Yes, necessarily** — under the current design a new printed date can only arise from a new generation, which IS a new version. The question cannot arise separately unless an `issued_at` is introduced that is mutable after the fact (see Alternative C) |
| Do historical versions reproduce their original printed date? | **Yes today**, trivially: their dates live in `source_snapshot`, which is stored per version |

---

## 4. Does a trustworthy timestamp already exist, without new schema? **Yes — two.**

`document` already carries, per version:

| Field | Type | Meaning |
| --- | --- | --- |
| **`generated_at`** | timestamptz | when this version was produced |
| `generated_by` | uuid | who produced it |
| `version` | integer | the version number |
| `source_snapshot` | **jsonb** | the exact render inputs |
| `source_sha256` / `content_sha256` | text | input hash / output hash |
| `renderer_version` | text | which renderer produced it |

**No schema change is required to print a frozen issue date.** `generated_at` is
already stored, already per-version, already immutable in practice.

⚠ **One ordering constraint.** In `actions.ts` the PDF is rendered **before** the
row is inserted, so `generated_at` does not yet exist at render time. Printing it
requires the action to mint the timestamp once, pass it to the renderer, and store
that same value — not read it back afterwards. Small, but it is the whole
implementation risk.

⚠ **And a reproduction-contract consequence.** `source_sha256` covers the snapshot
only. If an issue date becomes a render input, the reproduction contract becomes
**(snapshot, renderer_version, artifactVersion, issuedAt)**. That is consistent
with what already exists — `artifactVersion` is *already* a render input outside
the snapshot — but it must be stated, or a future verifier will compute a
mismatching hash and conclude the archive is corrupt.

---

## 5. PDF metadata — verified, not assumed

The operator asked not to claim determinism until the container itself was checked.

**Static scan of `lib/reports/pdf.ts`:**

* trailer is `<< /Size N /Root 1 0 R >>` — **no `/ID`**, **no `/Info`**;
* **no `/CreationDate`**, **no `/ModDate`**, **no `/Producer`**, **no `/Creator`**;
* no `Date.now`, no `new Date`, no `Math.random`, no `crypto`, no `randomUUID`.

The only textual match for `new Date` in either file is a **comment** in
`render.ts` explaining that it is deliberately never used.

**Empirical cross-process check.** The same fixed snapshot was rendered in two
separate Node processes ~2 minutes apart:

```
run1 11:40:48Z   PROBE_SHA256=d6b0fe6ad1f667d7ee016d78d0ef0aaa03649a8dad61bc255895c2daf0764f2a
run2 11:42:37Z   PROBE_SHA256=d6b0fe6ad1f667d7ee016d78d0ef0aaa03649a8dad61bc255895c2daf0764f2a
```

**Identical.** (The probe was a throwaway test file, deleted immediately; it is
not committed.)

**Conclusion: byte-level PDF determinism genuinely holds today**, and nothing in
the PDF container independently prevents it. Adding a **frozen** date preserves
it; adding a **live** one would break it.

---

## 6. Alternatives

### A — Retain current behaviour (no issue date)

| | |
| --- | --- |
| Semantic correctness | ✅ Nothing false is printed. But an external-facing order carries no date identifying when it was issued, which a carrier or an auditor may reasonably expect |
| Determinism | ✅ both properties hold |
| Audit/history | ✅ `generated_at` is on the row and queryable |
| Schema / migration | none |
| Impact on existing versions | none |
| Cost / risk | zero |

### B — Freeze the printed date from `generated_at` (RECOMMENDED)

| | |
| --- | --- |
| Semantic correctness | ✅ "issued" = "this version was produced", which is exactly what happens today: generation IS issuance, there is no separate approval step |
| Determinism | ✅ both hold, **provided** the timestamp is minted once in the action, passed to the renderer, and persisted — never read from a clock at render time |
| Audit/history | ✅ improves it: the printed document and the row agree, and an archived version can be re-rendered from (snapshot + renderer_version + version + generated_at) |
| Schema / migration | **none** — `generated_at` already exists |
| Impact on existing versions | **none** — old versions keep their bytes and hashes. Requires `RENDERER_VERSION` bump so old and new output for the same snapshot stay explainable |
| Cost / risk | Small. One render input, one action change, one version bump. The risk is the ordering constraint in §4 |

### C — Introduce an explicit `issued_at`

| | |
| --- | --- |
| Semantic correctness | ✅ **only if** Effitrans has an issuance/approval act distinct from generation. Today it does not — there is no draft→issue transition for these artifacts |
| Determinism | ✅ if frozen; ⚠ if `issued_at` were later editable, the printed document and the stored bytes would silently diverge unless editing forces a new version |
| Audit/history | Richer, but introduces a second date that must be explained against `generated_at` |
| Schema / migration | **Migration required** (new column, backfill decision for 6+ existing artifacts) |
| Impact on existing versions | Backfill needed, or a permanently null column on historical rows |
| Cost / risk | Highest. **Do not build it for a distinction the business has not asked for** |

### D — Remove the printed date

Not applicable to the ORDRE DE TRANSPORT (it has none). For the DEMANDE it would
mean dropping « Date de la demande », which is a **genuine business fact** and
should stay. **Rejected.**

### E — Alternative found in the repository: reuse the `aging_report_artifact` idiom

`aging_report_artifact` carries `rendered_at` + `content_sha256` + `renderer_key`
— the same shape as `document`'s `generated_at` / `content_sha256` /
`renderer_version`. It is **the same pattern already ratified elsewhere**, which
supports Alternative B rather than introducing a new concept. No new architecture
is needed.

---

## 7. Recommendation

**Alternative B — freeze the printed issue date from the existing `generated_at`.**

Smallest architecture-consistent change:

1. `actions.ts` mints the timestamp **once**, passes it to `renderArtifact`, and
   stores the identical value as `generated_at`.
2. `render.ts` prints it in the header block as **« Émis le 21/08/2026 »**, reusing
   the existing `frDateTime` helper (already pattern-parsed, timezone-free).
3. `RENDERER_VERSION` → `wes4g-4`.
4. Document the reproduction contract as (snapshot, renderer_version,
   artifactVersion, generated_at).
5. Tests: the date is printed; it is NOT read from a clock at render time; two
   renders with the same inputs are byte-identical; a different `generated_at`
   changes the bytes (proving it is a real input, not decoration).
6. Mutations: the date reverting to a live clock; the version not bumped; the
   timestamp read back from the row after render instead of minted before.

**No migration. No backfill. No change to existing versions.** Existing artifacts
simply have no printed date, which is what they have today.

---

## Decision required

> **1. Should the ORDRE DE TRANSPORT print an issue date at all?**
> If yes → **2. Approve Alternative B** (« Émis le … », frozen from `generated_at`,
> no schema change), or state a preferred wording.
> If Effitrans has a **formal issuance/approval act distinct from generation**, say
> so — that, and only that, would justify Alternative C and its migration.

---

## Out of scope — untouched by this audit

deposit legacy `APPROVED` write · customs-panel error placement ·
`UNIQUE (file_id)` multi-leg-road modelling debt · RQ-18b · TMS-7.

---

# STATUS: IMPLEMENTED (2026-08-21) — Alternative B

**Decision:** APPROVED. The ORDRE DE TRANSPORT prints **« Émis le : DD/MM/YYYY »**,
frozen from the artifact`s own generation timestamp.

## What was implemented

| Step | Detail |
| --- | --- |
| **Migration 120** | `20260912000001_artifact_generated_at.sql` — `finalize_generated_artifact` gains **`p_generated_at timestamptz default null`** as its LAST parameter; the INSERT uses `coalesce(p_generated_at, now())` |
| **Mint once** | `actions.ts` mints `generatedAt` **exactly once** and passes the SAME value to the renderer AND to the RPC. `now()` is never a second source of truth on this path |
| **Render** | `« Émis le : ${frDate(generatedAt)} »`, date only, in the header block, **ORDRE DE TRANSPORT only** (`ARTIFACTS_WITH_ISSUE_DATE`) |
| **RENDERER_VERSION** | `wes4g-3` → **`wes4g-4`** |

**Why DROP + CREATE, not CREATE OR REPLACE:** adding a parameter changes the
identity arguments, so a replace would leave the 14-argument function beside the new
one and every 14-argument call would become ambiguous. Both statements run inside the
migration`s single transaction, so the function is never missing.

## Reproduction contract (now documented)

**(`source_snapshot`, `renderer_version`, `artifactVersion`, `generated_at`)**

All four are persisted per version on `public.document`. An archived version can be
re-rendered byte-for-byte from its own row.

## Constraints held

| Constraint | Held |
| --- | --- |
| No table change, no new column, no `issued_at`, no backfill | ✅ — asserted BY the migration itself, which raises if `issued_at` exists or if `generated_at` is missing |
| Existing callers unbroken | ✅ — parameter appended last with a default; `now()` fallback preserves their exact prior behaviour |
| Historical versions untouched | ✅ — they simply have no printed date, as today |
| Byte determinism for identical inputs | ✅ pinned |
| Scoped to ORDRE DE TRANSPORT | ✅ — the DEMANDE keeps « Date de la demande » and prints no issue date |

## Verification

24 tests in `tests/rq-issue-date-frozen.test.ts`. Mutations **M63–M71** all caught:

* **M63** the RPC taking a SECOND clock read — the exact bug this change exists to
  prevent, and the one that only misbehaves across midnight;
* **M64** the renderer reading its own clock;
* **M65** the timestamp never reaching the renderer;
* **M66** `now()` outranking the supplied value in the INSERT;
* **M67** the default removed, breaking existing callers;
* **M68** the old 14-argument overload left in place (ambiguous calls);
* **M69** the issue date leaking onto every artifact;
* **M70** the hour printed alongside the date;
* **M71** `anon`/`authenticated` regaining EXECUTE on the definer function.

⚠ **M66 initially did NOT fail.** The pin `toContain("coalesce(p_generated_at, now())")`
was satisfied by that string`s OTHER occurrence — inside the migration`s own
self-assertion — so reverting the INSERT to plain `now()` stayed green. The pin is now
bound to the VALUES clause. Recorded because it is the recurring
"satisfied-by-neighbouring-text" trap, not a one-off.

## Housekeeping caused by this migration

* Build ledger registered: `LATEST_MIGRATION` → `20260912000001_artifact_generated_at`,
  `MIGRATION_COUNT` → **120**.
* `tests/tms-6-subcontractors.test.ts` pinned `LATEST_MIGRATION` to TMS-6`s own file and
  the count to exactly 119 — a **frozen "latest" literal**, true the day it was written
  and false the moment any later migration shipped. Rewritten to assert what TMS-6
  actually needs: its migration exists and the counted ledger includes it.

Full vitest **7209 passed** (the one failure is the standing Windows line-ending pin,
green in CI). Typecheck and production build clean.

⚠ **Migration 120 requires operator application in production**, then
`npx supabase migration repair --status applied 20260912000001`.
