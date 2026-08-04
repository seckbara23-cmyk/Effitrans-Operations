# UT-3C — Implementation Brief

**Status: BRIEF ONLY — implementation is NOT authorised.** Nothing here has been built.
**Predecessor:** UT-3B **CLOSED** 2026-08-11, migration 86 applied, ledger 86/86.
**Governing:** DEC-B88 (UT-1A freeze) · [ut-3a-emitter-governance-audit.md](ut-3a-emitter-governance-audit.md)

---

## 1. What UT-3B left behind

| Item | State |
|---|---|
| Six trigger emitters | live for new acts |
| Ledger honesty marker | implemented, tested, **not recorded**, and **has no invocation surface** |
| `EXPENSE_AUTHORIZED` | dossier-linked only |
| `ADMIN_OVERRIDE_EXECUTED` / `WORKFLOW_REVERSED` | reserved — acts do not exist |
| Road observation adapter | live (Option C, `confidence: null`) |

## 2. Candidate scope — pick, do not assume

UT-3A's roadmap named UT-3C as "the road observation adapter", but **UT-3B already
delivered that**. So UT-3C's scope is genuinely open, and this brief refuses to invent one.
The candidates, smallest first:

### A. Close the marker's invocation gap *(smallest, no schema)*

`recordLedgerStartMarker()` has no caller. Either wire a minimal admin control, or ratify
that it stays an operator-SQL action forever and delete the unused module rather than
leaving a tested function nothing can reach. **A tested function with no caller is a
liability**: it reads as shipped capability and is not.
*Depends on:* nothing. *Schema:* none. *UI:* one control, if that route is chosen.

### B. Answer RATIFY-UT3-2 and adjust `EXPENSE_AUTHORIZED`

Today the emitter is silent for dossier-less expenses because such an event would match no
visibility branch. Two outcomes:
* **keep the scope** — no work, close the question;
* **cover all expenses** — requires a finance-prologue branch in the `business_event` SELECT
  policy, which is a **migration** and must be approved before any code.
*Depends on:* management. *Schema:* only under the second outcome.

### C. The two reserved types, properly

Build the override/reversal *acts* and their emitters in **one** phase (ADR-UT3-1). This is
a real business capability, not plumbing, and needs its own governance — who may override,
what evidence is required, what it does to the process instance.
*Depends on:* ratification. *Schema:* likely. **Not a tracking phase.**

### D. Answer RATIFY-UT3-4 (prose-carrying road types)

`DELAY_REPORTED` / `INCIDENT_REPORTED` are excluded because they carry free text. Admitting
them means deciding whether the timeline may carry prose at all — a doctrine change, not a
filter change.
*Depends on:* management. *Schema:* none. Default remains **no**.

## 3. What UT-3C must NOT do

No UI beyond the single control in option A · no new event store · no synchronization ·
no backfill · no copying between planes · no widening of a visibility policy to make an
event visible · no emitter without an act · no fabricated chronology · `audit_log` stays
forensic.

## 4. Reuse

`emit_business_event` and the registry · migration 86's trigger pattern (a conditional
`WHEN` on the transition, never on the value) · the UT-2 merged reader, which needs **no
change** — new events surface automatically because it dispatches on the registry · the
emitters suite pattern, including the post-`ROLLBACK` leak check.

## 5. Testing lessons UT-3C should inherit

Four CI rounds were spent in UT-3B. Before any SQL fixture is pushed, extract for **every
table it writes**:

1. required columns — `NOT NULL` with no default;
2. **unique indexes and inline uniques**, including partial ones.

Passing (1) does not imply (2): UT-3B failed on `uq_process_instance_file_active` *after*
a full required-columns pass, and a second latent violation
(`workflow_policy_version`: one ACTIVE per tenant) was found only by enumerating uniques
deliberately. Also verify the `raise` format-specifier count matches its argument count —
plpgsql fails at runtime, not at parse.

## 6. Open management items (all preserved)

| Ref | Question |
|---|---|
| **RATIFY-UT3-2** | dossier-less expenses: keep the scope, or widen the policy (a migration)? |
| **RATIFY-UT3-3** | confirm `DOCUMENT_SHARED_WITH_CLIENT` as customer-visible (`clientSafe: true` stands) |
| **RATIFY-UT3-4** | may prose-carrying road types ever enter the timeline? Default: no |
| **SEATS** | QUOTATION_MANAGER and OPS_SUPERVISOR held by **different** people |
| **SEATS-CONVERT** | one person holding both `file:create` and commercial read — until then **conversion cannot be performed by anyone** |

## 7. Readiness for UT-4

**UT-4 (the timeline surface) is unblocked and does not depend on UT-3C.** It consumes
`readUnifiedTimeline` unchanged. Its obligations: render `chronologyGroup` as simultaneity,
`confidence` as confidence, and an `ESTIMATED` external observation never with the authority
of a committed decision.

---

**UT-3C must not begin until a scope is chosen and explicitly authorised.**
