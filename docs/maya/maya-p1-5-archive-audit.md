# MAYA-P1.5 — R-19 dossier archive (CEO step 17 / registry step 23): audit

**Date:** 2026-08-13 · **Baseline:** `378427b` (P1.4) · **Ledger:** 105/105 · **No migration.**

**Classification: G — STALE GAP; NOTHING TO BUILD.**

R-19 is not an accidental hole. What it names is **half built and half
deliberately deferred**, and the register entry rests on the same Phase 5.0A
metadata trap P1.4 exposed, compounded by a misreading of the word *archivage*.

---

## 1. What « archivage » means in step 23 — stated, not inferred

`docs/workflow/effitrans-business-workflow.md` answers this directly, and it is
the later and more specific of the two artifacts that describe step 23.

> **Terminal state today:** `CLOSED` (« Clôturé »). A distinct `ARCHIVED` status,
> the archive workspace and retention policy are a **deferred phase** —
> « archival » in the current system means **process step 23's dossier archiving
> by the Administration plus the terminal `CLOSED` status**, with all documents,
> invoices and history retained and downloadable indefinitely. *(§1)*

> | 23 | Administration | … | **archive the dossier documents (deposit chain of
> custody in `invoice_deposit` + append-only `invoice_deposit_event`)** | Courier
> assigned; **dossier archived (administrative)** | *(§2)*

> **§3.15 Archive — Today:** administrative archiving inside step 23 + terminal
> `CLOSED`; everything retained (immutability triggers make invoice artifacts and
> ledgers physically undeletable). **Deferred:** `ARCHIVED` status,
> `CLOSED → ARCHIVED`, archive browsing workspace, retention-policy redesign.

So there are **two different things** wearing one word:

| | Meaning | State |
|---|---|---|
| **Step 23 « archivage »** | the Administration files the dossier documents — deposit pack + chain of custody | ✅ **BUILT** (Phase 5.0D) |
| **`ARCHIVED` status / `archived_at` lifecycle** | a distinct terminal state, transition, workspace, retention redesign | ⏸ **DELIBERATELY DEFERRED**, scope named |

R-19 (« `archived_at` **reserved, deferred** ») recorded the second and was read
as a missing capability. « Reserved » was accurate: it is the deferral, correctly
labelled in its own migration.

## 2. Step 23 is built and is not blocked

| Evidence the registry names | Recorded by | State |
|---|---|---|
| `courier_id` | `assignCourier()` — `courier:assign`, + DB trigger | ✅ |
| `deposit_package_prepared_at` | `preparePackage()` → `prepared_at`, `prepared_by` — `admin_service:manage` | ✅ |
| `archived_at` | — | ⏸ deferred phase |

And **nothing is blocked by the third**: `completionRule` is a **display string**
(`queues/service.ts` → `nextAction`), and `requiredEvidence` is descriptive — the
policy layer only ever *counts* `evidenceKeys`, never enforces them. Step 23
completes through the ordinary engine path for a holder of its permission. This
was verified, not assumed.

## 3. Archive ≠ closure — already stated, and structurally enforced

The brief requires this separation be preserved. It is already load-bearing.

**Stated twice, in first-party surfaces:**
* registry step 23 description — « **L'archivage n'est PAS la clôture financière.** »
* `/deposits` — « **L'archivage n'est pas la clôture : un dossier archivé reste
  accessible au recouvrement.** »

**Enforced by RBAC**, which is stronger than either:

| Role | Holds | Notably does NOT hold |
|---|---|---|
| `ADMINISTRATIVE_OFFICER` (CEO « Administratif », step 23) | `admin_service:manage`, `courier:assign`, `document:create` | `file:update`, `process:close`, `collections:manage` |
| `COLLECTIONS_OFFICER` (CEO « Recouvrement », step 26) | `collections:manage`, `finance:payment` | `admin_service:manage`, `courier:assign`, `process:close` |

Neither can perform the other's act. Neither can close a dossier at all —
`process:close` is held only by `SYSTEM_ADMIN` and `OPS_SUPERVISOR`.

## 4. Retention — the guarantee R-19 would protect already holds

Archive must never destroy evidence. It cannot:

* « all documents, the immutable invoice PDF, payments, communications, events
  and audit remain retained and downloadable (**closure never deletes**) » (§2 step 28)
* « **immutability triggers make invoice artifacts and ledgers physically
  undeletable** » (§3.15)
* invoice bytes resolve to one SHA-256 and are « available after payment,
  cancellation, closure, **archival** » (§3)
* the deposit chain of custody is an **append-only** `invoice_deposit_event`

## 5. What the stale metadata claimed

Step 23's `implementation` block still reads `verdict: "missing"` with gaps:

| Recorded gap | Today |
|---|---|
| « no ADMINISTRATIVE_OFFICER role » | **FALSE** — the role exists and guards `preparePackage` |
| « no courier assignment, no deposit package » | **FALSE** — Phase 5.0D built both, with custody events |
| « archive must not equal financial closure — no such distinction exists » | **FALSE** — stated twice and RBAC-enforced (§3) |
| « no archive action » | **TRUE** — and deferred on purpose |
| « `operational_file.archived_at` … never written » | **TRUE** — confirmed in code and in production |

Three of five false. Exactly the pattern of [[process-registry-metadata-stale]] —
and the reason this phase re-censused instead of trusting it.

## 6. Production

3 dossiers · **0 with `archived_at`** · statuses `DRAFT / DELIVERED / CLOSED` ·
no `ARCHIVED` in the `FileStatus` union · all five end-stage step executions
`PENDING`. **No contradictory state anywhere**: nothing claims archived without
the column, and no archived dossier sits in an active queue. Nothing to
reconcile, nothing to back-fill.

## 7. Why not build a minimal `archived_at` write anyway

It would be one line of schema and three stop conditions from §V of the brief:

1. **The precondition is undefined.** The CEO sequence establishes *order*, not
   completion criteria. §G forbids inventing a gate.
2. **Visibility semantics are undefined.** Exactly one is stated — « reste
   accessible au recouvrement » — a negative. Nothing says what archive does to
   the active file list, search, the portal, queues or the tower.
3. **Restore is entirely undefined** (§H classification: **C — business answer
   required**). No dossier-level unarchive semantics exist anywhere. Note the
   *user* archive lifecycle (Phase 8.1A) is a different object and is not
   precedent for dossiers.

Above all, the deferred phase already has a **named scope** — status, transition,
workspace, retention redesign. Writing a lone timestamp now would pre-empt that
design and leave a third partial meaning of « archive » in the codebase.

## 8. Open questions, if Effitrans wants the deferred phase scheduled

1. When is the Administration **allowed** to archive — is it simply « at step 23 »,
   or does it require the invoice sent, the courier assigned, the POD present?
2. What changes for an archived dossier: does it leave the active file list,
   search, queues, the customer portal? (« Accessible au recouvrement » is the
   only fixed point.)
3. Is archive **reversible**, and by whom? A mistaken archive must be
   correctable, and no dossier-level restore semantics exist.
4. Is `CLOSED → ARCHIVED` a status transition, or is `archived_at` orthogonal to
   status? §1 of the architecture doc implies a status; the column implies an
   attribute.
5. If it becomes a fact, it needs an author: every comparable instant in the
   platform carries one (`reviewed_by`, `gainde_registered_by`,
   `receivability_by`). Today there is no `archived_by`.

## 9. Adjacent observation, out of scope

Registry step 26 (`collections`, « suivre les échéances et **clôturer le
dossier** ») declares `permissions: ["collections:manage", "file:update"]`, but
`COLLECTIONS_OFFICER` holds **neither `file:update` nor `process:close`**.
Whether Recouvrement can actually close a dossier is a **closure** question; the
brief forbids starting closure work here. Recorded, not investigated.

## 10. Recommendation

Nothing to build. R-19 should be **re-scoped in the register** from « archive is
a real missing capability » to « the `ARCHIVED`-status phase is deferred with a
named scope; step 23's archivage is built », and the five questions above
answered before that phase is scheduled.
