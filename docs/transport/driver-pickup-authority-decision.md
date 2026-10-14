# Decision note — should a driver's pickup confirmation move the transport to `PICKED_UP`?

**Status: OPEN — no authority change implemented. Decision required from Operations + Transport.**
Raised by `EFF-UAT-TRANSPORT-POD-LOSS-01` (incident, 2026-10-10) and deferred by `EFF-UAT-TRANSPORT-POD-FIX-01` (correction, 2026-10-11), which implemented only the conservative behaviour.

## 1. What happened, and what the fix did and did not do

On 2026-10-10 the assigned driver of `EFT-IMP-2026-00014` tapped « Enlèvement confirmé » at 18:39:13 UTC. That wrote a `tracking_event` of type `PICKUP_CONFIRMED` — evidence of what she observed — and nothing else. The official pickup (process step 15, `transport_record.status = PICKED_UP`) is a staff act and was never performed, so the record stayed at `DRIVER_ASSIGNED`. Two hours later her delivery confirmation was refused, because `DRIVER_ASSIGNED → DELIVERED` is not an edge of the transport state machine. The refusal reached her as « Transition non autorisée. »

The correction **kept that boundary exactly where it was**. It changed only what the driver is told:

* the delivery button is no longer offered when the state machine would refuse it;
* in its place she reads « Livraison indisponible : enlèvement officiel non enregistré », with a line telling her to ask the coordinator to record the official pickup;
* her pickup tap now answers « Enlèvement signalé. Le bureau doit encore enregistrer l'enlèvement officiel. » instead of a bare « Événement enregistré. », so nothing implies the dossier moved.

No permission was granted, no gate was bypassed, no new write path was opened.

## 2. The question

Should an assigned driver's `PICKUP_CONFIRMED` tap *itself* advance `transport_record.status` to `PICKED_UP` through a narrowly scoped, audited server operation — rather than waiting for a member of staff?

## 3. The case for

* **It matches the physical fact.** The person standing at the warehouse with the goods is the driver. Today the record lags reality by however long it takes someone at the office to notice — two hours and counting, in the incident.
* **The authority model already supports it.** Every driver write is authorised by *assignment* (`transport_record.driver_user_id = caller`), not by a permission. `confirmDelivery` already performs a governed transition (`PICKED_UP|IN_TRANSIT|BLOCKED → DELIVERED`) on exactly that authority. A driver who may record the end of a haul can coherently record its start.
* **It unblocks the chain the office forgets.** Step 15 pending blocks 16→17→18→19→20: delivery, POD, both completeness checks, and billing. The incident dossier is stuck there now.
* **The customs gate would still bind.** `canPickup(fileType, customs, customs_override)` is a pure function; a driver-triggered transition would call it unchanged, so goods still cannot leave the customs zone before `RELEASED`.

## 4. The case against

* **A ratified boundary.** TMS-4/TMS-5 ratified that *the Account Manager requests transport and Transport executes it*, and named `transport:complete` in the forbidden set for other roles. A prior slice (C-4, step 16) was **withdrawn** for crossing exactly this line; the remedy was a capability that means the step, not a loan of someone else's permission. Any change here must be ratified the same way, in the test suite, not merely implemented.
* **Pickup is a control, not a notification.** `PICKED_UP` is the point at which the customs gate is evaluated and `pickup_actual` is stamped. Moving it to the cab means a driver's tap is what asserts "customs released, goods lawfully out of the zone". Today a second person confirms that.
* **Subcontracted drivers.** Most drivers are subcontractors. Their accounts are the least-controlled identities on the platform; the office's confirmation is also a fraud and error check (wrong dossier, wrong vehicle, premature tap).
* **It would not have saved the incident alone.** The delivery was also blocked by the `RETURNING` session rules (D1/D2) — now fixed. With those fixed and the office recording pickup normally, the chain completes.
* **Timestamp honesty.** The server stamps `pickup_actual = now()`. A driver tapping late still produces a server-time stamp, which is no more faithful than the office's.

## 5. If it is approved — the shape it must take

1. A **narrow server operation**, not a permission grant: a driver-only path that may set `PICKED_UP` **and nothing else**, reachable only from `recordDriverEvent` with `type = "PICKUP_CONFIRMED"` for the assigned driver — mirroring how `recordPodReceiptFromVerifiedEvidence` is reachable only from the verified-document path.
2. **The same gate, re-evaluated**: `canPickup(fileType, customs, customs_override)` with live customs data; refusal returns `customs_not_released` with the existing French sentence.
3. **The same state machine**: `canTransition(from, "PICKED_UP")` only — never a write that skips it.
4. **Provenance recorded honestly** in the audit `after` payload, e.g. `source: "DRIVER_CONFIRMED_PICKUP"`, so a reader can always tell a driver's assertion from an officer's.
5. **Idempotent and compare-and-set** on the previous status, like the POD receipt, so a double tap produces one transition.
6. **Step 15 reconciliation** through the existing `reconcileDossierProcess` path, not a direct step write.
7. **Ratification in tests**: the TMS-4/TMS-5 boundary assertions updated deliberately, with the new rule stated — a change to a ratified boundary that merely makes tests pass is not a decision.
8. **An office override**: staff must retain the ability to correct or reverse a driver-recorded pickup, since it now carries a control's weight.

## 6. Recommendation

**Do not grant it yet.** With D1/D2 corrected, the driver's path is unblocked and the only remaining dependency is an office action that takes seconds once the dossier is visible. The cheaper and more reversible step is operational: make step 15 visible and urgent to Transport (the pickup event already notifies the dossier's dispatch owners). Revisit this decision if, after a few weeks of UAT, step 15 is still the step that strands dossiers — at which point §5 is the design to implement.

## 7. What was decided here

Nothing. This note records the question, the evidence and the constraints. Implementation requires explicit approval from the owners of the TMS-4/TMS-5 boundary.
