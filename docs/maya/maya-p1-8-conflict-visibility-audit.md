# MAYA-P1.8 — process conflict visibility & closure consistency: audit

**Date:** 2026-08-13 · **Baseline:** `112d810` (P1.7) · **Ledger:** 105/105 · **No migration.**

**Primary classification: E — BUSINESS / ARCHITECTURE DECISION REQUIRED.**
Secondary: **B** (conflict verdicts exist and have no projection) and a **technical
gap** (they are computed and discarded).

Nothing was built. Four of §U's stop conditions hold simultaneously.

---

## 1. What a WES-5 conflict actually is

`evaluateStep` returns `CONFLICT` when persisted process state says a step is
**COMPLETED or APPROVED** and the authoritative module fact that would prove it
is **absent**. It is:

* **step-level**, never instance-level;
* **pure** — a verdict of a function over facts already stored;
* **not persisted**. There is no conflict table, column or status anywhere.
  (`document_intelligence.reconciliation_status = 'CONFLICT'` is a different
  subsystem and unrelated.)
* **derivable on demand** — so a future surface needs **no new storage**;
* **self-clearing** — it disappears the moment the underlying fact becomes true
  again. Nothing needs to be "closed".

**And it is discarded.** `reconcileDossierProcess` returns
`conflicts: { stepKey, factFr }[]`, and **all five callers** — customs release,
customs GAINDE, document verification, transport transition, POD receipt —
`await` it and ignore the result. Nothing reads `.conflicts`, anywhere.

## 2. Taxonomy, from source behaviour

| | Class | Exists in this platform? | Blocks work? |
|---|---|---|---|
| **A** | Historical contradiction — step completed, fact now absent | **YES** — the only kind WES-5 produces | No |
| **B** | Live operational contradiction | Same mechanism; only differs by the dossier being active | No |
| **C** | File/process lifecycle divergence (`CLOSED` file + `ACTIVE` instance) | **YES** | **No — not since P1.7** |
| **D** | Data/ownership conflict | **No such concept in WES-5** | — |

WES-5 has exactly **one** conflict mechanism. A and B are the same verdict on
different dossiers; C is not a WES-5 conflict at all — it is a lifecycle
observation with no consequence since P1.7 scoped the tower.

## 3. Production census — one dossier, not a pattern

Only **one** dossier in the entire database has process executions
(`EFT-IMP-2026-00003`), and all five fact-provable steps are `COMPLETED` with
provenance `RECONCILED`. Evaluated against today's rules:

| Step | Fact | Verdict |
|---|---|---|
| `am_dossier_opening` | file beyond DRAFT | ✅ satisfied |
| `customs_field_clearance` | customs `RELEASED` | ✅ satisfied |
| **`gainde_registration`** | **`gainde_registered_at` absent** | ⚠ **CONFLICT** |
| `pickup` | transport `DELIVERED` (≥ PICKED_UP) | ✅ satisfied |
| `transport_pod_handoff` | `DELIVERY_NOTE` `CONSUMED_AS_EVIDENCE` | ✅ satisfied |

**Exactly one conflict exists in production**, and it is the one **MAYA-P1.2
created deliberately and wrote down**: the step had been completed from the
Declarant's paperwork under the old proxy rule; when the rule was corrected to
read Finance's milestone, the old completion became an honest contradiction.
P1.2's own words: *reported, never resolved — nothing is back-filled, because
inventing a registration date and actor is the one thing worse than the
contradiction.*

Counts: `CLOSED` files with an `ACTIVE` process — **1**. `CLOSED` files with
conflicting steps — **1**. Active files with a completed process — **0**.
Cancelled divergences — **0**. Conflicts on active work — **0**.

**This is one known historical dossier, not a systemic pattern.**

## 4. Why the audit stops here

### 4.1 No resolution semantics exist (§K)

The census returns nothing: there is **no** acknowledge, dismiss, reopen,
re-run-reconciliation, manual-correction or supervisor-resolution capability for
a conflict. The platform's only exception subsystem with a lifecycle —
`process_blocker` (`OPEN → ACKNOWLEDGED → RESOLVED/CANCELLED`, Phase 9.0B) — is
**dark**: the table is empty in production and no UI component reads it.

§K permits a read-only surface as a first step. But a read-only surface still
has to answer §E — *who is it for* — and that is the next problem.

### 4.2 No appropriate surface exists (§D)

The only candidate with a warning region is `/files/[id]/process`, which opens
by declaring itself:

> **Official process inspector (Phase 5.0B, Deliverable 15) — DIAGNOSTIC ONLY.**
> The minimal staff view needed to TEST the engine… This is NOT a department
> queue and NOT a workspace.

It renders `COMPLETED`, `UNVERIFIED_HISTORICAL`, `processVersion`,
`compatibilitySource` — raw engine vocabulary, which §S explicitly forbids
showing to business users. Its existing orange warning (« étape(s) non
vérifiée(s) ») is the right *shape*, but on a route that is not a business
surface. No management or reporting surface carries anything comparable.

### 4.3 Ownership is undefined (§E)

Nobody is designated to resolve a conflict. WES-5's own comment says *« a person
with authority resolves conflicts »* — and never says who. For the one real
conflict the resolution is a **business** question: should Finance retroactively
record a GAINDE registration on a dossier that is already closed and settled, or
does it stand as a permanent historical gap? That is not an engineering call.

### 4.4 Closure independence is intentional — and undocumented (§H)

Two doors reach `operational_file.status = CLOSED`:

* `closeDossier` (`process:close`) — closes the **process instance**, then calls
  the same guarded `transitionFile`;
* manual step-27 closure (`file:transition`) — closes the **dossier** only.

Both pass the identical closure gate, so neither can close an unsettled dossier.
**No architecture document explains the split.** And it must not be collapsed for
convenience: making `transitionFile` close the instance would hand every
`file:transition` holder the authority the collections migration deliberately
withheld — *« a collector may mark the recovery complete, but the dossier is
closed by a supervisor »*. §H says exactly this: do not collapse the two merely
because divergence is inconvenient.

**Since P1.7, `CLOSED` + `ACTIVE` has no operational consequence at all.** There
is no live defect to fix here — only an undocumented design.

## 5. Accepted state vs defect (§J)

| State | Classification |
|---|---|
| `CLOSED` file + `ACTIVE` process | **A — valid intentional state**, consequence-free since P1.7, but **undocumented** |
| `CLOSED` file + `CONFLICT` step | **C — historical inconsistency worth surfacing**, once an audience and owner exist |
| `COMPLETED` process + active file | not observed; structurally possible; unclassified |
| `CANCELLED` file + active process | not observed; the tower already excludes it (DEC-B43) |

## 6. What Effitrans / architecture must decide

1. **Who owns a process conflict?** OPS_SUPERVISOR, SYSTEM_ADMIN, the Direction,
   or nobody — is it purely informational?
2. **Is a conflict actionable, or only observable?** If actionable, through
   which act — and note that no such act exists today.
3. **The concrete case:** should Finance retroactively record the GAINDE
   registration on `EFT-IMP-2026-00003`, or does it stand as a historical gap?
4. **Should a manual step-27 closure also close the process instance?** If yes,
   by what authority — since `file:transition` holders deliberately do not hold
   `process:close`.
5. **Does a conflict belong in the dark `process_blocker` subsystem**, or is it a
   different concept that must not borrow that lifecycle?

Until (1) and (2) are answered, any surface would be inventing an audience.

## 7. What was NOT done, deliberately

No dashboard. No exception centre. No conflict table or migration — the verdict
is derivable from facts already stored, so storage was never the blocker. No
change to P1.7: terminal dossiers stay out of active workload, and conflicts will
**not** be made visible by putting them back. No change to closure.

## 8. Recommendation

Answer questions 1 and 2, then the smallest honest implementation is a
**read-only conflict indication for a named audience** — most plausibly on the
dossier, in business French (« Incohérence de processus — les données du dossier
et l'état du processus ne concordent pas »), with **no** resolution action until
one is defined. It needs no migration.

Until then the current behaviour is defensible: one known contradiction, on one
closed dossier, recorded in `maya-p12-gainde-convergence` and here.
