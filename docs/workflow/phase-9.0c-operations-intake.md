# Phase 9.0C — Operations Intake and Dossier Ownership

**Date:** 2026-07-23 · **Status:** shipped dark (no tenant sees anything until flags are turned on)

Phase 9.0C is the first **activation slice** of the canonical dossier workflow
approved in Phase 9.0A and structurally prepared in Phase 9.0B: opening a
dossier's official workflow (validation → canonical Operations owner → process
instance → initial step → legacy `DRAFT → OPENED` → « Dossier reçu » customer
milestone) and formally handing the work to Transit. It deliberately does
**not** implement the Transit T1–T10 execution workflow — that is Phase 9.0D.

---

## 1. What shipped

| Piece | File | Nature |
|---|---|---|
| Intake validation (pure) | `lib/process/intake.ts` | NEW |
| Intake server actions | `lib/process/engine/intake-actions.ts` | NEW |
| Intake panel UI | `components/process/intake-panel.tsx` | NEW |
| Page wiring | `app/files/[id]/process/page.tsx` | modified (flag-gated addition) |
| `intake` flag | `lib/process/flags.ts`, `config.ts`, `rollout.ts` | modified (additive) |
| « Dossier reçu » milestone | `lib/customer-notify/events.ts`, `lib/i18n.ts` | modified (additive event) |
| Tests | `tests/operations-intake.test.ts` (62) | NEW |

**No migration. No new table. No new permission. No RLS change.** Everything is
orchestration of existing, individually-audited actions.

## 2. The intake lifecycle (no second enum)

The lifecycle is expressed entirely through **existing** state — deliberately,
so no parallel status machine can drift from reality:

| Stage | Where it lives |
|---|---|
| `DRAFT` | `operational_file.status = 'DRAFT'` (what `createFile` already produces) |
| `READY_FOR_OPENING` | **derived**: DRAFT + `validateIntake().blocking` empty |
| `OPEN` | `process_instance` exists **and** canonical owner assigned (+ file transitioned to `OPENED`) |
| `HANDED_TO_TRANSIT` | a SENT/RECEIVED `process_handoff` into `coordinator_reception` |

## 3. Intake validation — blocking vs. warning

`validateIntake()` (pure, tested directly) draws the line the CEO documents
demand without pushing staff back outside the system:

- **Blocking** (opening refused): customer, dossier type, canonical Operations
  owner, and transport mode — except an `HND` handling dossier, where a missing
  mode is only recommended.
- **Warning** (opening allowed): origin, destination, a useful reference
  (BL/AWB/booking/container), ETA. **BL/AWB and documents are never universally
  mandatory at intake** — they frequently do not exist yet for a real dossier.

All labels are French; the panel shows blocking issues in red, warnings in amber.

## 4. Opening a dossier — `openDossierWorkflow(fileId, { ownerUserId })`

Requires `process:manage` (plus `process:owner:assign` to load the owner
directory in the UI). Orchestration order — each constituent keeps its own
permission gate, CAS and audit trail:

1. **Validate** intake (blocking issues refuse with `intake_incomplete`).
2. **Instance** via the existing idempotent `initializeProcessForFile` (29
   nodes PENDING, step 1 AVAILABLE). Never a direct insert.
3. **Canonical owner** via the 9.0B `assignProcessOwner` contract (active,
   same-tenant, OPERATIONS-mapped; audited `PROCESS_OWNER_ASSIGNED`).
4. **Cotation skip** (default, override with `skipCotation: false`): an
   explicit, audited `MANUAL` skip — « Ouverture directe — dossier sans
   cotation préalable (client sous contrat) » — so step 2 can open. If cotation
   is kept, `operations_intake` simply stays PENDING until it completes.
5. **Activate** `operations_intake` (frozen registry key; tolerant).
6. **Legacy transition** `DRAFT → OPENED` through the existing `transitionFile`
   seam (its own `file:update` permission + audit) — the engine still never
   writes `operational_file`. Failure aborts with `transition_failed` **before**
   any customer message.
7. **« Dossier reçu »** — published **last**, only after everything persisted.
   Existing `notifyCustomer` pipeline: portal inbox + preference-gated email,
   dedup key `file_opened:<fileId>` ⇒ at most once per dossier, ever.
8. **Owner notification** — existing `FILE_ASSIGNED` staff notification (never
   self-notify).

**Idempotent by composition**: a retry converges (initializer returns the
existing instance, owner assignment is idempotent, skip tolerates
already-skipped, milestone dedups). The action reports `milestonePublished` so
the UI never claims a customer message that was deduplicated away.

## 5. Canonical owner semantics

- Eligible owners = active same-tenant staff whose roles map to **OPERATIONS**
  in the canonical registry (`roleCanonicalDepartment`), served by
  `listEligibleOperationsOwners()` (gated on `process:owner:assign`, bounded).
- The UI shows **« Responsable opérationnel »** with name, role label,
  department label, email — never a raw UUID (the `IntakeState.owner` shape has
  no id field at all).
- Ownership is accountability, **not** task assignment — the 9.0B distinction
  is preserved untouched.

## 6. Transit handoff — `handDossierToTransit(fileId)`

Requires `process:handoff:send`. **Operations remains the owner** — the handoff
changes specialist responsibility, never ownership (the function provably never
touches owner columns).

- Refused with `blocked_by_intake_blockers` while any `OPEN`/`ACKNOWLEDGED`
  blocker in `HANDOFF_BLOCKING_CATEGORIES` (`MISSING_DOCUMENT`,
  `CUSTOMER_RESPONSE_REQUIRED`) exists — an incomplete dossier does not travel.
  Other categories (payment, supplier…) do not gate this transmission.
- The transmission itself is the engine's existing `sendHandoff("am_dossier_opening",
  "coordinator_reception")` — idempotent (dedup key), explicit reception,
  audited. `coordinator_reception` flips to AVAILABLE on `receiveHandoff`,
  exactly as the engine already works.
- Active `COORDINATOR` / `CHIEF_OF_TRANSIT` holders get a best-effort
  `FILE_ASSIGNED` notification (« Dossier transmis au Transit — réception à
  confirmer ») — never a per-member task assignment.

## 7. Intake blockers

The panel exposes « Signaler un document manquant »: a 9.0B `openProcessBlocker`
with category `MISSING_DOCUMENT`, an **internal** title (never shown to the
customer) and an **optional** customer message — the blocker is
`customer_visible` only when a message is actually written. Open blockers
suspend the Transit transmission until resolved from the same panel.

## 8. Rollout — dark by default, migration-gated

```
EFFITRANS_OPERATIONS_INTAKE_ENABLED=false   # .env.example default
```

Resolution (pure, in `lib/process/flags.ts`):

```
intake = ENGINE && STRUCTURES && OPERATIONS_INTAKE
```

then ANDed with the tenant rollout (`resolveEffectiveFlags`). The **double
gate** on structures is deliberate: intake writes 9.0B structures (owner,
blockers), so it can never be on where they are off.

### Migration-state precondition (production constraint)

The 9.0B migration `20260723000001_workflow_structures.sql` (and 9.0A-era
`20260722*`) **may not yet be applied to the live database**. Phase 9.0C is
safe in every combination:

| DB state | Flags off (today) | Flags on |
|---|---|---|
| 9.0B migration absent | invisible, zero change | `getIntakeState` catches the failure → panel **hides**; write actions fail closed via `assignProcessOwner` (`owner_…` error), nothing half-opens |
| 9.0B migration applied | invisible, zero change | full behaviour |

**Operator rule: do not enable `EFFITRANS_OPERATIONS_INTAKE_ENABLED` until
`/platform/operations` (build-info probe `process:owner:assign`) confirms the
9.0B migration is applied.** With every flag off — the shipped state — behaviour
is byte-for-byte today's production: `createFile` and the legacy lifecycle are
untouched.

## 9. Existing-dossier policy (no auto-backfill)

Nothing retroactively opens existing dossiers. A pre-engine dossier gains an
instance only through the **existing** compatibility path or through an
explicit, operator-driven `openDossierWorkflow` on that dossier. The
« Dossier reçu » milestone only ever fires from the explicit opening action —
never from a backfill.

## 10. Rollback

Turn `EFFITRANS_OPERATIONS_INTAKE_ENABLED` off (or `STRUCTURES`, or the
master). Instances/owners/handoffs already created remain (they are ordinary
engine data, readable by all existing surfaces); no data needs reverting
because 9.0C wrote nothing outside existing contracts.

## 11. Operator acceptance checklist

Prereqs: staging tenant, 9.0A/9.0B migrations applied, the three flags on for
the tenant, a user with `process:manage` + `process:owner:assign` +
`process:handoff:send` + `process:blocker:manage`.

1. Create a dossier missing its transport mode → open `/files/{id}/process`:
   panel shows the red blocking issue; « Ouvrir le dossier » stays disabled.
2. Complete the mode, pick a « Responsable Opérations » in the picker (names +
   roles, no UUID) → « Ouvrir le dossier » → dossier becomes `OPENED`, owner
   card appears, warnings (ETA…) shown amber but non-blocking.
3. As the client (portal): inbox shows **« Dossier reçu »** exactly once; run
   the opening again (retry) → no duplicate milestone.
4. « Signaler un document manquant » (no customer message) → blocker appears,
   « Transmettre au Transit » disabled; check the portal shows nothing.
5. Résoudre the blocker → « Transmettre au Transit » → success notice; a
   COORDINATOR user receives « Dossier transmis au Transit » ; the process
   inspector shows the pending handoff awaiting reception.
6. Verify audit log lines: instance init, `PROCESS_OWNER_ASSIGNED`,
   `STEP_SKIPPED` (cotation), file transition, blocker open/resolve, handoff.
7. Flags off → the panel and actions disappear; nothing else changed.

## 12. What Phase 9.0D takes up next

Transit execution (T1–T10 from `TRANSIT_SOURCE_MAP`): reception confirmation
UX, declarant assignment via Transit teams (`assignStepTeam` /
`organization_team_member`), the customs chain steps, and the
`CONTINUE_BEFORE_PAYMENT` decision seam at the payment gate.
