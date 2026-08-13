# MAYA-P1.6 — Recouvrement → dossier closure (CEO step 18): audit

**Date:** 2026-08-13 · **Baseline:** `b0db416` (P1.5) · **Ledger:** 105/105 · **No migration.**

**Classification: A — ALREADY IMPLEMENTED CORRECTLY.**

**And it corrects my own P1.5 closing note.** I ended P1.5 by flagging that
`COLLECTIONS_OFFICER` holds neither `file:update` nor `process:close` and
suggesting the role the CEO names as closing the dossier might be unable to. That
hypothesis is **wrong**. Recouvrement was never meant to hold either.

---

## 1. The CEO reading, answered from source: **B**

> *Recouvrement establishes payment evidence and another role closes.*

`docs/workflow/effitrans-business-workflow.md` splits the end-chain into **two
rows**, deliberately:

> | **26** | Collections | Service Recouvrement | … payments recorded
> (`recordPayment`) then **verified by a second person** (`verifyPayment`) … |
> Payments verified; balance 0 |

> | **27** | Operations / Management | **Ops Supervisor, Coordinateur, AM or
> Admin (`file:transition`)** | Settled dossier | **« Clôture du dossier »** →
> `DELIVERED → CLOSED` |

and again in its authority table:

> | Manual closure | **`file:transition` holders (ADMIN, AM, COORDINATOR,
> OPS_SUPERVISOR)** | OPERATIONS | Finance | all |

Recouvrement produces the settlement evidence. Operations performs the closure.
That is the CEO sequence, faithfully implemented.

## 2. Four separated authorities, none accidental

| Act | Permission | Held by | Notably not |
|---|---|---|---|
| Record a payment | `finance:payment` | SYSTEM_ADMIN, FINANCE_OFFICER, OPS_SUPERVISOR, **COLLECTIONS_OFFICER** | — |
| **Verify** that payment | `finance:void` | SYSTEM_ADMIN, FINANCE_OFFICER, OPS_SUPERVISOR | **not COLLECTIONS_OFFICER** |
| Mark the recovery complete | `collections:manage` | COLLECTIONS_OFFICER (+ supervisors) | — |
| Close the **dossier** | `file:transition` | SYSTEM_ADMIN, ACCOUNT_MANAGER, COORDINATOR, OPS_SUPERVISOR | **not COLLECTIONS_OFFICER** |
| Close the **process instance** | `process:close` | SYSTEM_ADMIN, OPS_SUPERVISOR | **not COLLECTIONS_OFFICER** |

The collector records the money and can never verify it — the maker-checker §L
asks about, enforced at the permission level rather than by a runtime identity
check. And the two closure permissions govern **two different objects**, which is
why both exist.

`closeDossier`'s own comment, and the migration that created `process:close`,
say so in as many words:

> Deliberately NOT granted to COLLECTIONS_OFFICER: **a collector may mark the
> recovery complete, but the dossier is closed by a supervisor.**
> — `20260714000003_collections_closure.sql`

## 3. What CLOSED means today

`operational_file.status = CLOSED` is reached through **one guarded seam**,
`transitionFile(id, "CLOSED")`, from either door:

* **manual closure** — a `file:transition` holder (step 27);
* **`closeDossier(fileId)`** — `process:close`, which closes the process instance
  **and then calls the same `transitionFile`**. It never writes
  `operational_file.status` directly.

Both pass the identical gate, because the rule is **one pure function**,
`closureBlockers()` in `lib/files/closure.ts`, called by the lifecycle display
*and* the server guard. Its header records exactly why:

> A displayed gate that the server does not enforce is not a control; it is a
> suggestion.

**The gate (§K), fully defined and enforced:**

| Blocker | Rule |
|---|---|
| `customs_not_released` | IMP/EXP with a **required** record not RELEASED/CANCELLED |
| `delivery_incomplete` | a transport leg not DELIVERED/POD_RECEIVED/CANCELLED |
| `no_invoice` | zero non-VOID invoices |
| `invoice_outstanding` | any billable invoice with `balance > 0` or still DRAFT |
| `payment_unverified` | **any live payment not verified** |

Refusal returns the **complete** blocker list in French, never a generic failure.
Closure is idempotent, deletes nothing, hides nothing, and is audited
(`CLOSURE_READINESS_EVALUATED`, then `PROCESS_CLOSED`).

## 4. §P — payment does **not** auto-close, by construction

`verifyPayment` records the verification, notifies the customer, and **calls no
transition**. No path anywhere turns a payment event into `CLOSED`. The last
blocker is decisive on this point: a zero balance reached through an *unverified*
payment is explicitly **not** a settled dossier.

## 5. §E — the settlement fact

Not `invoice.status = PAID`. Settlement is derived, per dossier:

* **every** non-VOID invoice on the dossier must have `balance ≤ 0` and not be DRAFT;
* balance is computed from `invoice_line` (quantity × unit_amount, tax) minus
  **non-reversed** payments — `balance` is not a stored column;
* a **rejected** payment is also reversed, so it leaves the paid total;
* VOID invoices are excluded before the test;
* **all** live payments must be VERIFIED.

Multiple invoices and multiple payments per invoice are handled. Charges outside
invoices (`billing_charge`) do **not** affect closure.

## 6. §I — step 26's metadata is descriptive, re-verified not assumed

Registry step 26 declares `permissions: ["collections:manage", "file:update"]`.
The engine reads **`permissions[0]` only** (`getNode(...)?.permissions[0] ??
"process:manage"`, and only for validation steps), so `file:update` at index 1 is
never consumed. `completionRule` is a display string; `requiredEvidence` is only
ever counted. Same finding as P1.5 — checked again rather than carried over.

**This is the whole of my P1.5 error:** I read a declared permission as a
requirement. It is a label.

## 7. §M — production census

| Dossier | file | instance | invoices | recovery complete |
|---|---|---|---|---|
| EFT-IMP-2026-00001 | DELIVERED | *(no instance)* | 0 | — |
| EFT-IMP-2026-00002 | DRAFT | *(no instance)* | 1 | — |
| **EFT-IMP-2026-00003** | **CLOSED** | **ACTIVE** | 1 | ✅ |

No dossier is CLOSED with an unpaid or partially paid invoice, and none is CLOSED
without an invoice — the gate held. **Nothing was back-filled or reconciled.**

EFT-IMP-2026-00003 was closed through the **step-27 manual door**, which is the
documented path, so its file status is correct and authorized. Its process
instance stays ACTIVE because only `closeDossier` closes instances — see §8.

## 8. One genuine defect found, and deliberately not fixed here

**The Control Tower counts readiness gaps on closed dossiers.**

`getProcessTower` selects instances with `.neq("status", "CANCELLED")` — so it
includes instances that are ACTIVE **on a CLOSED dossier**, and instances whose
own status is `CLOSED`. The pickup-gate buckets are computed per instance from
document/customs/transport facts, not from step state, so EFT-IMP-2026-00003 —
closed, settled, delivered — **currently increments « Bon à Délivrer manquant »**
in the Coordinator's tower.

It is a **Control Tower scope** question, not a closure capability: it affects
every bucket, and the correct fix is at the tower's instance filter (the
source-of-truth boundary), never a count patch. P1.6's classification is A and its
boundary is Recouvrement → closure, so this is **reported, not built**.

## 9. Open questions

None blocking. One worth confirming when convenient: **should a manual step-27
closure also close the process instance?** Today the two doors differ — closing
the *dossier* leaves the *process instance* open. Both are documented behaviours,
and no evidence says the instance must follow, so nothing was changed. §8 is the
observable consequence.

## 10. Recommendation

Nothing to build for closure. The next concrete, fully-defined piece of work is
**§8 — scope the Control Tower to non-terminal dossiers**, which needs nothing
from Effitrans and has a live production example.
