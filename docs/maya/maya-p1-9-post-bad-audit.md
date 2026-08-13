# MAYA-P1.9 — the CEO chain after Bon à Délivrer: audit

**Date:** 2026-08-13 · **Baseline:** `0ac82c9` (P1.8) · **Ledger:** 105/105 · **No migration.**

**Result: NO QUALIFYING GAP. Nothing built.**

Every remaining CEO step after BAD classifies **A**, **E** or **G**. §D of the
brief anticipates this: *"If every remaining CEO step is A/E/G: report that
honestly and build nothing."*

---

## 1. The post-BAD chain, censused from source and production

Nothing below comes from `implementation.verdict` — that block is a frozen
2026-07-13 snapshot ([[process-registry-metadata-stale]]), and §T forbids it.

| CEO | Owner | Registry | Durable fact | Consumer | Class |
|---|---|---|---|---|---|
| **12** Affectation véhicule | Transport | 14 `transport_assignment` | `vehicle_plate`, `driver_user_id` / `driver_name` | `assignTransport`, `assignDriverUser` under **`transport:assign`** | **A** |
| **13** Enlèvement + sortie port | Agent d'Enlèvement | 15 `pickup` | `pickup_actual`, status `PICKED_UP` | `changeTransportStatus` under `transport:update` + customs gate | **A** (pickup) · **E** (« sortie du port », §3) |
| **14** Info client, suivi, BL signé | Account Manager | 16 `am_delivery_followup`, 17 `transport_pod_handoff` | `delivery_actual`; POD document | `changeTransportStatus` under **`transport:complete`**; `document:approve` + maker-checker | **A** · **E** residue (signature evidence, R-16) |
| **15** Facturation | Facturation | 20 `billing_draft` | `invoice` | `finance:create` / `finance:issue` | **A** (P1.6) |
| **16** Validation facture | Finance | 21 | `invoice.status = VALIDATED` | `finance:validate` | **A** (P1.6) |
| **17** Envoi + archivage | Administratif | 22–25 | deposit custody chain | `admin_service:manage`, `courier:assign` | **G** (P1.5) |
| **18** Recouvrement + clôture | Recouvrement | 26 | payments verified; `CLOSED` | `collections:manage`; `file:transition` | **A** (P1.6) |

**No B, C or D anywhere.**

## 2. The POD rule is NOT a P1.2-style proxy — checked, and it holds

WES-5 proves `transport_pod_handoff` from *transport status ≥ POD_RECEIVED* **OR**
*a verified POD document*. The first half looks like another department's field
completing the Coordinator's verification step — exactly the shape P1.2 found on
GAINDE. It is not, and the reason is enforced in code:

`changeTransportStatus(…, "POD_RECEIVED")` requires **`transport:complete`** (not
the ordinary `transport:update`) **and** passes `canReceivePod(approvedDocCodes(…))`
— an **APPROVED Delivery Note**. So the status cannot exist without the very
evidence the other half of the rule requires. The two halves are equivalent, not
a proxy.

`lib/transport/pod-receipt.ts` states the ownership design explicitly: the
authorizing act is the document verification (`document:approve`, maker-checker);
recording the transport receipt is its mechanical consequence, deliberately
*not* granted as a second user-facing power.

**This boundary was already reconciled. Nothing to fix.**

## 3. « Sortie du port » — §E answered: undetermined, and it is a business question

Two first-party-derived artifacts disagree, and P1.0 already registered it:

* `effitrans-business-workflow.md` §2 step 15 treats them as **one** act —
  *"Pick up the goods, **exit the port** (`PICKED_UP`)"* — and documents the
  server enforcement in the same cell: *"server refuses pickup before customs
  release"*.
* The registry's step 15 lists `requiredEvidence: ["pickup_confirmed_at",
  **"port_exit_evidence"**]`, and P1.0's R-15 records: *"CEO step 13 names
  « sortie du port » as a distinct act from pickup… **Not sufficient to define
  capture**."*

So it is **option 5 or 6 and the sources do not settle which**. Per §E and §V, no
`port_exited_at` column was invented. It remains an open Effitrans question,
already on P1.0's list.

## 4. The pickup gate — two paths, and the difference is documented

The engine action evaluates the full `evaluatePickupGate` (customs, BAD,
Pre-Gate, BL, vehicle, driver). `changeTransportStatus(…, "PICKED_UP")` enforces
**customs release only**.

That is not an undiscovered bypass: the architecture doc describes the join gate
as *"BAE obtained AND transport assigned; parallel activities Bon à Délivrer +
Pre-Gate"* and, in the same cell, documents the server rule as *"**server refuses
pickup before customs release** for required IMP/EXP"*. The gate is the process
readiness advisor; customs release is the hard server rule. And step 15's
`completionRule: "pickup_confirmed_after_readiness_gate"` is a **display string**
— P1.5 and P1.6 both proved these fields are descriptive, never executable.

**No current human command bypasses a rule the platform actually enforces.**

## 5. Vehicle / driver — assignment exists; conformity is Q5.1

A vehicle is a **plate on the transport record**, not a fleet entity, and a
driver is `driver_user_id` (a platform user) or `driver_name`. Assignment is
built and reachable under `transport:assign`. CEO step 12 asks for *affectation*,
not conformity — and conformity is **Q5.1**, an explicit §V stop condition. The
CRUD rule's precondition ("current workflow is blocked by inability to manage
it") is **not met**: nothing is blocked.

## 6. Permission consumer census (§K)

| Permission | Consumers | Verdict |
|---|---|---|
| `transport:assign` · `transport:complete` · `transport:update` · `transport:read` | real server + UI consumers | ✅ |
| `transport:request` | **none** — the only hit is a list | orphaned, but **pre-BAD** (AM raises the request at CEO step 3), so out of P1.9's scope |

⚠ `lib/process/roles.ts` `MISSING_PERMISSIONS` is **another 5.0A snapshot** — it
still lists `customs:validate`, `customs:register`, `finance:validate` and others
that have since shipped. Same stale class as `implementation.verdict`; do not
read it as current state.

## 7. Production census

| Dossier | file | transport | vehicle | driver | picked up | delivered | POD linked |
|---|---|---|---|---|---|---|---|
| EFT-IMP-2026-00001 | DELIVERED | DRIVER_ASSIGNED | — | — | — | — | — |
| EFT-IMP-2026-00002 | DRAFT | NOT_STARTED | — | — | — | — | — |
| EFT-IMP-2026-00003 | CLOSED | DELIVERED | ✅ | ✅ | ✅ | ✅ | — |

The post-BAD chain has been exercised **once**, end to end, on a dossier that is
now closed. Two observations, neither a live defect:

* `00001` is at `DRIVER_ASSIGNED` with no vehicle or driver values — a status set
  without its evidence, on an untouched test dossier.
* `00003` carries a `DELIVERY_NOTE` at `CONSUMED_AS_EVIDENCE` while
  `pod_document_id` is NULL and transport stayed `DELIVERED` rather than
  `POD_RECEIVED`. The WES-5 step still reconciled correctly from the verified
  document. Historical, on a closed dossier; nothing to repair.

## 8. Transport activation (§F) — enabled, and not mine to change

Tenant `…0001`: `process_engine`, `process_workspaces`, `collections`,
`physical_invoice_deposit` all **true**. `transitExecution` and
`financeExecution` are **environment-only** sub-flags
([[rollout-flags-two-layer]]) whose values I cannot read and must not change —
§V makes activation an explicit production decision. The legacy transport module
is gated on `transport:read` alone and is demonstrably in use.

**BUILT AND ENABLED**, not "not built".

## 9. Open Effitrans questions (all pre-existing)

1. Is « sortie du port » a distinct recorded instant from pickup? *(R-15)*
2. What proves a **signed** BL — signature evidence? *(R-16)*
3. Vehicle conformity criteria? *(Q5.1)*
4. Rattachement — what is attached to what? *(P1.3)*
5. Who owns a process conflict, and is it actionable? *(P1.8)*

## 10. Recommendation

Build nothing here. The post-BAD chain is implemented, reachable, correctly
owned and already well covered by tests. Every remaining item is a business
definition, not an engineering gap.

The next engineering work worth doing is **not in the CEO chain**: it is the
`transport:request` orphan at CEO step 3 (pre-BAD, so outside this phase's
mandate) — the same pattern that produced P1.1. That would need its own brief.
