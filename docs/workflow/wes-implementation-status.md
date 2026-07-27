# WES — Implementation Status

Tracks execution of the stabilization programme ratified in
[`wes-0-canonical-workflow-architecture.md`](wes-0-canonical-workflow-architecture.md) and
[`wes-0a-ratification-addendum.md`](wes-0a-ratification-addendum.md).

Execution order is dependency-driven, not numeric (WES-0A §6):

> WES-1 → WES-2 → **WES-7** → **WES-9** → WES-3 → WES-4 → WES-5 → WES-8 → WES-6

| Phase | Scope | Status |
|---|---|---|
| WES-0 / WES-0A | architecture ratification (docs) | ✅ done — `026ca30` |
| **WES-1** | **integrity hotfixes** | ✅ done |
| **WES-2** | **canonical projection, ratchet, one progress formula** | ✅ done |
| **WES-7** | **policy registry (ADR-WES-012)** | ✅ **done** |
| **WES-9** | **business event ledger (ADR-WES-014)** | ✅ **done** — `398d6b8` |
| **WES-9A** | **mandatory-event atomicity correction (Model A)** | ✅ **done** |
| **WES-3** | **ownership, assignment, visibility, assignment history** | ✅ **done** |
| **WES-3A** | **assignment-path migration + department queue (closes WES-3H)** | ✅ **done** — WES-3 now complete end to end |
| **WES-3B** | **rollout consistency repair (Recouvrement)** | ✅ **done** — console now shows what is LIVE; ⚠ operator must set EFFITRANS_COLLECTIONS_ENABLED |
| **WES-4** | **BAE governance + document doctrine** | ✅ **done** |
| **WES-4G/4H** | **generated artifacts, upload hashing, sharing enforcement, operator UI** | ✅ **done** — WES-4 fully complete |
| **WES-5** | **engine/module reconciliation** | ✅ **done (core), CI-verified + deployed** — `3c85e87`, run 30305934500 (54/54 suites, 0 skipped); prod /api/version matches; POD defect fixed; conflicts returned not persisted; see §10. ⚠ Authenticated new-dossier smoke = operator step, folded into UAT-1 |
| WES-8 | SLA engine (ADR-WES-013) | ⬜ |
| WES-6 | missions + chauffeur portal (reuse analysis first) | ⬜ |

---

## WES-1 — Workflow Integrity Hotfixes

**Scope:** stop data loss, duplicate handoffs and the chauffeur-linkage break found in UAT.
**No schema migration.** All five fixes ride existing structures.

### UAT defect traceability

| UAT observation | Audit finding | Root cause in code | Fix |
|---|---|---|---|
| Transport planning data disappeared after assignment | §6, §9.6 | `updateTransport`/`assignTransport` wrote every owned field as `input.x?.trim() \|\| null`, so an omitted field was written **null** — a full overwrite wearing the shape of a patch | WES-1A — `lib/transport/patch.ts` |
| Two tabs silently overwrote each other | §6 | no optimistic concurrency; last write won | WES-1B — CAS on `updated_at` |
| Completed department read as "never started" | §2 (K), §9.1(b) | soft-delete allowed at any status, and revival wrote `status: "NOT_STARTED"`, discarding BAE / delivery evidence from every projection | WES-1C |
| « Dossier prêt pour déclaration douanière » reappeared on a dossier already in transport | §4, §9.2 | `createHandoffTask` checked only for an **open** task; a satisfied+closed handoff was eligible again, and `onDocumentApproved` re-fired on a late POD approval | WES-1D |
| Chauffeur received no mission after assignment | §5 (H), §9.4 | the always-visible form wrote free-text `driver_name`; the authoritative `driver_user_id` assignment was rendered only when `TRACKING_ENABLED` — GPS configuration silently controlled identity | WES-1E |

### Contracts introduced

**Partial-patch (WES-1A)** — `lib/transport/patch.ts`

| Caller supplies | Result |
|---|---|
| field omitted (`undefined`) | preserved |
| field `null` | preserved |
| field `""` / whitespace | preserved |
| field with text | set (trimmed) |
| field named in `clearFields` | **cleared** — the only way to write null |

An empty browser form is never consent to erase. A UI that wants blanking-to-clear computes
`clearFields` itself, from a real comparison against the record it loaded
(`components/transport/transport-panel.tsx#clearedFields`). `clearFields` is validated against the
fields the called action owns, so `assignTransport` can never clear a planning field.

**Optimistic concurrency (WES-1B)** — reuses the existing `updated_at` column (maintained by
`trg_transport_updated_at`) and the engine's compare-and-set shape: constrain the UPDATE on the
token the caller loaded, then check the affected row count. `expectedUpdatedAt` is **required** on
both material mutations. A stale write returns `stale_write`, writes **no** success audit, and never
retries or merges. The token is passed back verbatim — reformatting it would break the microsecond
comparison.

**Deletion / revival (WES-1C)** — `customs_record` at `RELEASED` and `transport_record` at
`DELIVERED`/`POD_RECEIVED` are non-deletable through the ordinary path. Revival now writes **only**
`deleted_at: null`: a soft delete never cleared the status, BAE reference, release date or
delivery/POD timestamps, so restoring the row restores the history intact. **No override system was
built** (WES-1 introduces none); these records are simply protected.

**Handoff idempotency (WES-1D)** — `handoffSurpassed()` in `lib/handoffs/rules.ts` (pure) refuses a
handoff when an equivalent one already reached `DONE`, **or** when the dossier has already reached
the target department or a later one. Department progress is read from the authoritative module
records — never from the tasks being guarded — and reuses the `CUSTOMS_RANK` / `TRANSPORT_RANK`
tables already used by the lifecycle projection (now exported; not duplicated). A `NOT_STARTED`
record does not count as reached, so the first legitimate handoff still fires. The guard sits in the
single funnel `createHandoffTask`, so all four producers inherit it, and it returns before both the
task insert and the notification fan-out.

**Chauffeur identity (WES-1E)** — driver-user assignment is gated on `transport:assign` alone.
`TRACKING_ENABLED` keeps its real job (GPS sessions, positions, live map) and no longer gates
identity, mission visibility or the assignment notification. The driver portal already keyed on
`driver_user_id` and its guard consults no flag, so missions now arrive with GPS off. When a
free-text name exists without an authenticated link, the panel says so explicitly rather than
letting the form look like it worked.

### Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | 3419 passed / 161 files (+60 new) |
| Production build | compiled |
| Lint | **not applicable** — ESLint is not configured in this repository (`next lint` offers interactive setup; configuring it would add unrelated files) |
| SQL/RLS suites | not run — **no schema, policy or SQL changed** |

### Known limitations carried forward

1. **Legacy free-text chauffeurs.** Existing rows may hold `driver_name` with no `driver_user_id`.
   WES-1 does **not** infer a link from a name — the panel surfaces the gap honestly instead.
   Repair is an operator action (re-assign through the driver selector).
2. **Rows already damaged by prior null-overwrites** are not reconstructed; WES-1 stops the bleeding,
   it does not invent history.
3. **A satisfied handoff can no longer be recreated at all.** Under the monotonic doctrine
   (ADR-WES-010) that is correct — corrections do not re-handoff. Should a genuine re-handoff need
   arise, it belongs to the engine's explicit `process_handoff` with reception (ADR-WES-009), which
   WES-5 makes the only handoff of record.
4. **Concurrency covers the transport module only.** `assignDriverUser` keeps its existing no-op
   guard; extending CAS across other modules is not WES-1 scope.
5. The four unratified SLA thresholds, the policy registry, the event ledger and the mission entity
   remain untouched — WES-7/8/9/6.


---

## WES-2 — Canonical Projection, Lifecycle Ratchet & Single Progress Formula

**Scope:** one projection every surface reads. **No schema migration, no new business rules.**

### Architecture discovered — SEVEN competing computations

| # | Location | What it computed |
|---|---|---|
| 1 | `lib/files/lifecycle.ts` | `completedPercent` over 15 derived steps |
| 2 | `lib/navigation/journey.ts` | `completed`/`total` over 26 engine steps |
| 3 | `components/process/process-journey.tsx` | a percentage **in the UI** — not in the audit's list of five |
| 4 | `lib/portal/progress-map.ts` | `percent` over 10 customer stages |
| 5 | `lib/driver/service.ts` | hardcoded 0 / 50 / 100 |
| 6 | `lib/process/journeys/milestones.ts` | milestone roll-up (a competing stage view) |
| 7 | `lib/control-tower/aggregate.ts` | flow-board bucketing off the **raw frontier** |

Call graph: `module records → getDossierLifecycle → {dossier page, control tower, copilot, portal×2}`
and, separately, `process engine → summarizeJourney → journey panel`. Nothing reconciled them.

### The canonical projection

`lib/workflow/stages.ts` — the ladder:
`draft → open → documentation → douane → transport → finance → archivage`, reusing the existing
`Department` vocabulary.

`lib/workflow/projection.ts` — `buildCanonicalProjection(input)`. PURE, no I/O, **no task input**.
Owns: current stage · current + responsible department · next action · progress · completed stages ·
pending stages · blockers · ratchet transparency.

**Ratchet.** The stage is `max(evidence floor, raw frontier)` and never decreases. The floor reads
only facts that cannot legitimately go backwards, and a `BLOCKED` record counts as *reached* — you
cannot be blocked in a department you never entered. When the frontier falls behind, the stage
**holds** and the earlier work surfaces as a blocker overlay:

```
Stage: Transport · Statut: Bloqué · Responsable: Documentation
```

**Completed stages are immutable:** anything before the ratcheted stage is `completed` and stays so.

**One formula:** `completed applicable stages ÷ applicable stages`. Skipped stages leave the
denominator; **blocked never subtracts**.

### Consumers removed / migrated

| Consumer | Action |
|---|---|
| `lifecycle.completedPercent` | **removed** — the tracker is now a fact deriver |
| `PortalTimeline.percent` | **removed** — the map returns stages only |
| journey panel percentage + bar | **removed** — renders an official-step *count*, no percentage |
| dossier page, control tower, copilot, portal shipments, portal tracking | **migrated** to `buildCanonicalProjection` |
| control-tower flow board | **migrated** to the ratcheted department |
| driver `progressPercent` | **renamed** `executionPercent` — mission execution, not dossier progress |

### Verification

| Gate | Result |
|---|---|
| Typecheck | clean |
| Tests | 3457 passed / 162 files (+38 new) |
| Production build | compiled |
| Schema | **no migration** |

Proofs in `tests/wes-2-canonical-projection.test.ts`: the UAT regression is reproduced and held;
stage and progress are monotone across a full forward walk; completed stages are immutable under
regression; `* 100` appears in exactly one workflow module; no consumer computes its own percentage;
the projection takes no task input and contains no SLA, routing, ownership or document policy.

### Deferred (documented, not implemented)

- **`summarizeJourney` still reports x/26 official steps.** That is a *count of process steps*, a
  detail of the 26-step inspector, not a second dossier-progress claim — the percentage and bar were
  removed. Folding the engine's step model into the canonical projection is **WES-5** (engine/module
  reconciliation).
- **SLA and risk still key on the raw frontier** (`lifecycle.currentDepartment`) in the control
  tower. That is semantically "who we are waiting on", and SLA is **WES-8**; ADR-WES-012 forbids the
  projection from carrying SLA at all.
- **`milestones.ts`** remains the engine-side milestone view for `/journeys`; it produces no
  percentage. Reconciliation is WES-5.
- **No persisted high-water column.** The ratchet is derived from already-monotonic evidence, which
  needs no schema and cannot itself drift. If a future phase needs an explicit reversal action
  (ADR-WES-010), that is where persistence would be introduced.


---

## WES-7 — Versioned Policy Registry

**Scope:** separate engine invariants (code) from business policy (versioned configuration), so
WES-3/4/5/8 write bindings as configuration instead of hardcoding and migrating later.
Full detail: [`wes-7-policy-registry.md`](wes-7-policy-registry.md).

**Shipped:** seven typed policy domains · immutable versions with `DRAFT→VALIDATED→ACTIVE→RETIRED` ·
exactly one ACTIVE per scope · content hashing with duplicate detection · fail-closed validation
against the live catalogs · one server-only resolver (pinned → tenant → platform → built-in → fail) ·
dossier pinning at process-instance creation with honest `LEGACY_DEFAULT` provenance · atomic
activation RPC · RLS + minimal admin surface. Migration `20260726000003` (61st), additive.

**Reused, not rebuilt:** the `expense_template` lifecycle vocabulary, the `tenant_process_rollout`
fail-closed resolution pattern, the `provision_tenant` atomic-RPC precedent, the 11.0B canonicalization
for hashing, and the existing `admin:config:manage` permission — **no new privileged permission**.

**Gates:** typecheck clean · 3516 tests / 163 files (+59) · production build compiled · clean replay
green · seed unchanged · RLS suite wired into CI.

**Deliberately not consumed yet.** WES-7G requires the registry to reproduce current behaviour exactly;
`resolvePolicy` is the typed seam WES-3/4/5/8 will consume, and no workflow action reads it today, so
behaviour is byte-for-byte unchanged.
