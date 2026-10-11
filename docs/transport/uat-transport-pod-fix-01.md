# UAT-TRANSPORT-POD-FIX-01 — driver tracking, pickup, delivery and POD

Correction of the defects confirmed by the read-only audit `EFF-UAT-TRANSPORT-POD-LOSS-01` (incident of 2026-10-10 on dossier `EFT-IMP-2026-00014`, transport `4117d491…`). Branch `fix/uat-transport-pod-01`, cut from `main` at `616a223` (the SHA production serves). **No production data was touched; no migration was added; the ledger stays at 151.**

## 1. Root cause → fix traceability

| # | Confirmed root cause (audit) | Evidence | Correction | Guarding test |
|---|---|---|---|---|
| D1 | The position ingest accepted `ACTIVE` only, so every GPS fix after « Démarrer le retour » (19:10:59) was refused `409 session_not_active` — which the control tower then displayed as a lost signal. TMS-2 had already ratified that the client *keeps its watch open* on the return leg. | `app/api/driver/positions/route.ts:51`; `tests/tms-2-driver-tracking.test.ts:186`; 0 batches audited after 19:10:26 | Ingest asks the shared predicate `acceptsPositions(session.status)` → `ACTIVE` + `RETURNING`. `PAUSED` stays refused **deliberately** (suspending sharing withdraws consent); `COMPLETED`/`CANCELLED` refused. Wire contract unchanged (409, same code). | 01–07 |
| D2 | Every driver write demanded `ACTIVE`\|`PAUSED`, so from 19:10:59 the delivery confirmation, evidence upload and events all returned `no_session`. | `lib/driver/mission-auth.ts:45`; audit trail shows no further driver write after the turn | `liveSessionOrError` accepts the live set (`ACTIVE`, `PAUSED`, `RETURNING`) and **distinguishes** "no session" from "session already over". Read model and driver screen use `isLiveSession`. | 08–13 |
| D3 | The driver's « Enlèvement confirmé » writes a tracking event only; the official `PICKED_UP` is a staff act that never happened, so the record sat at `DRIVER_ASSIGNED` and delivery was structurally impossible — reported as « Transition non autorisée. » | `lib/driver/ops.ts:49`; `lib/transport/status.ts:25`; transport still `DRIVER_ASSIGNED` | **Conservative behaviour kept.** No permission granted, no gate bypassed. One pure predicate `deliveryBlock(status)` — derived *from* `canTransition`, so the two cannot drift — now decides what the screen offers and what the server answers: the delivery button is replaced by an actionable explanation, and the pickup tap answers honestly that the office must still record the official pickup. Authority question deferred to `docs/transport/driver-pickup-authority-decision.md`. | 14–21 |
| D4 | Refusals reached the driver as generic text. (Audit correction: `no_session` **did** have a French sentence — the real gaps were its wording for a return leg, the absence of any message for a missing official pickup, and `hash_failed`, which had **no** sentence at all.) | `lib/i18n.ts`; `components/driver/mission-actions.tsx:52` | Added `session_completed`, `pickup_not_recorded`, `mission_cancelled`, `network`, `hash_failed`; `forbidden` made mission-specific; added the two `delivery.pickupPending*` notices and `events.pickupReported`. A test derives the code set **from the source** so a future code without a sentence fails. | 22–26 |
| D5 | `startMission` reused an `ACTIVE` session only, while the unique index covers `ACTIVE` only — so restarting during `PAUSED`/`RETURNING` would insert a **second live session**, splitting the return leg across two rows and leaving one never completed. | `lib/driver/actions.ts`; `supabase/migrations/20260711000001_driver_execution.sql:27-29` | Start reuses **any** live session and returns its status, so the screen can no longer show a paused session as though it were sharing. Application-level; no migration. | 27–28 |

## 2. Files changed

| File | Change |
|---|---|
| `lib/driver/mission-gates.ts` | **New, pure, no I/O.** `LIVE_SESSION_STATUSES`, `POSITION_SESSION_STATUSES`, `isLiveSession`, `acceptsPositions`, `sessionBlock`, `deliveryBlock`. |
| `app/api/driver/positions/route.ts` | Accepts positions from a live *transmitting* session; every other control unchanged; still exactly one audit per batch. |
| `lib/driver/mission-auth.ts` | `currentSession` → `liveSessionOrError` (one query, tenant+transport scoped, prefers a live row, names the reason). |
| `lib/driver/delivery.ts` | Uses the lookup; pre-checks `deliveryBlock` to *name* the refusal; `deliverTransport` remains the authority. |
| `lib/driver/upload.ts`, `lib/driver/ops.ts` | Use the lookup (4 call sites). |
| `lib/driver/actions.ts` | D5 reuse; `SessionActionResult.status`. |
| `lib/driver/service.ts` | `pickSession` prefers any live session. |
| `app/driver/missions/[transportId]/page.tsx` | `sessionActive={isLiveSession(...)}`. |
| `components/driver/mission-actions.tsx` | Availability from `deliveryBlock`; pickup-pending explanation; honest pickup message; network catch. |
| `components/driver/mission-tracker.tsx` | Status from the action result; network catch. |
| `lib/i18n.ts` | The new French sentences. |
| `tests/uat-transport-pod-fix-01.test.ts` | **New**, 32 regression tests. |
| `docs/transport/driver-pickup-authority-decision.md` | **New** decision note (D3), no change implemented. |

## 3. Security and RLS impact

* **No RLS policy, table, column, index, function or migration changed** (ledger 151 → 151; `migration-integrity --linked` reports CLEAN and the CLI cross-check agrees).
* **No permission granted.** `DRIVER` gains nothing; `transport:update` / `transport:complete` remain with `COORDINATOR, OPS_SUPERVISOR, PICKUP_AGENT, SYSTEM_ADMIN, TRANSPORT_OFFICER` / `OPS_SUPERVISOR, SYSTEM_ADMIN, TRANSPORT_OFFICER`.
* **Authority unchanged**: assignment (`driver_user_id = caller`) still proven per action by `loadAssignedTransport`; the ingest still verifies `session.driver_id === user.id`; `is_assigned_driver()` and the tracking RLS policies are untouched.
* **Tenant isolation unchanged**: every new or edited query carries `.eq("tenant_id", user.tenantId)`; the session lookup is additionally transport-scoped. The widened session read returns at most 5 rows of the caller's own transport.
* **Attack surface**: the only widening is *which session states accept a driver's own writes*. A `COMPLETED` or `CANCELLED` session still accepts nothing, and `PAUSED` still accepts no positions — the consent guarantee is preserved and tested.
* **Maker/checker and Finance untouched**: a driver POD scan still lands `PENDING_REVIEW`; `canReceivePod` still demands a verified `DELIVERY_NOTE`; `recordPodReceiptFromVerifiedEvidence` still demands `DELIVERED` + the same gate; billing still demands steps 18 + 19.
* **No secret, credential or personal datum** is read, logged or displayed by the change.

## 4. Test results

| Check | Result |
|---|---|
| `tests/uat-transport-pod-fix-01.test.ts` | **32 / 32 pass** |
| Pinning suites (`tms-2-driver-tracking`, `driver-ops`, `pod-ownership`, `tms-2d-live-map`, `tracking-06a/06b`, `wes-1`, `wes-2`, `trn-vehicle-01`, `tms-3`) | **340 / 340 pass** |
| Full suite (`npm test`) | **9935 passed, 1 skipped, 1 failed** |
| `tsc --noEmit` | clean |
| `next build` | clean (`/driver/missions/[transportId]` 6.07 kB) |
| `lint:migrations` | OK |
| `migration-integrity --linked` (read-only) | CLEAN, CLI cross-check agrees |
| `next lint` | **not runnable** — the repository has no ESLint configuration (pre-existing; CI does not run it). The command only offers to create one; nothing was created. |

**The one failure is pre-existing and unrelated**: `tests/expense-approval-chain.test.ts > 31 — prior versions and their visas are never rewritten`, in finance code this branch does not touch. It is the known CRLF-checkout debt (the file is LF in the index, CRLF in the working copy, and the assertion contains an embedded newline); it passes in CI. Verified failing identically on a pristine `main` checkout with no local edits, and `lib/finance/expense/actions.ts` does not appear in this branch's diff.

**Two defects were found by the new tests while writing them** and fixed: `hash_failed` had no French sentence (D4), and the first draft of test 18 asserted against the wrong module.

## 5. Deferred findings — documented, NOT implemented (scope boundary)

| # | Finding | Proposed correction (needs approval) |
|---|---|---|
| D6 | A refused driver action leaves no trace, so "she pressed and nothing happened" is unprovable either way. | Audit the *refusal reason* for driver writes (reason code only — no coordinates, no personal data), reusing the existing batch-audit pattern. |
| D7 | `operational_file.status` was set to `DELIVERED` on 2026-10-08 23:56:53 by a COORDINATOR **before the transport record existed**, and that status is portal-visible to the client. | Decide the data correction with Operations; separately consider gating a manual `file:transition → DELIVERED` on transport state, as `advanceFileToDeliveredFromTransport` already does automatically. |
| D8 | Mobile browsers suspend `watchPosition` when the screen locks — the 19-minute hole at 18:51–19:10 is device-side, not network. | Surface a « suivi en veille » hint on `visibilitychange`, and document screen-lock guidance for drivers; consider a wake-lock request during an active mission. |
| D9 | `pickup_actual` / `delivery_actual` record the click time; the server already accepts a `deliveredAt` within a 120 s future skew but the form never sends one. | Offer an explicit "heure réelle" field with bounded backdating and provenance, rather than letting the click time stand for the physical event. |
| D5-db | The partial unique index covers `ACTIVE` only; the D5 fix is application-level. | Widen `uq_tracking_session_active_transport` to the live set in a future migration (requires a governed production apply — out of scope here). |

## 6. Recovery UAT checklist for `EFT-IMP-2026-00014`

Nothing below is automatic and nothing here was executed. Each step is a real person performing a normal, audited act; **no delivery evidence may be fabricated**. The physical pickup and delivery are, so far, facts reported by the CEO — the platform holds the driver's `PICKUP_CONFIRMED` event (18:39:13 UTC) and no delivery record at all.

1. **Deploy this branch to a preview** and confirm `/api/version` serves its SHA.
2. **Office — record the official pickup.** A holder of `transport:update` moves transport `4117d491…` to `PICKED_UP`. The customs gate is satisfied (customs `RELEASED`, 2026-10-10 14:03:25 UTC). ⚠ `pickup_actual` will be the click time; state the real pickup time (18:39 UTC per the driver's event) in the notes — do not pretend the stamp is the physical time.
3. **Driver — re-open the mission.** On `/driver/missions/4117d491…`, « Démarrer la mission » creates a **new** session (the old one is `COMPLETED`; D5 prevents a duplicate live one). Confirm the delivery button is now offered and the amber pickup notice is gone.
4. **Driver — confirm the delivery** with the recipient's name and, if available, signature/photo evidence. ⚠ `delivery_actual` is again the click time; record the real delivery time in the customer message.
   *Alternative if the driver is unavailable:* a holder of `transport:complete` records `DELIVERED` from the staff screen. Same caveat.
5. **Office — upload the signed delivery note** as `DELIVERY_NOTE` and have **a different authorized person** verify it (`document:approve`, maker/checker). This is the only lawful route to `POD_RECEIVED`; if no signed note exists, the dossier must not advance — that is the control working.
6. **Confirm the automatic consequences**: `transport_record.status = POD_RECEIVED`, a `FINANCE_HANDOFF` task, steps 17 → 18 → 19 opening, then billing readiness.
7. **Regression spot-checks on the preview**, with a second test mission: GPS continues after « Démarrer le retour » (positions keep arriving, no 409); delivery and evidence work during the return leg; a paused session records evidence but sends no position; a completed session refuses with « Cette mission est terminée… »; a mission still at `DRIVER_ASSIGNED` shows the pickup-pending explanation instead of a delivery button; aeroplane mode produces « Connexion interrompue… ».
8. **Decide D7** (the premature dossier `DELIVERED`) before closing the dossier.
