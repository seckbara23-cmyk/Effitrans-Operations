# PILOT UAT — EFT-IMP-2026-00009 blocked Operations → Transit

**Date:** 2026-09-01 · **Read-only audit.** No production mutation, no code change.

## Classification: **USER ACTION MISSING** (primary) + **UI DEFECT** (secondary, guidance only)

The gate is correct. The dossier has genuinely not been through steps 2 and 3.

---

## 1. Ladder state (production, read-only)

Instance `d83eaf9e…`, ACTIVE, opened 2026-08-27:

| # | step | state |
|---|---|---|
| 1 | `cotation` | **SKIPPED** ← this is the "1/26" |
| 2 | `operations_intake` | **ACTIVE** ← the current action, never submitted |
| 3 | `am_dossier_opening` | **PENDING** ← never activated, never performed |
| 4 | `coordinator_reception` | PENDING |

0 handoffs · 0 open blockers · 5 documents · transport record `NOT_STARTED`.

## 2. What completes step 3, and whether it happened

`submitStep(fileId, "am_dossier_opening")` → `COMPLETED` directly (it is **not** a
maker/checker pair, so no independent review). Gate: permission `file:create`
+ **all four `requiredDocuments`** satisfied.

**It has not happened, and could not have**: step 3 is `PENDING`, and
`PENDING → COMPLETED` is not a legal transition. Step 3 only becomes actionable
when step 2 completes and promotes it.

## 3. Why the engine says step 3 is incomplete — correctly

The handoff is `sendHandoff("am_dossier_opening" → "coordinator_reception")`.
Step 3 is the handoff's **from-step**, so it must be terminal-done. The
prerequisite mirror (`unmetTransitHandoffPrerequisites`, `amOpeningDone`) names
step 3 for exactly that reason. Nothing is out of sync.

## 4. What must actually be done (and by whom)

**The Account Manager cannot act yet.** The order is:

1. **Step 2 — an `OPS_SUPERVISOR` holder.** `operations_intake.requiredDocuments`
   is **empty**, so there is no evidence to gather: the step is submittable
   immediately from the « Processus officiel Effitrans » screen. Permission:
   `file:assign`.
2. Step 3 then promotes and the **Account Manager** completes it, satisfying
   four documents:
   - `BORDEREAU_LIVRAISON` — **mandatory, and NOT declarable** (C-3 names it
     explicitly: "the transport document the dossier is built on"). **The
     dossier does not have one** — this is the only real work item.
   - `TRANSPORT_REQUEST`, `VENDOR_INVOICE`, `SPENDING_AUTHORIZATION` — declarable
     absent with a motif via the ratified C-3 declaration (not a skip, not a
     bypass: a recorded declaration with reason and author).
   Current documents: BILL_OF_LADING, COMMERCIAL_INVOICE, PACKING_LIST, OTHER×2 —
   none of the four required types.
3. « Transmettre au Transit » then unblocks.

## 5. RBAC — not the blocker

| actor | `file:assign` | `file:create` | `process:handoff:send` |
|---|---|---|---|
| `operations4@effitrans.com` | ✅ | ✅ | ✅ |
| `operations@operations.com` (dossier AM) | ✅ | ✅ | ✅ |

The dossier's AM holds `ACCOUNT_MANAGER`. The authoritative owning roles are
`operations_intake → OPS_SUPERVISOR` (9 holders) and
`am_dossier_opening → ACCOUNT_MANAGER`.

⚠ The execution row carries `assigned_role_code = 'OPERATIONS_MANAGER'` — **a
role that does not exist in the platform** (0 rows, absent from role-templates).
It is the documentary field, not the authorization source, so it blocks nothing;
but it is misleading and should be corrected to `OPS_SUPERVISOR` in its own
slice.

## 6. Step 2 vs Step 3 ordering — intentional

`am_dossier_opening.prerequisites = ["operations_intake"]`. The UI is right that
step 2 is current; the error is right that step 3 is the handoff's from-step.
Both statements are true and the operator reads them as a contradiction —
**the message should name the first actionable step, not only the from-step.**
That is the UI defect, and the only thing worth fixing in code.

## 7. « Livré » with the ladder at 1/26

Two planes, ratified as different objects (dossier lifecycle vs official
process). Not a state-machine inconsistency **by design**. But the data is
operationally implausible and was operator-driven:

```
2026-08-27 17:12  DRAFT       → OPENED       operations4@effitrans.com
2026-09-01 12:44  OPENED      → IN_PROGRESS  operations4@effitrans.com
2026-09-01 16:30  IN_PROGRESS → DELIVERED    seckbara23@gmail.com
```

A dossier marked *delivered* whose transport record is `NOT_STARTED`, whose
official process sits at step 2, and which has never been handed to Transit.
Legitimate mechanically; a **business** question, not a defect to code around.

## 8. ⚠ Separate anomaly — out-of-order completion on two other dossiers

| dossier | step 2 | step 3 | step 4 | status |
|---|---|---|---|---|
| EFT-IMP-2026-00003 | **PENDING** | **COMPLETED** | PENDING | CLOSED |
| EFT-IMP-2026-00004 | **ACTIVE** | **COMPLETED** | PENDING | DELIVERED |
| EFT-IMP-2026-00007 | COMPLETED | COMPLETED | AVAILABLE | IN_PROGRESS |
| EFT-IMP-2026-00008 | COMPLETED | AVAILABLE | AVAILABLE | OPENED |
| **EFT-IMP-2026-00009** | **ACTIVE** | **PENDING** | PENDING | DELIVERED |
| EFT-TRP-2026-00001 | ACTIVE | PENDING | PENDING | OPENED |

Step 3 completed while step 2 was not — which `submitStep` alone cannot produce.
Some other path (reconciliation, backfill, or a legacy route) reached it. **This
does not block the pilot and is not diagnosed here**; it needs its own audit,
because it bears on whether the ladder's ordering is enforced everywhere it is
claimed to be.

## 9. Shortest safe resolution for today

**Two acts, no code, no data repair, no weakening of the gate:**

1. An **OPS_SUPERVISOR** opens the dossier's « Processus officiel Effitrans »
   screen and completes **step 2 — Responsable des Opérations, réception et
   affectation**. No documents required.
2. The **Account Manager** completes **step 3**: attach the
   **BORDEREAU_LIVRAISON** (the one genuinely missing artefact), and declare
   `TRANSPORT_REQUEST` / `VENDOR_INVOICE` / `SPENDING_AUTHORIZATION` absent with
   a motif where they do not apply.

Then « Transmettre au Transit » proceeds. If the Bordereau does not exist for
this shipment, that is a **business** decision — the platform deliberately
refuses to let it be waived, and I am not proposing to change that.

**Not recommended, and not done:** weakening the prerequisite, marking step 3
complete directly, or any SQL repair.
